import "server-only";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  MemberTable,
  ProjectMemberTable,
  ProjectTable,
} from "@/lib/db/pg/schema.pg";

/** Auto-created catch-all project for voice notes that don't match anything. */
export const VOICE_INBOX_NAME = "Voice Inbox";
const VOICE_INBOX_DESCRIPTION =
  "Captured voice notes that didn't clearly match another project.";

export type ProjectRef = {
  id: string;
  name: string;
  description: string | null;
};

export async function listUserProjects(userId: string): Promise<ProjectRef[]> {
  return pgDb
    .select({
      id: ProjectTable.id,
      name: ProjectTable.name,
      description: ProjectTable.description,
    })
    .from(ProjectTable)
    .where(eq(ProjectTable.ownerUserId, userId));
}

/**
 * Projects the user can access in their active org: owned ones plus those
 * with a project_member row. No active org fails closed to owner-only
 * (matching the repository convention).
 */
export async function listAccessibleProjects(
  userId: string,
  organizationId?: string | null,
): Promise<ProjectRef[]> {
  if (!organizationId) {
    return listUserProjects(userId);
  }
  return pgDb
    .select({
      id: ProjectTable.id,
      name: ProjectTable.name,
      description: ProjectTable.description,
    })
    .from(ProjectTable)
    .leftJoin(
      ProjectMemberTable,
      and(
        eq(ProjectMemberTable.projectId, ProjectTable.id),
        eq(ProjectMemberTable.userId, userId),
      ),
    )
    .where(
      and(
        eq(ProjectTable.organizationId, organizationId),
        or(
          eq(ProjectTable.ownerUserId, userId),
          isNotNull(ProjectMemberTable.userId),
        ),
      ),
    );
}

/**
 * Best-effort name match: exact (case-insensitive) first, then a containment
 * match in either direction. Returns null when nothing is confidently close.
 */
export function matchProjectByName(
  projects: ProjectRef[],
  name: string | null | undefined,
): ProjectRef | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (!needle) return null;

  const exact = projects.find((p) => p.name.trim().toLowerCase() === needle);
  if (exact) return exact;

  const contains = projects.find((p) => {
    const hay = p.name.trim().toLowerCase();
    return hay.includes(needle) || needle.includes(hay);
  });
  return contains ?? null;
}

/** Find-or-create the user's Voice Inbox project, returning its id. */
export async function ensureVoiceInbox(userId: string): Promise<string> {
  const [existing] = await pgDb
    .select({ id: ProjectTable.id })
    .from(ProjectTable)
    .where(
      and(
        eq(ProjectTable.ownerUserId, userId),
        eq(ProjectTable.name, VOICE_INBOX_NAME),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [membership] = await pgDb
    .select({ organizationId: MemberTable.organizationId })
    .from(MemberTable)
    .where(eq(MemberTable.userId, userId))
    .limit(1);
  if (!membership) throw new Error("Voice Inbox requires an organization.");

  return pgDb.transaction(async (tx) => {
    const [created] = await tx
      .insert(ProjectTable)
      .values({
        name: VOICE_INBOX_NAME,
        description: VOICE_INBOX_DESCRIPTION,
        organizationId: membership.organizationId,
        ownerUserId: userId,
      })
      .onConflictDoNothing()
      .returning({ id: ProjectTable.id });
    if (created) {
      await tx.insert(ProjectMemberTable).values({
        projectId: created.id,
        userId,
        role: "owner",
      });
      return created.id;
    }
    const [raceWinner] = await tx
      .select({ id: ProjectTable.id })
      .from(ProjectTable)
      .where(
        and(
          eq(ProjectTable.ownerUserId, userId),
          eq(ProjectTable.name, VOICE_INBOX_NAME),
        ),
      )
      .limit(1);
    if (!raceWinner) throw new Error("Could not create Voice Inbox.");
    return raceWinner.id;
  });
}

/**
 * Resolve a target project id for a transcript.
 * - If `projectName` matches one of the user's projects, use it.
 * - Otherwise, when `fallbackToInbox`, route to the Voice Inbox.
 * - Otherwise return null (e.g. a transient question that needs no home).
 */
export async function resolveProjectId(input: {
  userId: string;
  projectName?: string | null;
  fallbackToInbox: boolean;
}): Promise<{ projectId: string | null; matched: boolean }> {
  const projects = await listUserProjects(input.userId);
  const match = matchProjectByName(projects, input.projectName);
  if (match) return { projectId: match.id, matched: true };
  if (input.fallbackToInbox) {
    return { projectId: await ensureVoiceInbox(input.userId), matched: false };
  }
  return { projectId: null, matched: false };
}
