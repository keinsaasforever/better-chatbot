import { Agent, AgentRepository, AgentSummary } from "app-types/agent";
import { pgDb as db } from "../db.pg";
import { AgentTable, BookmarkTable, UserTable } from "../schema.pg";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import type { PresetAgent } from "lib/ai/agent/presets";

export const pgAgentRepository: AgentRepository = {
  async insertAgent(agent) {
    const [result] = await db
      .insert(AgentTable)
      .values({
        id: generateUUID(),
        name: agent.name,
        description: agent.description,
        icon: agent.icon,
        userId: agent.userId,
        organizationId: agent.organizationId ?? null,
        instructions: agent.instructions,
        visibility: agent.visibility || "private",
        presetId: (agent as any).presetId ?? null,
        model: agent.model ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
      presetId: result.presetId ?? null,
    };
  },

  async selectAgentById(
    id,
    userId,
    activeOrganizationId,
  ): Promise<Agent | null> {
    // Shared (public/readonly) agents are visible only within the caller's
    // active org. Without an active org the shared branch is dropped, so the
    // lookup is owner-only (fails closed).
    const shared = activeOrganizationId
      ? and(
          or(
            eq(AgentTable.visibility, "public"),
            eq(AgentTable.visibility, "readonly"),
          ),
          eq(AgentTable.organizationId, activeOrganizationId),
        )
      : undefined;
    const [result] = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        instructions: AgentTable.instructions,
        visibility: AgentTable.visibility,
        presetId: AgentTable.presetId,
        model: AgentTable.model,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
        isBookmarked: sql<boolean>`${BookmarkTable.id} IS NOT NULL`,
      })
      .from(AgentTable)
      .leftJoin(
        BookmarkTable,
        and(
          eq(BookmarkTable.itemId, AgentTable.id),
          eq(BookmarkTable.userId, userId),
          eq(BookmarkTable.itemType, "agent"),
        ),
      )
      .where(
        and(
          eq(AgentTable.id, id),
          shared
            ? or(eq(AgentTable.userId, userId), shared)
            : eq(AgentTable.userId, userId),
        ),
      );

    if (!result) return null;

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
      presetId: result.presetId ?? null,
      isBookmarked: result.isBookmarked ?? false,
    };
  },

  async selectAgentsByUserId(userId) {
    const results = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        instructions: AgentTable.instructions,
        visibility: AgentTable.visibility,
        presetId: AgentTable.presetId,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        isBookmarked: sql<boolean>`false`,
      })
      .from(AgentTable)
      .innerJoin(UserTable, eq(AgentTable.userId, UserTable.id))
      .where(eq(AgentTable.userId, userId))
      .orderBy(desc(AgentTable.createdAt));

    // Map database nulls to undefined and set defaults for owned agents
    return results.map((result) => ({
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
      presetId: result.presetId ?? null,
      userName: result.userName ?? undefined,
      userAvatar: result.userAvatar ?? undefined,
      isBookmarked: false, // Always false for owned agents
    }));
  },

  async updateAgent(id, userId, agent, activeOrganizationId) {
    const [result] = await db
      .update(AgentTable)
      .set({
        ...agent,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(AgentTable.id, id),
          or(
            // Owner can always edit.
            eq(AgentTable.userId, userId),
            // A non-owner may edit only a `public` agent, and only within their
            // active org. Without an active org this branch is inert (the sql
            // `false` sentinel), so it fails closed to owner-only — a null org
            // must never widen to every org's public agents.
            activeOrganizationId
              ? and(
                  eq(AgentTable.visibility, "public"),
                  eq(AgentTable.organizationId, activeOrganizationId),
                )
              : sql`false`,
          ),
        ),
      )
      .returning();

    // No row matched => not found or not authorized. Guard the spread, which
    // would otherwise throw on `undefined`.
    if (!result) {
      throw new Error("Agent not found or not authorized to update");
    }

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      instructions: result.instructions ?? {},
    };
  },

  async deleteAgent(id, userId) {
    await db
      .delete(AgentTable)
      .where(and(eq(AgentTable.id, id), eq(AgentTable.userId, userId)));
  },

  async selectAgents(
    currentUserId,
    filters = ["all"],
    limit = 50,
    activeOrganizationId,
  ): Promise<AgentSummary[]> {
    let orConditions: any[] = [];

    // Shared (public/readonly) agents belonging to someone else are visible
    // only within the caller's active org. Without an active org there is no
    // shared branch, so the shared/bookmarked filters match nothing (a false
    // sentinel keeps orConditions non-empty — an empty WHERE would return every
    // row) and "all" collapses to owner-only.
    const sharedOrg = activeOrganizationId
      ? and(
          ne(AgentTable.userId, currentUserId),
          or(
            eq(AgentTable.visibility, "public"),
            eq(AgentTable.visibility, "readonly"),
          ),
          eq(AgentTable.organizationId, activeOrganizationId),
        )
      : undefined;

    // Build OR conditions based on filters array
    for (const filter of filters) {
      if (filter === "mine") {
        orConditions.push(eq(AgentTable.userId, currentUserId));
      } else if (filter === "shared") {
        orConditions.push(sharedOrg ?? sql`false`);
      } else if (filter === "bookmarked") {
        orConditions.push(
          sharedOrg
            ? and(sharedOrg, sql`${BookmarkTable.id} IS NOT NULL`)
            : sql`false`,
        );
      } else if (filter === "all") {
        // All available agents (mine + shared) - this overrides other filters
        orConditions = [
          sharedOrg
            ? or(eq(AgentTable.userId, currentUserId), sharedOrg)
            : eq(AgentTable.userId, currentUserId),
        ];
        break; // "all" overrides everything else
      }
    }

    const results = await db
      .select({
        id: AgentTable.id,
        name: AgentTable.name,
        description: AgentTable.description,
        icon: AgentTable.icon,
        userId: AgentTable.userId,
        // Exclude instructions from list queries for performance
        visibility: AgentTable.visibility,
        presetId: AgentTable.presetId,
        createdAt: AgentTable.createdAt,
        updatedAt: AgentTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
        isBookmarked: sql<boolean>`CASE WHEN ${BookmarkTable.id} IS NOT NULL THEN true ELSE false END`,
      })
      .from(AgentTable)
      .innerJoin(UserTable, eq(AgentTable.userId, UserTable.id))
      .leftJoin(
        BookmarkTable,
        and(
          eq(BookmarkTable.itemId, AgentTable.id),
          eq(BookmarkTable.itemType, "agent"),
          eq(BookmarkTable.userId, currentUserId),
        ),
      )
      .where(orConditions.length > 1 ? or(...orConditions) : orConditions[0])
      .orderBy(
        // My agents first, then other shared agents
        sql`CASE WHEN ${AgentTable.userId} = ${currentUserId} THEN 0 ELSE 1 END`,
        desc(AgentTable.createdAt),
      )
      .limit(limit);

    // Map database nulls to undefined
    return results.map((result) => ({
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      presetId: result.presetId ?? null,
      userName: result.userName ?? undefined,
      userAvatar: result.userAvatar ?? undefined,
    }));
  },

  async checkAccess(
    agentId,
    userId,
    destructive = false,
    activeOrganizationId,
  ) {
    const [agent] = await db
      .select({
        visibility: AgentTable.visibility,
        userId: AgentTable.userId,
        organizationId: AgentTable.organizationId,
      })
      .from(AgentTable)
      .where(eq(AgentTable.id, agentId));
    if (!agent) {
      return false;
    }
    if (userId == agent.userId) return true;
    // Shared access only within the caller's active org. A null active org or a
    // null/foreign agent org fails closed.
    if (
      agent.visibility === "public" &&
      !destructive &&
      !!activeOrganizationId &&
      agent.organizationId === activeOrganizationId
    )
      return true;
    return false;
  },
};

/**
 * Seeds preset agents for a user, skipping any presets that already exist.
 * Called from the auth hook on user creation and from the library API.
 */
export async function seedPresetsForUser(
  userId: string,
  presets: PresetAgent[],
): Promise<void> {
  if (presets.length === 0) return;

  const presetIds = presets.map((p) => p.presetId);

  // Find which presetIds the user already has
  const existing = await db
    .select({ presetId: AgentTable.presetId })
    .from(AgentTable)
    .where(
      and(
        eq(AgentTable.userId, userId),
        inArray(AgentTable.presetId, presetIds),
      ),
    );

  const existingIds = new Set(existing.map((r) => r.presetId));
  const toInsert = presets.filter((p) => !existingIds.has(p.presetId));

  if (toInsert.length === 0) return;

  await db.insert(AgentTable).values(
    toInsert.map((preset) => ({
      id: generateUUID(),
      name: preset.name,
      description: preset.description,
      icon: preset.icon,
      userId,
      instructions: preset.instructions,
      visibility: "private" as const,
      presetId: preset.presetId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
}
