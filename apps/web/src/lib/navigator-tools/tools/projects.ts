import "server-only";
import {
  type OrganizationMemberRow,
  fetchOrganizationMembers,
  isUserMemberOfOrganization,
} from "lib/organization/members";
import {
  getLatestProjectStatusSnapshot,
  getRecentProjectEvents,
} from "lib/project-brain/generated-insights";
import { ProjectAccessError, requireProjectAccess } from "lib/projects/access";
import { createProject } from "lib/projects/create-project";
import {
  ProjectMemberError,
  addProjectMember as addProjectMemberShared,
} from "lib/projects/members";
import {
  type ProjectRef,
  listAccessibleProjects,
  matchProjectByName,
} from "lib/voice/project-resolver";
import {
  addProjectMemberSpec,
  createProjectSpec,
  getProjectStatusSpec,
  listProjectsSpec,
} from "../definitions";
import { requireOrganization, trim } from "../shared";
import { NavigatorToolError, defineTool } from "../types";

/** Domain errors from the project helpers carry spoken-ready messages. */
function rethrowProjectError(error: unknown): never {
  if (
    error instanceof ProjectAccessError ||
    error instanceof ProjectMemberError
  ) {
    throw new NavigatorToolError(error.code, error.message);
  }
  throw error;
}

function projectNotFoundPayload(projects: ProjectRef[]) {
  return {
    found: false,
    note: "Kein passendes Projekt gefunden.",
    projects: projects.slice(0, 10).map((project) => project.name),
  };
}

/**
 * Resolve a project from the actor's accessible set by id or fuzzy name. Never
 * looks outside that set, so an id for someone else's project resolves to
 * nothing rather than to a forbidden row.
 */
function resolveProjectRef(
  projects: ProjectRef[],
  args: { projectId?: string; projectName?: string },
): ProjectRef | null {
  if (args.projectId) {
    return projects.find((project) => project.id === args.projectId) ?? null;
  }
  return matchProjectByName(projects, args.projectName);
}

export const listProjectsTool = defineTool(listProjectsSpec, async (actor) => {
  const projects = await listAccessibleProjects(
    actor.userId,
    actor.organizationId,
  );
  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      description: trim(project.description, 120),
    })),
  };
});

export const createProjectTool = defineTool(
  createProjectSpec,
  async (actor, args) => {
    const organizationId = requireOrganization(actor);
    // The session route checks membership in `requireActiveOrganization`; a
    // tool caller may hold a key minted before a membership was revoked.
    if (!(await isUserMemberOfOrganization(organizationId, actor.userId))) {
      throw new NavigatorToolError(
        "organization_forbidden",
        "The active organization is not accessible.",
      );
    }
    const project = await createProject(
      { userId: actor.userId, organizationId },
      args,
    );
    return {
      created: true,
      project: { id: project.id, name: project.name },
      url: `/projects/${project.id}`,
    };
  },
);

export const getProjectStatusTool = defineTool(
  getProjectStatusSpec,
  async (actor, args) => {
    const organizationId = requireOrganization(actor);
    const projects = await listAccessibleProjects(actor.userId, organizationId);
    const ref = resolveProjectRef(projects, args);
    if (!ref) return projectNotFoundPayload(projects);

    try {
      await requireProjectAccess({
        projectId: ref.id,
        actor: { userId: actor.userId, organizationId },
      });
    } catch (error) {
      rethrowProjectError(error);
    }

    const [snapshot, events] = await Promise.all([
      getLatestProjectStatusSnapshot(ref.id),
      getRecentProjectEvents(ref.id, 8).catch(() => []),
    ]);

    const statusData = (snapshot?.statusRenderData ?? null) as {
      health?: string;
      progressPct?: number | null;
      summary?: string | null;
      blockers?: string[];
    } | null;
    const todosData = (snapshot?.todosRenderData ?? null) as {
      items?: { title: string; status: string; priority: string }[];
    } | null;

    return {
      project: { id: ref.id, name: ref.name },
      status: snapshot
        ? {
            health: statusData?.health ?? snapshot.health,
            progressPct: statusData?.progressPct ?? null,
            summary: trim(statusData?.summary ?? snapshot.summary, 400),
            blockers: (statusData?.blockers ?? []).slice(0, 5),
            generatedAt: snapshot.generatedAt?.toISOString?.() ?? null,
          }
        : null,
      todos: (todosData?.items ?? []).slice(0, 10).map((item) => ({
        title: item.title,
        status: item.status,
        priority: item.priority,
      })),
      recentEvents: events.map((event) => ({
        date: event.eventDate?.toISOString?.().slice(0, 10) ?? null,
        title: trim(event.summary, 140),
      })),
      ...(snapshot ? {} : { note: "Noch keine Statusdaten vorhanden." }),
    };
  },
);

