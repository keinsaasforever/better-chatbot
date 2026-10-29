import { describe, expect, test } from "vitest";
import {
  PROJECT_BRAIN_EXTRACTION_MAX_MS,
  PROJECT_BRAIN_RUN_BUDGET_MS,
  ProjectBrainBudgetError,
  assertRunBudgetRemaining,
  extractionTimeoutMs,
  remainingRunBudgetMs,
} from "./run-budget";

const NOW = Date.parse("2026-08-11T05:15:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("run budget", () => {
  test("stays below the Inngest finish timeout so we fail in-band first", () => {
    // timeouts.finish is 15m; the budget must leave room to settle the row.
    expect(PROJECT_BRAIN_RUN_BUDGET_MS).toBeLessThan(15 * 60_000);
  });

  test("reports the remaining budget from the anchor", () => {
    expect(remainingRunBudgetMs(ago(60_000), NOW)).toBe(
      PROJECT_BRAIN_RUN_BUDGET_MS - 60_000,
    );
  });

  test("grants the full budget when the anchor is unusable", () => {
    expect(remainingRunBudgetMs(null, NOW)).toBe(PROJECT_BRAIN_RUN_BUDGET_MS);
    expect(remainingRunBudgetMs("not-a-date", NOW)).toBe(
      PROJECT_BRAIN_RUN_BUDGET_MS,
    );
  });

  test("accepts Date objects as well as replayed ISO strings", () => {
    expect(remainingRunBudgetMs(new Date(NOW - 60_000), NOW)).toBe(
      PROJECT_BRAIN_RUN_BUDGET_MS - 60_000,
    );
  });

  test("assert passes while budget remains", () => {
    expect(assertRunBudgetRemaining(ago(60_000), "extracting", NOW)).toBe(
      PROJECT_BRAIN_RUN_BUDGET_MS - 60_000,
    );
  });

  test("assert throws once the budget is spent", () => {
    // The real-world case: load-source retried for 12+ minutes, leaving
    // nothing for extraction. Fail here rather than get cancelled mid-flight.
    const anchor = ago(PROJECT_BRAIN_RUN_BUDGET_MS + 1_000);

    expect(() => assertRunBudgetRemaining(anchor, "extracting", NOW)).toThrow(
      ProjectBrainBudgetError,
    );
    try {
      assertRunBudgetRemaining(anchor, "extracting", NOW);
    } catch (error) {
      expect((error as ProjectBrainBudgetError).code).toBe("budget_exhausted");
      expect((error as Error).message).toContain("extracting");
    }
  });

  test("extraction is capped by its own ceiling and by what is left", () => {
    expect(extractionTimeoutMs(10 * 60_000)).toBe(
      PROJECT_BRAIN_EXTRACTION_MAX_MS,
    );
    expect(extractionTimeoutMs(30_000)).toBe(30_000);
    // Never hand AbortSignal.timeout a zero or negative delay.
    expect(extractionTimeoutMs(0)).toBeGreaterThan(0);
    expect(extractionTimeoutMs(-5_000)).toBeGreaterThan(0);
  });
});
