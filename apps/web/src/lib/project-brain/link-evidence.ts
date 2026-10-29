import "server-only";

import type { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainLinkEvidenceTable,
  ProjectBrainLinkTable,
} from "@/lib/db/pg/schema.pg";
import type { ProjectEdgeType } from "./edge-types";

type Db = Pick<typeof pgDb, "insert">;

/**
 * Upsert a typed link and record the evidence one source scope contributes
 * for it. Links are unique per (project, from, to, type); evidence per
 * (link, scope, key). Evidence from a scope that stops mentioning the link is
 * retracted by the caller at the end of its run.
 */
export async function upsertLinkWithEvidence(
  db: Db,
  input: {
    projectId: string;
    fromPageId: string;
    toPageId: string;
    linkType: ProjectEdgeType;
    context?: string | null;
    confidence: number;
    source: "markdown" | "frontmatter" | "classifier" | "manual";
    sourceId: string;
    runId: string;
    sourceScope: string;
    evidenceKey: string;
    observedAt: Date;
  },
) {
  const confidence = String(input.confidence);
  const [link] = await db
    .insert(ProjectBrainLinkTable)
    .values({
      projectId: input.projectId,
      fromPageId: input.fromPageId,
      toPageId: input.toPageId,
      linkType: input.linkType,
      context: input.context ?? null,
      confidence,
      source: input.source,
    })
    .onConflictDoUpdate({
      target: [
        ProjectBrainLinkTable.projectId,
        ProjectBrainLinkTable.fromPageId,
        ProjectBrainLinkTable.toPageId,
        ProjectBrainLinkTable.linkType,
      ],
      set: {
        context: input.context ?? null,
        confidence,
      },
    })
    .returning({ id: ProjectBrainLinkTable.id });

  if (!link) throw new Error("Could not upsert project brain link.");

  await db
    .insert(ProjectBrainLinkEvidenceTable)
    .values({
      projectId: input.projectId,
      linkId: link.id,
      sourceId: input.sourceId,
      runId: input.runId,
      sourceScope: input.sourceScope,
      evidenceKey: input.evidenceKey,
      context: input.context ?? null,
      status: "current",
      confidence,
      observedAt: input.observedAt,
    })
    .onConflictDoUpdate({
      target: [
        ProjectBrainLinkEvidenceTable.linkId,
        ProjectBrainLinkEvidenceTable.sourceScope,
        ProjectBrainLinkEvidenceTable.evidenceKey,
      ],
      set: {
        sourceId: input.sourceId,
        runId: input.runId,
        status: "current",
        confidence,
        observedAt: input.observedAt,
      },
    });

  return link.id;
}
