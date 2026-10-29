import { describe, expect, it } from "vitest";
import { weightInputTokens } from "./cache-weighted-tokens";

const ratios = { readRatio: 0.1, writeRatio: 1.25 };

describe("weightInputTokens", () => {
  it("returns the prompt total untouched when nothing was cached", () => {
    // The backwards-compatibility guarantee: a provider that reports no cache
    // detail must bill exactly what it billed before this existed.
    expect(weightInputTokens({ promptTokens: 10_000 }, ratios)).toEqual({
      noCacheTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      effectiveInputTokens: 10_000,
    });
  });

  it("discounts cache reads", () => {
    const result = weightInputTokens(
      { promptTokens: 10_000, cacheReadTokens: 9_000, noCacheTokens: 1_000 },
      ratios,
    );

    // 1000 + 9000 x 0.1
    expect(result.effectiveInputTokens).toBe(1_900);
  });

  it("charges a premium for cache writes", () => {
    const result = weightInputTokens(
      { promptTokens: 10_000, cacheWriteTokens: 8_000, noCacheTokens: 2_000 },
      ratios,
    );

    // 2000 + 8000 x 1.25
    expect(result.effectiveInputTokens).toBe(12_000);
  });

  it("derives the uncached remainder when the SDK omits it", () => {
    const result = weightInputTokens(
      { promptTokens: 10_000, cacheReadTokens: 6_000, cacheWriteTokens: 1_000 },
      ratios,
    );

    expect(result.noCacheTokens).toBe(3_000);
    // 3000 + 1000 x 1.25 + 6000 x 0.1
    expect(result.effectiveInputTokens).toBe(4_850);
  });

  it("never derives a negative remainder from a mismatched trio", () => {
    const result = weightInputTokens(
      { promptTokens: 100, cacheReadTokens: 900 },
      ratios,
    );

    expect(result.noCacheTokens).toBe(0);
    expect(result.effectiveInputTokens).toBe(90);
  });

  it("ignores nonsense values instead of propagating NaN into a charge", () => {
    const result = weightInputTokens(
      {
        promptTokens: 1_000,
        cacheReadTokens: Number.NaN,
        cacheWriteTokens: -50,
      },
      ratios,
    );

    expect(result.effectiveInputTokens).toBe(1_000);
  });

  it("honours per-model ratios rather than assuming Anthropic's", () => {
    // Providers that charge nothing to write the cache, and a quarter to read.
    const result = weightInputTokens(
      { promptTokens: 10_000, cacheReadTokens: 4_000, cacheWriteTokens: 4_000 },
      { readRatio: 0.25, writeRatio: 1 },
    );

    // 2000 + 4000 x 1 + 4000 x 0.25
    expect(result.effectiveInputTokens).toBe(7_000);
  });
});
