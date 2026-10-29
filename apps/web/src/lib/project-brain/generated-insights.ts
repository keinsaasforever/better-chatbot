import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainEventTable,
  ProjectStatusSnapshotTable,
} from "@/lib/db/pg/schema.pg";
import { desc, eq } from "drizzle-orm";

/**
 * Readers for the consolidated project status. The snapshot rows are written
 * by `consolidate-project.ts` (one per ingest run); the voice app-control tool,
 * chat retrieval and the Overview endpoint read the latest one.
 */

/** Most recent brain timeline events — the "news" feed for a project. */
export async function getRecentProjectEvents(projectId: string, limit = 8) {
  return pgDb
    .select({
      eventDate: ProjectBrainEventTable.eventDate,
      summary: ProjectBrainEventTable.summary,
    })
    .from(ProjectBrainEventTable)
    .where(eq(ProjectBrainEventTable.projectId, projectId))
    .orderBy(desc(ProjectBrainEventTable.eventDate))
    .limit(limit);
}

export async function getLatestProjectStatusSnapshot(projectId: string) {
  const [snapshot] = await pgDb
    .select()
    .from(ProjectStatusSnapshotTable)
    .where(eq(ProjectStatusSnapshotTable.projectId, projectId))
    .orderBy(desc(ProjectStatusSnapshotTable.generatedAt))
    .limit(1);

  return snapshot ?? null;
}
