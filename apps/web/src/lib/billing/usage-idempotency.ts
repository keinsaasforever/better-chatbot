/**
 * Idempotency keys for billable work.
 *
 * The key must be **stable within one run and unique across runs**. Both halves
 * are load-bearing and both were violated in production:
 *
 * - Stable within a run, because every writer retries. `trackWithRetry` sends
 *   identical params twice on failure, and the reservation is re-read on a
 *   client retry — a key that changed between those would double-charge.
 * - Unique across runs, because a repeat is real spend. Chat keyed on the
 *   *user's* message id, but a client-side tool (one declared without
 *   `execute`) ends the stream, the browser runs the tool and posts back with
 *   that same message id. One production message produced 14 model runs: Autumn
 *   billed the first and rejected 13 as `duplicate_idempotency_key`, and the
 *   member's spending cap counted a single reservation for all 14. The workflow
 *   analyzer keyed on the workflow id alone, so every re-analysis after the
 *   first was discarded for the life of that workflow. Temporary chat fell back
 *   to the literal `"unknown"` when a message carried no id, collapsing every
 *   such request across a customer onto one key.
 *
 * `runId` is what supplies uniqueness, so it must be minted once per run —
 * never derived from anything the caller can repeat.
 */
export function billingRunKey(input: {
  /** What kind of work this is, so keys from different paths cannot collide. */
  scope: string;
  /** Who the spend belongs to: billing customer, member, or owning record. */
  subject: string;
  /** Minted once per run. The part that makes a repeat a distinct event. */
  runId: string;
  /** Optional context that only aids debugging — never uniqueness. */
  detail?: string;
}): string {
  const { scope, subject, runId, detail } = input;
  return [scope, subject, detail, runId].filter(Boolean).join(":");
}
