import { withAuth } from "auth/route-guard";
import { mcpRepository } from "lib/db/repository";
import { VisibilityZodSchema } from "app-types/mcp";
import { z } from "zod";

const UpdateVisibilitySchema = z.object({
  visibility: VisibilityZodSchema.optional(),
});

export const PUT = withAuth(
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;

    // Check if user has write access
    const hasAccess = await mcpRepository.checkAccess(
      id,
      session.user.id,
      true,
    );
    if (!hasAccess) {
      return new Response("Forbidden", { status: 403 });
    }

    const parseResult = UpdateVisibilitySchema.safeParse(await request.json());
    if (!parseResult.success) {
      return new Response(parseResult.error.message, { status: 400 });
    }
    const { visibility } = parseResult.data;

    if (visibility) {
      await mcpRepository.updateVisibility(id, visibility);
    }

    return new Response("OK");
  },
);

export const DELETE = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;

    // Check if user has delete access
    const hasAccess = await mcpRepository.checkAccess(
      id,
      session.user.id,
      true,
    );
    if (!hasAccess) {
      return new Response("Forbidden", { status: 403 });
    }

    await mcpRepository.deleteById(id);
    return new Response("OK");
  },
);

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

    // Check if user has read access
    const hasAccess = await mcpRepository.checkAccess(
      id,
      session.user.id,
      false,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return new Response("Forbidden", { status: 403 });
    }

    const server = await mcpRepository.selectById(id);
    if (!server) {
      return new Response("Not Found", { status: 404 });
    }

    // Hide userId for security, add ownerId pattern
    const isOwner = server.userId === session.user.id;
    const response = {
      id: server.id,
      name: server.name,
      config: server.config,
      enabled: server.enabled,
      visibility: server.visibility,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      ...(isOwner ? {} : { ownerId: server.userId }),
    };

    return Response.json(response);
  },
);
