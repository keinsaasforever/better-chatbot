import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ScheduledTaskTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { computeDueSlot } from "@/lib/scheduled-tasks/due-detection";
import { computeNextRunAt } from "@/lib/scheduled-tasks/schedule-validation";

/**
 * GET /api/scheduled-tasks/diagnostics
 * Config + due-state snapshot to diagnose "scheduled agent never fires". Env
 * values are reported as booleans only — never the secret values. Helps tell a
 * missing-config problem (env booleans false / Inngest keys absent) from a
 * due-detection issue (dueNow/nextRunAt per task).
 */
export const GET = withAuth(async (_request, session) => {
  try {
    const now = new Date();

    const tasks = await pgDb
      .select({
        id: ScheduledTaskTable.id,
        name: ScheduledTaskTable.name,
        enabled: ScheduledTaskTable.enabled,
        cronExpression: ScheduledTaskTable.cronExpression,
        timezone: ScheduledTaskTable.timezone,
        lastRunAt: ScheduledTaskTable.lastRunAt,
        lastRunStatus: ScheduledTaskTable.lastRunStatus,
        lastSlotAt: ScheduledTaskTable.lastSlotAt,
        persistedNextRunAt: ScheduledTaskTable.nextRunAt,
        createdAt: ScheduledTaskTable.createdAt,
      })
      .from(ScheduledTaskTable)
      .where(eq(ScheduledTaskTable.userId, session.user.id));

    return NextResponse.json({
      now: now.toISOString(),
      // Presence only — never echo secret values.
      env: {
        inngestSigningKey: Boolean(process.env.INNGEST_SIGNING_KEY),
        inngestEventKey: Boolean(process.env.INNGEST_EVENT_KEY),
        scheduledTaskSecret: Boolean(process.env.SCHEDULED_TASK_SECRET),
        baseUrl: Boolean(process.env.NEXT_PUBLIC_BASE_URL),
      },
      tasks: tasks.map((task) => ({
        ...task,
        nextRunAt: task.enabled
          ? computeNextRunAt(task.cronExpression, task.timezone, now)
          : null,
        // Whether the cron checker would consider this task due right now. Must
        // mirror the checker's inputs exactly (lastSlotAt as the floor, the
        // real createdAt) or diagnostics reports a different answer than what
        // actually fires.
        dueNow: task.enabled
          ? computeDueSlot(
              {
                cronExpression: task.cronExpression,
                timezone: task.timezone,
                lastSlotAt: task.lastSlotAt,
                createdAt: task.createdAt,
              },
              now,
            ) !== null
          : false,
      })),
    });
  } catch (error) {
    console.error("Error building scheduled-task diagnostics:", error);
    return NextResponse.json(
      { error: "Failed to build diagnostics" },
      { status: 500 },
    );
  }
});
