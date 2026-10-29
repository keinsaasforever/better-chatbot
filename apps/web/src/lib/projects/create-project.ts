import "server-only";

import { z } from "zod";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectMemberTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { AGENTSET_EMBEDDING_PROFILE_IDS } from "@/types/project";
import type { ProjectActor } from "./access";

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  goal: z.string().trim().max(4000).optional(),
  // Agentset retrieval profile chosen in the creation dialog; locked after
  // creation because changing it requires re-indexing the namespace.
  embeddingProfile: z.enum(AGENTSET_EMBEDDING_PROFILE_IDS).optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

/**
 * Create a project in the actor's organization with the actor as its owner.
 *
 * Shared by `POST /api/projects` and the `create_project` Navigator tool. The
 * caller is responsible for having verified the actor's org membership (the
 * route via `requireActiveOrganization`, the tool explicitly).
 */
export async function createProject(
  actor: ProjectActor,
  input: CreateProjectInput,
) {
  return pgDb.transaction(async (tx) => {
    const [created] = await tx
      .insert(ProjectTable)
      .values({
        organizationId: actor.organizationId,
        ownerUserId: actor.userId,
        name: input.name,
        description: input.description,
        goal: input.goal,
        ...(input.embeddingProfile
          ? { agentsetEmbeddingProfile: input.embeddingProfile }
          : {}),
      })
      .returning();

    if (!created) throw new Error("Could not create project.");

    await tx
      .insert(ProjectMemberTable)
      .values({
        projectId: created.id,
        userId: actor.userId,
        role: "owner",
      })
      .onConflictDoNothing();

    return created;
  });
}
