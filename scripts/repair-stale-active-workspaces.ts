/**
 * Repair sessions still pinned to a personal workspace after their owner joined
 * a team.
 *
 * `session.activeOrganizationId` is stamped once at sign-in and never re-read,
 * and a session's expiry is pushed out on every request, so a browser signed in
 * before the membership landed keeps billing to the person instead of the
 * organization for as long as it stays in use. `adoptTeamWorkspaceInSessions`
 * closes that hole going forward, but only for members who join *after* it
 * ships — and only through Better Auth, so a membership written straight into
 * the database never triggers it. This repairs the sessions already stuck.
 *
 * Dry run by default; pass --apply to write.
 *
 *   pnpm tsx scripts/repair-stale-active-workspaces.ts
 *   pnpm tsx scripts/repair-stale-active-workspaces.ts --apply
 */
import "load-env";
import { and, eq, gt, inArray } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  MemberTable,
  OrganizationTable,
  SessionTable,
  UserTable,
} from "@/lib/db/pg/schema.pg";
import { isPersonalOrgMetadata } from "@/lib/organization/member-cap";
import logger from "logger";

const apply = process.argv.includes("--apply");

async function repairStaleActiveWorkspaces() {
  const organizations = await pgDb
    .select({
      id: OrganizationTable.id,
      name: OrganizationTable.name,
      metadata: OrganizationTable.metadata,
    })
    .from(OrganizationTable);

  const organizationById = new Map(organizations.map((org) => [org.id, org]));
  const teamOrganizationIds = new Set(
    organizations
      .filter((org) => !isPersonalOrgMetadata(org.metadata))
      .map((org) => org.id),
  );

  const memberships = await pgDb
    .select({
      userId: MemberTable.userId,
      organizationId: MemberTable.organizationId,
    })
    .from(MemberTable);

  // One team workspace per user is what the invite guards enforce
  // (`findOtherTeamOrganization`). Anyone who somehow has two is reported and
  // skipped rather than guessed at.
  const teamOrgsByUser = new Map<string, Set<string>>();
  for (const membership of memberships) {
    if (!teamOrganizationIds.has(membership.organizationId)) continue;
    const existing = teamOrgsByUser.get(membership.userId) ?? new Set<string>();
    existing.add(membership.organizationId);
    teamOrgsByUser.set(membership.userId, existing);
  }

  const userIds = [...teamOrgsByUser.keys()];
  if (userIds.length === 0) {
    logger.info("No team memberships found - nothing to repair.");
    return;
  }

  const sessions = await pgDb
    .select({
      id: SessionTable.id,
      userId: SessionTable.userId,
      email: UserTable.email,
      activeOrganizationId: SessionTable.activeOrganizationId,
      updatedAt: SessionTable.updatedAt,
    })
    .from(SessionTable)
    .innerJoin(UserTable, eq(UserTable.id, SessionTable.userId))
    .where(
      and(
        inArray(SessionTable.userId, userIds),
        gt(SessionTable.expiresAt, new Date()),
      ),
    );

  const repairs: Array<{
    sessionId: string;
    email: string;
    from: string;
    to: string;
  }> = [];
  const ambiguous: string[] = [];

  for (const session of sessions) {
    const teamOrgs = teamOrgsByUser.get(session.userId);
    if (!teamOrgs || teamOrgs.size === 0) continue;
    if (teamOrgs.size > 1) {
      ambiguous.push(session.email);
      continue;
    }
    const [target] = [...teamOrgs];
    if (session.activeOrganizationId === target) continue;

    const active = session.activeOrganizationId
      ? organizationById.get(session.activeOrganizationId)
      : undefined;
    // Same rule as the runtime repair: only a session with nothing to lose
    // moves. One sitting in another team workspace is a deliberate choice.
    const stale =
      !session.activeOrganizationId ||
      !active ||
      isPersonalOrgMetadata(active.metadata);
    if (!stale) continue;

    repairs.push({
      sessionId: session.id,
      email: session.email,
      from: active ? `${active.name} (personal)` : "none",
      to: organizationById.get(target)?.name ?? target,
    });
  }

  for (const email of new Set(ambiguous)) {
    logger.warn(
      `${email} belongs to more than one team workspace - skipped, pick one by hand`,
    );
  }

  if (repairs.length === 0) {
    logger.info("No stale sessions found.");
    return;
  }

  logger.info(
    `${repairs.length} session(s) are billing to the wrong workspace:`,
  );
  for (const repair of repairs) {
    logger.info(`  ${repair.email}: ${repair.from} -> ${repair.to}`);
  }

  if (!apply) {
    logger.info("Dry run. Re-run with --apply to write these changes.");
    return;
  }

  // Grouped by destination so each user's sessions move in one statement.
  const byTarget = new Map<string, string[]>();
  for (const session of sessions) {
    const repair = repairs.find((entry) => entry.sessionId === session.id);
    if (!repair) continue;
    const target = [...(teamOrgsByUser.get(session.userId) ?? [])][0];
    const existing = byTarget.get(target) ?? [];
    existing.push(session.id);
    byTarget.set(target, existing);
  }

  for (const [organizationId, sessionIds] of byTarget) {
    await pgDb
      .update(SessionTable)
      .set({ activeOrganizationId: organizationId })
      .where(inArray(SessionTable.id, sessionIds));
  }

  logger.info(`Repaired ${repairs.length} session(s).`);
}

repairStaleActiveWorkspaces()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error("Repair failed:", error);
    process.exit(1);
  });
