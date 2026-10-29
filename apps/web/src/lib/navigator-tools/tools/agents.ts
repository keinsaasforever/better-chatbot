import "server-only";
import { generateText, stepCountIs } from "ai";
import { assertOwnedAgentFiles } from "lib/ai/agent/agent-files";
import { getModelInstance } from "lib/ai/models";
import { aiTelemetry } from "lib/ai/telemetry";
import { agentRepository } from "lib/db/repository";
import { VOICE_COMMAND_MODEL } from "lib/voice/run-transcript-command";
import { buildVoiceAgentContext } from "lib/voice/voice-session";
import globalLogger from "logger";
import {
  createAgentSpec,
  getAgentSpec,
  listAgentsSpec,
  runAgentSpec,
  updateAgentSpec,
} from "../definitions";
import {
  assertActorCredits,
  assertRolePermission,
  requireAgentReference,
  toVoiceActor,
  trackActorTokens,
  trim,
} from "../shared";
import { NavigatorToolError, defineTool } from "../types";

const logger = globalLogger.withDefaults({ message: "Navigator Tools: " });

/**
 * How long `run_agent` may take before it gives up.
 *
 * A realtime function call blocks the conversation, so this is a UX budget,
 * not a safety one: past roughly this long the user assumes the line is dead.
 */
const RUN_AGENT_TIMEOUT_MS = 45_000;

/** Billing id of the model the tool-side agent runs use. */
export const TOOL_MODEL_BILLING_ID = `${VOICE_COMMAND_MODEL.provider}/${VOICE_COMMAND_MODEL.model}`;

export const listAgentsTool = defineTool(listAgentsSpec, async (actor) => {
  const agents = await agentRepository.selectAgents(
    actor.userId,
    ["all"],
    50,
    actor.organizationId ?? undefined,
  );
  return {
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: trim(agent.description, 120),
    })),
  };
});

export const getAgentTool = defineTool(getAgentSpec, async (actor, args) => {
  const ref = await requireAgentReference(actor, args.agent);
  const agent = await agentRepository.selectAgentById(
    ref.id,
    actor.userId,
    actor.organizationId,
  );
  if (!agent) throw new NavigatorToolError("not_found", "Agent not found.");
  return {
    agent: {
      id: agent.id,
      name: agent.name,
      description: trim(agent.description, 400),
      role: trim(agent.instructions?.role, 200),
      instructions: trim(agent.instructions?.systemPrompt, 2000),
      visibility: agent.visibility,
      model: agent.model ?? null,
      isOwner: agent.userId === actor.userId,
    },
  };
});

export const createAgentTool = defineTool(
  createAgentSpec,
  async (actor, args) => {
    await assertRolePermission(
      actor,
      "create",
      "agent",
      "Only editors and admins can create agents.",
    );
    const agent = await agentRepository.insertAgent({
      name: args.name,
      description: args.description,
      userId: actor.userId,
      organizationId: actor.organizationId ?? null,
      instructions: {
        role: args.role,
        systemPrompt: args.instructions,
      },
      visibility: args.visibility ?? "private",
    });
    return {
      created: true,
      agent: { id: agent.id, name: agent.name, visibility: agent.visibility },
    };
  },
);

