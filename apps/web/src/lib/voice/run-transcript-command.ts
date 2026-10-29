import { generateText, stepCountIs } from "ai";
import { getModelInstance } from "lib/ai/models";
import { loadComposioTools } from "@/app/api/chat/shared.chat";
import { chatRepository } from "lib/db/repository";
import { generateUUID } from "lib/utils";
import globalLogger from "logger";
import { classifyTranscript } from "./classify-transcript";
import {
  listUserProjects,
  matchProjectByName,
  resolveProjectId,
} from "./project-resolver";
import {
  RunTranscriptCommandInput,
  RunTranscriptCommandResult,
  VoiceTranscriptAction,
  VoiceTranscriptActionStatus,
} from "./types";
import { buildVoiceAgentContext, VoiceAgentContext } from "./voice-session";
import { createAgentFromTranscript } from "./create-agent-from-transcript";
import { createScheduledAgentTask } from "./create-scheduled-agent-task";
import { aiTelemetry } from "lib/ai/telemetry";

const logger = globalLogger.withDefaults({ message: "Voice Transcript: " });

/** Navigator base model, by alias so a base-model swap carries here. */
export const VOICE_COMMAND_MODEL = {
  provider: "Navigator",
  model: "Base model",
} as const;

function normalizeToolSteps(steps: unknown): VoiceTranscriptAction[] {
  const actions: VoiceTranscriptAction[] = [];
  for (const step of (steps as Array<{
    toolCalls?: Array<{ toolName: string }>;
  }>) ?? []) {
    for (const toolCall of step.toolCalls ?? []) {
      actions.push({
        toolName: toolCall.toolName,
        ok: true,
        summary: toolCall.toolName,
      });
    }
  }
  return actions;
}

/**
 * Run the user's full agent over a transcript: voice context (MCP +
 * customizations) merged with ALL Composio tools — the same capability set as
 * typing into the chat input. Returns the assistant text + tool actions.
 *
 * If the tool-laden call throws (e.g. the provider rejects a Composio tool
 * schema or the tools payload is too large), it retries once WITHOUT tools so
 * the user still gets a spoken/text answer instead of a silent failure.
 */
async function runAgent(
  input: RunTranscriptCommandInput,
  context: VoiceAgentContext,
) {
  const composioTools = await loadComposioTools(input.actor.userId).catch(
    () => ({}),
  );
  const tools = {
    ...context.mcpTools,
    ...composioTools,
  } as typeof context.mcpTools;

  const model = await getModelInstance(VOICE_COMMAND_MODEL, input.actor.userId);

  try {
    return await generateText({
      model,
      system: context.systemPrompt,
      messages: [{ role: "user", content: input.text }],
      tools,
      experimental_telemetry: aiTelemetry("voice.command.run", {
        withTools: true,
      }),
      stopWhen: stepCountIs(10),
    });
  } catch (error: any) {
    logger.error("Voice agent run with tools failed; retrying without tools", {
      userId: input.actor.userId,
      toolCount: Object.keys(tools).length,
      error: error?.message ?? String(error),
    });
    // Fallback: no tools so a bad/oversized tool payload can't block a reply.
    return generateText({
      model,
      system: context.systemPrompt,
      experimental_telemetry: aiTelemetry("voice.command.run", {
        withTools: false,
      }),
      messages: [{ role: "user", content: input.text }],
    });
  }
}

