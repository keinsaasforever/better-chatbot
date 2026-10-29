/**
 * Shared vocabulary for Kernel browser automation.
 *
 * Deliberately free of any Kernel SDK import so the UI, the billing helpers and
 * the tool can all agree on these shapes without pulling a server-only client
 * into the browser bundle. Mirrors `lib/e2b/sandbox-contract.ts`.
 */

/**
 * Kernel browser types, and what each costs relative to a headless second.
 *
 * Kernel's published rates are $0.0000166667/s headless, $0.0001333336/s
 * headful and $0.0008000016/s headful+GPU — exactly 1x, 8x and 48x. Billing
 * therefore normalises everything to "headless-equivalent seconds" and lets a
 * single Autumn credit cost cover all three. See `docs/kernel-browser-billing.md`.
 */
export const KERNEL_BROWSER_MULTIPLIERS = {
  headless: 1,
  headful: 8,
  gpu: 48,
} as const;

export type KernelBrowserType = keyof typeof KERNEL_BROWSER_MULTIPLIERS;

/**
 * v1 runs headful, always. The feature's whole promise is that the user watches
 * the agent work, and headless Chrome is fingerprinted and blocked by a large
 * share of real sites. GPU is never exposed: no use case here justifies 48x.
 */
export const DEFAULT_KERNEL_BROWSER_TYPE: KernelBrowserType = "headful";

/** Provider cost per second, in USD, straight from Kernel's pricing page. */
export const KERNEL_USD_PER_SECOND: Record<KernelBrowserType, number> = {
  headless: 0.0000166667,
  headful: 0.0001333336,
  gpu: 0.0008000016,
};

/**
 * How a browser reaches the internet.
 *
 * `default` uses Kernel's managed proxy pool; `direct` egresses straight from
 * the browser's own cloud IP.
 */
export type KernelProxyMode = "direct" | "default";

/**
 * Egress mode for every browser this app opens.
 *
 * `direct`, deliberately, and this is a correctness fix rather than a tuning
 * knob. Kernel's own documentation:
 *
 * > Some destination categories — including government, banking, and payment
 * > domains — are blocked by our upstream network providers and will fail at
 * > the proxy layer. Reach them directly or with a custom proxy instead.
 *
 * `stealth: true` with no explicit proxy routes through Kernel's managed proxy,
 * so the config that looks strongest is the one that cannot reach a tax
 * authority or a bank at all — and it fails at the network layer, which reads
 * as a broken site rather than a blocked one. Since those portals are the whole
 * point of this feature, direct egress is the default.
 *
 * What this does NOT give up: stealth mode and the CAPTCHA solver stay on. Per
 * Kernel, "a stealth browser using mode=direct still runs in stealth mode with
 * the CAPTCHA solver enabled" — an explicit proxy config "changes only egress".
 *
 * What it costs: the exit IP is Kernel's datacenter address rather than a
 * residential-looking ISP one, so a site that scores IP reputation may challenge
 * more often. The solver absorbs most of that, and a hard block on a `.gov` is
 * strictly worse than an extra CAPTCHA elsewhere. A site that genuinely needs
 * the managed pool can pass `default` per run.
 */
export const DEFAULT_KERNEL_PROXY_MODE: KernelProxyMode = "direct";

/**
 * The live view, made read-only.
 *
 * Kernel's live view is INTERACTIVE by default — whoever loads that URL can
 * click and type into the browser. `readOnly=true` is what turns it into a
 * viewer. Anywhere the app shows the live view purely so a human can watch,
 * it has to go through here; forgetting it silently hands control of an
 * authenticated browser to whoever has the panel open.
 *
 * Returns the input unchanged when it will not parse, rather than throwing: a
 * malformed URL is already handled downstream as "no live view", and this must
 * never be the thing that fails a run.
 */
export function toReadOnlyLiveViewUrl(liveViewUrl: string): string {
  try {
    const url = new URL(liveViewUrl);
    url.searchParams.set("readOnly", "true");
    return url.toString();
  } catch {
    return liveViewUrl;
  }
}

/**
 * Billable units for one browser run: whole headless-equivalent seconds.
 *
 * Rounded up so a sub-second run is never free, matching how
 * `trackVoiceAssemblyUsage` ceilings its seconds.
 */
export function toBillableUnits(
  seconds: number,
  browserType: KernelBrowserType,
): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds) * KERNEL_BROWSER_MULTIPLIERS[browserType];
}

