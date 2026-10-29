import { withAuth } from "auth/route-guard";
import { workflowRepository } from "lib/db/repository";

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
    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      true,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
    const workflow = await workflowRepository.selectStructureById(id);
    return Response.json(workflow);
  },
);

export const POST = withAuth(
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { nodes, edges, deleteNodes, deleteEdges } = await request.json();
    const { id } = await params;
    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null } | undefined
    )?.activeOrganizationId;

    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      false,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
    await workflowRepository.saveStructure({
      workflowId: id,
      nodes: nodes.map((v) => ({
        ...v,
        workflowId: id,
      })),
      edges: edges.map((v) => ({
        ...v,
        workflowId: id,
      })),
      deleteNodes,
      deleteEdges,
    });

    return Response.json({ success: true });
  },
);
