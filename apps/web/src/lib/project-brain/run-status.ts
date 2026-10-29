/**
 * Liveness rules for `project_brain_run` rows.
 *
 * A run row is inserted as "queued" *before* the Inngest event is dispatched
 * (see enqueue.ts), so any dispatch or delivery failure leaves a row that
 * claims to be queued forever. The project workspace disables "Sync now" while
 * a run is active, so without a cutoff a single undelivered event bricks the
 * button permanently — the user clicks and nothing happens at all. Treat a run
 * that has outlived its stage as stale so the UI re-enables and a retry can
 * dispatch a fresh run.
 */

/** Dispatched but never picked up: normally sub-second, so minutes is generous. */
export const QUEUED_RUN_STALE_MS = 5 * 60_000;
/** Matches the ingest function's `timeouts: { finish: "15m" }`. */
export const RUNNING_RUN_STALE_MS = 15 * 60_000;

export type ProjectRunLike = {
  status?: string | null;
  enqueuedAt?: string | Date | null;
  startedAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
};

/** Dates arrive as ISO strings over the API and as Date objects on the server. */
function toTime(value?: string | Date | null): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function isInFlightStatus(status?: string | null) {
  return status === "queued" || status === "running";
}

export function isProjectRunStale(
  run: ProjectRunLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!run || !isInFlightStatus(run.status)) return false;

  // Queued with no enqueuedAt means inngest.send() never succeeded, so nothing
  // is ever going to pick this row up. Stuck from the start — no need to wait.
  if (run.status === "queued" && toTime(run.enqueuedAt) === null) return true;

  const since =
    run.status === "running"
      ? (toTime(run.startedAt) ??
        toTime(run.updatedAt) ??
        toTime(run.createdAt))
      : (toTime(run.enqueuedAt) ?? toTime(run.createdAt));

  // No usable timestamp at all: treat as stale rather than blocking forever.
  if (since === null) return true;

  const limit =
    run.status === "running" ? RUNNING_RUN_STALE_MS : QUEUED_RUN_STALE_MS;
  return now - since > limit;
}

/** In flight and still within its expected window — the only state that should block a retry. */
export function isProjectRunActive(
  run: ProjectRunLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!run || !isInFlightStatus(run.status)) return false;
  return !isProjectRunStale(run, now);
}
