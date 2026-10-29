/**
 * Whether a human is present for this chat run.
 *
 * This is deliberately NOT the same thing as `headless`, which the chat route
 * already tracks. `headless` answers "can a client-side tool (one declared
 * without an `execute`) ever be answered here?" — a precise, load-bearing
 * question that `loadAppDefaultTools` depends on. It happens to be true on the
 * same requests as `unattended` today, but the two mean different things and
 * conflating them is what made the browser tool unavailable to scheduled
 * agents: it was suppressed by a flag that really meant "no client-side tools".
 *
 * `unattended` answers "is anyone watching, and can anyone be asked?". It gates
 * the browser tool's sign-in behaviour, the human-in-the-loop tools, and the
 * per-run cost brakes.
 *
 * Kept free of `server-only` so it can be imported from tests and from the
 * scheduled-task runner.
 */
export type ChatRunMode = "interactive" | "unattended";

/** Header the scheduled-task loopback uses to name the task it is running. */
export const SCHEDULED_TASK_ID_HEADER = "X-Scheduled-Task-Id";

export function isUnattended(mode: ChatRunMode): boolean {
  return mode === "unattended";
}
