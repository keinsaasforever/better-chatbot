import "server-only";
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ScheduledTaskTable } from "@/lib/db/pg/schema.pg";
import { computeDueSlot } from "./due-detection";
import { computeNextRunAt } from "./schedule-validation";

/**
 * A scheduled task the checker has found due for a specific cron occurrence.
 * `slot` is the occurrence time; it is the unit both transports (the Inngest
 * cron checker and the /api/scheduled-tasks/cron fallback) deduplicate on.
 */
export type DueScheduledTask = {
  taskId: string;
  userId: string;
  slot: Date;
};

/**
 * Finds every enabled task whose cron has an occurrence due at or before `now`
 * (within the catch-up window). Filters on the persisted `next_run_at` — using
 * the `scheduled_task_due_idx` index — so the checker no longer full-scans
 * every enabled row each minute. `next_run_at IS NULL` is included so
 * pre-existing rows that predate the column (and rows just created) are still
 * picked up until their first run persists a value.
 *
 * Shared by the Inngest checker and the secret-gated fallback route so the two
 * transports can never disagree about what is due.
 */
export async function findDueScheduledTasks(
  now: Date,
): Promise<DueScheduledTask[]> {
  const rows = await pgDb
    .select({
      id: ScheduledTaskTable.id,
      userId: ScheduledTaskTable.userId,
      cronExpression: ScheduledTaskTable.cronExpression,
      timezone: ScheduledTaskTable.timezone,
      lastSlotAt: ScheduledTaskTable.lastSlotAt,
      createdAt: ScheduledTaskTable.createdAt,
    })
    .from(ScheduledTaskTable)
    .where(
      and(
        eq(ScheduledTaskTable.enabled, true),
        or(
          isNull(ScheduledTaskTable.nextRunAt),
          lte(ScheduledTaskTable.nextRunAt, now),
        ),
      ),
    );

  return rows.flatMap((row) => {
    const slot = computeDueSlot(
      {
        cronExpression: row.cronExpression,
        timezone: row.timezone,
        lastSlotAt: row.lastSlotAt,
        createdAt: row.createdAt,
      },
      now,
    );
    if (!slot) return [];
    return [{ taskId: row.id, userId: row.userId, slot }];
  });
}

/**
 * Atomically claims a due slot for execution. Returns true only for the caller
 * that wins the race; every later caller for the same-or-earlier slot returns
 * false and must not run. This is the idempotency guard that lets the Inngest
 * executor and the fallback route fire concurrently without double-running:
 * the conditional predicate on `last_slot_at` is the single source of truth.
 *
 * Winning the claim also advances `next_run_at` to the next future occurrence
 * so `findDueScheduledTasks` will not re-select this task until then.
 */
export async function claimScheduledSlot(
  taskId: string,
  slot: Date,
  now: Date = new Date(),
): Promise<boolean> {
  const [task] = await pgDb
    .select({
      cronExpression: ScheduledTaskTable.cronExpression,
      timezone: ScheduledTaskTable.timezone,
    })
    .from(ScheduledTaskTable)
    .where(eq(ScheduledTaskTable.id, taskId))
    .limit(1);

  const nextRunAt = task
    ? computeNextRunAt(task.cronExpression, task.timezone, now)
    : null;

  const claimed = await pgDb
    .update(ScheduledTaskTable)
    .set({ lastSlotAt: slot, nextRunAt })
    .where(
      and(
        eq(ScheduledTaskTable.id, taskId),
        or(
          isNull(ScheduledTaskTable.lastSlotAt),
          lt(ScheduledTaskTable.lastSlotAt, slot),
        ),
      ),
    )
    .returning({ id: ScheduledTaskTable.id });

  return claimed.length > 0;
}
