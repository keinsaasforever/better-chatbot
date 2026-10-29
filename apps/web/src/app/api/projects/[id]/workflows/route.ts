import { and, desc, eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectWorkflowTable, WorkflowTable } from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

const AttachWorkflowSchema = z.object({
  workflowId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId });

    const workflows = await pgDb
      .select({
        id: ProjectWorkflowTable.id,
        workflowId: ProjectWorkflowTable.workflowId,
        status: ProjectWorkflowTable.status,
        createdAt: ProjectWorkflowTable.createdAt,
        name: WorkflowTable.name,
        description: WorkflowTable.description,
        icon: WorkflowTable.icon,
      })
      .from(ProjectWorkflowTable)
      .innerJoin(
        WorkflowTable,
        eq(ProjectWorkflowTable.workflowId, WorkflowTable.id),
      )
      .where(eq(ProjectWorkflowTable.projectId, projectId))
      .orderBy(desc(ProjectWorkflowTable.createdAt));

    return NextResponse.json({ workflows });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });
    const parsed = AttachWorkflowSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_workflow",
            message: parsed.error.issues[0]?.message ?? "Invalid workflow.",
          },
        },
        { status: 400 },
      );
    }

    const { workflowId } = parsed.data;

    // Own workflows, plus shared (public/readonly) workflows within the
    // caller's active org — mirrors workflow-repository.pg.ts's selectAll.
    const [accessibleWorkflow] = await pgDb
      .select({ id: WorkflowTable.id })
      .from(WorkflowTable)
      .where(
        and(
          eq(WorkflowTable.id, workflowId),
          or(
            eq(WorkflowTable.userId, actor.userId),
            and(
              inArray(WorkflowTable.visibility, ["public", "readonly"]),
              eq(WorkflowTable.organizationId, actor.organizationId),
            ),
          ),
        ),
      )
      .limit(1);

    if (!accessibleWorkflow) {
      return NextResponse.json(
        {
          error: {
            code: "workflow_not_found",
            message: "Workflow not found.",
          },
        },
        { status: 404 },
      );
    }

    const [projectWorkflow] = await pgDb
      .insert(ProjectWorkflowTable)
      .values({ projectId, workflowId, addedBy: actor.userId })
      .onConflictDoNothing({
        target: [
          ProjectWorkflowTable.projectId,
          ProjectWorkflowTable.workflowId,
        ],
      })
      .returning();

    return NextResponse.json(
      { workflow: projectWorkflow ?? { projectId, workflowId } },
      { status: 201 },
    );
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId, minRole: "editor" });

    const workflowId = new URL(request.url).searchParams.get("workflowId");
    const parsed = z.string().uuid().safeParse(workflowId);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_workflow",
            message: "A valid workflowId is required.",
          },
        },
        { status: 400 },
      );
    }

    const deleted = await pgDb
      .delete(ProjectWorkflowTable)
      .where(
        and(
          eq(ProjectWorkflowTable.projectId, projectId),
          eq(ProjectWorkflowTable.workflowId, parsed.data),
        ),
      )
      .returning({ id: ProjectWorkflowTable.id });

    if (!deleted.length) {
      return NextResponse.json(
        {
          error: {
            code: "workflow_not_attached",
            message: "That workflow isn't attached to this project.",
          },
        },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
