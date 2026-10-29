import { pgDb as db } from "../db.pg";
import { McpServerTable, McpToolCustomizationTable } from "../schema.pg";
import { and, eq } from "drizzle-orm";
import type { McpToolCustomizationRepository } from "@/types/mcp";

export const pgMcpMcpToolCustomizationRepository: McpToolCustomizationRepository =
  {
    async select(key) {
      const [result] = await db
        .select()
        .from(McpToolCustomizationTable)
        .where(
          and(
            eq(McpToolCustomizationTable.userId, key.userId),
            eq(McpToolCustomizationTable.mcpServerId, key.mcpServerId),
            eq(McpToolCustomizationTable.toolName, key.toolName),
          ),
        );
      return result;
    },
    async selectByUserIdAndMcpServerId(key) {
      const rows = await db
        .select()
        .from(McpToolCustomizationTable)
        .where(
          and(
            eq(McpToolCustomizationTable.userId, key.userId),
            eq(McpToolCustomizationTable.mcpServerId, key.mcpServerId),
          ),
        );
      return rows;
    },

    async selectByUserId(userId) {
      return db
        .select({
          id: McpToolCustomizationTable.id,
          userId: McpToolCustomizationTable.userId,
          toolName: McpToolCustomizationTable.toolName,
          mcpServerId: McpToolCustomizationTable.mcpServerId,
          prompt: McpToolCustomizationTable.prompt,
          serverName: McpServerTable.name,
        })
        .from(McpToolCustomizationTable)
        .innerJoin(
          McpServerTable,
          eq(McpToolCustomizationTable.mcpServerId, McpServerTable.id),
        )
        .where(and(eq(McpToolCustomizationTable.userId, userId)));
    },

    async upsertToolCustomization(data) {
      const now = new Date();
      const [result] = await db
        .insert(McpToolCustomizationTable)
        .values({
          userId: data.userId,
          toolName: data.toolName,
          mcpServerId: data.mcpServerId,
          prompt: data.prompt,
        })
        .onConflictDoUpdate({
          target: [
            McpToolCustomizationTable.userId,
            McpToolCustomizationTable.toolName,
            McpToolCustomizationTable.mcpServerId,
          ],
          set: {
            prompt: data.prompt ?? null,
            updatedAt: now,
          },
        })
        .returning();
      return result as any;
    },

    async deleteToolCustomization(key) {
      await db
        .delete(McpToolCustomizationTable)
        .where(
          and(
            eq(McpToolCustomizationTable.mcpServerId, key.mcpServerId),
            eq(McpToolCustomizationTable.toolName, key.toolName),
            eq(McpToolCustomizationTable.userId, key.userId),
          ),
        );
    },
  };
