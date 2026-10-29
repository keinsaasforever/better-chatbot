import "server-only";

import type { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainEventTable } from "@/lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";
import type { ProjectBrainExtraction } from "./extraction-schema";

type EventSourceType =
  (typeof ProjectBrainEventTable.$inferInsert)["sourceType"];

/** Maps a raw-source type onto the narrower event enum. */
export function toEventSourceType(rawSourceType: string): EventSourceType {
  switch (rawSourceType) {
    case "tool_sync":
      return "tool";
    case "transcript":
    case "meeting":
      return "voice";
    case "chat":
      return "chat";
    case "document":
      return "document";
    default:
      return "manual";
  }
}

const MAX_EVENTS_PER_SCOPE = 20;

/** Either the root client or a transaction handle. */
type Db = Pick<typeof pgDb, "delete" | "insert">;

/**
 * Replace the timeline entries a source scope contributed. Keyed by scope (not
 * by raw-source row) so a re-sync of the same tool swaps its events instead of
 * stacking duplicates. `source_id` carries the scope string.
 */
export async function replaceProjectBrainTimeline(
  db: Db,
  input: {
    projectId: string;
    userId: string;
    sourceScope: string;
    rawSourceType: string;
    observedAt: Date;
    timeline: ProjectBrainExtraction["timeline"];
    pageIdByEntityId?: Map<string, string>;
  },
) {
  await db
    .delete(ProjectBrainEventTable)
    .where(
      and(
        eq(ProjectBrainEventTable.projectId, input.projectId),
        eq(ProjectBrainEventTable.sourceId, input.sourceScope),
      ),
    );

  const rows = input.timeline.slice(0, MAX_EVENTS_PER_SCOPE).map((item) => ({
    projectId: input.projectId,
    userId: input.userId,
    pageId:
      (item.entityId && input.pageIdByEntityId?.get(item.entityId)) || null,
    sourceType: toEventSourceType(input.rawSourceType),
    sourceId: input.sourceScope,
    eventDate: item.eventDate ? new Date(item.eventDate) : input.observedAt,
    summary: item.summary,
    detail: item.detail ?? null,
    metadata: {},
  }));

  if (rows.length) {
    await db.insert(ProjectBrainEventTable).values(rows);
  }

  return rows.length;
}
