"use server";

import {
  generateText,
  Output,
  jsonSchema,
  LanguageModel,
  type UIMessage,
} from "ai";

import {
  CREATE_THREAD_TITLE_PROMPT,
  generateExampleToolSchemaPrompt,
} from "lib/ai/prompts";

import type { ChatModel, ChatThread } from "app-types/chat";
import {
  AgentKnowledgeBaseBindingSchema,
  type AgentKnowledgeBaseBinding,
} from "app-types/agent";
import { MAX_KNOWLEDGE_SOURCES } from "lib/chat/knowledge-base-mentions";
import { RUN_RECOVERY_WINDOW } from "lib/chat/persisted-tail";
import z from "zod";

import {
  agentRepository,
  chatExportRepository,
  chatRepository,
  mcpMcpToolCustomizationRepository,
  mcpServerCustomizationRepository,
} from "lib/db/repository";
import { customModelProvider } from "lib/ai/models";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ChatThreadTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { toAny } from "lib/utils";
import { McpServerCustomizationsPrompt, MCPToolInfo } from "app-types/mcp";
import { serverCache } from "lib/cache";
import { CacheKeys } from "lib/cache/cache-keys";
import { CHAT_MESSAGE_WINDOW } from "lib/const";
import { getSession } from "auth/server";
import logger from "logger";

import { JSONSchema7 } from "json-schema";
import { ObjectJsonSchema7 } from "app-types/util";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { aiTelemetry } from "lib/ai/telemetry";

export async function getUserId() {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error("User not found");
  }
  return userId;
}

export async function generateTitleFromUserMessageAction({
  message,
  model,
}: { message: UIMessage; model: LanguageModel }) {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  const prompt = toAny(message.parts?.at(-1))?.text || "unknown";

  const { text: title } = await generateText({
    model,
    system: CREATE_THREAD_TITLE_PROMPT,
    experimental_telemetry: aiTelemetry("chat.title.action"),
    prompt,
  });

  return title.trim();
}

export async function selectThreadWithMessagesAction(threadId: string) {
  // Session, thread (joined with its project name), and the newest message
  // window are mutually independent, so fetch them in one parallel batch
  // instead of stacking round trips. Messages are fetched eagerly but only
  // returned once ownership is confirmed, so nothing leaks across users.
  // The project join removes the page's separate follow-up query.
  const [session, threadRow, messages] = await Promise.all([
    getSession(),
    pgDb
      .select({
        id: ChatThreadTable.id,
        title: ChatThreadTable.title,
        userId: ChatThreadTable.userId,
        projectId: ChatThreadTable.projectId,
        knowledgeBases: ChatThreadTable.knowledgeBases,
        createdAt: ChatThreadTable.createdAt,
        projectName: ProjectTable.name,
      })
      .from(ChatThreadTable)
      .leftJoin(ProjectTable, eq(ChatThreadTable.projectId, ProjectTable.id))
      .where(eq(ChatThreadTable.id, threadId))
      .limit(1)
      .then((rows) => rows[0]),
    // Newest window only; older messages load on demand via
    // loadOlderThreadMessagesAction. Avoids de-TOASTing the whole transcript on
    // every thread open.
    chatRepository.selectMessagesByThreadId(threadId, {
      limit: CHAT_MESSAGE_WINDOW,
    }),
  ]);

  if (!session) {
    throw new Error("Unauthorized");
  }
  if (!threadRow) {
    logger.error("Thread not found", threadId);
    return null;
  }
  if (threadRow.userId !== session.user.id) {
    return null;
  }

  const projectInfo =
    threadRow.projectId && threadRow.projectName
      ? { id: threadRow.projectId, name: threadRow.projectName }
      : undefined;

  return {
    id: threadRow.id,
    title: threadRow.title,
    userId: threadRow.userId,
    projectId: threadRow.projectId ?? undefined,
    knowledgeBases: threadRow.knowledgeBases ?? [],
    createdAt: threadRow.createdAt,
    messages: messages ?? [],
    projectInfo,
  };
}

export async function loadOlderThreadMessagesAction(
  threadId: string,
  beforeMessageId: string,
) {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  const thread = await chatRepository.selectThread(threadId);
  if (!thread || thread.userId !== session.user.id) {
    return [];
  }
  return chatRepository.selectMessagesByThreadId(threadId, {
    limit: CHAT_MESSAGE_WINDOW,
    beforeMessageId,
  });
}

/**
 * The newest rows of a thread, for a client whose stream died to reconcile
 * against once the server-side run has ended. Small on purpose: a run touches
 * at most two rows, and this is polled while the run is still going.
 */
export async function loadLatestThreadMessagesAction(threadId: string) {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  const thread = await chatRepository.selectThread(threadId);
  if (!thread || thread.userId !== session.user.id) {
    return [];
  }
  return chatRepository.selectMessagesByThreadId(threadId, {
    limit: RUN_RECOVERY_WINDOW,
  });
}

export async function deleteMessageAction(messageId: string) {
  const userId = await getUserId();
  await chatRepository.deleteChatMessage(messageId, userId);
}

export async function deleteThreadAction(threadId: string) {
  const userId = await getUserId();
  const hasAccess = await chatRepository.checkAccess(threadId, userId);
  if (!hasAccess) {
    throw new Error("Unauthorized");
  }
  await chatRepository.deleteThread(threadId);
}

export async function deleteMessagesByChatIdAfterTimestampAction(
  messageId: string,
) {
  "use server";
  const userId = await getUserId();
  await chatRepository.deleteMessagesByChatIdAfterTimestamp(messageId, userId);
}

