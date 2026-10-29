import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectTable } from "@/lib/db/pg/schema.pg";
import { and, eq } from "drizzle-orm";
import { ConflictError } from "agentset";
import { getAgentsetClient, getAgentsetNamespace } from "./client";
import { isAgentsetCreatedAtSchemaError } from "./ingest-job-fetch";
import {
  getAgentsetEmbeddingProfile,
  type AgentsetEmbeddingProfileId,
} from "./embedding-profiles";
import {
  buildProjectAgentsetSlug,
  buildProjectAgentsetSlugCandidates,
  parseConflictSlugFromError,
} from "./project-slugs";

type NamespaceSchema = Awaited<
  ReturnType<ReturnType<typeof getAgentsetClient>["namespaces"]["get"]>
>;

const namespaceEnsureLocks = new Map<string, Promise<NamespaceSchema>>();

export class AgentsetNamespaceProvisionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentsetNamespaceProvisionError";
  }
}

function isAgentsetConflictError(error: unknown) {
  if (error instanceof ConflictError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { status?: number }).status === 409 ||
      (error as { code?: string }).code === "conflict")
  );
}

export function formatAgentsetError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Agentset request failed";
}

async function persistProjectAgentsetNamespace(input: {
  projectId: string;
  userId: string;
  namespace: NamespaceSchema;
  embeddingProfile?: AgentsetEmbeddingProfileId;
}) {
  const profile = getAgentsetEmbeddingProfile(input.embeddingProfile);

  await pgDb
    .update(ProjectTable)
    .set({
      agentsetNamespaceId: input.namespace.id,
      agentsetEmbeddingProfile: input.embeddingProfile ?? "agentset-managed",
      agentsetEmbeddingConfig: profile.embeddingConfig ?? null,
    })
    .where(
      and(
        eq(ProjectTable.id, input.projectId),
        eq(ProjectTable.ownerUserId, input.userId),
      ),
    );

  return input.namespace;
}

async function readPersistedNamespaceId(input: {
  projectId: string;
  userId: string;
}) {
  const [project] = await pgDb
    .select({ agentsetNamespaceId: ProjectTable.agentsetNamespaceId })
    .from(ProjectTable)
    .where(
      and(
        eq(ProjectTable.id, input.projectId),
        eq(ProjectTable.ownerUserId, input.userId),
      ),
    )
    .limit(1);

  return project?.agentsetNamespaceId ?? null;
}

async function findNamespaceInList(slugs: string[]) {
  const wanted = new Set(slugs.filter(Boolean));
  if (!wanted.size) return null;

  const agentset = getAgentsetClient();
  let namespaces: Awaited<ReturnType<typeof agentset.namespaces.list>>;
  try {
    namespaces = await agentset.namespaces.list();
  } catch (error) {
    if (isAgentsetCreatedAtSchemaError(error)) {
      console.warn(
        "[agentset] namespaces.list returned schema 422; skipping list recovery",
        { error: formatAgentsetError(error) },
      );
      return null;
    }
    throw error;
  }
  return namespaces.find((namespace) => wanted.has(namespace.slug)) ?? null;
}

/** Same-org recovery only — avoids cross-org slug get() 401s. */
async function resolveExistingProjectNamespaceInOrg(input: {
  projectId: string;
  projectName: string;
  extraSlugs?: string[];
}) {
  const slugs = [
    ...new Set([
      buildProjectAgentsetSlug(input.projectId),
      ...buildProjectAgentsetSlugCandidates(input),
      ...(input.extraSlugs ?? []),
    ]),
  ];

  return findNamespaceInList(slugs);
}

async function createProjectNamespace(input: {
  projectId: string;
  userId: string;
  projectName: string;
  embeddingProfile?: AgentsetEmbeddingProfileId;
}) {
  const agentset = getAgentsetClient();
  const profile = getAgentsetEmbeddingProfile(input.embeddingProfile);
  const slug = buildProjectAgentsetSlug(input.projectId);

  let namespace: NamespaceSchema;
  try {
    namespace = await agentset.namespaces.create({
      name: input.projectName,
      slug,
      ...(profile.embeddingConfig
        ? { embeddingConfig: profile.embeddingConfig }
        : {}),
    });
  } catch (error) {
    if (!isAgentsetConflictError(error)) throw error;

    const conflictSlug = parseConflictSlugFromError(error);
    const recovered = await resolveExistingProjectNamespaceInOrg({
      projectId: input.projectId,
      projectName: input.projectName,
      extraSlugs: conflictSlug ? [conflictSlug] : [],
    });
    if (!recovered) {
      console.error("[agentset] namespace conflict recovery failed", {
        projectId: input.projectId,
        slug,
        conflictSlug,
        error,
      });
      throw error;
    }
    namespace = recovered;
  }

  return persistProjectAgentsetNamespace({
    projectId: input.projectId,
    userId: input.userId,
    namespace,
    embeddingProfile: input.embeddingProfile,
  });
}

