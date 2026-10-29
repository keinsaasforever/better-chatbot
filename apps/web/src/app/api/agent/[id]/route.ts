import { agentRepository } from "lib/db/repository";
import { withAuth } from "auth/route-guard";
import { z } from "zod";
import { AgentUpdateSchema } from "app-types/agent";
import { canEditAgent, canDeleteAgent } from "lib/auth/permissions";
import { assertOwnedAgentFiles } from "lib/ai/agent/agent-files";

export const GET = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null } | undefined
    )?.activeOrganizationId;

    const hasAccess = await agentRepository.checkAccess(
      id,
      session.user.id,
      false,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }

    const agent = await agentRepository.selectAgentById(
      id,
      session.user.id,
      activeOrganizationId,
    );
    return Response.json(agent);
  },
);

export const PUT = withAuth(
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    // Check if user has permission to edit agents
    const canEdit = await canEditAgent();
    if (!canEdit) {
      return Response.json(
        { error: "Only editors and admins can edit agents" },
        { status: 403 },
      );
    }

    try {
      const { id } = await params;
      const body = await request.json();
      const data = AgentUpdateSchema.parse(body);
      const activeOrganizationId = (
        session.session as { activeOrganizationId?: string | null } | undefined
      )?.activeOrganizationId;

      // Check access for write operations
      const hasAccess = await agentRepository.checkAccess(
        id,
        session.user.id,
        false,
        activeOrganizationId,
      );
      if (!hasAccess) {
        return new Response("Unauthorized", { status: 401 });
      }

      // For non-owners of public agents, preserve original visibility
      const existingAgent = await agentRepository.selectAgentById(
        id,
        session.user.id,
        activeOrganizationId,
      );
      if (existingAgent && existingAgent.userId !== session.user.id) {
        data.visibility = existingAgent.visibility;
      }

      // New file bindings must name keys the editor owns; the ones already on
      // the agent are carried over, so an org member can edit a shared agent
      // without owning the creator's template.
      const ownership = assertOwnedAgentFiles({
        files: data.instructions?.files,
        userId: session.user.id,
        existingFiles: existingAgent?.instructions?.files,
      });
      if (!ownership.ok) {
        return Response.json(
          { error: "Agent files must belong to the current user" },
          { status: 400 },
        );
      }

      const agent = await agentRepository.updateAgent(
        id,
        session.user.id,
        data,
        activeOrganizationId,
      );

      return Response.json(agent);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return Response.json(
          { error: "Invalid input", details: error.message },
          { status: 400 },
        );
      }

      console.error("Failed to update agent:", error);
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
    // Check if user has permission to delete agents
    const canDelete = await canDeleteAgent();
    if (!canDelete) {
      return Response.json(
        { error: "Only editors and admins can delete agents" },
        { status: 403 },
      );
    }

    try {
      const { id } = await params;
      const hasAccess = await agentRepository.checkAccess(
        id,
        session.user.id,
        true, // destructive = true for delete operations
      );
      if (!hasAccess) {
        return new Response("Unauthorized", { status: 401 });
      }
      await agentRepository.deleteAgent(id, session.user.id);
      return Response.json({ success: true });
    } catch (error) {
      console.error("Failed to delete agent:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
);