export async function createThreadWithProjectAction(projectId: string) {
  "use server";
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const { generateUUID } = await import("lib/utils");
  const threadId = generateUUID();

  await chatRepository.insertThread({
    id: threadId,
    title: "",
    userId: session.user.id,
    projectId,
  });

  return threadId;
}

export async function updateThreadAction(
  id: string,
  thread: Partial<Omit<ChatThread, "createdAt" | "updatedAt" | "userId">>,
) {
  const userId = await getUserId();
  await chatRepository.updateThread(id, { ...thread, userId });
}

/**
 * Replaces the knowledge sources attached to a thread from the composer.
 *
 * Returns false when the thread has no row yet (a draft whose first message is
 * still unsent) — the chat POST writes the same list when it creates the
 * thread, so the attachment is never lost, it just becomes durable a moment
 * later. Deliberately does NOT create the thread: an empty row would show up
 * in the sidebar as a phantom chat.
 */
export async function setThreadKnowledgeBasesAction(
  threadId: string,
  knowledgeBases: AgentKnowledgeBaseBinding[],
) {
  const userId = await getUserId();
  const parsed = z
    .array(AgentKnowledgeBaseBindingSchema)
    .max(MAX_KNOWLEDGE_SOURCES)
    .safeParse(knowledgeBases);
  if (!parsed.success) throw new Error("Invalid knowledge base bindings");
  return chatRepository.setThreadKnowledgeBases(threadId, userId, parsed.data);
}

export async function deleteThreadsAction() {
  const userId = await getUserId();
  await chatRepository.deleteAllThreads(userId);
}

export async function deleteUnarchivedThreadsAction() {
  const userId = await getUserId();
  await chatRepository.deleteUnarchivedThreads(userId);
}

export async function generateExampleToolSchemaAction(options: {
  model?: ChatModel;
  toolInfo: MCPToolInfo;
  prompt?: string;
}) {
  const model = customModelProvider.getModel(options.model);

  const schema = jsonSchema(
    toAny({
      ...options.toolInfo.inputSchema,
      properties: options.toolInfo.inputSchema?.properties ?? {},
      additionalProperties: false,
    }),
  );
  const { output } = await generateText({
    model,
    experimental_telemetry: aiTelemetry("tool.example-schema"),
    output: Output.object({
      schema,
    }),
    prompt: generateExampleToolSchemaPrompt({
      toolInfo: options.toolInfo,
      prompt: options.prompt,
    }),
  });

  return output;
}

export async function rememberMcpServerCustomizationsAction(userId: string) {
  const key = CacheKeys.mcpServerCustomizations(userId);

  const cachedMcpServerCustomizations =
    await serverCache.get<Record<string, McpServerCustomizationsPrompt>>(key);
  if (cachedMcpServerCustomizations) {
    return cachedMcpServerCustomizations;
  }

  const mcpServerCustomizations =
    await mcpServerCustomizationRepository.selectByUserId(userId);
  const mcpToolCustomizations =
    await mcpMcpToolCustomizationRepository.selectByUserId(userId);

  const serverIds: string[] = [
    ...mcpServerCustomizations.map(
      (mcpServerCustomization) => mcpServerCustomization.mcpServerId,
    ),
    ...mcpToolCustomizations.map(
      (mcpToolCustomization) => mcpToolCustomization.mcpServerId,
    ),
  ];

  const prompts = Array.from(new Set(serverIds)).reduce(
    (acc, serverId) => {
      const sc = mcpServerCustomizations.find((v) => v.mcpServerId == serverId);
      const tc = mcpToolCustomizations.filter(
        (mcpToolCustomization) => mcpToolCustomization.mcpServerId === serverId,
      );
      const data: McpServerCustomizationsPrompt = {
        name: sc?.serverName || tc[0]?.serverName || "",
        id: serverId,
        prompt: sc?.prompt || "",
        tools: tc.reduce(
          (acc, v) => {
            acc[v.toolName] = v.prompt || "";
            return acc;
          },
          {} as Record<string, string>,
        ),
      };
      acc[serverId] = data;
      return acc;
    },
    {} as Record<string, McpServerCustomizationsPrompt>,
  );

  serverCache.set(key, prompts, 1000 * 60 * 30); // 30 minutes
  return prompts;
}

export async function generateObjectAction({
  model,
  prompt,
  schema,
}: {
  model?: ChatModel;
  prompt: {
    system?: string;
    user?: string;
  };
  schema: JSONSchema7 | ObjectJsonSchema7;
}) {
  const result = await generateText({
    model: customModelProvider.getModel(model),
    experimental_telemetry: aiTelemetry("chat.structured-output", {
      provider: model?.provider,
      modelId: model?.model,
    }),
    system: prompt.system,
    prompt: prompt.user || "",
    output: Output.object({
      schema: jsonSchemaToZod(schema),
    }),
  });
  return result.output;
}

export async function rememberAgentAction(
  agent: string | undefined,
  userId: string,
  activeOrganizationId?: string | null,
) {
  if (!agent) return undefined;
  // No cache: agent instructions are ownership-filtered per user, so a shared
  // cache key would leak one user's private agent to another. selectAgentById
  // is a single indexed lookup by id.
  const foundAgent = await agentRepository.selectAgentById(
    agent,
    userId,
    activeOrganizationId,
  );
  return foundAgent ?? undefined;
}

export async function exportChatAction({
  threadId,
  expiresAt,
}: {
  threadId: string;
  expiresAt?: Date;
}) {
  const userId = await getUserId();

  const isAccess = await chatRepository.checkAccess(threadId, userId);
  if (!isAccess) {
    return new Response("Unauthorized", { status: 401 });
  }

  return await chatExportRepository.exportChat({
    threadId,
    exporterId: userId,
    expiresAt: expiresAt ?? undefined,
  });
}
