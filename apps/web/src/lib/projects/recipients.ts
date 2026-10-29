import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectMemberTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";

/**
 * Every user who should hear about a project: the owner plus all
 * `project_member` rows. Older projects may lack the owner's member row, so
 * the owner is always unioned in explicitly.
 */
export async function listProjectRecipientUserIds(
  projectId: string,
): Promise<string[]> {
  const [project] = await pgDb
    .select({ ownerUserId: ProjectTable.ownerUserId })
    .from(ProjectTable)
    .where(eq(ProjectTable.id, projectId))
    .limit(1);

  const members = await pgDb
    .select({ userId: ProjectMemberTable.userId })
    .from(ProjectMemberTable)
    .where(eq(ProjectMemberTable.projectId, projectId));

  return [
    ...new Set([
      ...(project ? [project.ownerUserId] : []),
      ...members.map((member) => member.userId),
    ]),
  ];
}