async function resolveAccessibleProjectNamespace(input: {
  projectId: string;
  userId: string;
  projectName: string;
  embeddingProfile?: AgentsetEmbeddingProfileId;
}) {
  const persistedId = await readPersistedNamespaceId({
    projectId: input.projectId,
    userId: input.userId,
  });

  if (persistedId) {
    // Trust the persisted id; the SDK namespace() handle is local. Validating
    // via namespaces.get(persistedId) would either succeed silently or surface
    // unrelated 422/createdAt schema drifts from Agentset's API and break
    // upload/search. Real "namespace gone" cases get detected by the next
    // operation (ingest/search) returning 404.
    return { id: persistedId } as NamespaceSchema;
  }

  const primarySlug = buildProjectAgentsetSlug(input.projectId);
  const existingInOrg = await resolveExistingProjectNamespaceInOrg({
    projectId: input.projectId,
    projectName: input.projectName,
  });
  if (existingInOrg) {
    console.info("[agentset] linked existing namespace in org", {
      projectId: input.projectId,
      namespaceId: existingInOrg.id,
      slug: existingInOrg.slug,
    });
    return persistProjectAgentsetNamespace({
      projectId: input.projectId,
      userId: input.userId,
      namespace: existingInOrg,
      embeddingProfile: input.embeddingProfile,
    });
  }

  console.info("[agentset] creating namespace", {
    projectId: input.projectId,
    slug: primarySlug,
  });

  return createProjectNamespace(input);
}

export async function createProjectAgentsetNamespace(input: {
  projectId: string;
  userId: string;
  projectName: string;
  embeddingProfile?: AgentsetEmbeddingProfileId;
}) {
  try {
    return await resolveAccessibleProjectNamespace(input);
  } catch (error) {
    throw new AgentsetNamespaceProvisionError(
      formatAgentsetError(error),
      error,
    );
  }
}

export async function ensureProjectAgentsetNamespace(input: {
  projectId: string;
  userId: string;
  projectName?: string;
  embeddingProfile?: AgentsetEmbeddingProfileId;
}) {
  const [project] = await pgDb
    .select({
      id: ProjectTable.id,
      name: ProjectTable.name,
      agentsetNamespaceId: ProjectTable.agentsetNamespaceId,
      agentsetEmbeddingProfile: ProjectTable.agentsetEmbeddingProfile,
    })
    .from(ProjectTable)
    .where(
      and(
        eq(ProjectTable.id, input.projectId),
        eq(ProjectTable.ownerUserId, input.userId),
      ),
    )
    .limit(1);

  if (!project) throw new Error("Project not found");

  const lockKey = `${input.userId}:${project.id}`;
  const inFlight = namespaceEnsureLocks.get(lockKey);
  if (inFlight) {
    const namespace = await inFlight;
    return getAgentsetNamespace(namespace.id);
  }

  const promise = resolveAccessibleProjectNamespace({
    projectId: project.id,
    userId: input.userId,
    projectName: input.projectName ?? project.name,
    // The profile chosen at project creation drives lazy namespace
    // provisioning; explicit input still wins for legacy callers.
    embeddingProfile:
      input.embeddingProfile ??
      (project.agentsetEmbeddingProfile as AgentsetEmbeddingProfileId),
  }).finally(() => {
    namespaceEnsureLocks.delete(lockKey);
  });

  namespaceEnsureLocks.set(lockKey, promise);
  const namespace = await promise;

  return getAgentsetNamespace(namespace.id);
}

export {
  buildLegacyProjectAgentsetSlug,
  buildProjectAgentsetSlug,
} from "./project-slugs";
