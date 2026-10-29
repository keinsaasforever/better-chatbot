import "server-only";

import { createHash } from "node:crypto";
import { getMCPClientsManager } from "@/lib/ai/mcp/mcp-manager";
import { projectBrainModelId } from "@/lib/ai/models";
import { composio } from "@/lib/composio/client";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ChatMessageTable,
  DocumentChunkTable,
  ProjectBrainRunTable,
  ProjectConnectedToolTable,
  ProjectMemberTable,
  ProjectTable,
  VoiceSessionTable,
} from "@/lib/db/pg/schema.pg";
import { type Tool, generateText, stepCountIs } from "ai";
import { and, asc, eq } from "drizzle-orm";
import { aiTelemetry } from "lib/ai/telemetry";
import { buildGatherSystemPrompt } from "./prompts";
import { createProjectBrainRawSource } from "./raw-source";
import { buildToolCatalog } from "./tool-catalog";
import { classifyToolResult } from "./tool-result";

export class ProjectSourceError extends Error {
  constructor(
    public readonly code:
      | "connection_not_active"
      | "credential_owner_removed"
      | "no_read_actions"
      | "no_data_returned"
      | "source_failed",
    message: string,
  ) {
    super(message);
    this.name = "ProjectSourceError";
  }
}

/**
 * Codes that fail identically on every attempt until someone reconnects the
 * connector. Retrying them through Inngest's exponential backoff burns the
 * run's entire time budget to reach the same outcome, so the pipeline converts
 * these into a non-retriable failure instead.
 */
const PERMANENT_SOURCE_ERROR_CODES = new Set<ProjectSourceError["code"]>([
  "connection_not_active",
  "credential_owner_removed",
  "no_read_actions",
]);

/** Unwraps a ProjectSourceError that may be carried as another error's cause. */
export function resolveSourceError(error: unknown): ProjectSourceError | null {
  if (error instanceof ProjectSourceError) return error;
  const cause = (error as { cause?: unknown } | null | undefined)?.cause;
  return cause instanceof ProjectSourceError ? cause : null;
}

export function isPermanentSourceError(error: unknown): boolean {
  const sourceError = resolveSourceError(error);
  return (
    sourceError !== null && PERMANENT_SOURCE_ERROR_CODES.has(sourceError.code)
  );
}

/**
 * The connector status a failed load implies, or null when the failure says
 * nothing about the connector itself (e.g. an empty or broken payload).
 * Reconnecting through the tool picker resets this back to "connected".
 */
export function connectorStatusForSourceError(
  code: ProjectSourceError["code"],
): "needs_auth" | "error" | null {
  switch (code) {
    case "connection_not_active":
    case "credential_owner_removed":
      return "needs_auth";
    case "no_read_actions":
      return "error";
    default:
      return null;
  }
}

const READ_ACTION =
  /(^|_)(GET|LIST|SEARCH|FIND|FETCH|RETRIEVE|READ|QUERY|LOOKUP|DESCRIBE|DETAILS|HISTORY|STATUS|STATS|REPORT)(_|$)/;
const WRITE_ACTION =
  /(^|_)(CREATE|UPDATE|DELETE|REMOVE|SEND|WRITE|POST|PUT|PATCH|MOVE|COPY|UPLOAD|INVITE|ADD|CANCEL|ARCHIVE|TRIGGER|EXECUTE)(_|$)/;

export function isReadOnlyComposioAction(slug: string) {
  const normalized = slug.toUpperCase();
  return READ_ACTION.test(normalized) && !WRITE_ACTION.test(normalized);
}