/**
 * Resolve an org member from a spoken name or email. Email matches exactly;
 * names match exactly first, then by containment. Multiple hits return the
 * candidate names so the model can ask instead of guessing.
 */
function resolveOrgMember(
  members: OrganizationMemberRow[],
  nameOrEmail: string,
):
  | { kind: "match"; member: OrganizationMemberRow }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" } {
  const needle = nameOrEmail.trim().toLowerCase();
  if (!needle) return { kind: "none" };

  const byEmail = members.filter(
    (member) => member.user.email?.toLowerCase() === needle,
  );
  if (byEmail.length === 1) return { kind: "match", member: byEmail[0] };

  const exactNames = members.filter(
    (member) => member.user.name?.trim().toLowerCase() === needle,
  );
  if (exactNames.length === 1) return { kind: "match", member: exactNames[0] };
  if (exactNames.length > 1) {
    return {
      kind: "ambiguous",
      candidates: exactNames.map(
        (member) => member.user.email ?? member.user.name ?? member.userId,
      ),
    };
  }

  const contains = members.filter((member) =>
    member.user.name?.toLowerCase().includes(needle),
  );
  if (contains.length === 1) return { kind: "match", member: contains[0] };
  if (contains.length > 1) {
    return {
      kind: "ambiguous",
      candidates: contains.map(
        (member) => member.user.name ?? member.user.email ?? member.userId,
      ),
    };
  }
  return { kind: "none" };
}

export const addProjectMemberTool = defineTool(
  addProjectMemberSpec,
  async (actor, args) => {
    const organizationId = requireOrganization(actor);
    const projects = await listAccessibleProjects(actor.userId, organizationId);
    const ref = matchProjectByName(projects, args.projectName);
    if (!ref) return projectNotFoundPayload(projects);

    const members = await fetchOrganizationMembers(organizationId);
    const resolved = resolveOrgMember(members, args.memberNameOrEmail);
    if (resolved.kind === "none") {
      throw new NavigatorToolError(
        "not_org_member",
        "Diese Person ist kein Mitglied der Organisation.",
      );
    }
    if (resolved.kind === "ambiguous") {
      throw new NavigatorToolError(
        "ambiguous_member",
        `Mehrere Treffer: ${resolved.candidates.slice(0, 5).join(", ")}. Bitte genauer sagen, wer gemeint ist.`,
      );
    }

    try {
      const member = await addProjectMemberShared({
        projectId: ref.id,
        userId: resolved.member.userId,
        role: args.role,
        actor: { userId: actor.userId, organizationId },
      });
      return {
        added: true,
        member: {
          name:
            resolved.member.user.name ??
            resolved.member.user.email ??
            member.userId,
          role: member.role,
        },
        project: ref.name,
      };
    } catch (error) {
      rethrowProjectError(error);
    }
  },
);

export const PROJECT_TOOLS = [
  listProjectsTool,
  createProjectTool,
  getProjectStatusTool,
  addProjectMemberTool,
];
