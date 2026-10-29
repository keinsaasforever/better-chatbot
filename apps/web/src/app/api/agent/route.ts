import { agentRepository } from "lib/db/repository";
import { withAuth } from "auth/route-guard";
import { z } from "zod";
import { AgentCreateSchema, AgentQuerySchema } from "app-types/agent";
import { canCreateAgent } from "lib/auth/permissions";
import { assertOwnedAgentFiles } from "lib/ai/agent/agent-files";

export const GET = withAuth(async (request, session) => {
  try {
    const url = new URL(request.url);
    const queryParams = Object.fromEntries(url.searchParams);
    const {
      type,
      filters: filtersParam,
      limit,
    } = AgentQuerySchema.parse(queryParams);

    // Parse filters - can be passed as comma-separated string or single type
    let filters;
    if (filtersParam) {
      filters = filtersParam.split(",").map((f) => f.trim());
    } else {
      // Fallback to single type parameter for backward compatibility
      filters = [type];
    }

    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null } | undefined
    )?.activeOrganizationId;

    // Use the new simplified selectAgents method with database-level filtering and limiting
    const agents = await agentRepository.selectAgents(
      session.user.id,
      filters,
      limit,
      activeOrganizationId,
    );
    return Response.json(agents);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid query parameters", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to fetch agents:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

export const POST = withAuth(async (request, session) => {
  // Check if user has permission to create agents
  const hasPermission = await canCreateAgent();
  if (!hasPermission) {
    return Response.json(
      { error: "You don't have permission to create agents" },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const data = AgentCreateSchema.parse(body);
    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null } | undefined
    )?.activeOrganizationId;

    // A file binding is a read grant against storage, so it may only name keys
    // the caller owns.
    const ownership = assertOwnedAgentFiles({
      files: data.instructions?.files,
      userId: session.user.id,
    });
    if (!ownership.ok) {
      return Response.json(
        { error: "Agent files must belong to the current user" },
        { status: 400 },
      );
    }

    const agent = await agentRepository.insertAgent({
      ...data,
      userId: session.user.id,
      organizationId: activeOrganizationId ?? null,
    });

    return Response.json(agent);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }

    console.error("Failed to upsert agent:", error);
    return Response.json(
      { message: "Internal Server Error" },
      {
        status: 500,
      },
    );
  }
});