async function gatherWithTools(input: {
  projectName: string;
  projectGoal?: string | null;
  projectDescription?: string | null;
  projectSystemPrompt?: string | null;
  connectorName: string;
  tools: Record<string, Tool>;
}) {
  const result = await generateText({
    model: projectBrainModelId,
    experimental_telemetry: aiTelemetry("brain.source.run", {
      modelId: projectBrainModelId,
    }),
    abortSignal: AbortSignal.timeout(90_000),
    tools: input.tools,
    stopWhen: stepCountIs(6),
    system: buildGatherSystemPrompt(input),
    prompt: `Load relevant current data from ${input.connectorName}.`,
  });

  const allResults = (result.steps ?? []).flatMap((step) =>
    (step.toolResults ?? []).map((toolResult) => ({
      toolName: toolResult.toolName,
      result: "output" in toolResult ? toolResult.output : toolResult,
    })),
  );

  if (allResults.length === 0) {
    throw new ProjectSourceError(
      "no_data_returned",
      "The connector completed without calling a read action.",
    );
  }

  // Connector errors arrive as ordinary tool results. Keep them out of the
  // source text, otherwise the extraction step reads "HTTP 403" as project
  // state. When nothing succeeded the run must fail like a dead connector so
  // the Brain tab prompts a reconnect instead of rendering the error.
  const failed: Array<{
    toolName: string;
    message: string;
    authLike: boolean;
  }> = [];
  const toolResults = allResults.filter((item) => {
    const verdict = classifyToolResult(item.result);
    if (verdict.ok) return true;
    failed.push({
      toolName: item.toolName,
      message: verdict.message,
      authLike: verdict.authLike,
    });
    return false;
  });

  if (toolResults.length === 0) {
    const authFailure = failed.find((item) => item.authLike);
    if (authFailure) {
      throw new ProjectSourceError(
        "connection_not_active",
        `The connector rejected the request: ${authFailure.message.slice(0, 300)}`,
      );
    }
    throw new ProjectSourceError(
      "no_data_returned",
      `Every read action failed: ${failed[0]?.message.slice(0, 300) ?? "unknown error"}`,
    );
  }

  const rawText = JSON.stringify(toolResults);
  const boundedRawText = rawText.slice(0, 100_000);
  const textContent = [result.text, "Raw connector data:", boundedRawText]
    .filter(Boolean)
    .join("\n\n");

  return {
    textContent,
    rawPayload: {
      toolNames: toolResults.map((item) => item.toolName),
      toolCallCount: toolResults.length,
      failedToolNames: failed.map((item) => item.toolName),
      truncated: rawText.length > boundedRawText.length,
      rawText: boundedRawText,
      toolCatalog: buildToolCatalog(input.tools),
    },
    contentHash: createHash("sha256").update(textContent).digest("hex"),
  };
}

async function loadComposioSource(input: {
  connector: typeof ProjectConnectedToolTable.$inferSelect;
  project: typeof ProjectTable.$inferSelect;
}) {
  if (!input.connector.connectionRef) {
    throw new ProjectSourceError(
      "connection_not_active",
      "This connector needs to be reconnected.",
    );
  }

  const accountPage = await composio.connectedAccounts.list({
    userIds: [input.connector.credentialOwnerUserId],
    toolkitSlugs: [input.connector.providerRef],
    statuses: ["ACTIVE"],
    limit: 100,
  });

  const account = accountPage.items.find(
    (item) => item.id === input.connector.connectionRef && !item.isDisabled,
  );

  if (!account) {
    throw new ProjectSourceError(
      "connection_not_active",
      "The connector's bound account is no longer active.",
    );
  }

  const allTools = (await composio.tools.get(
    input.connector.credentialOwnerUserId,
    { toolkits: [input.connector.providerRef] },
    {
      signal: AbortSignal.timeout(20_000),
      beforeExecute: ({ params }) => ({
        ...params,
        connectedAccountId: account.id,
      }),
    },
  )) as unknown as Record<string, Tool>;

  const allowed = new Set(input.connector.syncConfig.readActionSlugs ?? []);
  const tools = Object.fromEntries(
    Object.entries(allTools).filter(
      ([slug]) => allowed.has(slug) && isReadOnlyComposioAction(slug),
    ),
  );

  if (!Object.keys(tools).length) {
    throw new ProjectSourceError(
      "no_read_actions",
      "The connector exposes no supported read actions.",
    );
  }

  return gatherWithTools({
    projectName: input.project.name,
    projectGoal: input.project.goal,
    projectDescription: input.project.description,
    projectSystemPrompt: input.project.systemPrompt,
    connectorName: input.connector.displayName,
    tools,
  });
}

async function loadMcpSource(input: {
  connector: typeof ProjectConnectedToolTable.$inferSelect;
  project: typeof ProjectTable.$inferSelect;
}) {
  if (!input.connector.connectionRef) {
    throw new ProjectSourceError(
      "connection_not_active",
      "This MCP connector needs to be reconnected.",
    );
  }

  const manager = getMCPClientsManager(input.connector.credentialOwnerUserId);
  await manager.init();

  const allTools = await manager.tools();
  const tools = Object.fromEntries(
    Object.entries(allTools).filter(
      ([, tool]) =>
        tool._mcpServerId === input.connector.connectionRef &&
        tool._readOnlyHint === true,
    ),
  );

  if (!Object.keys(tools).length) {
    throw new ProjectSourceError(
      "no_read_actions",
      "The MCP server declares no read-only tools.",
    );
  }

  return gatherWithTools({
    projectName: input.project.name,
    projectGoal: input.project.goal,
    projectDescription: input.project.description,
    projectSystemPrompt: input.project.systemPrompt,
    connectorName: input.connector.displayName,
    tools,
  });
}

