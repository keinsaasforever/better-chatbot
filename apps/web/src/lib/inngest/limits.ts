/**
 * Ceiling for a single function's *global* concurrency, imposed by the Inngest
 * plan.
 *
 * Exceeding it does not degrade that one function — it fails the entire app
 * sync ("The function 'x' has higher concurrency limits (N) than your plan
 * limit of 5"), so every function stops registering and the deployed code
 * never reaches the runtime. Keep global limits at or below this, and raise it
 * only alongside an actual plan upgrade.
 *
 * Per-key limits (`{ limit, key }`) are scoped to each key's own queue and are
 * bounded by this same ceiling.
 */
export const INNGEST_PLAN_CONCURRENCY_LIMIT = 5;
