"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps a preview sandbox alive while the user is actually using it — and,
 * far more importantly, stops keeping it alive the moment they are not.
 *
 * The previous behaviour was an unconditional `setInterval` that extended the
 * sandbox TTL every 5 minutes for as long as the panel was mounted. A tab left
 * open overnight therefore billed E2B compute all night. Since E2B charges per
 * second of *running* time and a paused sandbox is free, retained
 * indefinitely, and resumes in ~1s with its memory intact, letting a sandbox
 * pause costs the user nothing and is the whole saving.
 *
 * Three things here are less obvious than they look:
 *
 * 1. **Only `visibilityState` is a safe activity signal.** The preview is a
 *    cross-origin iframe, so the instant the user clicks *into* it the parent
 *    document loses focus. Anything built on `document.hasFocus()` or a parent
 *    `blur` handler would pause the sandbox at the exact moment it is being
 *    used most. Interaction inside the iframe is simply not observable from
 *    out here, which is also why the idle window is generous.
 *
 * 2. **Stopping the heartbeat is not enough.** Auto-resume fires on *any*
 *    inbound HTTP request to the sandbox tunnel, so a generated app that polls
 *    on an interval, holds an SSE stream, or registers a service worker will
 *    keep resuming itself from a background tab no matter what this timer
 *    does. The iframe therefore has to be *detached* (`previewActive: false`),
 *    not merely hidden with CSS.
 *
 * 3. **Pause must survive page unload.** `fetch(..., { keepalive: true })` is
 *    the primary path because, unlike `sendBeacon`, it still allows a method
 *    and headers; `sendBeacon` is the fallback. Both are same-origin POSTs, so
 *    the session cookie rides along — which is why the pause route must not
 *    read a body.
 */

export interface UseSandboxKeepaliveOptions {
  sbxId: string | null;
  /** Panel is open and a preview URL exists. */
  enabled: boolean;
  /** Heartbeat cadence. Must stay well under the server's idle TTL. */
  heartbeatMs?: number;
  /** Stop heartbeating after this long with no observed interaction. */
  idleTimeoutMs?: number;
  /** Detach the iframe and pause this long after the tab is hidden. */
  suspendAfterHiddenMs?: number;
}

export interface UseSandboxKeepaliveResult {
  /** When false, render a placeholder — the iframe must not be mounted. */
  previewActive: boolean;
  /** Record parent-level interaction (pointer, key, wheel) with the panel. */
  markActive: () => void;
  /** User asked to bring a suspended preview back. */
  resume: () => void;
}

/** A third of the server's 3-minute idle TTL: two beats may drop harmlessly. */
const DEFAULT_HEARTBEAT_MS = 60 * 1000;

/**
 * Generous because interaction inside the iframe is invisible to us (see note
 * 1) — someone can be reading or clicking around a preview without producing
 * a single parent-level event. Pausing early is cheap to recover from, but
 * doing it while someone is mid-edit is not.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;

/** Long enough that an alt-tab or a copy-paste detour doesn't thrash. */
const DEFAULT_SUSPEND_AFTER_HIDDEN_MS = 45 * 1000;

function isVisible(): boolean {
  return typeof document === "undefined"
    ? false
    : document.visibilityState === "visible";
}

/**
 * Ask the server to pause a sandbox, on a path that survives page unload.
 * Exported for reuse by callers that supersede a sandbox outside this hook.
 */
export function requestSandboxPause(sbxId: string): void {
  const url = `/api/sandbox/${sbxId}/pause`;
  try {
    void fetch(url, { method: "POST", keepalive: true }).catch(() => {});
  } catch {
    navigator.sendBeacon?.(url);
  }
}

export function useSandboxKeepalive({
  sbxId,
  enabled,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  suspendAfterHiddenMs = DEFAULT_SUSPEND_AFTER_HIDDEN_MS,
}: UseSandboxKeepaliveOptions): UseSandboxKeepaliveResult {
  const [previewActive, setPreviewActive] = useState(true);

  // Refs, not state: the heartbeat reads these on every tick, and putting them
  // in state would tear down and rebuild the interval on each interaction.
  const lastInteractionAt = useRef(Date.now());
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The effect below must NOT depend on `previewActive`. Its cleanup pauses
  // the sandbox, so listing the flag as a dependency would make `resume()`
  // tear the effect down and immediately pause the sandbox the user just
  // asked to bring back. Mirror it into a ref instead.
  const previewActiveRef = useRef(previewActive);
  previewActiveRef.current = previewActive;

  const markActive = useCallback(() => {
    lastInteractionAt.current = Date.now();
  }, []);

  const extend = useCallback(() => {
    if (!sbxId) return;
    fetch(`/api/sandbox/${sbxId}/extend`, { method: "POST" }).catch(() => {});
  }, [sbxId]);

  const resume = useCallback(() => {
    markActive();
    setPreviewActive(true);
  }, [markActive]);

  // A new sandbox starts active, and its idle clock starts now rather than
  // inheriting the previous preview's staleness.
  useEffect(() => {
    if (!sbxId) return;
    lastInteractionAt.current = Date.now();
    setPreviewActive(true);
  }, [sbxId]);

  useEffect(() => {
    if (!enabled || !sbxId) return;

    const clearHiddenTimer = () => {
      if (hiddenTimer.current !== null) {
        clearTimeout(hiddenTimer.current);
        hiddenTimer.current = null;
      }
    };

    const suspend = () => {
      clearHiddenTimer();
      setPreviewActive(false);
      requestSandboxPause(sbxId);
    };

    const interval = setInterval(() => {
      if (!isVisible()) return;
      if (Date.now() - lastInteractionAt.current >= idleTimeoutMs) {
        // Idle: stop renewing and let the server-side TTL pause it. We do not
        // pause eagerly here — the user is still on the tab, and a click would
        // auto-resume anyway.
        return;
      }
      extend();
    }, heartbeatMs);

    const onVisibilityChange = () => {
      if (isVisible()) {
        clearHiddenTimer();
        // Returning to the tab is intent. Renew immediately so the user isn't
        // waiting out a full heartbeat interval on a nearly-expired sandbox.
        markActive();
        if (previewActiveRef.current) extend();
        return;
      }
      clearHiddenTimer();
      hiddenTimer.current = setTimeout(suspend, suspendAfterHiddenMs);
    };

    const onPageHide = () => requestSandboxPause(sbxId);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      clearInterval(interval);
      clearHiddenTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      // Panel closed, sandbox swapped, or the user navigated away: stop
      // paying for it immediately rather than waiting out the TTL.
      requestSandboxPause(sbxId);
    };
  }, [
    enabled,
    extend,
    heartbeatMs,
    idleTimeoutMs,
    markActive,
    sbxId,
    suspendAfterHiddenMs,
  ]);

  return { previewActive, markActive, resume };
}
