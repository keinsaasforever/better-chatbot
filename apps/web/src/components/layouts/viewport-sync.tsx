"use client";

import { appViewportHeightPx } from "@/lib/app-viewport";
import { useEffect } from "react";

/**
 * Pins the authenticated shell to the *visual* viewport and stops the document
 * itself from scrolling.
 *
 * Two mobile bugs come out of the shell being sized in `dvh` — the layout
 * viewport — while the browser shrinks or pans the visual one:
 *
 * - Opening the keyboard on iOS leaves the shell at full height and pans the
 *   page instead, so the composer ends up floating in the middle of the screen
 *   with messages scrolling past underneath it.
 * - A hard flick anywhere outside the chat's own scroller rubber-bands the
 *   document, exposing the page canvas under the shell as a white band.
 *
 * Publishing `--app-viewport-height` (consumed by `.h-app-viewport`) fixes the
 * first: the shell ends where the keyboard starts, so the composer rises by the
 * keyboard's height and no more. `app-viewport-locked` fixes the second.
 *
 * Mounted by `AppShell` only — public pages keep normal document scrolling.
 */
export function ViewportSync() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport ?? null;

    root.classList.add("app-viewport-locked");

    const sync = () => {
      const height = appViewportHeightPx({
        innerHeight: window.innerHeight,
        visualViewport: viewport,
      });
      if (height === null) {
        root.style.removeProperty("--app-viewport-height");
      } else {
        root.style.setProperty("--app-viewport-height", `${height}px`);
      }
      // iOS scrolls the document to reveal a focused input. The shell now ends
      // above the keyboard, so that scroll only pushes the header off-screen.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };

    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      root.classList.remove("app-viewport-locked");
      root.style.removeProperty("--app-viewport-height");
    };
  }, []);

  return null;
}