export const updateAgentTool = defineTool(
  updateAgentSpec,
  async (actor, args) => {
    await assertRolePermission(
      actor,
      "update",
      "agent",
      "Only editors and admins can edit agents.",
    );
    const ref = await requireAgentReference(actor, args.agent);
    const hasAccess = await agentRepository.checkAccess(
      ref.id,
      actor.userId,
      false,
      actor.organizationId,
    );
    if (!hasAccess) {
      throw new NavigatorToolError("forbidden", "This agent cannot be edited.");
    }
    const existing = await agentRepository.selectAgentById(
      ref.id,
      actor.userId,
      actor.organizationId,
    );
    if (!existing)
      throw new NavigatorToolError("not_found", "Agent not found.");

    // The instructions object is replaced as a whole on update, so merge into
    // the existing one: mentions, knowledge bases and files must survive a
    // role or prompt edit.
    const instructionsChanged =
      args.role !== undefined || args.instructions !== undefined;
    const instructions = instructionsChanged
      ? {
          ...existing.instructions,
          ...(args.role !== undefined ? { role: args.role } : {}),
          ...(args.instructions !== undefined
            ? { systemPrompt: args.instructions }
            : {}),
        }
      : undefined;

    // Same rule as PUT /api/agent/[id]: files carried over from the existing
    // agent stay; anything new must be owned by the editor.
    const ownership = assertOwnedAgentFiles({
      files: instructions?.files,
      userId: actor.userId,
      existingFiles: existing.instructions?.files,
    });
    if (!ownership.ok) {
      throw new NavigatorToolError(
        "forbidden",
        "Agent files must belong to the current user.",
      );
    }

    const agent = await agentRepository.updateAgent(
      ref.id,
      actor.userId,
      {
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.description !== undefined
          ? { description: args.description }
          : {}),
        ...(instructions ? { instructions } : {}),
        // A non-owner editing a shared agent keeps its visibility, as in the
        // route: only the owner decides who else sees it.
        ...(args.visibility !== undefined && existing.userId === actor.userId
          ? { visibility: args.visibility }
          : {}),
      },
      actor.organizationId,
    );
    return {
      updated: true,
      agent: { id: agent.id, name: agent.name, visibility: agent.visibility },
    };
  },
);

/**
 * Put a question to one of the user's agents and bring its answer back.
 *
 * This is what makes "ask the sales agent" work in a spoken conversation.
 * Unlike `send_chat_message`, which files the answer into a chat thread in the
 * background, this BLOCKS and returns the text so the realtime model can read
 * it out: an answer the user has to go and find in a thread is not an answer
 * in a voice conversation.
 *
 * The agent runs with its own system prompt, its own MCP tools AND the user's
 * Composio tools. The realtime session has the Composio meta-tools too; what
 * this adds is the agent's own instructions and a multi-step tool chain the
 * realtime model would otherwise have to drive one spoken turn at a time.
 */
export const runAgentTool = defineTool(runAgentSpec, async (actor, args) => {
  const ref = await requireAgentReference(actor, args.agent);
  const billing = await assertActorCredits(actor);

  const context = await buildVoiceAgentContext({
    actor: toVoiceActor(actor),
    agentId: ref.id,
    mentions: [],
  });
  if (!context.agent) {
    throw new NavigatorToolError("not_found", "Agent not found.");
  }

  // Imported here rather than at the top on purpose. `shared.chat` is a barrel
  // that reaches the workflow executor and, through it, every chat tool: a
  // module graph heavy enough that loading it at import time slows every other
  // tool's cold start. Composio can be slow to introspect too; a failure to
  // load it degrades the answer and never fails the call.
  const { loadComposioTools } = await import("@/app/api/chat/shared.chat");
  const composioTools = await loadComposioTools(actor.userId).catch(() => ({}));

  try {
    const model = await getModelInstance(VOICE_COMMAND_MODEL, actor.userId);
    const result = await generateText({
      model,
      system: context.systemPrompt,
      messages: [{ role: "user", content: args.question }],
      tools: {
        ...context.mcpTools,
        ...composioTools,
      } as typeof context.mcpTools,
      // Tighter than the chat delegate's ten: a caller is waiting on this,
      // and a long tool chain is better handled by send_chat_message.
      stopWhen: stepCountIs(6),
      abortSignal: AbortSignal.timeout(RUN_AGENT_TIMEOUT_MS),
      experimental_telemetry: aiTelemetry("navigator-tool.run-agent", {
        withTools: true,
      }),
    });
    await trackActorTokens(actor, billing, {
      operation: "run_agent",
      modelId: TOOL_MODEL_BILLING_ID,
      usage: result.totalUsage ?? result.usage,
      responseId: result.response?.id,
    });

    const answer = result.text?.trim();
    return {
      agent: context.agent.name,
      answer:
        answer || `${context.agent.name} ran but returned nothing to say.`,
    };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    logger.error(
      `run_agent failed for ${ref.name}`,
      error instanceof Error ? error.message : error,
    );
    throw new NavigatorToolError(
      timedOut ? "timeout" : "agent_failed",
      timedOut
        ? `${context.agent.name} took too long to answer. Offer to send it as a chat message instead with send_chat_message.`
        : `${context.agent.name} could not answer just now.`,
    );
  }
});

export const AGENT_TOOLS = [
  listAgentsTool,
  getAgentTool,
  createAgentTool,
  updateAgentTool,
  runAgentTool,
];
