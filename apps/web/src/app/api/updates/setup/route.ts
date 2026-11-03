import { withAuth } from "auth/route-guard";
import { getIsUserAdmin } from "lib/user/utils";
import { updateSetupUrlForDeployment } from "lib/updates/workflow";

/**
 * GET /api/updates/setup
 *
 * The link that turns on update checks for this copy (see lib/updates). Only
 * the administrator gets it: it opens their GitHub repository.
 */
export const GET = withAuth(async (_request, session) => {
  if (!getIsUserAdmin(session.user)) return Response.json({ url: null });
  return Response.json({ url: updateSetupUrlForDeployment() });
});
