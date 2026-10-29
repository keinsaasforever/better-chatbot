import CronParser from "cron-parser";

/**
 * How far back the checker will still fire a missed occurrence. Bounded so a
 * task that was disabled (or a checker outage) for longer than this resumes at
 * its next occurrence instead of replaying history.
 */
export const CATCH_UP_WINDOW_MS = 10 * 60 * 1000;

export type DueCheckTask = {
  cronExpression: string;
  timezone: string;
  // The occurrence a run last claimed. Floored on here (not lastRunAt) so a run
  // that overruns its cron interval does not permanently skip the occurrences
  // it stepped over: the slot is claimed when the run STARTS, not when it ends.
  lastSlotAt: Date | string | null;
  createdAt: Date | string | null;
};

/**
 * Returns the cron occurrence the task is due for (the most recent occurrence
 * at or before `now`), or null when nothing is due.
 *
 * Anchored on `now` (never on lastRunAt), so a task that has never run fires
 * at its first occurrence after creation, and a checker tick that was missed
 * is recovered on the next tick as long as the occurrence is still inside
 * CATCH_UP_WINDOW_MS. The floor (lastSlotAt, falling back to createdAt)
 * guarantees a slot is never returned twice after it was claimed and that a
 * task never fires for a slot that predates its creation. Re-detection of the
 * same slot across consecutive ticks (while a run is still in flight) is
 * expected and deduplicated by the Inngest event id — see
 * scheduledRunEventId().
 */
export function computeDueSlot(task: DueCheckTask, now: Date): Date | null {
  let slot: Date;
  try {
    slot = CronParser.parse(task.cronExpression, {
      currentDate: now,
      tz: task.timezone,
    })
      .prev()
      .toDate();
  } catch {
    // Invalid cron or timezone: skip this task, never break the checker.
    return null;
  }

  const floorSource = task.lastSlotAt ?? task.createdAt;
  const floor = floorSource
    ? new Date(floorSource).getTime()
    : now.getTime() - CATCH_UP_WINDOW_MS;

  if (slot.getTime() <= floor) return null;
  if (now.getTime() - slot.getTime() > CATCH_UP_WINDOW_MS) return null;
  return slot;
}

/**
 * Deterministic Inngest event id for a (task, slot) pair. Inngest deduplicates
 * event ids for 24h at ingest, so re-sending the same due slot on consecutive
 * checker ticks can never start a second run.
 */
export function scheduledRunEventId(taskId: string, slot: Date): string {
  return `scheduled-task-${taskId}-${slot.getTime()}`;
}
