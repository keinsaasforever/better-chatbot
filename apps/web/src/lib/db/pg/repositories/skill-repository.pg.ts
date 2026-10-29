import { Skill, SkillRepository, SkillSummary } from "app-types/skill";
import { pgDb as db } from "../db.pg";
import { SkillTable, UserTable } from "../schema.pg";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { generateUUID } from "lib/utils";

export const pgSkillRepository: SkillRepository = {
  async insertSkill(skill) {
    const [result] = await db
      .insert(SkillTable)
      .values({
        id: generateUUID(),
        name: skill.name,
        description: skill.description,
        slug: skill.slug,
        source: skill.source,
        content: skill.content,
        icon: skill.icon,
        userId: skill.userId,
        organizationId: skill.organizationId ?? null,
        visibility: skill.visibility || "private",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
    };
  },

  async selectSkillById(
    id,
    userId,
    activeOrganizationId,
  ): Promise<Skill | null> {
    // Shared (public/readonly) skills are visible only within the caller's
    // active org. Without an active org the shared branch is dropped, so the
    // lookup is owner-only (fails closed).
    const shared = activeOrganizationId
      ? and(
          or(
            eq(SkillTable.visibility, "public"),
            eq(SkillTable.visibility, "readonly"),
          ),
          eq(SkillTable.organizationId, activeOrganizationId),
        )
      : undefined;

    const [result] = await db
      .select({
        id: SkillTable.id,
        name: SkillTable.name,
        description: SkillTable.description,
        slug: SkillTable.slug,
        source: SkillTable.source,
        content: SkillTable.content,
        icon: SkillTable.icon,
        userId: SkillTable.userId,
        visibility: SkillTable.visibility,
        createdAt: SkillTable.createdAt,
        updatedAt: SkillTable.updatedAt,
      })
      .from(SkillTable)
      .where(
        and(
          eq(SkillTable.id, id),
          shared
            ? or(eq(SkillTable.userId, userId), shared)
            : eq(SkillTable.userId, userId),
        ),
      );

    if (!result) return null;

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
    };
  },

  async selectSkillsByUserId(userId) {
    const results = await db
      .select({
        id: SkillTable.id,
        name: SkillTable.name,
        description: SkillTable.description,
        slug: SkillTable.slug,
        source: SkillTable.source,
        icon: SkillTable.icon,
        userId: SkillTable.userId,
        visibility: SkillTable.visibility,
        createdAt: SkillTable.createdAt,
        updatedAt: SkillTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(SkillTable)
      .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id))
      .where(eq(SkillTable.userId, userId))
      .orderBy(desc(SkillTable.createdAt));

    return results.map((result) => ({
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      userName: result.userName ?? undefined,
      userAvatar: result.userAvatar ?? undefined,
    }));
  },

  async updateSkill(id, userId, skill) {
    const [result] = await db
      .update(SkillTable)
      .set({
        ...skill,
        updatedAt: new Date(),
      })
      .where(and(eq(SkillTable.id, id), eq(SkillTable.userId, userId)))
      .returning();

    return {
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
    };
  },

  async deleteSkill(id, userId) {
    await db
      .delete(SkillTable)
      .where(and(eq(SkillTable.id, id), eq(SkillTable.userId, userId)));
  },

  async selectSkills(
    currentUserId,
    filters = ["all"],
    limit = 50,
    activeOrganizationId,
  ): Promise<SkillSummary[]> {
    let orConditions: any[] = [];

    // Shared (public/readonly) skills belonging to someone else are visible only
    // within the caller's active org. Without an active org there is no shared
    // branch, so the "shared" filter matches nothing (a false sentinel keeps
    // orConditions non-empty — an empty WHERE would return every row) and "all"
    // collapses to owner-only.
    const sharedOrg = activeOrganizationId
      ? and(
          ne(SkillTable.userId, currentUserId),
          or(
            eq(SkillTable.visibility, "public"),
            eq(SkillTable.visibility, "readonly"),
          ),
          eq(SkillTable.organizationId, activeOrganizationId),
        )
      : undefined;

    for (const filter of filters) {
      if (filter === "mine") {
        orConditions.push(eq(SkillTable.userId, currentUserId));
      } else if (filter === "shared") {
        orConditions.push(sharedOrg ?? sql`false`);
      } else if (filter === "all") {
        orConditions = [
          sharedOrg
            ? or(eq(SkillTable.userId, currentUserId), sharedOrg)
            : eq(SkillTable.userId, currentUserId),
        ];
        break;
      }
    }

    const results = await db
      .select({
        id: SkillTable.id,
        name: SkillTable.name,
        description: SkillTable.description,
        slug: SkillTable.slug,
        source: SkillTable.source,
        icon: SkillTable.icon,
        userId: SkillTable.userId,
        // Exclude content from list queries for payload size.
        visibility: SkillTable.visibility,
        createdAt: SkillTable.createdAt,
        updatedAt: SkillTable.updatedAt,
        userName: UserTable.name,
        userAvatar: UserTable.image,
      })
      .from(SkillTable)
      .innerJoin(UserTable, eq(SkillTable.userId, UserTable.id))
      .where(orConditions.length > 1 ? or(...orConditions) : orConditions[0])
      .orderBy(
        // My skills first, then other shared skills.
        sql`CASE WHEN ${SkillTable.userId} = ${currentUserId} THEN 0 ELSE 1 END`,
        desc(SkillTable.createdAt),
      )
      .limit(limit);

    return results.map((result) => ({
      ...result,
      description: result.description ?? undefined,
      icon: result.icon ?? undefined,
      userName: result.userName ?? undefined,
      userAvatar: result.userAvatar ?? undefined,
    }));
  },

  async checkAccess(
    skillId,
    userId,
    destructive = false,
    activeOrganizationId,
  ) {
    const [skill] = await db
      .select({
        visibility: SkillTable.visibility,
        userId: SkillTable.userId,
        organizationId: SkillTable.organizationId,
      })
      .from(SkillTable)
      .where(eq(SkillTable.id, skillId));
    if (!skill) return false;
    if (userId == skill.userId) return true;
    // Shared access only within the caller's active org. A null active org or a
    // null/foreign skill org fails closed.
    if (
      skill.visibility === "public" &&
      !destructive &&
      !!activeOrganizationId &&
      skill.organizationId === activeOrganizationId
    )
      return true;
    return false;
  },
};
