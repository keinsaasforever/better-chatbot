import "server-only";
import logger from "logger";
import {
  DEFAULT_KERNEL_BROWSER_TYPE,
  DEFAULT_KERNEL_PROXY_MODE,
  type KernelBrowserSession,
  type KernelBrowserType,
  type KernelProxyMode,
} from "./browser-contract";
import { getKernelClient } from "./client";

/**
 * Kernel terminates a browser after this many seconds of *inactivity* — and
 * only CDP and live-view connections count as activity. The tool drives the
 * browser through `playwright.execute` REST calls, which are idle between the
 * inner agent's model turns, so with Kernel's 60s default a slow turn (or a
 * user who never opens the live view) killed the session mid-run and every
 * later step failed on a dead browser. Idle time is free (Kernel Standby), so
 * a generous window costs nothing; the `finally` delete still frees the
 * concurrency slot the moment the run ends.
 */
const BROWSER_INACTIVITY_TIMEOUT_SECONDS = 600;

/**
 * Create a Kernel browser and return everything the tool and the UI need.
 *
 * Headful by design: the live view is the feature, and headless Chrome is
 * blocked by a large share of real sites. See `browser-contract.ts`.
 */
export async function createBrowserSession(options?: {
  browserType?: KernelBrowserType;
  /**
   * Kernel's anti-detection tuning plus the automatic CAPTCHA solver
   * (reCAPTCHA, Cloudflare and similar). Kernel bills nothing extra for it,
   * and bot detection bites hardest at exactly the sign-in step, so callers
   * should leave this on.
   *
   * Note it does NOT choose the egress path here: `proxyMode` is always sent
   * explicitly, which per Kernel "changes only egress; it does not enable or
   * disable stealth or the CAPTCHA solver".
   */
  stealth?: boolean;
  /**
   * Load a saved profile (cookies + localStorage) into this browser, so a
   * session captured once by hand can be reused. `saveChanges` writes state
   * back — but Kernel only commits it when the browser is DELETED or times
   * out, never on close, so a run that sets this must reach
   * `destroyBrowserSession`.
   */
  profile?: { name: string; saveChanges: boolean };
  /**
   * Egress mode. Defaults to `direct` so government, banking and payment
   * domains stay reachable — see `DEFAULT_KERNEL_PROXY_MODE`. Override only
   * for a site that specifically needs Kernel's managed proxy pool.
   */
  proxyMode?: KernelProxyMode;
}): Promise<KernelBrowserSession> {
  const browserType = options?.browserType ?? DEFAULT_KERNEL_BROWSER_TYPE;
  const proxyMode = options?.proxyMode ?? DEFAULT_KERNEL_PROXY_MODE;
  const browser = await getKernelClient().browsers.create({
    headless: browserType === "headless",
    timeout_seconds: BROWSER_INACTIVITY_TIMEOUT_SECONDS,
    // Always sent explicitly. Omitting it is not a neutral default: a stealth
    // browser with no proxy config silently takes Kernel's managed pool, which
    // blocks the government and banking domains this feature exists to reach.
    proxy: { mode: proxyMode },
    ...(options?.stealth ? { stealth: true } : {}),
    ...(options?.profile
      ? {
          profile: {
            name: options.profile.name,
            save_changes: options.profile.saveChanges,
          },
        }
      : {}),
  });

  const sessionId = browser.session_id;
  const liveViewUrl = browser.browser_live_view_url;

  if (!sessionId) {
    throw new Error("Kernel returned a browser without a session id");
  }
  // The live view is the feature: headful exists so the user can watch, and the
  // artifact panel has nothing to render without this. Guarded like the session
  // id rather than left to surface as an `undefined` iframe src.
  if (!liveViewUrl) {
    throw new Error("Kernel returned a browser without a live view URL");
  }

  return {
    sessionId,
    liveViewUrl,
    browserType,
    startedAt: Date.now(),
    profileName: options?.profile?.name,
    saveChanges: options?.profile?.saveChanges ?? false,
  };
}

/**
 * Look up a browser that should still be alive.
 *
 * No agent run resumes a browser any more — nothing parks, every run ends in
 * `destroyBrowserSession`. This serves the connect-a-site flow in org settings,
 * where a human opens a browser, signs in over several minutes of polling, and
 * then closes it: each poll lands on a different serverless instance holding
 * nothing but the session id, so the rest is re-read from Kernel here.
 *
 * Returns `null` — never throws — when the browser is gone (reaped by the
 * inactivity timeout, deleted, or an id that was never valid), so a caller can
 * tell "still signing in" from "that session ended" without a try/catch.
 */
export async function resumeBrowserSession(
  sessionId: string,
): Promise<KernelBrowserSession | null> {
  try {
    const browser = await getKernelClient().browsers.retrieve(sessionId);

    // `include_deleted` defaults to false, so a reaped browser normally 404s
    // into the catch. Checked anyway: a soft-deleted browser answers no CDP.
    if (browser.deleted_at) return null;
    if (!browser.browser_live_view_url) return null;

    return {
      sessionId: browser.session_id,
      liveViewUrl: browser.browser_live_view_url,
      browserType: browser.headless
        ? "headless"
        : browser.gpu
          ? "gpu"
          : "headful",
      // Deliberately now, not `browser.created_at`: each segment is billed by
      // the caller that opened it, and billing from creation again on every
      // poll would charge the same seconds repeatedly. See
      // `docs/kernel-browser-billing.md`.
      startedAt: Date.now(),
      profileName: browser.profile?.name ?? undefined,
      saveChanges: browser.profile_save_changes ?? false,
    };
  } catch (error) {
    logger.info(
      `[kernel] could not resume browser ${sessionId}: ${
        error instanceof Error ? error.message : error
      }`,
    );
    return null;
  }
}

/**
 * Delete a Kernel browser.
 *
 * Call this in a `finally` for every run that truly ended. An orphaned browser
 * holds a concurrency slot (5 on Developer, 10 on Hobbyist), so leaking one
 * degrades the whole workspace rather than just its own run. Deleting does not
 * reduce cost — Kernel stops billing ~5s after the last activity, via Standby —
 * so this is about capacity.
 *
 * The one run that must NOT reach here is an `awaiting-user` park: the browser
 * has to survive for the user to sign in. That leak is bounded and deliberate,
 * and the inactivity timeout above is its backstop.
 *
 * Never throws: a failed delete must not mask the tool's own error, and the
 * reaper is the backstop.
 */
export async function destroyBrowserSession(
  session: Pick<KernelBrowserSession, "sessionId">,
): Promise<void> {
  try {
    await getKernelClient().browsers.deleteByID(session.sessionId);
  } catch (error) {
    logger.error(
      `[kernel] failed to delete browser ${session.sessionId}`,
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * Wall-clock seconds a browser was alive.
 *
 * This is an UPPER BOUND on what Kernel actually bills: Kernel drops a browser
 * to free Standby roughly 5s after the last CDP or Live View activity, so idle
 * time inside the window costs us nothing. Billing on this over-charges an idle
 * user rather than under-charging us, which is the safe direction. The artifact
 * panel unmounting its iframe when inactive is what keeps the gap small.
 */
export function elapsedSeconds(
  session: Pick<KernelBrowserSession, "startedAt">,
): number {
  return Math.max(0, (Date.now() - session.startedAt) / 1_000);
}
