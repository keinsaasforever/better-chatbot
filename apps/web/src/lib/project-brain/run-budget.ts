/**
 * Wall-clock budget for a single project-brain ingest run.
 *
 * The Inngest function declares `timeouts: { finish: "15m" }`. When that fires
 * Inngest *cancels* the invocation, which is not an in-band exception: the
 * pipeline's try/catch never runs, so the run row is orphaned at
 * `status: "running"` forever. `inngest/function.cancelled` cannot rescue it
 * either — that payload carries only `function_id` and `run_id`, with no
 * reference back to the triggering event, so there is no way to map a
 * cancellation onto a `project_brain_run` row.
 *
 * So the pipeline owns its own, shorter budget and fails in-band before the
 * platform timeout can fire. That keeps the catch block as the single place a
 * run reaches a terminal state, and demotes `timeouts.finish` to a backstop
 * that should never actually trigger.
 *
 * The budget is anchored to the run row's `createdAt` rather than `startedAt`
 * because Inngest memoizes step output: on a retry the replayed `load-run`
 * snapshot still carries the values from the first attempt, so `createdAt` is
 * the one timestamp that stays stable across the whole invocation. That also
 * makes the budget cover retries in aggregate, which is what stops a retrying
 * step from quietly eating the entire window.
 */

/** Must stay comfortably below the function's `timeouts.finish` (15m). */
export const PROJECT_BRAIN_RUN_BUDGET_MS = 13 * 60_000;

/**
 * Ceiling for one extraction attempt. `generateObjectResilient` makes up to
 * three sequential model calls, so without a cap it can absorb whatever budget
 * the earlier stages left behind.
 */
export const PROJECT_BRAIN_EXTRACTION_MAX_MS = 4 * 60_000;

export class ProjectBrainBudgetError extends Error {
  readonly code = "budget_exhausted";

  constructor(stage: string, elapsedMs: number) {
    super(
      `Project brain run exceeded its ${Math.round(
        PROJECT_BRAIN_RUN_BUDGET_MS / 60_000,
      )}m budget before ${stage} (elapsed ${Math.round(elapsedMs / 1000)}s).`,
    );
    this.name = "ProjectBrainBudgetError";
  }
}

/** Step output replayed by Inngest arrives as ISO strings, not Date objects. */
function toTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export function remainingRunBudgetMs(
  anchor: string | Date | null | undefined,
  now: number = Date.now(),
  budgetMs: number = PROJECT_BRAIN_RUN_BUDGET_MS,
): number {
  const started = toTime(anchor);
  // No usable anchor: grant the full budget rather than failing a run that may
  // be perfectly healthy.
  if (started === null) return budgetMs;
  return budgetMs - (now - started);
}

/**
 * Remaining budget, or throw if the run has already outlived it. Call this
 * before each expensive stage so an exhausted run fails with a real error
 * instead of being cancelled mid-flight.
 */
export function assertRunBudgetRemaining(
  anchor: string | Date | null | undefined,
  stage: string,
  now: number = Date.now(),
): number {
  const remaining = remainingRunBudgetMs(anchor, now);
  if (remaining <= 0) {
    throw new ProjectBrainBudgetError(
      stage,
      PROJECT_BRAIN_RUN_BUDGET_MS - remaining,
    );
  }
  return remaining;
}

/** Bound one extraction attempt by both its own ceiling and what's left. */
export function extractionTimeoutMs(remainingMs: number): number {
  return Math.max(1, Math.min(remainingMs, PROJECT_BRAIN_EXTRACTION_MAX_MS));
}
