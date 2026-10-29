import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectMemberTable } from "@/lib/db/pg/schema.pg";
import { isUserMemberOfOrganization } from "@/lib/organization/members";
import { ProjectActor, requireProjectAccess } from "./access";

/** Domain error for member mutations; routes map it to the same JSON errors the endpoint always returned. */
export class ProjectMemberError extends Error {
  constructor(
    public readonly status: 409 | 422,
    public readonly code: "cannot_modify_owner" | "not_org_member",
    message: string,
  ) {
    super(message);
    this.name = "ProjectMemberError";
  }
}

/**
 * Adds (or re-roles) an organization member on a project. Extracted from the
 * members route POST so the API route and the voice executor share one
 * implementation: editor access on the project, owner protection, and
 * org-membership check included. Passing no actor falls back to the active
 * session (route behavior).
 */
export async function addProjectMember(input: {
  projectId: string;
  userId: string;
  role: "viewer" | "editor";
  actor?: ProjectActor;
}) {
  const { actor, project } = await requireProjectAccess({
    projectId: input.projectId,
    minRole: "editor",
    actor: input.actor,
  });

  if (input.userId === project.ownerUserId) {
    throw new ProjectMemberError(
      409,
      "cannot_modify_owner",
      "The project owner's membership can't be changed here.",
    );
  }

  const isOrgMember = await isUserMemberOfOrganization(
    actor.organizationId,
    input.userId,
  );
  if (!isOrgMember) {
    throw new ProjectMemberError(
      422,
      "not_org_member",
      "That user isn't a member of this organization.",
    );
  }

  const [member] = await pgDb
    .insert(ProjectMemberTable)
    .values({
      projectId: input.projectId,
      userId: input.userId,
      role: input.role,
    })
    .onConflictDoUpdate({
      target: [ProjectMemberTable.projectId, ProjectMemberTable.userId],
      set: { role: input.role },
    })
    .returning();

  return member;
}
