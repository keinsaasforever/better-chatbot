import "server-only";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getSession } from "auth/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  MemberTable,
  ProjectMemberTable,
  ProjectTable,
} from "@/lib/db/pg/schema.pg";

export type ProjectRole = "viewer" | "editor" | "owner";

export type ProjectActor = {
  userId: string;
  organizationId: string;
};

const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export class ProjectAccessError extends Error {
  constructor(
    public readonly status: 401 | 403 | 404 | 409,
    public readonly code:
      | "unauthorized"
      | "organization_required"
      | "organization_forbidden"
      | "project_not_found"
      | "project_forbidden",
    message: string,
  ) {
    super(message);
    this.name = "ProjectAccessError";
  }
}

export async function requireActiveOrganization(): Promise<ProjectActor> {
  const session = await getSession();

  if (!session?.user?.id) {
    throw new ProjectAccessError(401, "unauthorized", "Unauthorized.");
  }

  const organizationId = (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;

  if (!organizationId) {
    throw new ProjectAccessError(
      409,
      "organization_required",
      "Select an organization before accessing projects.",
    );
  }

  const [membership] = await pgDb
    .select({ id: MemberTable.id })
    .from(MemberTable)
    .where(
      and(
        eq(MemberTable.organizationId, organizationId),
        eq(MemberTable.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!membership) {
    throw new ProjectAccessError(
      403,
      "organization_forbidden",
      "The active organization is not accessible.",
    );
  }

  return { userId: session.user.id, organizationId };
}

export async function requireProjectAccess(input: {
  projectId: string;
  minRole?: ProjectRole;
  actor?: ProjectActor;
  /** @deprecated Routes should pass an actor or rely on the active session. */
  userId?: string;
}) {
  const actor = input.actor ?? (await requireActiveOrganization());

  const [project] = await pgDb
    .select()
    .from(ProjectTable)
    .where(
      and(
        eq(ProjectTable.id, input.projectId),
        eq(ProjectTable.organizationId, actor.organizationId),
      ),
    )
    .limit(1);

  if (!project) {
    throw new ProjectAccessError(
      404,
      "project_not_found",
      "Project not found.",
    );
  }

  let role: ProjectRole | null =
    project.ownerUserId === actor.userId ? "owner" : null;

  if (!role) {
    const [member] = await pgDb
      .select({ role: ProjectMemberTable.role })
      .from(ProjectMemberTable)
      .where(
        and(
          eq(ProjectMemberTable.projectId, project.id),
          eq(ProjectMemberTable.userId, actor.userId),
        ),
      )
      .limit(1);

    role = member?.role ?? null;
  }

  if (!role) {
    throw new ProjectAccessError(
      404,
      "project_not_found",
      "Project not found.",
    );
  }

  const required = input.minRole ?? "viewer";
  if (ROLE_RANK[role] < ROLE_RANK[required]) {
    throw new ProjectAccessError(
      403,
      "project_forbidden",
      `Project role "${required}" is required.`,
    );
  }

  return { actor, project, role };
}

export function toProjectErrorResponse(error: unknown) {
  if (error instanceof ProjectAccessError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: error.status },
    );
  }

  console.error("[projects] unhandled error", error);
  return NextResponse.json(
    {
      error: {
        code: "internal_error",
        message: "Internal Server Error.",
      },
    },
    { status: 500 },
  );
}
