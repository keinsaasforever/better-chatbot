import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectConnectedToolTable,
  ProjectTodoTable,
} from "@/lib/db/pg/schema.pg";
import { getLatestProjectStatusSnapshot } from "@/lib/project-brain/generated-insights";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { and, desc, eq, gte, inArray, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const RECENTLY_DONE_DAYS = 7;

function serializeTodo(todo: typeof ProjectTodoTable.$inferSelect) {
  return {
    id: todo.id,
    key: todo.key,
    title: todo.title,
    detail: todo.detail,
    priority: todo.priority,
    dueAt: todo.dueAt?.toISOString() ?? null,
    sourceScope: todo.sourceScope,
    sourceLabel: todo.sourceLabel,
    sourceUrl: todo.sourceUrl,
    status: todo.status,
    resolvedAt: todo.resolvedAt?.toISOString() ?? null,
    createdAt: todo.createdAt.toISOString(),
  };
}

// GET: the single project-level status + to-do view for the Overview tab.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId });

    const since = new Date(Date.now() - RECENTLY_DONE_DAYS * 86_400_000);

    const [snapshot, connectors, openTodos, recentlyDone] = await Promise.all([
      getLatestProjectStatusSnapshot(projectId),
      pgDb
        .select({
          id: ProjectConnectedToolTable.id,
          displayName: ProjectConnectedToolTable.displayName,
          status: ProjectConnectedToolTable.status,
          lastSyncError: ProjectConnectedToolTable.lastSyncError,
        })
        .from(ProjectConnectedToolTable)
        .where(
          and(
            eq(ProjectConnectedToolTable.projectId, projectId),
            notInArray(ProjectConnectedToolTable.status, [
              "connected",
              "disabled",
            ]),
          ),
        ),
      pgDb
        .select()
        .from(ProjectTodoTable)
        .where(
          and(
            eq(ProjectTodoTable.projectId, projectId),
            eq(ProjectTodoTable.status, "open"),
          ),
        )
        .orderBy(desc(ProjectTodoTable.createdAt))
        .limit(50),
      pgDb
        .select()
        .from(ProjectTodoTable)
        .where(
          and(
            eq(ProjectTodoTable.projectId, projectId),
            inArray(ProjectTodoTable.status, ["done"]),
            gte(ProjectTodoTable.resolvedAt, since),
          ),
        )
        .orderBy(desc(ProjectTodoTable.resolvedAt))
        .limit(5),
    ]);

    const sortedOpen = [...openTodos].sort((a, b) => {
      const rank =
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      if (rank !== 0) return rank;
      const dueA = a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const dueB = b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
      if (dueA !== dueB) return dueA - dueB;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const statusData = (snapshot?.statusRenderData ?? null) as {
      health?: string;
      progressPct?: number | null;
      summary?: string | null;
      blockers?: string[];
    } | null;

    return NextResponse.json({
      status: snapshot
        ? {
            health: statusData?.health ?? snapshot.health,
            progressPct: statusData?.progressPct ?? null,
            summary: statusData?.summary ?? snapshot.summary ?? "",
            blockers: statusData?.blockers ?? [],
            generatedAt: snapshot.generatedAt.toISOString(),
          }
        : null,
      connectorIssues: connectors,
      todos: sortedOpen.map(serializeTodo),
      recentlyDone: recentlyDone.map(serializeTodo),
    });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
