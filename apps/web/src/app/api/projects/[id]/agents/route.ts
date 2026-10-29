import { and, desc, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { pgDb } from "@/lib/db/pg/db.pg";
import { AgentTable, ProjectAgentTable } from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

const AttachAgentSchema = z.object({
  agentId: z.string().uuid(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId });

    const agents = await pgDb
      .select({
        id: ProjectAgentTable.id,
        agentId: ProjectAgentTable.agentId,
        status: ProjectAgentTable.status,
        createdAt: ProjectAgentTable.createdAt,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
      })
      .from(ProjectAgentTable)
      .innerJoin(AgentTable, eq(ProjectAgentTable.agentId, AgentTable.id))
      .where(eq(ProjectAgentTable.projectId, projectId))
      .orderBy(desc(ProjectAgentTable.createdAt));

    return NextResponse.json({ agents });
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
    const parsed = AttachAgentSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_agent",
            message: parsed.error.issues[0]?.message ?? "Invalid agent.",
          },
        },
        { status: 400 },
      );
    }

    const { agentId } = parsed.data;

    // Own agents, plus shared (public/readonly) agents within the caller's
    // active org — mirrors agent-repository.pg.ts's accessibility predicate.
    const [accessibleAgent] = await pgDb
      .select({ id: AgentTable.id })
      .from(AgentTable)
      .where(
        and(
          eq(AgentTable.id, agentId),
          or(
            eq(AgentTable.userId, actor.userId),
            and(
              or(
                eq(AgentTable.visibility, "public"),
                eq(AgentTable.visibility, "readonly"),
              ),
              eq(AgentTable.organizationId, actor.organizationId),
            ),
          ),
        ),
      )
      .limit(1);

    if (!accessibleAgent) {
      return NextResponse.json(
        {
          error: {
            code: "agent_not_found",
            message: "Agent not found.",
          },
        },
        { status: 404 },
      );
    }

    const [projectAgent] = await pgDb
      .insert(ProjectAgentTable)
      .values({ projectId, agentId, addedBy: actor.userId })
      .onConflictDoNothing({
        target: [ProjectAgentTable.projectId, ProjectAgentTable.agentId],
      })
      .returning();

    return NextResponse.json(
      { agent: projectAgent ?? { projectId, agentId } },
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

    const agentId = new URL(request.url).searchParams.get("agentId");
    const parsed = z.string().uuid().safeParse(agentId);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_agent",
            message: "A valid agentId is required.",
          },
        },
        { status: 400 },
      );
    }

    const deleted = await pgDb
      .delete(ProjectAgentTable)
      .where(
        and(
          eq(ProjectAgentTable.projectId, projectId),
          eq(ProjectAgentTable.agentId, parsed.data),
        ),
      )
      .returning({ id: ProjectAgentTable.id });

    if (!deleted.length) {
      return NextResponse.json(
        {
          error: {
            code: "agent_not_attached",
            message: "That agent isn't attached to this project.",
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