/** A live Kernel browser, as the tool and the UI see it. */
export type KernelBrowserSession = {
  sessionId: string;
  liveViewUrl: string;
  browserType: KernelBrowserType;
  /** `Date.now()` at creation; the billing window starts here. */
  startedAt: number;
  /** Saved profile loaded into this browser, when one was. */
  profileName?: string;
  /**
   * Whether Kernel will write this browser's cookies back to that profile.
   * Kernel commits only on delete or timeout, so the teardown path has to know.
   */
  saveChanges: boolean;
};

/**
 * What the tool's generator yields.
 *
 * `starting` carries the live-view URL as early as possible so the panel can
 * open while the agent is still working. Only the terminal value persists to
 * `chat_message.parts`.
 *
 * Every terminal state now ends the browser. `blocked` is separate from
 * `failed` on purpose: `failed` means the infrastructure broke and a retry
 * might work, `blocked` means the page needs a person (an eID prompt, a
 * one-time code, a CAPTCHA) and retrying changes nothing. The outer agent, the
 * panel and a scheduled run's error text should each say something different
 * about those two.
 */
export type BrowserToolOutput =
  | { status: "starting"; sessionId: string; liveViewUrl: string }
  | {
      status: "running";
      sessionId: string;
      liveViewUrl: string;
      message: unknown;
    }
  | {
      status: "done";
      sessionId: string;
      liveViewUrl: string;
      summary: string;
      stepCount: number;
    }
  | {
      /**
       * The page needs a person and the agent stopped rather than improvising.
       * The browser IS torn down: nobody is coming to finish it mid-run, and
       * holding a headful browser open on the chance someone might is how a
       * concurrency slot leaks. Recovery is a fresh run, or connecting the
       * site by hand in org settings so a profile carries the sign-in.
       */
      status: "blocked";
      sessionId: string;
      liveViewUrl?: string;
      /** What the page wanted that no automation could supply. */
      reason: string;
      /** What the run achieved before it stopped, so nothing is lost. */
      summary: string;
      stepCount: number;
    }
  | { status: "failed"; sessionId?: string; error: string }
  | {
      /**
       * LEGACY. Produced by the old human-in-the-loop park, which is gone: the
       * agent no longer hands a browser to a user mid-run. Kept in the union
       * because runs from before that change are already persisted in
       * `chat_message.parts`, and the panel still has to render them without
       * throwing. Nothing produces this any more — do not add code that does.
       */
      status: "awaiting-user";
      sessionId: string;
      liveViewUrl: string;
      request: string;
      summary: string;
      stepCount: number;
    };

/**
 * How long a parked (`awaiting-user`) browser stays on screen before the panel
 * gives up on the handoff.
 *
 * This is a cost guard, not a UX preference. Kernel reaps a browser after a
 * window of INACTIVITY, and a mounted live view counts as activity — so a user
 * who walks away from an open panel would keep a headful browser (8x rate)
 * alive indefinitely. Unmounting the iframe here lets Kernel's own timeout
 * finish the job. Generous enough for a real sign-in with a 2FA code.
 */
export const BROWSER_HANDOFF_WINDOW_MS = 10 * 60 * 1000;

/**
 * Wall-clock ceiling on one unattended browser run.
 *
 * A cost guard, not a UX preference, and the only hard one: nobody is watching
 * an unattended run, so an agent stuck in a retry loop on a broken page bills
 * headful browser-seconds (128 credits each) until Kernel's inactivity timeout
 * notices — and the tool's own REST calls keep resetting that. Three minutes is
 * enough for a sign-in plus real work, and caps a runaway at ~23k credits.
 */
export const UNATTENDED_MAX_RUN_MS = 3 * 60 * 1000;

/**
 * Step ceiling for the inner agent, by run mode.
 *
 * Lower when unattended for the same reason as the clock above, and because a
 * run that has not finished in a dozen steps with no human to redirect it is
 * not about to.
 */
export const BROWSER_MAX_STEPS = { interactive: 20, unattended: 12 } as const;

/**
 * Whether a browser output means "the session is over".
 *
 * `awaiting-user` is legacy and reads as live, because the panel rendering an
 * old parked run should still show what it showed then.
 */
export function isBrowserSessionOver(status: string | undefined): boolean {
  return status === "done" || status === "failed" || status === "blocked";
}
