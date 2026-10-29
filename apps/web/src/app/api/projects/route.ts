import { and, desc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectMemberTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import {
  requireActiveOrganization,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import {
  CreateProjectSchema,
  createProject,
} from "@/lib/projects/create-project";

export async function GET() {
  try {
    const actor = await requireActiveOrganization();
    const rows = await pgDb
      .selectDistinct({
        project: ProjectTable,
        role: ProjectMemberTable.role,
      })
      .from(ProjectTable)
      .leftJoin(
        ProjectMemberTable,
        and(
          eq(ProjectMemberTable.projectId, ProjectTable.id),
          eq(ProjectMemberTable.userId, actor.userId),
        ),
      )
      .where(
        and(
          eq(ProjectTable.organizationId, actor.organizationId),
          or(
            eq(ProjectTable.ownerUserId, actor.userId),
            eq(ProjectMemberTable.userId, actor.userId),
          ),
        ),
      )
      .orderBy(desc(ProjectTable.updatedAt));

    return NextResponse.json({
      projects: rows.map((row) => ({
        ...row.project,
        role: row.project.ownerUserId === actor.userId ? "owner" : row.role,
      })),
    });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActiveOrganization();
    const parsed = CreateProjectSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_project",
            message: parsed.error.issues[0]?.message ?? "Invalid project.",
          },
        },
        { status: 400 },
      );
    }

    const project = await createProject(actor, parsed.data);

    return NextResponse.json({ project, role: "owner" }, { status: 201 });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
