import "server-only";
import { generateText, stepCountIs } from "ai";
import { getModelInstance } from "lib/ai/models";
import { aiTelemetry } from "lib/ai/telemetry";
import { CHAT_MESSAGE_WINDOW } from "lib/const";
import { chatRepository } from "lib/db/repository";
import { generateUUID } from "lib/utils";
import {
  listAccessibleProjects,
  matchProjectByName,
} from "lib/voice/project-resolver";
import { VOICE_COMMAND_MODEL } from "lib/voice/run-transcript-command";
import { buildVoiceAgentContext } from "lib/voice/voice-session";
import globalLogger from "logger";
import { after } from "next/server";
import {
  createChatSpec,
  getChatReplySpec,
  listRecentChatsSpec,
  sendChatMessageSpec,
} from "../definitions";
import {
  type ActorBilling,
  assertActorCredits,
  requireAgentReference,
  toVoiceActor,
  trackActorTokens,
  trim,
} from "../shared";
import { NavigatorToolError, type ToolActor, defineTool } from "../types";
import { TOOL_MODEL_BILLING_ID } from "./agents";

const logger = globalLogger.withDefaults({ message: "Navigator Tools: " });

const CHAT_FALLBACK_REPLY =
  "Die Nachricht ist gespeichert, aber die Antwort konnte gerade nicht erzeugt werden. Bitte im Chat nachsehen.";

/** Where the turns these tools write came from, for the chat UI and audits. */
function messageSource(
  actor: ToolActor,
): "voice_realtime" | "navigator_mcp" | "navigator_cockpit" {
  return actor.source === "voice"
    ? "voice_realtime"
    : actor.source === "mcp"
      ? "navigator_mcp"
      : "navigator_cockpit";
}

async function persistAssistantTurn(
  actor: ToolActor,
  threadId: string,
  text: string,
) {
  await chatRepository
    .insertMessage({
      id: generateUUID(),
      threadId,
      role: "assistant",
      parts: [{ type: "text", text }],
      metadata: { source: messageSource(actor) },
    })
    .catch((error) => logger.warn("Failed to persist assistant turn:", error));
}

async function resolveProjectId(
  actor: ToolActor,
  projectName: string | undefined,
): Promise<string | undefined> {
  if (!projectName) return undefined;
  const projects = await listAccessibleProjects(
    actor.userId,
    actor.organizationId,
  ).catch(() => []);
  return matchProjectByName(projects, projectName)?.id;
}

/** A new thread owned by the actor, filed under a project they can reach. */
async function createThread(
  actor: ToolActor,
  input: { title?: string; message: string; projectName?: string },
): Promise<string> {
  const threadId = generateUUID();
  await chatRepository.insertThread({
    id: threadId,
    title: (input.title || input.message).slice(0, 80),
    userId: actor.userId,
    projectId: await resolveProjectId(actor, input.projectName),
  });
  return threadId;
}

async function insertUserTurn(
  actor: ToolActor,
  threadId: string,
  message: string,
) {
  await chatRepository.insertMessage({
    id: generateUUID(),
    threadId,
    role: "user",
    parts: [{ type: "text", text: message }],
    metadata: { source: messageSource(actor) },
  });
}

/**
 * Let an agent answer a message in its thread after the response is sent.
 *
 * The agent's tool run (MCP etc.) is too slow for a blocking call, so it
 * finishes in the background and the result lands in the thread.
 */
async function delegateInBackground(
  actor: ToolActor,
  billing: ActorBilling,
  input: { threadId: string; agentId: string; message: string },
): Promise<{ agentName: string } | null> {
  const context = await buildVoiceAgentContext({
    actor: toVoiceActor(actor),
    agentId: input.agentId,
    mentions: [],
  });
  if (!context.agent) return null;

  after(async () => {
    try {
      const model = await getModelInstance(VOICE_COMMAND_MODEL, actor.userId);
      const result = await generateText({
        model,
        system: context.systemPrompt,
        messages: [{ role: "user", content: input.message }],
        tools: context.mcpTools,
        stopWhen: stepCountIs(10),
        experimental_telemetry: aiTelemetry("navigator-tool.delegate", {
          withTools: true,
        }),
      });
      await trackActorTokens(actor, billing, {
        operation: "chat_delegate",
        modelId: TOOL_MODEL_BILLING_ID,
        usage: result.totalUsage ?? result.usage,
        responseId: result.response?.id,
      });
      await persistAssistantTurn(
        actor,
        input.threadId,
        result.text?.trim() ||
          "Erledigt — es gab aber nichts weiter zu berichten.",
      );
    } catch (error) {
      logger.error("Delegated agent run failed:", error);
      await persistAssistantTurn(actor, input.threadId, CHAT_FALLBACK_REPLY);
    }
  });

  return { agentName: context.agent.name };
}

/** A plain reply without tools, generated in the background. */
function replyInBackground(
  actor: ToolActor,
  billing: ActorBilling,
  input: { threadId: string; message: string },
) {
  after(async () => {
    const reply = await generatePlainReply(actor, billing, input.message);
    await persistAssistantTurn(actor, input.threadId, reply);
  });
}

