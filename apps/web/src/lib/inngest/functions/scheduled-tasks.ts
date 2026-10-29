import { inngest } from "../client";
import { INNGEST_PLAN_CONCURRENCY_LIMIT } from "../limits";
import logger from "logger";
import { scheduledRunEventId } from "@/lib/scheduled-tasks/due-detection";
import {
  claimScheduledSlot,
  findDueScheduledTasks,
} from "@/lib/scheduled-tasks/checker";
import {
  executeAgentRun,
  loadScheduledTaskContext,
  recordScheduledRunResult,
  type ScheduledRunResult,
} from "@/lib/scheduled-tasks/runner";

// Main execution function
export const executeScheduledTask = inngest.createFunction(
  {
    id: "execute-scheduled-task",
    retries: 3,
    // Throttle queues bursts instead of dropping them (the previous rateLimit
    // silently discarded events over the cap, losing runs entirely).
    throttle: { limit: 30, period: "1m" },
    concurrency: [
      // Global cap on simultaneous loopback chat streams against the web tier.
      // Pinned to the plan ceiling: a higher number fails the whole app sync,
      // which silently strands every function on its last-synced version.
      { limit: INNGEST_PLAN_CONCURRENCY_LIMIT },
      // Per-user fairness: one user's task pile-up cannot starve everyone.
      { limit: 2, key: "event.data.userId" },
    ],
  },
  { event: "scheduled-task/trigger" },
  async ({ event, step }) => {
    const { taskId, slot } = event.data;

    // 1. Load + verify (shared with the synchronous run-now path).
    const ctx = await step.run("load-task", () =>
      loadScheduledTaskContext(taskId),
    );
    if (!ctx.ok) {
      return { skipped: true, reason: ctx.reason };
    }
    if (!ctx.task.enabled) {
      return { skipped: true, reason: "Task disabled" };
    }
    const { task, agent } = ctx;

    // 1b. Claim the slot before running. A manual trigger carries no slot and
    // always runs; a scheduled fire claims its occurrence so a concurrent
    // fallback-route run for the same slot cannot double-execute. step.run
    // memoizes, so a retry re-uses the claim result rather than re-claiming.
    if (slot) {
      const won = await step.run("claim-slot", () =>
        claimScheduledSlot(taskId, new Date(slot)),
      );
      if (!won) {
        return { skipped: true, reason: "Slot already claimed" };
      }
    }

    // 2. Execute agent. Transient failures throw inside the step so Inngest
    // retries them (with backoff, up to `retries`); once retries are exhausted
    // the catch below still records the failure and notifies the user.
    let result: ScheduledRunResult;
    try {
      result = await step.run("execute-task", () =>
        executeAgentRun(task, agent),
      );
    } catch {
      result = {
        success: false,
        error: "Chat request failed after retries",
        threadId: null,
      };
    }

    // 3. Record stats + notify (atomic counters, notification row, web push).
    await step.run("record-result", () =>
      recordScheduledRunResult(taskId, task, agent, result),
    );

    return result;
  },
);

// Cron checker - runs every minute
export const scheduledTaskCronChecker = inngest.createFunction(
  { id: "scheduled-task-cron-checker" },
  { cron: "* * * * *" },
  async ({ step }) => {
    const events = await step.run("find-due-tasks", async () => {
      const now = new Date();
      const dueTasks = await findDueScheduledTasks(now);

      const due = dueTasks.map((task) => ({
        // Deterministic id: Inngest dedupes ids for 24h, so the same due slot
        // re-detected on later ticks (before the claim advances next_run_at)
        // can never start a second run.
        id: scheduledRunEventId(task.taskId, task.slot),
        name: "scheduled-task/trigger" as const,
        data: {
          taskId: task.taskId,
          userId: task.userId,
          slot: task.slot.toISOString(),
        },
      }));

      // One info line per tick so the cron's activity is visible in the
      // Inngest run output (confirms the checker is actually running).
      logger.info("[scheduled-tasks] checker tick", {
        dueCount: due.length,
      });

      return due;
    });

    if (events.length > 0) {
      // step.sendEvent is memoized on retry, so a checker retry cannot
      // re-send (and the event ids would dedupe even if it did).
      await step.sendEvent("fan-out", events);
    }

    return { triggered: events.length };
  },
);
