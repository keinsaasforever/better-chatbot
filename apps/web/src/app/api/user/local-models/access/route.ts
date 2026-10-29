import { getSession } from "auth/server";
import { checkFeature } from "@/lib/gate";

/**
 * Check if user has Local Models Pro subscription
 *
 * GET /api/user/local-models/access
 *
 * Returns:
 *   { hasAccess: boolean, needsAuth?: boolean }
 */
export async function GET() {
  const session = await getSession();

  if (!session?.user?.id) {
    return Response.json({
      hasAccess: false,
      needsAuth: true,
    });
  }

  const hasAccess = await checkFeature("local_models");

  return Response.json({ hasAccess });
}
