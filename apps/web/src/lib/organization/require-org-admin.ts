import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { MemberTable } from "@/lib/db/pg/schema.pg";
import type { UserSession } from "@/types/user";
import { getSession } from "auth/server";
import { and, eq } from "drizzle-orm";
import logger from "logger";

/**
 * Gate an organization-settings route on owner/admin membership.
 *
 * Returns either the session or a `Response` the caller early-returns, so the
 * failure shapes (401 unauthenticated, 403 not an admin, 503 the membership
 * read itself failed) stay identical across every route that uses it. That
 * third case matters: an admin whose org is fine must be able to tell "you are
 * not allowed" from "we could not check".
 *
 * Platform admins pass regardless of membership, matching the AI-policy route
 * this was extracted from.
 */
export type OrgAdminResult =
  | { session: UserSession; error?: undefined }
  | { session?: undefined; error: Response };

export async function requireOrganizationAdmin(
  organizationId: string,
): Promise<OrgAdminResult> {
  const session = await getSession();
  if (!session?.user?.id) {
    return { error: new Response("Unauthorized", { status: 401 }) };
  }

  try {
    const member = await pgDb.query.MemberTable.findFirst({
      where: and(
        eq(MemberTable.organizationId, organizationId),
        eq(MemberTable.userId, session.user.id),
      ),
    });
    const isPlatformAdmin =
      (session.user as { role?: string }).role === "admin";
    if (
      !isPlatformAdmin &&
      member?.role !== "owner" &&
      member?.role !== "admin"
    ) {
      return { error: new Response("Forbidden", { status: 403 }) };
    }
    return { session };
  } catch (error) {
    logger.error("Failed to authorize organization admin", error);
    return {
      error: Response.json(
        { error: "Unable to verify your access right now. Please try again." },
        { status: 503 },
      ),
    };
  }
}
