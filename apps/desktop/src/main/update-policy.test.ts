import { describe, expect, it } from "vitest";
import {
  AUTO_CHECK_INTERVAL_MS,
  FOCUS_CHECK_MIN_GAP_MS,
  isForcedCheck,
  shouldRunAutoCheck,
  trimLog,
} from "./update-policy.js";

const NOW = 1_700_000_000_000;

describe("shouldRunAutoCheck", () => {
  it("always runs when nothing has been checked yet", () => {
    expect(
      shouldRunAutoCheck({
        lastCheckAt: null,
        now: NOW,
        minGapMs: FOCUS_CHECK_MIN_GAP_MS,
      }),
    ).toBe(true);
  });

  it("throttles a focus check inside the minimum gap", () => {
    expect(
      shouldRunAutoCheck({
        lastCheckAt: NOW - 5 * 60_000,
        now: NOW,
        minGapMs: FOCUS_CHECK_MIN_GAP_MS,
      }),
    ).toBe(false);
  });

  it("runs again once the gap has passed", () => {
    expect(
      shouldRunAutoCheck({
        lastCheckAt: NOW - FOCUS_CHECK_MIN_GAP_MS,
        now: NOW,
        minGapMs: FOCUS_CHECK_MIN_GAP_MS,
      }),
    ).toBe(true);
  });

  it("keeps the hourly interval above the focus gap so interval checks never throttle", () => {
    expect(AUTO_CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(
      FOCUS_CHECK_MIN_GAP_MS,
    );
  });
});

describe("isForcedCheck", () => {
  it("lets user-initiated checks bypass the throttle", () => {
    expect(isForcedCheck("manual")).toBe(true);
    expect(isForcedCheck("renderer")).toBe(true);
    expect(isForcedCheck("focus")).toBe(false);
    expect(isForcedCheck("startup")).toBe(false);
    expect(isForcedCheck("interval")).toBe(false);
  });
});

describe("trimLog", () => {
  it("leaves a small log untouched", () => {
    expect(trimLog("a\nb\n", 100)).toBe("a\nb\n");
  });

  it("keeps the tail and starts on a line boundary", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n");
    const trimmed = trimLog(lines, 60);
    expect(Buffer.byteLength(trimmed, "utf8")).toBeLessThanOrEqual(60);
    expect(trimmed.startsWith("line-")).toBe(true);
    expect(trimmed.endsWith("line-49")).toBe(true);
  });
});
