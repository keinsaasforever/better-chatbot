// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useIsIOS } from "./use-is-ios";

/**
 * The point of this hook is one thing: an iframe cannot show a PDF on iOS.
 * Getting the detection wrong in either direction is a visible bug — a false
 * negative leaves an iPad user staring at a blank frame, a false positive
 * takes the inline viewer away from a desktop Mac that renders it fine.
 */
function stubAgent(userAgent: string, maxTouchPoints: number) {
  vi.stubGlobal("navigator", { userAgent, maxTouchPoints });
}

afterEach(() => vi.unstubAllGlobals());

describe("useIsIOS", () => {
  test.each([
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)", 5],
    ["iPod", "Mozilla/5.0 (iPod touch; CPU iPhone OS 17_5 like Mac OS X)", 5],
  ])("detects %s from the user agent", (_label, ua, touch) => {
    stubAgent(ua, touch);
    expect(renderHook(() => useIsIOS()).result.current).toBe(true);
  });

  // The case a user-agent test alone gets wrong: iPadOS 13+ deliberately
  // claims to be a Mac, so every iPad would fall through to the broken iframe.
  test("detects an iPad despite its desktop-Mac user agent", () => {
    stubAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      5,
    );
    expect(renderHook(() => useIsIOS()).result.current).toBe(true);
  });

  test("leaves a real Mac alone — a trackpad reports no touch points", () => {
    stubAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      0,
    );
    expect(renderHook(() => useIsIOS()).result.current).toBe(false);
  });

  test("leaves a touchscreen Windows laptop alone", () => {
    stubAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 10);
    expect(renderHook(() => useIsIOS()).result.current).toBe(false);
  });
});
