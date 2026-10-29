/**
 * How the inner browser agent reports that a page needs a person.
 *
 * Replaces the old `pause_for_user` park. The park had no `execute`, so the
 * unresolved call ended the inner loop and left the browser alive for a human
 * to take over. That handoff is gone: the agent signs itself in where it can,
 * and where it cannot, the run stops.
 *
 * This tool DOES have an `execute`, and the difference matters. We want the
 * inner loop to finish cleanly and write its summary — what it reached, what it
 * found on the way — rather than dying on an unanswered call. The alternative,
 * reading the agent's prose for "I got stuck", is guesswork; a tool call is a
 * structured signal.
 *
 * Kept free of any `ai` import so it stays unit-testable without a model.
 */

/** Tool name the inner agent calls to stop. Also the UI part suffix. */
export const BLOCKED_TOOL_NAME = "report_blocked";

/** `UIMessage` part type the blocked call shows up as. */
const BLOCKED_PART_TYPE = `tool-${BLOCKED_TOOL_NAME}`;

/** What the tool answers with, so the agent knows to wrap up rather than retry. */
export const BLOCKED_TOOL_ACK =
  "Recorded. Write a short summary of how far you got, then end your turn. Do not try another way in.";

/**
 * The only thing this needs off a `UIMessage` part.
 *
 * Deliberately just `type`: `UIMessagePart` is a wide union whose members
 * disagree about every other field, and narrowing to the one property they all
 * share keeps this assignable from any AI SDK version. `input` is read behind a
 * cast below, where its absence is already handled.
 */
type PartLike = { type: string };

/**
 * Why the run stopped, or `null` when it did not.
 *
 * Reads the LAST report in the message: an agent that reports, is told to wrap
 * up and reports again must surface the newest reason, not the stale one.
 *
 * Never returns anything the user typed, and never a credential: the reason is
 * the agent's own description of what the page asked for, and a resolved
 * credential value never reaches the agent's context at all.
 */
export function readBlockedReason(parts: readonly PartLike[]): string | null {
  let reason: string | null = null;

  for (const part of parts) {
    if (part.type !== BLOCKED_PART_TYPE) continue;
    const input = (part as { input?: unknown }).input as
      | { reason?: unknown }
      | undefined;
    const text = typeof input?.reason === "string" ? input.reason.trim() : "";
    // A report with an empty or malformed input is still a report: the run
    // stopped and must not be recorded as a success. Fall back rather than
    // treating it as done.
    reason = text || "The page needs a person to complete something by hand.";
  }

  return reason;
}
