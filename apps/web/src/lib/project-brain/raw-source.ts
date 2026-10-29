import "server-only";

import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainRawSourceTable } from "@/lib/db/pg/schema.pg";

export type RawSourceType =
  | "chat"
  | "transcript"
  | "meeting"
  | "document"
  | "tool_sync"
  | "manual"
  | "agent"
  | "workflow";

export async function createProjectBrainRawSource(input: {
  projectId: string;
  runId?: string;
  sourceUserId: string;
  sourceType: RawSourceType;
  sourceRef: string;
  sourceScope: string;
  contentHash: string;
  title?: string;
  textContent?: string;
  summary?: string;
  rawPayload?: Record<string, unknown>;
  observedAt?: Date;
}) {
  const [created] = await pgDb
    .insert(ProjectBrainRawSourceTable)
    .values({
      ...input,
      runId: input.runId ?? null,
      title: input.title,
      textContent: input.textContent,
      summary: input.summary,
      rawPayload: input.rawPayload ?? {},
      observedAt: input.observedAt ?? new Date(),
    })
    .onConflictDoNothing({
      target: [
        ProjectBrainRawSourceTable.projectId,
        ProjectBrainRawSourceTable.sourceType,
        ProjectBrainRawSourceTable.sourceRef,
        ProjectBrainRawSourceTable.contentHash,
      ],
    })
    .returning();

  if (created) {
    return { source: created, created: true };
  }

  const [source] = await pgDb
    .select()
    .from(ProjectBrainRawSourceTable)
    .where(
      and(
        eq(ProjectBrainRawSourceTable.projectId, input.projectId),
        eq(ProjectBrainRawSourceTable.sourceType, input.sourceType),
        eq(ProjectBrainRawSourceTable.sourceRef, input.sourceRef),
        eq(ProjectBrainRawSourceTable.contentHash, input.contentHash),
      ),
    )
    .limit(1);

  if (!source) {
    throw new Error("Could not resolve project brain source.");
  }

  return { source, created: false };
}

/** @deprecated New ingestion must provide a stable scope and content hash. */
export async function upsertProjectBrainRawSource(input: {
  projectId: string;
  userId: string;
  sourceType: RawSourceType;
  sourceRef: string;
  title?: string;
  textContent?: string;
  summary?: string;
  rawPayload?: Record<string, unknown>;
  observedAt?: Date;
}) {
  const contentHash = createHash("sha256")
    .update(input.textContent ?? "")
    .update(JSON.stringify(input.rawPayload ?? {}))
    .digest("hex");

  const { source } = await createProjectBrainRawSource({
    projectId: input.projectId,
    sourceUserId: input.userId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    sourceScope: `${input.sourceType}:${input.sourceRef}`,
    contentHash,
    title: input.title,
    textContent: input.textContent,
    summary: input.summary,
    rawPayload: input.rawPayload,
    observedAt: input.observedAt,
  });

  return source;
}
