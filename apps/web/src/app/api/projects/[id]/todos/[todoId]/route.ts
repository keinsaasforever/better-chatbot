import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectTodoTable } from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateTodoSchema = z.object({
  status: z.enum(["open", "done", "dismissed"]),
});

// PATCH: the user marks a to-do done / dismissed / open again. The decision is
// owned by the user: later syncs never reopen a done or dismissed row.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; todoId: string }> },
) {
  try {
    const { id: projectId, todoId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });

    const parsed = UpdateTodoSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_status",
            message: "Status must be open, done or dismissed.",
          },
        },
        { status: 400 },
      );
    }

    const now = new Date();
    const reopened = parsed.data.status === "open";
    const [updated] = await pgDb
      .update(ProjectTodoTable)
      .set({
        status: parsed.data.status,
        resolvedAt: reopened ? null : now,
        resolvedByUserId: reopened ? null : actor.userId,
        updatedAt: now,
      })
      .where(
        and(
          eq(ProjectTodoTable.id, todoId),
          eq(ProjectTodoTable.projectId, projectId),
        ),
      )
      .returning({
        id: ProjectTodoTable.id,
        status: ProjectTodoTable.status,
        resolvedAt: ProjectTodoTable.resolvedAt,
      });

    if (!updated) {
      return NextResponse.json(
        { error: { code: "todo_not_found", message: "To-do not found." } },
        { status: 404 },
      );
    }

    return NextResponse.json({
      todo: {
        ...updated,
        resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
