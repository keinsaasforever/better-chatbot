import "server-only";

import { eq, sql } from "drizzle-orm";
import { pgDb } from "lib/db/pg/db.pg";
import {
  InvitationTable,
  OrganizationTable,
  UserTable,
} from "lib/db/pg/schema.pg";
import type { InvitationRecord } from "./invitation-state";

/**
 * Read one invitation together with its organization name and inviter email.
 *
 * Deliberately unscoped by user: the caller compares the invited address with
 * the session and renders a masked "wrong account" state (see
 * `resolveInvitationState`). The invitation id is the capability here, exactly
 * as it is in the emailed link.
 */
export async function getInvitationSummary(
  invitationId: string,
): Promise<InvitationRecord | null> {
  const [row] = await pgDb
    .select({
      id: InvitationTable.id,
      organizationId: InvitationTable.organizationId,
      organizationName: OrganizationTable.name,
      inviterId: InvitationTable.inviterId,
      email: InvitationTable.email,
      status: InvitationTable.status,
      expiresAt: InvitationTable.expiresAt,
    })
    .from(InvitationTable)
    .innerJoin(
      OrganizationTable,
      eq(InvitationTable.organizationId, OrganizationTable.id),
    )
    .where(eq(InvitationTable.id, invitationId))
    .limit(1);

  if (!row) return null;

  // `user.id` is a uuid column while `invitation.inviter_id` is text, so the
  // join has to go through an explicit cast.
  const [inviter] = await pgDb
    .select({ email: UserTable.email })
    .from(UserTable)
    .where(sql`${UserTable.id}::text = ${row.inviterId}`)
    .limit(1);

  return {
    id: row.id,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    inviterEmail: inviter?.email ?? null,
    email: row.email,
    status: row.status,
    expiresAt: row.expiresAt,
  };
}
