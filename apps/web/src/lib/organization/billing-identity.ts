import { isPersonalOrgMetadata } from "./member-cap";

/**
 * "Is this workspace personal?" for callers that hold an organization *row*.
 *
 * The billing rule built on this — which Autumn customer a piece of work is
 * charged to — lives in `lib/billing/billing-customer.ts` and is the only copy.
 * This module exists because that one is `server-only` and two client
 * components need the predicate: the credit gate and the billing page both
 * decide whether to show workspace-level or personal wording.
 *
 * Detection is the union of both rules, so it can only ever widen; a team org
 * is never reclassified as personal. Both clauses are load-bearing:
 *
 * - `metadata.personal === true` is how workspaces are flagged today
 *   (`lib/auth/auth-instance.ts` sets it at signup).
 * - the `personal-` id prefix is the legacy form, carried only by rows migrated
 *   from better-chatbot v1. Modern personal orgs get a `crypto.randomUUID()`
 *   id, so a prefix-only check misses every one of them — which is exactly how
 *   six call sites came to disagree about who to bill.
 */

export type BillingOrganization = {
  id: string;
  metadata?: string | null;
};

/** A personal "Workspace" org: flagged via metadata, or the legacy id prefix. */
export function isPersonalOrg(organization: BillingOrganization): boolean {
  return (
    isPersonalOrgMetadata(organization.metadata) ||
    organization.id.startsWith("personal-")
  );
}
