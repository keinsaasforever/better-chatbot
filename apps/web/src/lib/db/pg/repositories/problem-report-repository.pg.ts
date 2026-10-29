import type {
  ProblemReportContext,
  ProblemReportScreenshot,
} from "app-types/problem-report";
import { and, desc, eq } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import { ProblemReportTable, type ProblemReportEntity } from "../schema.pg";

export type CreateProblemReportInput = {
  userId: string;
  organizationId?: string | null;
  description: string;
  screenshots: ProblemReportScreenshot[];
  context?: ProblemReportContext | null;
  traceId?: string | null;
};

export interface ProblemReportRepository {
  create(input: CreateProblemReportInput): Promise<ProblemReportEntity>;
  /** Owner-scoped read: a report is only ever visible to the user who filed it. */
  selectByIdForUser(
    id: string,
    userId: string,
  ): Promise<ProblemReportEntity | null>;
  selectAllForUser(
    userId: string,
    limit?: number,
  ): Promise<ProblemReportEntity[]>;
}

export const pgProblemReportRepository: ProblemReportRepository = {
  async create(input) {
    const [row] = await db
      .insert(ProblemReportTable)
      .values({
        userId: input.userId,
        organizationId: input.organizationId ?? null,
        description: input.description,
        screenshots: input.screenshots,
        context: input.context ?? null,
        traceId: input.traceId ?? null,
      })
      .returning();
    return row;
  },

  async selectByIdForUser(id, userId) {
    const [row] = await db
      .select()
      .from(ProblemReportTable)
      .where(
        and(
          eq(ProblemReportTable.id, id),
          eq(ProblemReportTable.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  },

  async selectAllForUser(userId, limit = 50) {
    return db
      .select()
      .from(ProblemReportTable)
      .where(eq(ProblemReportTable.userId, userId))
      .orderBy(desc(ProblemReportTable.createdAt))
      .limit(limit);
  },
};
