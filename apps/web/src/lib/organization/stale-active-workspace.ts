import { and, eq, gt, inArray } from "drizzle-orm";
import { pgDb } from "lib/db/pg/db.pg";
import { OrganizationTable, SessionTable } from "lib/db/pg/schema.pg";
import logger from "logger";
import { isPersonalOrgMetadata } from "./member-cap";

/**
 * Point a user's live sessions at the team workspace they just joined.
 *
 * `session.activeOrganizationId` is stamped once, by the `session.create` hook,
 * and only when it is empty. Nothing ever re-reads it, and a session's expiry is
 * pushed out on every request, so a browser that signed in *before* the
 * membership landed stays pinned to the personal workspace it was stamped with
 * for as long as it keeps being used. Billing follows that workspace
 * (`lib/billing/billing-customer.ts`), so the new member quietly spends their
 * own free credits while the workspace they were added to sits untouched.
 *
 * That is not theoretical: a member added 2h22m after her session was created
 * spent a week reading "no credits" with millions unspent on the team.
 *
 * Only sessions with nothing to lose move: no active workspace, a personal one,
 * or one that no longer exists. A session already pointing at another team
 * workspace is left alone — that is a real choice, and org-scoped data (agents,
 * workflows, MCP servers) would otherwise change under the user's feet.
 *
 * Returns the number of sessions repointed, for logging and tests.
 */
export async function adoptTeamWorkspaceInSessions(input: {
  userId: string;
  organizationId: string;
}): Promise<number> {
  const { userId, organizationId } = input;

  const [organization] = await pgDb
    .select({ metadata: OrganizationTable.metadata })
    .from(OrganizationTable)
    .where(eq(OrganizationTable.id, organizationId))
    .limit(1);

  // A personal workspace is never a destination: it bills to the user either
  // way, so moving a session onto one would change nothing but the label.
  if (!organization || isPersonalOrgMetadata(organization.metadata)) return 0;

  const sessions = await pgDb
    .select({
      id: SessionTable.id,
      activeOrganizationId: SessionTable.activeOrganizationId,
      // Null for a session whose workspace was deleted — the left join finds no
      // row, which is exactly the "nothing to lose" case.
      activeOrganizationRowId: OrganizationTable.id,
      activeOrganizationMetadata: OrganizationTable.metadata,
    })
    .from(SessionTable)
    .leftJoin(
      OrganizationTable,
      eq(OrganizationTable.id, SessionTable.activeOrganizationId),
    )
    .where(
      and(
        eq(SessionTable.userId, userId),
        // An expired session will be replaced by a fresh one, which the
        // `session.create` hook stamps correctly on its own.
        gt(SessionTable.expiresAt, new Date()),
      ),
    );

  const stale = sessions.filter(
    (session) =>
      !session.activeOrganizationId ||
      !session.activeOrganizationRowId ||
      isPersonalOrgMetadata(session.activeOrganizationMetadata),
  );
  if (stale.length === 0) return 0;

  await pgDb
    .update(SessionTable)
    .set({ activeOrganizationId: organizationId })
    .where(
      inArray(
        SessionTable.id,
        stale.map((session) => session.id),
      ),
    );

  logger.info(
    `Moved ${stale.length} session(s) of user ${userId} to team workspace ${organizationId} so billing follows the organization`,
  );
  return stale.length;
}
