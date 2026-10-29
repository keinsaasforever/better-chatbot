import { type SQL, and, asc, eq, exists, isNull, or, sql } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import {
  type CockpitConnectionEntity,
  CockpitConnectionTable,
  MemberTable,
  OrganizationTable,
} from "../schema.pg";

/**
 * Cockpit connections for one scope.
 *
 * A scope is the active organization, or the user alone when no organization
 * is active. Organization rows only match while the user is still a member of
 * that organization, so a stale `activeOrganizationId` on a session fails
 * closed. A null organization never widens to other users' rows.
 */
export function cockpitScopeWhere(
  userId: string,
  organizationId: string | null,
): SQL {
  if (!organizationId) {
    return and(
      isNull(CockpitConnectionTable.organizationId),
      eq(CockpitConnectionTable.userId, userId),
    ) as SQL;
  }
  return and(
    eq(CockpitConnectionTable.organizationId, organizationId),
    exists(
      db
        .select({ one: sql`1` })
        .from(MemberTable)
        .where(
          and(
            eq(MemberTable.organizationId, organizationId),
            eq(MemberTable.userId, userId),
          ),
        ),
    ),
  ) as SQL;
}

export type CockpitConnectionUpsert = {
  userId: string;
  organizationId: string | null;
  provider: string;
  label?: string | null;
  configEncrypted: string;
  enabled?: boolean;
};

/** How many connections a user can see in one workspace. */
export type CockpitScopeCount = {
  organizationId: string | null;
  organizationName: string | null;
  count: number;
};

export const pgCockpitConnectionRepository = {
  /**
   * Connection counts per workspace the user can still access: organizations
   * they are a member of, plus their own personal (organization-less) rows.
   * Used to point at connections saved under another workspace; returns
   * names and counts only, never configs.
   */
  async countScopesForUser(userId: string): Promise<CockpitScopeCount[]> {
    return db
      .select({
        organizationId: CockpitConnectionTable.organizationId,
        organizationName: OrganizationTable.name,
        count: sql<number>`count(*)::int`,
      })
      .from(CockpitConnectionTable)
      .leftJoin(
        OrganizationTable,
        eq(OrganizationTable.id, CockpitConnectionTable.organizationId),
      )
      .where(
        or(
          and(
            isNull(CockpitConnectionTable.organizationId),
            eq(CockpitConnectionTable.userId, userId),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(MemberTable)
              .where(
                and(
                  eq(
                    MemberTable.organizationId,
                    CockpitConnectionTable.organizationId,
                  ),
                  eq(MemberTable.userId, userId),
                ),
              ),
          ),
        ),
      )
      .groupBy(CockpitConnectionTable.organizationId, OrganizationTable.name);
  },

  async listForScope(
    userId: string,
    organizationId: string | null,
  ): Promise<CockpitConnectionEntity[]> {
    return db
      .select()
      .from(CockpitConnectionTable)
      .where(cockpitScopeWhere(userId, organizationId))
      .orderBy(asc(CockpitConnectionTable.provider));
  },

  async findForScope(
    userId: string,
    organizationId: string | null,
    provider: string,
  ): Promise<CockpitConnectionEntity | null> {
    const [row] = await db
      .select()
      .from(CockpitConnectionTable)
      .where(
        and(
          cockpitScopeWhere(userId, organizationId),
          eq(CockpitConnectionTable.provider, provider),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async findByIdForScope(
    id: string,
    userId: string,
    organizationId: string | null,
  ): Promise<CockpitConnectionEntity | null> {
    const [row] = await db
      .select()
      .from(CockpitConnectionTable)
      .where(
        and(
          cockpitScopeWhere(userId, organizationId),
          eq(CockpitConnectionTable.id, id),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  /**
   * Creates or replaces the scope's connection for `input.provider`. The
   * original creator stays the owner (and alert recipient) on updates.
   */
  async upsert(
    input: CockpitConnectionUpsert,
  ): Promise<CockpitConnectionEntity> {
    const existing = await this.findForScope(
      input.userId,
      input.organizationId,
      input.provider,
    );
    if (existing) {
      const [row] = await db
        .update(CockpitConnectionTable)
        .set({
          label: input.label ?? existing.label,
          configEncrypted: input.configEncrypted,
          enabled: input.enabled ?? existing.enabled,
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(CockpitConnectionTable.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(CockpitConnectionTable)
      .values({
        userId: input.userId,
        organizationId: input.organizationId,
        provider: input.provider,
        label: input.label ?? null,
        configEncrypted: input.configEncrypted,
        enabled: input.enabled ?? true,
      })
      .returning();
    return row;
  },

  /** Deletes one connection inside the scope; false when nothing matched. */
  async remove(
    id: string,
    userId: string,
    organizationId: string | null,
  ): Promise<boolean> {
    const rows = await db
      .delete(CockpitConnectionTable)
      .where(
        and(
          cockpitScopeWhere(userId, organizationId),
          eq(CockpitConnectionTable.id, id),
        ),
      )
      .returning({ id: CockpitConnectionTable.id });
    return rows.length > 0;
  },

  /** Records the latest refresh or probe outcome (error is a reason code). */
  async markResult(id: string, ok: boolean, error?: string | null) {
    await db
      .update(CockpitConnectionTable)
      .set(
        ok
          ? { lastOkAt: new Date(), lastError: null }
          : { lastError: (error ?? "unreachable").slice(0, 200) },
      )
      .where(eq(CockpitConnectionTable.id, id));
  },
};
