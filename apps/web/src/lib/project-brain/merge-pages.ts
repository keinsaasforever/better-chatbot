import "server-only";

import type { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainAliasTable,
  ProjectBrainContentChunkTable,
  ProjectBrainContradictionTable,
  ProjectBrainEventTable,
  ProjectBrainFactTable,
  ProjectBrainPageTable,
  ProjectBrainPageVersionTable,
} from "@/lib/db/pg/schema.pg";
import { and, asc, desc, eq, sql } from "drizzle-orm";

type Db = Pick<
  typeof pgDb,
  "select" | "update" | "delete" | "insert" | "execute"
>;

/**
 * Recompute a page's compiled truth from its current facts: newest, most
 * confident value per fact key. Shared by ingest (persist-extraction) and the
 * dedupe merge.
 */
export async function recompilePageTruth(
  db: Db,
  input: { projectId: string; pageId: string; sourceId?: string | null },
) {
  const facts = await db
    .select()
    .from(ProjectBrainFactTable)
    .where(
      and(
        eq(ProjectBrainFactTable.pageId, input.pageId),
        eq(ProjectBrainFactTable.status, "current"),
      ),
    )
    .orderBy(
      asc(ProjectBrainFactTable.factKey),
      desc(ProjectBrainFactTable.lastObservedAt),
      desc(ProjectBrainFactTable.confidence),
    );

  const winners = new Map<string, (typeof facts)[number]>();
  for (const fact of facts) {
    if (!winners.has(fact.factKey)) winners.set(fact.factKey, fact);
  }

  const compiledTruth = [...winners.values()]
    .map((fact) => `- ${fact.factKey}: ${fact.value}`)
    .join("\n");

  await db
    .update(ProjectBrainPageTable)
    .set({ compiledTruth, updatedAt: new Date() })
    .where(eq(ProjectBrainPageTable.id, input.pageId));

  await db.insert(ProjectBrainPageVersionTable).values({
    projectId: input.projectId,
    pageId: input.pageId,
    sourceId: input.sourceId ?? null,
    compiledTruth,
  });

  return compiledTruth;
}

/**
 * Fold `loserId` into `survivorId`: facts, links, evidence, aliases, events,
 * versions and contradictions are repointed; duplicates that would violate a
 * unique key are dropped (the survivor already has them). The loser row is
 * kept, archived and marked `merged_into_page_id`, so anything still holding
 * its id keeps resolving.
 */
export async function mergePages(
  db: Db,
  input: { projectId: string; survivorId: string; loserId: string },
) {
  const { projectId, survivorId, loserId } = input;
  if (survivorId === loserId) return;

  // Facts: drop loser rows the survivor already holds, repoint the rest.
  await db.execute(sql`
    DELETE FROM project_brain_fact l
    WHERE l.page_id = ${loserId}
      AND EXISTS (
        SELECT 1 FROM project_brain_fact s
        WHERE s.page_id = ${survivorId}
          AND s.source_scope = l.source_scope
          AND s.fact_key = l.fact_key
          AND s.value_hash = l.value_hash
      )
  `);
  await db
    .update(ProjectBrainFactTable)
    .set({ pageId: survivorId, updatedAt: new Date() })
    .where(eq(ProjectBrainFactTable.pageId, loserId));

  // Links: drop loser links whose repointed form already exists (their
  // evidence cascades; the survivor's link carries its own), repoint the
  // rest, then remove any self-link the repoint produced.
  await db.execute(sql`
    DELETE FROM project_brain_link l
    WHERE l.project_id = ${projectId}
      AND (l.from_page_id = ${loserId} OR l.to_page_id = ${loserId})
      AND EXISTS (
        SELECT 1 FROM project_brain_link s
        WHERE s.project_id = l.project_id
          AND s.link_type = l.link_type
          AND s.from_page_id = CASE WHEN l.from_page_id = ${loserId} THEN ${survivorId}::uuid ELSE l.from_page_id END
          AND s.to_page_id = CASE WHEN l.to_page_id = ${loserId} THEN ${survivorId}::uuid ELSE l.to_page_id END
      )
  `);
  await db.execute(sql`
    UPDATE project_brain_link
    SET from_page_id = CASE WHEN from_page_id = ${loserId} THEN ${survivorId}::uuid ELSE from_page_id END,
        to_page_id = CASE WHEN to_page_id = ${loserId} THEN ${survivorId}::uuid ELSE to_page_id END
    WHERE project_id = ${projectId}
      AND (from_page_id = ${loserId} OR to_page_id = ${loserId})
  `);
  await db.execute(sql`
    DELETE FROM project_brain_link
    WHERE project_id = ${projectId} AND from_page_id = to_page_id
  `);

  await db
    .update(ProjectBrainAliasTable)
    .set({ pageId: survivorId })
    .where(eq(ProjectBrainAliasTable.pageId, loserId));

  await db
    .update(ProjectBrainEventTable)
    .set({ pageId: survivorId })
    .where(eq(ProjectBrainEventTable.pageId, loserId));

  await db
    .update(ProjectBrainPageVersionTable)
    .set({ pageId: survivorId })
    .where(eq(ProjectBrainPageVersionTable.pageId, loserId));

  await db
    .update(ProjectBrainContradictionTable)
    .set({ pageId: survivorId })
    .where(eq(ProjectBrainContradictionTable.pageId, loserId));

  // The loser's chunks describe a page that no longer stands on its own.
  await db
    .delete(ProjectBrainContentChunkTable)
    .where(eq(ProjectBrainContentChunkTable.pageId, loserId));

  const now = new Date();
  await db
    .update(ProjectBrainPageTable)
    .set({
      mergedIntoPageId: survivorId,
      archivedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(ProjectBrainPageTable.id, loserId),
        eq(ProjectBrainPageTable.projectId, projectId),
      ),
    );

  await recompilePageTruth(db, { projectId, pageId: survivorId });
}
