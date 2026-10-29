/**
 * When the desktop shell asks the update feed for a new version.
 *
 * Automatic checks run at startup, on a fixed interval and when the window
 * regains focus, but never more often than `FOCUS_CHECK_MIN_GAP_MS`. A check
 * the user asks for (Help > Check for Updates, or the web UI) always runs.
 *
 * Pure module: no `electron` import, so it is unit-testable.
 */

export type UpdateCheckSource =
  | "startup"
  | "interval"
  | "focus"
  | "manual"
  | "renderer";

/** Background re-check cadence while the app stays open. */
export const AUTO_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/** Minimum gap between two automatic checks (focus events can be frequent). */
export const FOCUS_CHECK_MIN_GAP_MS = 30 * 60 * 1000;

/** Keep the updater log at roughly this size; older lines are dropped. */
export const UPDATER_LOG_MAX_BYTES = 512 * 1024;

export function isForcedCheck(source: UpdateCheckSource): boolean {
  return source === "manual" || source === "renderer";
}

export function shouldRunAutoCheck(input: {
  lastCheckAt: number | null;
  now: number;
  minGapMs: number;
}): boolean {
  if (input.lastCheckAt === null) return true;
  return input.now - input.lastCheckAt >= input.minGapMs;
}

/**
 * Trims a log to its most recent `maxBytes`, cutting on a line boundary so
 * the file never starts mid-line.
 */
export function trimLog(existing: string, maxBytes: number): string {
  if (Buffer.byteLength(existing, "utf8") <= maxBytes) return existing;
  const buffer = Buffer.from(existing, "utf8");
  let tail = buffer.subarray(buffer.length - maxBytes).toString("utf8");
  const firstNewline = tail.indexOf("\n");
  if (firstNewline !== -1) tail = tail.slice(firstNewline + 1);
  return tail;
}
