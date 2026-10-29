import { skillRepository } from "lib/db/repository";
import { withAuth } from "auth/route-guard";
import { z } from "zod";
import { SkillUpdateSchema } from "app-types/skill";

function activeOrg(session: {
  session?: { activeOrganizationId?: string | null } | undefined;
}): string | null | undefined {
  return (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
}

export const GET = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const activeOrganizationId = activeOrg(session);

    const hasAccess = await skillRepository.checkAccess(
      id,
      session.user.id,
      false,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    const skill = await skillRepository.selectSkillById(
      id,
      session.user.id,
      activeOrganizationId,
    );
    return Response.json(skill);
  },
);

export const PUT = withAuth(
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const { id } = await params;
      const body = await request.json();
      const data = SkillUpdateSchema.parse(body);

      // Only the owner can update a skill.
      const hasAccess = await skillRepository.checkAccess(
        id,
        session.user.id,
        true,
      );
      if (!hasAccess) {
        return new Response("Unauthorized", { status: 401 });
      }

      const skill = await skillRepository.updateSkill(
        id,
        session.user.id,
        data,
      );
      return Response.json(skill);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: "Invalid input", details: error.message },
          { status: 400 },
        );
      }
      console.error("Failed to update skill:", error);
      return Response.json(
        { message: "Internal Server Error" },
        { status: 500 },
      );
    }
  },
);

export const DELETE = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      const hasAccess = await skillRepository.checkAccess(
        id,
        session.user.id,
        true,
      );
      if (!hasAccess) {
        return new Response("Unauthorized", { status: 401 });
      }
      await skillRepository.deleteSkill(id, session.user.id);
      return Response.json({ success: true });
    } catch (error) {
      console.error("Failed to delete skill:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
);
