import "server-only";
import { serverCache } from "lib/cache";
import { pgDb } from "lib/db/pg/db.pg";
import { OrganizationTable } from "lib/db/pg/schema.pg";
import { isPersonalOrgMetadata } from "lib/organization/member-cap";
import { eq } from "drizzle-orm";

export type BillingCustomer = {
  /** The Autumn customer every check and every usage event is keyed on. */
  customerId: string;
  /**
   * Only set for team organizations, where the customer is the org and the
   * member needs distinguishing within it. Never set for a personal
   * workspace, whose customer already *is* the user.
   */
  entityId?: string;
};

/**
 * The single definition of which Autumn customer a piece of work is billed to.
 *
 * This rule used to be written out four times — in the Autumn customer lookup, in
 * the voice session route, and twice in the workflow generator — and the copies
 * drifted. Three of them tested only the legacy `personal-` id prefix, which no
 * organization created since the personal-workspace flag landed actually has,
 * so the same person was billed as two different Autumn customers depending on
 * whether they were chatting or dictating. Keep this the only copy.
 *
 * Both clauses matter:
 * - `metadata.personal === true` is how personal workspaces are flagged today
 *   (`lib/auth/auth-instance.ts` sets it at signup).
 * - the `personal-` prefix is the legacy form, carried by workspaces migrated
 *   from better-chatbot v1. Dropping it would re-break exactly those accounts.
 */
export function resolveBillingCustomer(input: {
  userId: string;
  organizationId?: string | null;
  organizationMetadata?: string | null;
}): BillingCustomer {
  const { userId, organizationId, organizationMetadata } = input;

  if (!organizationId) return { customerId: userId };

  const isPersonal =
    isPersonalOrgMetadata(organizationMetadata) ||
    organizationId.startsWith("personal-");

  return isPersonal
    ? { customerId: userId }
    : { customerId: organizationId, entityId: userId };
}

const ORG_METADATA_TTL_MS = 60 * 1000;

/**
 * Read an organization's metadata straight from Postgres, where the column is
 * genuinely `text`. Short-lived cache: an org's personal flag is set once at
 * creation and never edited, so this only exists to keep hot paths off the DB.
 */
async function getOrganizationMetadata(
  organizationId: string,
): Promise<string | null> {
  const cacheKey = `org-metadata:${organizationId}`;
  const cached = await serverCache.get<{ metadata: string | null }>(cacheKey);
  if (cached) return cached.metadata;

  const [org] = await pgDb
    .select({ metadata: OrganizationTable.metadata })
    .from(OrganizationTable)
    .where(eq(OrganizationTable.id, organizationId))
    .limit(1);

  const metadata = org?.metadata ?? null;
  await serverCache.set(cacheKey, { metadata }, ORG_METADATA_TTL_MS);
  return metadata;
}

/**
 * `resolveBillingCustomer` for callers that hold an organization id but not its
 * metadata — background jobs and device-authenticated routes, which have no
 * session to read it from.
 *
 * Fails toward the organization: if the metadata read throws, the org is
 * treated as a team org, which is what it was before this function existed.
 * That keeps a transient DB error from silently moving someone's billing.
 */
export async function resolveBillingCustomerById(input: {
  userId: string;
  organizationId?: string | null;
}): Promise<BillingCustomer> {
  const { userId, organizationId } = input;
  if (!organizationId) return { customerId: userId };

  try {
    const organizationMetadata = await getOrganizationMetadata(organizationId);
    return resolveBillingCustomer({
      userId,
      organizationId,
      organizationMetadata,
    });
  } catch {
    return resolveBillingCustomer({ userId, organizationId });
  }
}
