import { and, asc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { pgDb } from "../db.pg";
import { SandboxSessionTable } from "../schema.pg";

export type SandboxSession = typeof SandboxSessionTable.$inferSelect;
export type SandboxSessionState = SandboxSession["state"];

/**
 * Server-side registry of E2B preview sandboxes.
 *
 * Reads and writes driven by a request are scoped to the owning `userId`.
 * Reuse is deliberately **owner-only** and never widened to the organization:
 * a sandbox is a live filesystem someone is actively editing, not a shared
 * document, so handing a colleague the same box would let them overwrite work
 * in progress.
 *
 * The two reaper helpers at the bottom are the exception — they run from a
 * secret-gated cron with no session at all, and are intentionally not scoped.
 */
export const pgSandboxSessionRepository = {
  /**
   * Record a sandbox as running, replacing any earlier row for the same ID.
   *
   * Keyed on `sandboxId` so a reused sandbox updates in place rather than
   * accumulating a row per deploy.
   */
  upsert: async (input: {
    sandboxId: string;
    threadId?: string | null;
    toolCallId?: string | null;
    userId: string;
    organizationId?: string | null;
    template: string;
    port: number;
    url: string;
    installCommandHash?: string | null;
  }): Promise<SandboxSession> => {
    const values = {
      sandboxId: input.sandboxId,
      threadId: input.threadId ?? null,
      toolCallId: input.toolCallId ?? null,
      userId: input.userId,
      organizationId: input.organizationId ?? null,
      template: input.template,
      port: input.port,
      url: input.url,
      installCommandHash: input.installCommandHash ?? null,
      state: "running" as const,
      lastActiveAt: sql`CURRENT_TIMESTAMP`,
    };

    const [row] = await pgDb
      .insert(SandboxSessionTable)
      .values(values)
      .onConflictDoUpdate({
        target: SandboxSessionTable.sandboxId,
        set: {
          threadId: values.threadId,
          toolCallId: values.toolCallId,
          template: values.template,
          port: values.port,
          url: values.url,
          installCommandHash: values.installCommandHash,
          state: values.state,
          lastActiveAt: values.lastActiveAt,
        },
      })
      .returning();

    return row;
  },

  /**
   * The sandbox this thread should reuse for `template`, if any.
   *
   * Excludes `killed` rows — that state is terminal and the ID can never be
   * resurrected — and anything older than `maxAgeMs`, so a thread reopened
   * weeks later starts fresh rather than resuming a stale filesystem.
   */
  findReusable: async (input: {
    threadId: string;
    template: string;
    userId: string;
    maxAgeMs: number;
  }): Promise<SandboxSession | undefined> => {
    const cutoff = new Date(Date.now() - input.maxAgeMs);

    const [row] = await pgDb
      .select()
      .from(SandboxSessionTable)
      .where(
        and(
          eq(SandboxSessionTable.threadId, input.threadId),
          eq(SandboxSessionTable.template, input.template),
          eq(SandboxSessionTable.userId, input.userId),
          ne(SandboxSessionTable.state, "killed"),
          gte(SandboxSessionTable.lastActiveAt, cutoff),
        ),
      )
      .limit(1);

    return row;
  },

  /** Owner of a sandbox, for routes that authorize by ID. */
  findOwner: async (
    sandboxId: string,
  ): Promise<{ userId: string; template: string } | undefined> => {
    const [row] = await pgDb
      .select({
        userId: SandboxSessionTable.userId,
        template: SandboxSessionTable.template,
      })
      .from(SandboxSessionTable)
      .where(eq(SandboxSessionTable.sandboxId, sandboxId))
      .limit(1);

    return row;
  },

  /**
   * Authorize and record liveness in one statement.
   *
   * Returning zero rows means "not yours, or unknown" — the caller 403s. Doing
   * both here keeps the heartbeat to a single indexed write instead of an
   * ownership read plus an update.
   */
  touch: async (sandboxId: string, userId: string): Promise<boolean> => {
    const rows = await pgDb
      .update(SandboxSessionTable)
      .set({ lastActiveAt: sql`CURRENT_TIMESTAMP`, state: "running" })
      .where(
        and(
          eq(SandboxSessionTable.sandboxId, sandboxId),
          eq(SandboxSessionTable.userId, userId),
          ne(SandboxSessionTable.state, "killed"),
        ),
      )
      .returning({ sandboxId: SandboxSessionTable.sandboxId });

    return rows.length > 0;
  },

  markState: async (
    sandboxId: string,
    state: SandboxSessionState,
  ): Promise<void> => {
    await pgDb
      .update(SandboxSessionTable)
      .set({ state })
      .where(eq(SandboxSessionTable.sandboxId, sandboxId));
  },

  /**
   * Other still-running sandboxes for the same thread and template.
   *
   * Nobody is looking at these once a newer preview supersedes them, so they
   * are pure waste until their TTL expires.
   */
  listSuperseded: async (input: {
    threadId: string;
    template: string;
    keepSandboxId: string;
  }): Promise<SandboxSession[]> => {
    return pgDb
      .select()
      .from(SandboxSessionTable)
      .where(
        and(
          eq(SandboxSessionTable.threadId, input.threadId),
          eq(SandboxSessionTable.template, input.template),
          eq(SandboxSessionTable.state, "running"),
          ne(SandboxSessionTable.sandboxId, input.keepSandboxId),
        ),
      );
  },

  /**
   * Reaper: sandboxes still marked running that nobody has touched.
   *
   * Not user-scoped — this runs from the secret-gated cron with no session.
   * Catches the case the browser cannot report: tab crashed, laptop lid
   * closed, network dropped before the pause beacon left.
   */
  listIdleRunning: async (input: {
    idleBefore: Date;
    limit: number;
  }): Promise<SandboxSession[]> => {
    return pgDb
      .select()
      .from(SandboxSessionTable)
      .where(
        and(
          eq(SandboxSessionTable.state, "running"),
          lt(SandboxSessionTable.lastActiveAt, input.idleBefore),
        ),
      )
      .orderBy(asc(SandboxSessionTable.lastActiveAt))
      .limit(input.limit);
  },

  /**
   * Reaper: long-dormant paused sandboxes, for eventual cleanup.
   *
   * Paused sandboxes cost nothing, so this is hygiene rather than savings —
   * keep the threshold generous. Not user-scoped, same reason as above.
   */
  listPausedBefore: async (input: {
    before: Date;
    limit: number;
  }): Promise<SandboxSession[]> => {
    return pgDb
      .select()
      .from(SandboxSessionTable)
      .where(
        and(
          eq(SandboxSessionTable.state, "paused"),
          lt(SandboxSessionTable.lastActiveAt, input.before),
        ),
      )
      .orderBy(asc(SandboxSessionTable.lastActiveAt))
      .limit(input.limit);
  },

  /** Which of these sandbox IDs we already know about. Reaper orphan check. */
  findKnownIds: async (sandboxIds: string[]): Promise<Set<string>> => {
    if (sandboxIds.length === 0) return new Set();

    const rows = await pgDb
      .select({ sandboxId: SandboxSessionTable.sandboxId })
      .from(SandboxSessionTable)
      .where(inArray(SandboxSessionTable.sandboxId, sandboxIds));

    return new Set(rows.map((row) => row.sandboxId));
  },
};
