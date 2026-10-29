import { getStorageManager } from "lib/browser-storage";

/**
 * Session-scoped record that the user closed the usage-limit modal.
 *
 * `sessionStorage`, so the dismissal survives reloads and in-app navigation but
 * dies with the tab: a user who is out of credits should be able to read old
 * chats and change settings without the modal reappearing on every page, and
 * should still be reminded the next time they open the app.
 *
 * One global key rather than one per workspace. Dismissal expresses how much
 * the user wants to see this modal, not a property of the workspace — and the
 * per-action gates in `require-credits.ts` still fire in every workspace
 * regardless, so nothing is silently skipped by sharing the key.
 *
 * `getStorageManager` returns an inert manager outside the browser, so `get()`
 * is `undefined` during SSR and this correctly reads as "not dismissed".
 */
const dismissal = getStorageManager<true>("USAGE_LIMIT_DISMISSED", "session");

export function isUsageLimitDismissed(): boolean {
  return dismissal.get() === true;
}

export function dismissUsageLimit(): void {
  dismissal.set(true);
}

/** Test seam — also useful if a future upgrade flow wants a clean slate. */
export function resetUsageLimitDismissal(): void {
  dismissal.remove();
}
