import { appStore } from "@/app/store";

/**
 * Client-side gate for actions that spend credits.
 *
 * This is a *nudge*, not enforcement. The authoritative check is server-side in
 * the credit guard (`assertCreditsAvailable` in `lib/gate`), which every AI entry point runs before invoking
 * a model. Some gated actions here (creating a project or a workflow, starting
 * dictation) have no server guard at all — they are gated for coherence, so the
 * app does not let a user start work it cannot finish. Do not treat a call to
 * `requireCredits` as proof that spending is blocked.
 *
 * Two invariants:
 *
 * 1. **Reads at call time**, via `getState()` rather than a render-time
 *    selector. `(chat)/layout.tsx` is a server layout, so the status it seeds is
 *    fixed until the next full page load — potentially hours in a long-lived
 *    tab. Reading in the handler at least picks up anything that changed the
 *    store since render.
 * 2. **Fails open.** A null or not-yet-seeded status never blocks. That keeps
 *    surfaces where `UsageLimitSync` is not mounted — `/accept-invitation/:id`
 *    renders the sidebar and header but not the guard — from silently
 *    swallowing clicks with no modal to explain why. The cost of failing open is
 *    one request that comes back 402, which the `ErrorMessage` backstop turns
 *    into the same modal.
 */
export function requireCredits(): boolean {
  if (appStore.getState().usageLimit?.isOverLimit !== true) return true;
  appStore.setState({ openUsageLimit: true });
  return false;
}

/**
 * Open the usage-limit modal directly, for the authoritative path: the server
 * answered 402, so the seeded status was stale and the user must see it
 * regardless of whether they dismissed it earlier.
 */
export function openUsageLimitDialog(): void {
  appStore.setState({ openUsageLimit: true });
}
