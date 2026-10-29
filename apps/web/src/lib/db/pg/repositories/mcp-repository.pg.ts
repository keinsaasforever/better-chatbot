import { pgDb as db } from "../db.pg";
import { McpServerTable, UserTable } from "../schema.pg";
import { and, eq, or, desc } from "drizzle-orm";
import { generateUUID } from "lib/utils";
import type { MCPRepository } from "app-types/mcp";

export const pgMcpRepository: MCPRepository = {
  async save(server) {
    const [result] = await db
      .insert(McpServerTable)
      .values({
        id: server.id ?? generateUUID(),
        name: server.name,
        config: server.config,
        userId: server.userId,
        organizationId: server.organizationId ?? null,
        visibility: server.visibility ?? "private",
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [McpServerTable.id],
        set: {
          config: server.config,
          visibility: server.visibility ?? "private",
          updatedAt: new Date(),
        },
      })
      .returning();

    return result;
  },

  async insert(server) {
    const [result] = await db
      .insert(McpServerTable)
      .values({
        id: server.id ?? generateUUID(),
        name: server.name,
        config: server.config,
        enabled: true,
        userId: server.userId,
        organizationId: server.organizationId ?? null,
        visibility: server.visibility ?? "private",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return result;
  },

  async selectById(id) {
    const [result] = await db
      .select()
      .from(McpServerTable)
      .where(eq(McpServerTable.id, id));
    return result;
  },

  async selectAll() {
    const results = await db.select().from(McpServerTable);
    return results;
  },

  async selectAllForUser(userId, activeOrganizationId) {
    // Own servers plus shared ("public") servers in the caller's active org.
    // Without an active org the shared branch is dropped entirely, so a
    // null/undefined org yields owner-only results (fails closed).
    const shared = activeOrganizationId
      ? and(
          eq(McpServerTable.visibility, "public"),
          eq(McpServerTable.organizationId, activeOrganizationId),
        )
      : undefined;
    const results = await db
      .select({
        id: McpServerTable.id,
        name: McpServerTable.name,
        config: McpServerTable.config,
        enabled: McpServerTable.enabled,
        userId: McpServerTable.userId,
        organizationId: McpServerTable.organizationId,
        visibility: McpServerTable.visibility,
        createdAt: McpServerTable.createdAt,
        updatedAt: McpServerTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(McpServerTable)
      .leftJoin(UserTable, eq(McpServerTable.userId, UserTable.id))
      .where(
        shared
          ? or(eq(McpServerTable.userId, userId), shared)
          : eq(McpServerTable.userId, userId),
      )
      .orderBy(desc(McpServerTable.createdAt));
    return results;
  },

  async updateVisibility(id, visibility) {
    await db
      .update(McpServerTable)
      .set({ visibility, updatedAt: new Date() })
      .where(eq(McpServerTable.id, id));
  },

  async deleteById(id) {
    await db.delete(McpServerTable).where(eq(McpServerTable.id, id));
  },

  async selectByServerName(name) {
    const [result] = await db
      .select()
      .from(McpServerTable)
      .where(eq(McpServerTable.name, name));
    return result;
  },
  async existsByServerName(name) {
    const [result] = await db
      .select({ id: McpServerTable.id })
      .from(McpServerTable)
      .where(eq(McpServerTable.name, name));

    return !!result;
  },

  async checkAccess(
    id: string,
    userId: string,
    destructive = false,
    activeOrganizationId?: string | null,
  ) {
    const [server] = await db
      .select({
        userId: McpServerTable.userId,
        organizationId: McpServerTable.organizationId,
        visibility: McpServerTable.visibility,
      })
      .from(McpServerTable)
      .where(eq(McpServerTable.id, id));

    if (!server) {
      return false;
    }

    // Owner always has access.
    if (server.userId === userId) {
      return true;
    }

    // Non-owners can only have non-destructive access to public servers, and
    // only within the caller's active org. A null active org or a null/foreign
    // server org fails closed.
    if (destructive) {
      return false;
    }

    return (
      server.visibility === "public" &&
      !!activeOrganizationId &&
      server.organizationId === activeOrganizationId
    );
  },
};
