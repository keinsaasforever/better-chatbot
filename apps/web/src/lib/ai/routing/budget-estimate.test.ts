import { describe, expect, it, vi } from "vitest";

// `budget.ts` is server-only and reaches for the DB at import time; the cost
// estimator itself touches neither.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pg/db.pg", () => ({ pgDb: {} }));

const { estimateCostMicros } = await import("./budget");

const candidate = {
  inputPriceMicrosPerMillion: 1_000_000,
  outputPriceMicrosPerMillion: 4_000_000,
} as any;

describe("estimateCostMicros", () => {
  it("estimates on gross tokens when no cache breakdown is available", () => {
    // The pre-run reservation has no usage to read, so it must keep behaving
    // exactly as it did before cache weighting existed.
    expect(
      estimateCostMicros({
        inputTokens: 10_000,
        outputTokens: 1_000,
        candidate,
      }),
    ).toBe(10_000 + 4_000);
  });

  it("weighs cache reads the same way billing does", () => {
    // 9,000 read at 0.1 + 1,000 plain = 1,900 effective input tokens. A capped
    // member must not be charged against their allowance at a rate the
    // invoice never shows.
    expect(
      estimateCostMicros({
        inputTokens: 10_000,
        outputTokens: 1_000,
        candidate,
        cacheReadTokens: 9_000,
        noCacheTokens: 1_000,
      }),
    ).toBe(1_900 + 4_000);
  });

  it("charges the write premium, so caching is not free to create", () => {
    expect(
      estimateCostMicros({
        inputTokens: 10_000,
        outputTokens: 0,
        candidate,
        cacheWriteTokens: 8_000,
        noCacheTokens: 2_000,
      }),
    ).toBe(12_000);
  });
});