async function generatePlainReply(
  actor: ToolActor,
  billing: ActorBilling,
  message: string,
): Promise<string> {
  try {
    const model = await getModelInstance(VOICE_COMMAND_MODEL, actor.userId);
    const result = await generateText({
      model,
      messages: [{ role: "user", content: message }],
      experimental_telemetry: aiTelemetry("navigator-tool.chat", {
        withTools: false,
      }),
    });
    await trackActorTokens(actor, billing, {
      operation: "chat_reply",
      modelId: TOOL_MODEL_BILLING_ID,
      usage: result.totalUsage ?? result.usage,
      responseId: result.response?.id,
    });
    return result.text?.trim() || CHAT_FALLBACK_REPLY;
  } catch (error) {
    logger.error("Chat reply generation failed:", error);
    return CHAT_FALLBACK_REPLY;
  }
}

export const createChatTool = defineTool(
  createChatSpec,
  async (actor, args) => {
    const agent = args.agent
      ? await requireAgentReference(actor, args.agent)
      : null;
    const billing = await assertActorCredits(actor);

    const threadId = await createThread(actor, args);
    await insertUserTurn(actor, threadId, args.message);

    if (agent) {
      const delegated = await delegateInBackground(actor, billing, {
        threadId,
        agentId: agent.id,
        message: args.message,
      });
      if (!delegated) {
        await persistAssistantTurn(actor, threadId, CHAT_FALLBACK_REPLY);
        throw new NavigatorToolError("not_found", "Agent not found.");
      }
      return {
        threadId,
        delegatedTo: delegated.agentName,
        status: "running",
        url: `/chat/${threadId}`,
      };
    }

    replyInBackground(actor, billing, { threadId, message: args.message });
    return { threadId, status: "running", url: `/chat/${threadId}` };
  },
);

export const sendChatMessageTool = defineTool(
  sendChatMessageSpec,
  async (actor, args) => {
    let threadId = args.threadId;
    let createdThread = false;

    if (threadId) {
      const thread = await chatRepository.selectThread(threadId);
      if (!thread || thread.userId !== actor.userId) {
        throw new NavigatorToolError("forbidden", "Chat thread not found");
      }
    }

    const billing = await assertActorCredits(actor);

    if (!threadId) {
      threadId = await createThread(actor, args);
      createdThread = true;
    }
    await insertUserTurn(actor, threadId, args.message);

    if (args.agentId) {
      const delegated = await delegateInBackground(actor, billing, {
        threadId,
        agentId: args.agentId,
        message: args.message,
      });
      if (!delegated) {
        await persistAssistantTurn(actor, threadId, CHAT_FALLBACK_REPLY);
        throw new NavigatorToolError("not_found", "Agent not found");
      }
      return {
        threadId,
        createdThread,
        delegatedTo: delegated.agentName,
        status: "running",
      };
    }

    // Plain message: answer inline without tools so the call stays fast.
    const reply = await generatePlainReply(actor, billing, args.message);
    await persistAssistantTurn(actor, threadId, reply);
    return { threadId, createdThread, reply: reply.slice(0, 600) };
  },
);

function textOfParts(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) =>
      part &&
      typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
        ? (part as { text: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

export const getChatReplyTool = defineTool(
  getChatReplySpec,
  async (actor, args) => {
    const thread = await chatRepository.selectThread(args.threadId);
    if (!thread || thread.userId !== actor.userId) {
      throw new NavigatorToolError("not_found", "Chat thread not found");
    }
    // Bounded like every chat read: only the newest window is ever loaded.
    const messages = await chatRepository.selectMessagesByThreadId(
      args.threadId,
      { limit: CHAT_MESSAGE_WINDOW },
    );
    const last = messages.at(-1);
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");

    return {
      threadId: args.threadId,
      title: thread.title,
      // The user spoke last: whatever answers it is still being written.
      pending: last?.role === "user",
      reply: lastAssistant
        ? {
            text: trim(textOfParts(lastAssistant.parts), 2000),
            createdAt: lastAssistant.createdAt
              ? new Date(lastAssistant.createdAt).toISOString()
              : null,
          }
        : null,
      url: `/chat/${args.threadId}`,
    };
  },
);

export const listRecentChatsTool = defineTool(
  listRecentChatsSpec,
  async (actor, args) => {
    const threads = await chatRepository.selectThreadsByUserId(actor.userId);
    return {
      chats: threads.slice(0, args.limit ?? 10).map((thread) => ({
        id: thread.id,
        title: trim(thread.title, 120),
        lastActivityAt: new Date(
          thread.lastMessageAt || thread.createdAt,
        ).toISOString(),
      })),
    };
  },
);

export const CHAT_TOOLS = [
  createChatTool,
  sendChatMessageTool,
  getChatReplyTool,
  listRecentChatsTool,
];
