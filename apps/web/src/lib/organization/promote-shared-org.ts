import { eq } from "drizzle-orm";
import { pgDb } from "lib/db/pg/db.pg";
import { MemberTable, OrganizationTable } from "lib/db/pg/schema.pg";
import logger from "logger";
import { isPersonalOrgMetadata } from "./member-cap";

/**
 * A personal workspace that has been shared with someone else is a team
 * workspace — clear the flag once a second member joins.
 *
 * Nothing used to do this. The invite guards deliberately skip personal orgs so
 * that a solo user can always be invited elsewhere, so an owner could rename
 * their auto-created workspace and invite colleagues into it while it stayed
 * flagged personal. Billing reads that flag to decide whether to charge the
 * organization or the individual, so every member was charged to their own user
 * id: each burned their personal free credits while the credits their admin had
 * paid for sat unreachable on the admin's own customer.
 *
 * Returns whether the flag was cleared, for logging and tests.
 */
export async function promoteSharedPersonalOrganization(
  organizationId: string,
): Promise<boolean> {
  const [org] = await pgDb
    .select({ metadata: OrganizationTable.metadata })
    .from(OrganizationTable)
    .where(eq(OrganizationTable.id, organizationId))
    .limit(1);

  if (!org || !isPersonalOrgMetadata(org.metadata)) return false;

  const members = await pgDb
    .select({ id: MemberTable.id })
    .from(MemberTable)
    .where(eq(MemberTable.organizationId, organizationId));
  if (members.length <= 1) return false;

  // Keep `userId`: it records who created the workspace, and nothing reads it
  // for billing.
  const metadata = JSON.parse(org.metadata as string);
  delete metadata.personal;

  await pgDb
    .update(OrganizationTable)
    .set({ metadata: JSON.stringify(metadata) })
    .where(eq(OrganizationTable.id, organizationId));

  logger.info(
    `Organization ${organizationId} now has ${members.length} members - cleared its personal-workspace flag so billing follows the organization`,
  );
  return true;
}
