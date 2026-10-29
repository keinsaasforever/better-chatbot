import { eq, inArray } from "drizzle-orm";
import { pgDb } from "lib/db/pg/db.pg";
import { MemberTable, OrganizationTable } from "lib/db/pg/schema.pg";
import { isPersonalOrg } from "./billing-identity";

export type DefaultOrganization = {
  id: string;
  name: string;
  metadata: string | null;
};

/**
 * The organization a user belongs in by default.
 *
 * Used in two places, which is why it returns the row rather than an id:
 * `auth-instance.ts` stamps the id onto a new session, and
 * the billing customer lookup needs the metadata to tell a personal workspace from
 * a team org without a second query.
 *
 * Prefers an org the user was invited into (they hold a non-owner role there)
 * over their own personal workspace, which they always own. This keeps an
 * invited employee defaulted into the employer's org instead of snapping back
 * to their personal workspace.
 */
export async function resolveDefaultOrganization(
  userId: string,
): Promise<DefaultOrganization | undefined> {
  const memberships = await pgDb
    .select()
    .from(MemberTable)
    .where(eq(MemberTable.userId, userId));

  if (memberships.length === 0) return undefined;

  const orgIds = memberships.map((m) => m.organizationId);
  const organizations = await pgDb
    .select({
      id: OrganizationTable.id,
      name: OrganizationTable.name,
      metadata: OrganizationTable.metadata,
    })
    .from(OrganizationTable)
    .where(inArray(OrganizationTable.id, orgIds))
    .limit(10);
  const orgById = new Map(organizations.map((o) => [o.id, o]));

  const invited = memberships.find(
    (m) => m.role !== "owner" && orgById.has(m.organizationId),
  );
  if (invited) return orgById.get(invited.organizationId);

  const personal = organizations.find(isPersonalOrg);
  return personal ?? organizations[0];
}

/** Convenience for callers that only need the id (session bootstrapping). */
export async function resolveDefaultActiveOrganizationId(
  userId: string,
): Promise<string | undefined> {
  return (await resolveDefaultOrganization(userId))?.id;
}
