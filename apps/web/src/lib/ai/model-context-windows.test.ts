import { describe, expect, it } from "vitest";
import {
  formatTokenCount,
  getContextWindow,
  percentUsed,
} from "./model-context-windows";

describe("getContextWindow", () => {
  it("resolves known gateway models", () => {
    expect(
      getContextWindow({ provider: "anthropic", model: "claude-sonnet-5" }),
    ).toBe(200_000);
    expect(
      getContextWindow({ provider: "Navigator", model: "Base model" }),
    ).toBe(1_000_000);
  });

  it("returns undefined for unknown or missing models", () => {
    expect(
      getContextWindow({ provider: "Local Models", model: "llama3.2:latest" }),
    ).toBeUndefined();
    expect(getContextWindow(undefined)).toBeUndefined();
  });
});

describe("percentUsed", () => {
  it("computes a rounded percentage", () => {
    expect(percentUsed(50_000, 200_000)).toBe(25);
    expect(percentUsed(1, 200_000)).toBe(0);
  });

  it("clamps to 0-100 and guards bad input", () => {
    expect(percentUsed(300_000, 200_000)).toBe(100);
    expect(percentUsed(-5, 200_000)).toBe(0);
    expect(percentUsed(10, 0)).toBe(0);
    expect(percentUsed(Number.NaN, 100)).toBe(0);
  });
});

describe("formatTokenCount", () => {
  it("formats token counts compactly", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1_000)).toBe("1K");
    expect(formatTokenCount(1_500)).toBe("1.5K");
    expect(formatTokenCount(262_144)).toBe("262K");
    expect(formatTokenCount(1_048_576)).toBe("1M");
  });
});
