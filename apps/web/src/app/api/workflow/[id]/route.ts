import { withAuth } from "auth/route-guard";
import { workflowRepository } from "lib/db/repository";
import { canEditWorkflow, canDeleteWorkflow } from "lib/auth/permissions";

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
    const workflow = await workflowRepository.selectById(id);
    return Response.json(workflow);
  },
);

export const PUT = withAuth(
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { visibility, isPublished } = await request.json();

    // Check if user has permission to edit workflows
    const canEdit = await canEditWorkflow();
    if (!canEdit) {
      return Response.json(
        { error: "Only editors and admins can edit workflows" },
        { status: 403 },
      );
    }
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

    // Get existing workflow
    const existingWorkflow = await workflowRepository.selectById(id);
    if (!existingWorkflow) {
      return new Response("Workflow not found", { status: 404 });
    }

    // Update only the specified fields
    const updatedWorkflow = await workflowRepository.save({
      ...existingWorkflow,
      visibility: visibility ?? existingWorkflow.visibility,
      isPublished: isPublished ?? existingWorkflow.isPublished,
      updatedAt: new Date(),
    });

    return Response.json(updatedWorkflow);
  },
);

export const DELETE = withAuth(
  async (
    _request,
    session,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;

    // Check if user has permission to delete workflows
    const canDelete = await canDeleteWorkflow();
    if (!canDelete) {
      return Response.json(
        { error: "Only editors and admins can delete workflows" },
        { status: 403 },
      );
    }
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
    await workflowRepository.delete(id);
    return Response.json({ message: "Workflow deleted" });
  },
);
