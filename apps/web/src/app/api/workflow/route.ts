import { getSession } from "auth/server";
import { withAuth } from "auth/route-guard";
import { workflowRepository } from "lib/db/repository";
import { canCreateWorkflow, canEditWorkflow } from "lib/auth/permissions";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json([]);
  }
  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
  const workflows = await workflowRepository.selectAll(
    session.user.id,
    activeOrganizationId,
  );
  return Response.json(workflows);
}

export const POST = withAuth(async (request, session) => {
  const {
    name,
    description,
    icon,
    id,
    isPublished,
    visibility,
    noGenerateInputNode,
  } = await request.json();

  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;

  // Check if user has permission to create/edit workflows
  if (id) {
    // Editing existing workflow
    const canEdit = await canEditWorkflow();
    if (!canEdit) {
      return Response.json(
        { error: "You don't have permission to edit workflows" },
        { status: 403 },
      );
    }
    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      false,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
  } else {
    // Creating new workflow
    const canCreate = await canCreateWorkflow();
    if (!canCreate) {
      return Response.json(
        { error: "You don't have permission to create workflows" },
        { status: 403 },
      );
    }
  }

  const workflow = await workflowRepository.save(
    {
      name,
      description,
      id,
      isPublished,
      visibility,
      icon,
      userId: session.user.id,
      // Stamp org only when creating (no id). On edit-via-POST, leave undefined
      // so save() preserves the workflow's original org rather than re-stamping.
      organizationId: id ? undefined : (activeOrganizationId ?? null),
    },
    noGenerateInputNode,
  );

  return Response.json(workflow);
});
