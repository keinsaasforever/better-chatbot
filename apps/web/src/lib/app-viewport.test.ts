import { describe, expect, it } from "vitest";
import { appViewportHeightPx } from "./app-viewport";

describe("appViewportHeightPx", () => {
  it("ends the shell where the on-screen keyboard starts", () => {
    // iOS keeps the layout viewport at 844 and shrinks only the visual one.
    expect(
      appViewportHeightPx({
        innerHeight: 844,
        visualViewport: { height: 508, scale: 1 },
      }),
    ).toBe(508);
  });

  it("matches the layout viewport when no keyboard is open", () => {
    expect(
      appViewportHeightPx({
        innerHeight: 844,
        visualViewport: { height: 844, scale: 1 },
      }),
    ).toBe(844);
  });

  it("falls back to dvh where the visual viewport is unsupported", () => {
    expect(appViewportHeightPx({ innerHeight: 844 })).toBeNull();
    expect(
      appViewportHeightPx({ innerHeight: 844, visualViewport: null }),
    ).toBeNull();
  });

  it("leaves the layout alone while the user is pinch-zoomed in", () => {
    expect(
      appViewportHeightPx({
        innerHeight: 844,
        visualViewport: { height: 320, scale: 2.4 },
      }),
    ).toBeNull();
  });

  it("ignores readings that cannot be a viewport height", () => {
    expect(
      appViewportHeightPx({
        innerHeight: 844,
        visualViewport: { height: 0, scale: 1 },
      }),
    ).toBeNull();
    // Taller than the layout viewport: the two are mid-animation and out of sync.
    expect(
      appViewportHeightPx({
        innerHeight: 844,
        visualViewport: { height: 900, scale: 1 },
      }),
    ).toBeNull();
  });
});
