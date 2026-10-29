import { withAuth } from "auth/route-guard";
import { getAvailableOrganizationModels } from "lib/ai/routing/service";

export const GET = withAuth(async (_request, session) => {
  const organizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
  const result = await getAvailableOrganizationModels({
    organizationId,
    userId: session.user.id,
  });

  return Response.json({
    enabled: result.automaticRoutingEnabled && result.models.length > 0,
    candidateCount: result.models.length,
  });
});
