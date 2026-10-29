import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectConnectedToolTable,
  ProjectTodoTable,
} from "@/lib/db/pg/schema.pg";
import { requireProjectAccess } from "@/lib/projects/access";
import { withAuth } from "auth/route-guard";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

// DELETE: detach a connected tool from this project. The Composio account
// connection itself is untouched — this only removes the project link, so the
// tool can be re-added cleanly afterwards.
export const DELETE = withAuth(
  async (
    _request: Request,
    session,
    { params }: { params: Promise<{ id: string; toolId: string }> },
  ) => {
    const { id: projectId, toolId } = await params;
    await requireProjectAccess({
      projectId,
      userId: session.user.id,
      minRole: "editor",
    });

    const [deleted] = await pgDb
      .delete(ProjectConnectedToolTable)
      .where(
        and(
          eq(ProjectConnectedToolTable.id, toolId),
          eq(ProjectConnectedToolTable.projectId, projectId),
        ),
      )
      .returning({ id: ProjectConnectedToolTable.id });

    if (!deleted) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    // Open to-dos that only this tool vouched for should not linger.
    await pgDb
      .update(ProjectTodoTable)
      .set({
        status: "dismissed",
        resolvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ProjectTodoTable.projectId, projectId),
          eq(ProjectTodoTable.sourceScope, `tool:${toolId}`),
          eq(ProjectTodoTable.status, "open"),
        ),
      );

    return NextResponse.json({ ok: true, id: deleted.id });
  },
);
