import { getSession } from "auth/server";
import { workflowRepository } from "lib/db/repository";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return Response.json([]);
  }
  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
  const workflows = await workflowRepository.selectExecuteAbility(
    session.user.id,
    activeOrganizationId,
  );
  return Response.json(workflows);
}
