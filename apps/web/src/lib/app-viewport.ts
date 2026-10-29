/**
 * The height the authenticated shell should occupy, in CSS px.
 *
 * `100dvh` tracks the *layout* viewport. On Android that is enough — the
 * `interactiveWidget: "resizes-content"` hint in `app/layout.tsx` shrinks the
 * layout viewport when the keyboard opens. iOS Safari ignores the hint: it
 * keeps the layout viewport at full height, shrinks only the *visual* viewport
 * and pans the page to reveal the focused input. A `dvh`-sized shell then hangs
 * below the visible area, which is what put the composer in the middle of the
 * screen with messages scrolling past underneath it and the page canvas showing
 * as a white band at the bottom.
 *
 * Sizing the shell to `visualViewport.height` instead makes it end exactly where
 * the keyboard starts, so the composer rises by the keyboard's height and no
 * more.
 *
 * Returns `null` when the reading must not be trusted; the caller then falls
 * back to the `100dvh` the stylesheet already provides.
 */
export function appViewportHeightPx(metrics: {
  /** Layout viewport height (`window.innerHeight`). */
  innerHeight: number;
  /** `window.visualViewport`, or null/undefined where unsupported. */
  visualViewport?: { height: number; scale: number } | null;
}): number | null {
  const viewport = metrics.visualViewport;
  if (!viewport) return null;
  // Pinch-zoom shrinks the visual viewport too. Resizing the app in that case
  // would fight the gesture, so leave the layout alone until the user zooms out.
  if (!Number.isFinite(viewport.scale) || Math.abs(viewport.scale - 1) > 0.01) {
    return null;
  }
  const height = Math.round(viewport.height);
  if (!Number.isFinite(height) || height <= 0) return null;
  // A visual viewport taller than the layout viewport means the two are out of
  // sync (mid browser-UI animation). `dvh` is the safer reading there.
  if (
    Number.isFinite(metrics.innerHeight) &&
    height > metrics.innerHeight + 1
  ) {
    return null;
  }
  return height;
}
