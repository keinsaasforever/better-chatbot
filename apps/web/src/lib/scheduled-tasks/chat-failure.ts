/**
 * Whether a failed loopback /api/chat call is worth retrying. Timeouts, rate
 * limits, and server errors can heal on their own; other 4xx responses
 * (auth, validation, policy) will fail identically on every attempt.
 */
export function isTransientChatFailure(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Finish reasons that mean a scheduled run did not produce an answer.
 *
 * `tool-calls` is the important one. It means the model asked for a tool and
 * the loop stopped without a result — which, on a run where every bound tool
 * executes server-side, can only be a tool nothing was able to answer. That is
 * exactly how a client-side tool (declared without `execute`) fails when no
 * browser is attached, and it used to be recorded as a successful run.
 */
const FAILED_FINISH_REASONS = new Set([
  "tool-calls",
  "error",
  "length",
  "content-filter",
]);

/** What the terminal `finish` frame of a run tells us about its outcome. */
export type StreamOutcome = {
  /** `undefined` when the stream never finished — truncated or aborted. */
  finishReason: string | undefined;
  /**
   * Set when a tool stopped because it needed a person. The turn itself still
   * ends normally, so this is the only signal that separates "the agent did the
   * work" from "the agent hit an identity check and gave up".
   */
  blockedReason: string | undefined;
};

/**
 * Reads the outcome off the last `finish` chunk of a UI-message stream.
 *
 * `finishReason` comes from the chunk's own top-level field rather than message
 * metadata, because metadata written from the stream's async `onEnd` can lose
 * the race with the chunk itself. `blocked` is safe to read from
 * `messageMetadata` on that same frame precisely because it is NOT written in
 * `onEnd`: the tool sets it during the run, and the synchronous
 * `messageMetadata` callback returns the live object when the frame is built.
 *
 * One pass over the tail for both, since the tail can be 64kB.
 */
export function readStreamOutcome(sse: string): StreamOutcome {
  let finishReason: string | undefined;
  let blockedReason: string | undefined;
  for (const line of sse.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      if (chunk?.type === "finish") {
        // A `finish` frame at all means the stream completed, so an unreadable
        // reason still counts as finished. Failing on it instead would turn
        // every healthy run into a failure push the day the SDK renames this
        // field; the finish reason logged per run is what makes drift visible.
        finishReason =
          typeof chunk.finishReason === "string"
            ? chunk.finishReason
            : "unknown";
        const blocked = chunk.messageMetadata?.blocked;
        blockedReason =
          typeof blocked?.reason === "string" && blocked.reason.trim()
            ? blocked.reason.trim()
            : undefined;
      }
    } catch {
      // Not a JSON frame (or split mid-object) — nothing to read from it.
    }
  }
  return { finishReason, blockedReason };
}

/**
 * Reads only the finish reason. Thin wrapper over {@link readStreamOutcome},
 * kept because it is the narrower question most callers ask.
 */
export function readStreamFinishReason(sse: string): string | undefined {
  return readStreamOutcome(sse).finishReason;
}

/**
 * Whether a run that returned this finish reason should be recorded failed.
 *
 * Deliberately unchanged by the `blocked` signal: a blocked run genuinely
 * finishes with `stop`, and widening this set to catch it would start failing
 * healthy runs. The caller checks `blockedReason` separately.
 */
export function isFailedRunFinishReason(reason: string | undefined): boolean {
  return reason === undefined || FAILED_FINISH_REASONS.has(reason);
}
