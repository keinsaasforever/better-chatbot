import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getUserStats` issues three selects: counts, the top-ten model split, and the
 * token total. Only the third is a plain (ungrouped) aggregate, so the mock
 * hands back a different result per call in that order — which is exactly the
 * distinction the bug turned on: the total used to be reduced from the
 * ten-model list, so anyone using more than ten models saw a subtotal labelled
 * as their total.
 */
const h = vi.hoisted(() => ({
  results: [] as unknown[][],
  calls: 0,
  fail: false,
}));

function nextResult() {
  if (h.fail) throw new Error("connection reset");
  const result = h.results[h.calls] ?? [];
  h.calls += 1;
  return Promise.resolve(result);
}

vi.mock("../db.pg", () => {
  const query: any = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    groupBy: () => query,
    orderBy: () => query,
    limit: () => nextResult(),
    then: (resolve: (value: unknown) => unknown) => nextResult().then(resolve),
  };
  return { pgDb: { select: () => query } };
});

const { pgUserRepository } = await import("./user-repository.pg");

const TWELVE_MODELS = Array.from({ length: 12 }, (_, i) => ({
  model: `model-${i}`,
  messageCount: 1,
  totalTokens: 100,
}));

beforeEach(() => {
  h.results = [];
  h.calls = 0;
  h.fail = false;
});

describe("getUserStats totals", () => {
  it("reports the full token total, not the sum of the displayed models", async () => {
    h.results = [
      [{ threadCount: 3, messageCount: 42 }],
      TWELVE_MODELS.slice(0, 10),
      [{ totalTokens: 1200 }],
    ];

    const stats = await pgUserRepository.getUserStats("user-1");

    expect(stats.modelStats).toHaveLength(10);
    // The ten listed models only account for 1000 of the 1200.
    expect(stats.totalTokens).toBe(1200);
    expect(stats.threadCount).toBe(3);
    expect(stats.messageCount).toBe(42);
  });

  it("returns empty stats instead of throwing when a query fails", async () => {
    h.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});

    const stats = await pgUserRepository.getUserStats("user-1");

    expect(stats).toMatchObject({
      threadCount: 0,
      messageCount: 0,
      modelStats: [],
      totalTokens: 0,
    });
  });
});