export async function runTranscriptCommand(
  input: RunTranscriptCommandInput,
): Promise<RunTranscriptCommandResult> {
  const { actor, text, sessionId } = input;

  // 1. Classify intent + resolve a candidate project name.
  const projects = await listUserProjects(actor.userId).catch(() => []);
  const classification = await classifyTranscript({
    userId: actor.userId,
    text,
    projects,
  }).catch((error) => {
    logger.warn("Classification failed, defaulting to question:", error);
    return null;
  });
  const intent = classification?.intent ?? "question";
  const classificationMeta: Record<string, unknown> = {
    intent,
    projectName: classification?.projectName ?? null,
    title: classification?.title ?? null,
    rationale: classification?.rationale ?? null,
  };

  // 2. WORKFLOW → create a draft (Magic Paste done; stops at human Refine).
  if (intent === "agent" || intent === "scheduled_agent") {
    const agentSpec = classification?.agent;
    const agent = await createAgentFromTranscript({
      userId: actor.userId,
      organizationId: actor.organizationId,
      name: agentSpec?.name || classification?.title || "Voice Agent",
      description: agentSpec?.description || text.slice(0, 500),
      role: agentSpec?.role || "Autonomous assistant created from voice input",
      systemPrompt:
        agentSpec?.systemPrompt ||
        `You are an agent created from this voice instruction:\n\n${text}`,
    });

    let scheduledTaskId: string | null = null;
    if (intent === "scheduled_agent") {
      const cronExpression = classification?.schedule?.cronExpression;
      if (!cronExpression) {
        return {
          type: "agent.result",
          sessionId,
          message:
            "I drafted the agent idea, but I need a clearer schedule before enabling it.",
          actions: [{ toolName: "agent.draft", ok: true, summary: agent.id }],
          intent: "agent",
          projectId: null,
          actionStatus: "needs_review",
          classification: { ...classificationMeta, agentId: agent.id },
          createdAgentId: agent.id,
        };
      }

      try {
        const scheduledTask = await createScheduledAgentTask({
          userId: actor.userId,
          agentId: agent.id,
          name: `Scheduled ${agent.name}`,
          description: `Created from voice session ${sessionId}`,
          cronExpression,
          timezone: classification.schedule?.timezone || "Europe/Berlin",
          inputPrompt: classification.schedule?.inputPrompt || text,
        });
        scheduledTaskId = scheduledTask.id;
      } catch {
        // Invalid LLM-generated cron. Keep the agent, but don't pretend it was
        // scheduled — tell the user so they can restate the timing.
        return {
          type: "agent.result",
          sessionId,
          message: `I created the agent "${agent.name}", but couldn't understand the schedule. Please tell me when it should run.`,
          actions: [{ toolName: "agent.create", ok: true, summary: agent.id }],
          intent: "agent",
          projectId: null,
          actionStatus: "needs_review",
          classification: { ...classificationMeta, agentId: agent.id },
          createdAgentId: agent.id,
        };
      }
    }

    return {
      type: "agent.result",
      sessionId,
      message: scheduledTaskId
        ? `I created the agent "${agent.name}" and scheduled it.`
        : `I created the agent "${agent.name}".`,
      actions: [
        { toolName: "agent.create", ok: true, summary: agent.id },
        ...(scheduledTaskId
          ? [
              {
                toolName: "scheduled_task.create",
                ok: true,
                summary: scheduledTaskId,
              },
            ]
          : []),
      ],
      intent: scheduledTaskId ? "scheduled_agent" : "agent",
      projectId: null,
      actionStatus: "executed",
      classification: {
        ...classificationMeta,
        agentId: agent.id,
        scheduledTaskId,
      },
      createdAgentId: agent.id,
      createdScheduledTaskId: scheduledTaskId,
    };
  }

  // 2. WORKFLOW → create a draft (Magic Paste done; stops at human Refine).
  if (intent === "workflow") {
    if (!actor.organizationId) {
      const { projectId } = await resolveProjectId({
        userId: actor.userId,
        projectName: classification?.projectName,
        fallbackToInbox: true,
      });
      return {
        type: "agent.result",
        sessionId,
        message:
          "I noted that automation idea, but you need an active organization to build a workflow. Saved it for review.",
        actions: [],
        intent: "workflow",
        projectId,
        actionStatus: "needs_review",
        classification: classificationMeta,
      };
    }
    try {
      const { createWorkflowDraftFromTranscript } = await import(
        "@/lib/voice/workflow-draft"
      );
      const draft = await createWorkflowDraftFromTranscript({
        userId: actor.userId,
        orgId: actor.organizationId,
        text,
      });
      if (!draft) {
        return {
          type: "agent.result",
          sessionId,
          message:
            "I noted that automation idea. Open Workflows to build it out.",
          actions: [],
          intent: "workflow",
          projectId: null,
          actionStatus: "needs_review",
          classification: classificationMeta,
        };
      }
      const { workflowId } = draft;
      return {
        type: "agent.result",
        sessionId,
        message: `I drafted a workflow for "${
          classification?.title || "your automation"
        }". Open it to refine and connect tools.`,
        actions: [
          { toolName: "workflow.draft", ok: true, summary: workflowId },
        ],
        intent: "workflow",
        projectId: null,
        actionStatus: "executed",
        classification: { ...classificationMeta, workflowId },
        createdWorkflowId: workflowId,
      };
    } catch (error: any) {
      logger.error("Workflow draft creation failed:", error);
      return {
        type: "agent.result",
        sessionId,
        message: "I couldn't create the workflow draft. Saved it for review.",
        actions: [],
        intent: "workflow",
        projectId: null,
        actionStatus: "failed",
        classification: {
          ...classificationMeta,
          error: error?.message ?? "unknown",
        },
      };
    }
  }

  // 3. TASK → new chat with the user's FULL toolset (not project-bound unless
  //    the transcript explicitly named a project).
  if (intent === "task") {
    const explicitProject = matchProjectByName(
      projects,
      classification?.projectName,
    );
    const projectId = explicitProject?.id ?? null;
    const threadId = generateUUID();
    const title = (classification?.title || text).slice(0, 80);

    logger.info("Voice task classified; preparing agent run", {
      sessionId,
      userId: actor.userId,
      projectId,
      threadId,
      textLength: text.length,
      title,
    });

    const context = await buildVoiceAgentContext({
      actor,
      agentId: input.agentId,
      mentions: input.mentions ?? [],
    });

    // Run the agent. runAgent already falls back to a no-tools reply on
    // provider errors, but if it still fails (or returns empty text) we persist
    // a clear assistant message so the chat thread is never left empty — that
    // silent state is the "message sent, nothing happens" symptom.
    let assistantText: string;
    let actions: VoiceTranscriptAction[] = [];
    let actionStatus: VoiceTranscriptActionStatus = "executed";
    try {
      logger.info("Running voice task agent", {
        sessionId,
        threadId,
        mcpToolCount: Object.keys(context.mcpTools).length,
        agentId: input.agentId ?? null,
      });
      const result = await runAgent(input, context);
      assistantText = result.text?.trim()
        ? result.text
        : "Done — I processed that, but didn't have anything to add.";
      actions = normalizeToolSteps(result.steps);
      logger.info("Voice task agent completed", {
        sessionId,
        threadId,
        responseLength: result.text?.length ?? 0,
        stepCount: result.steps.length,
      });
    } catch (error: any) {
      logger.error("Voice task agent execution failed", {
        sessionId,
        threadId,
        error: error?.message ?? String(error),
        stack: error?.stack,
      });
      assistantText =
        "Sorry, I couldn't complete that just now. Please try again.";
      actionStatus = "failed";
    }

    // Always persist a complete thread: thread + user turn + assistant turn.
    await chatRepository.insertThread({
      id: threadId,
      title,
      userId: actor.userId,
      projectId: projectId ?? undefined,
    });
    await chatRepository.insertMessage({
      id: generateUUID(),
      threadId,
      role: "user",
      parts: [{ type: "text", text }],
      metadata: {
        source: "voice_transcript",
        voiceSessionId: sessionId,
      },
    });
    await chatRepository
      .insertMessage({
        id: generateUUID(),
        threadId,
        role: "assistant",
        parts: [{ type: "text", text: assistantText }],
        metadata: {
          source: "voice_transcript",
          voiceSessionId: sessionId,
        },
      })
      .catch((error) =>
        logger.warn("Failed to persist assistant turn:", error),
      );
    logger.info("Persisted voice task chat turn", {
      sessionId,
      threadId,
      actionStatus,
    });

    return {
      type: "agent.result",
      sessionId,
      message: assistantText,
      actions,
      intent: "task",
      projectId,
      actionStatus,
      classification: { ...classificationMeta, threadId },
      createdThreadId: threadId,
    };
  }

  // 4. NOTE → store under the resolved project (Voice Inbox fallback). No agent.
  if (intent === "note") {
    const { projectId, matched } = await resolveProjectId({
      userId: actor.userId,
      projectName: classification?.projectName,
      fallbackToInbox: true,
    });
    return {
      type: "agent.result",
      sessionId,
      message: matched
        ? "Saved that to the project."
        : "Saved that to your Voice Inbox.",
      actions: [],
      intent: "note",
      projectId,
      actionStatus: "stored",
      classification: classificationMeta,
    };
  }

  // 5. QUESTION / fallback → answer now with full tools; no thread created.
  const context = await buildVoiceAgentContext({
    actor,
    agentId: input.agentId,
    mentions: input.mentions ?? [],
  });
  const result = await runAgent(input, context);
  const { projectId } = await resolveProjectId({
    userId: actor.userId,
    projectName: classification?.projectName,
    fallbackToInbox: false,
  });

  return {
    type: "agent.result",
    sessionId,
    message: result.text,
    actions: normalizeToolSteps(result.steps),
    intent: "question",
    projectId,
    actionStatus: "executed",
    classification: classificationMeta,
  };
}