async function loadTextSource(run: typeof ProjectBrainRunTable.$inferSelect) {
  if (run.sourceType === "chat") {
    const messages = await pgDb
      .select({ parts: ChatMessageTable.parts })
      .from(ChatMessageTable)
      .where(eq(ChatMessageTable.threadId, run.sourceRef))
      .orderBy(asc(ChatMessageTable.createdAt));

    return {
      title: "Project chat",
      textContent: JSON.stringify(messages),
      rawPayload: { messageCount: messages.length },
    };
  }

  if (run.sourceType === "document") {
    const chunks = await pgDb
      .select({ content: DocumentChunkTable.content })
      .from(DocumentChunkTable)
      .where(
        and(
          eq(DocumentChunkTable.documentId, run.sourceRef),
          eq(DocumentChunkTable.projectId, run.projectId),
        ),
      )
      .orderBy(asc(DocumentChunkTable.chunkIndex));

    return {
      title: "Project document",
      textContent: chunks.map((chunk) => chunk.content).join("\n\n"),
      rawPayload: { chunkCount: chunks.length },
    };
  }

  if (run.sourceType === "transcript") {
    const [session] = await pgDb
      .select({ transcriptText: VoiceSessionTable.transcriptText })
      .from(VoiceSessionTable)
      .where(
        and(
          eq(VoiceSessionTable.id, run.sourceRef),
          eq(VoiceSessionTable.projectId, run.projectId),
        ),
      )
      .limit(1);

    return {
      title: "Voice transcript",
      textContent: session?.transcriptText ?? "",
      rawPayload: {},
    };
  }

  if (run.sourceType === "manual") {
    const [project] = await pgDb
      .select({ goal: ProjectTable.goal, name: ProjectTable.name })
      .from(ProjectTable)
      .where(eq(ProjectTable.id, run.projectId))
      .limit(1);

    return {
      title: "Project onboarding",
      textContent: [
        `Project: ${project?.name ?? ""}`,
        `Goal: ${project?.goal ?? ""}`,
      ].join("\n"),
      rawPayload: { trigger: run.trigger },
    };
  }

  throw new ProjectSourceError(
    "source_failed",
    `Unsupported source type: ${run.sourceType}`,
  );
}

export async function loadAndPersistProjectBrainRunSource(
  run: typeof ProjectBrainRunTable.$inferSelect,
) {
  const [project] = await pgDb
    .select()
    .from(ProjectTable)
    .where(eq(ProjectTable.id, run.projectId))
    .limit(1);

  if (!project) {
    throw new ProjectSourceError("source_failed", "Project not found.");
  }

  const [member] = await pgDb
    .select({ id: ProjectMemberTable.id })
    .from(ProjectMemberTable)
    .where(
      and(
        eq(ProjectMemberTable.projectId, run.projectId),
        eq(ProjectMemberTable.userId, run.sourceUserId),
      ),
    )
    .limit(1);

  if (project.ownerUserId !== run.sourceUserId && !member) {
    throw new ProjectSourceError(
      "credential_owner_removed",
      "The credential owner is no longer a project member.",
    );
  }

  let snapshot:
    | {
        title: string;
        textContent: string;
        rawPayload: Record<string, unknown>;
        contentHash: string;
      }
    | undefined;

  if (run.sourceType === "tool_sync") {
    if (!run.connectedToolId) {
      throw new ProjectSourceError("source_failed", "Connector not found.");
    }

    const [connector] = await pgDb
      .select()
      .from(ProjectConnectedToolTable)
      .where(
        and(
          eq(ProjectConnectedToolTable.id, run.connectedToolId),
          eq(ProjectConnectedToolTable.projectId, run.projectId),
        ),
      )
      .limit(1);

    if (!connector || connector.status !== "connected") {
      throw new ProjectSourceError(
        "connection_not_active",
        "Connector is unavailable.",
      );
    }

    const gathered =
      connector.providerType === "composio"
        ? await loadComposioSource({ connector, project })
        : await loadMcpSource({ connector, project });

    snapshot = {
      title: `${connector.displayName} sync`,
      ...gathered,
    };
  } else {
    const textSource = await loadTextSource(run);
    snapshot = {
      ...textSource,
      contentHash: createHash("sha256")
        .update(textSource.textContent)
        .digest("hex"),
    };
  }

  if (!snapshot.textContent.trim()) {
    throw new ProjectSourceError(
      "no_data_returned",
      "The project source contains no readable content.",
    );
  }

  const persisted = await createProjectBrainRawSource({
    projectId: run.projectId,
    runId: run.id,
    sourceUserId: run.sourceUserId,
    sourceType: run.sourceType,
    sourceRef: run.sourceRef,
    sourceScope: run.sourceScope,
    contentHash: snapshot.contentHash,
    title: snapshot.title,
    textContent: snapshot.textContent,
    rawPayload: snapshot.rawPayload,
    observedAt: new Date(),
  });

  return {
    sourceId: persisted.source.id,
    unchanged: !persisted.created,
  };
}
