import { McpOAuthRepository, McpOAuthSession } from "app-types/mcp";
import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { pgDb as db, pgClient } from "../db.pg";
import { McpOAuthSessionTable } from "../schema.pg";

/**
 * Whether the pool can spare a connection for the refresh lock.
 *
 * Serializing a token refresh across instances needs a session-level advisory
 * lock, and that needs a connection reserved out of the pool for the whole
 * refresh. `POSTGRES_POOL_MAX` defaults to 1 (see db.pg.ts - instance count
 * times max has to stay under the Supabase pooler limit), so on the default
 * config that reservation *is* the pool: nothing is left for the re-read that
 * follows the lock, nor for any other MCP server connecting in the same
 * request. Production showed four of them timing out at once with
 * "Failed to connect to <server>: Timed out reserving a connection for the MCP
 * OAuth refresh lock", which fails the connect and empties that server's tools
 * for the turn.
 *
 * A pool that small cannot serialize refreshes, so do not spend a connect
 * failure pretending it can. Unserialized, two instances refreshing at once
 * costs a wasted round trip - `tokens()` re-reads afterwards and `saveTokens`
 * merges through `mergeOAuthTokens`. Raise POSTGRES_POOL_MAX to get the lock
 * back.
 */
const CAN_RESERVE_FOR_REFRESH_LOCK = (() => {
  const max = Number(process.env.POSTGRES_POOL_MAX ?? 1);
  return Number.isFinite(max) && max > 1;
})();

const NO_REFRESH_LOCK = async () => {};

// OAuth repository implementation for multi-instance support
export const pgMcpOAuthRepository: McpOAuthRepository = {
  // 1. Query methods

  // Get session with valid tokens (authenticated)
  getAuthenticatedSession: async (mcpServerId) => {
    const [session] = await db
      .select()
      .from(McpOAuthSessionTable)
      .where(
        and(
          eq(McpOAuthSessionTable.mcpServerId, mcpServerId),
          isNotNull(McpOAuthSessionTable.tokens),
        ),
      )
      .orderBy(desc(McpOAuthSessionTable.updatedAt))
      .limit(1);

    return session as McpOAuthSession | undefined;
  },

  // Get session by OAuth state (for callback handling)
  getSessionByState: async (state) => {
    if (!state) return undefined;

    const [session] = await db
      .select()
      .from(McpOAuthSessionTable)
      .where(eq(McpOAuthSessionTable.state, state));

    return session as McpOAuthSession | undefined;
  },

  // 2. Create/Update methods

  // Create new OAuth session
  createSession: async (mcpServerId, data) => {
    const now = new Date();

    const [session] = await db
      .insert(McpOAuthSessionTable)
      .values({
        ...(data as McpOAuthSession),
        mcpServerId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return session as McpOAuthSession;
  },

  // Update existing session by state
  updateSessionByState: async (state, data) => {
    const now = new Date();

    const [session] = await db
      .update(McpOAuthSessionTable)
      .set({
        ...data,
        updatedAt: now,
      })
      .where(eq(McpOAuthSessionTable.state, state))
      .returning();

    if (!session) {
      throw new Error(`Session with state ${state} not found`);
    }

    return session as McpOAuthSession;
  },

  saveTokensAndCleanup: async (state, mcpServerId, data) => {
    return db.transaction(async (tx) => {
      const [session] = await tx
        .update(McpOAuthSessionTable)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(McpOAuthSessionTable.state, state))
        .returning();

      if (!session) {
        throw new Error(`Session with state ${state} not found`);
      }

      await tx
        .delete(McpOAuthSessionTable)
        .where(
          and(
            eq(McpOAuthSessionTable.mcpServerId, mcpServerId),
            isNull(McpOAuthSessionTable.tokens),
            ne(McpOAuthSessionTable.state, state),
          ),
        );

      return session as McpOAuthSession;
    });
  },

  clearTokens: async (state) => {
    const [session] = await db
      .update(McpOAuthSessionTable)
      .set({ tokens: null, updatedAt: new Date() })
      .where(eq(McpOAuthSessionTable.state, state))
      .returning();

    if (!session) {
      throw new Error(`Session with state ${state} not found`);
    }

    return session as McpOAuthSession;
  },

  acquireRefreshLock: async (lockKey) => {
    if (!CAN_RESERVE_FOR_REFRESH_LOCK) return NO_REFRESH_LOCK;

    const advisoryKey = `mcp-oauth-refresh:${lockKey}`;

    // Bound the pooled-connection reservation. With POSTGRES_POOL_MAX as low as
    // 1, a contended reserve() can otherwise block until the 300s function
    // timeout. If the connection arrives after we've given up, release it so
    // the reservation isn't leaked.
    let reserveTimedOut = false;
    const reservePromise = pgClient.reserve();
    const connection = await Promise.race([
      reservePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reserveTimedOut = true;
          reject(
            new Error(
              "Timed out reserving a connection for the MCP OAuth refresh lock",
            ),
          );
        }, 3_000),
      ),
    ]).catch((error) => {
      void reservePromise
        .then((late) => reserveTimedOut && late.release())
        .catch(() => {});
      throw error;
    });

    // Short poll window so a contended advisory lock fails inside the 8s probe
    // timeout (and throws a classifiable "refresh lock" error) instead of
    // riding to 300s.
    const deadline = Date.now() + 5_000;
    let acquired = false;

    try {
      while (Date.now() < deadline) {
        const [result] = await connection<[{ locked: boolean }]>`
          SELECT pg_try_advisory_lock(hashtextextended(${advisoryKey}, 0)) AS locked
        `;
        if (result.locked) {
          acquired = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } catch (error) {
      connection.release();
      throw error;
    }

    if (!acquired) {
      connection.release();
      throw new Error("Timed out waiting for the MCP OAuth refresh lock");
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await connection`
          SELECT pg_advisory_unlock(hashtextextended(${advisoryKey}, 0))
        `;
      } finally {
        connection.release();
      }
    };
  },

  // Delete a session by its OAuth state
  deleteByState: async (state) => {
    await db
      .delete(McpOAuthSessionTable)
      .where(eq(McpOAuthSessionTable.state, state));
  },
};
