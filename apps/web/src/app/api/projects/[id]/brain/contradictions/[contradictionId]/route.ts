import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainContradictionTable } from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const UpdateSchema = z.object({
  status: z.enum(["resolved", "dismissed"]),
});

// PATCH: a member resolves or dismisses a contradiction.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contradictionId: string }> },
) {
  try {
    const { id: projectId, contradictionId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });

    const parsed = UpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_status",
            message: "Status must be resolved or dismissed.",
          },
        },
        { status: 400 },
      );
    }

    const [updated] = await pgDb
      .update(ProjectBrainContradictionTable)
      .set({
        status: parsed.data.status,
        resolvedByUserId: actor.userId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(ProjectBrainContradictionTable.id, contradictionId),
          eq(ProjectBrainContradictionTable.projectId, projectId),
        ),
      )
      .returning({ id: ProjectBrainContradictionTable.id });

    if (!updated) {
      return NextResponse.json(
        { error: { code: "not_found", message: "Contradiction not found." } },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true, id: updated.id });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
