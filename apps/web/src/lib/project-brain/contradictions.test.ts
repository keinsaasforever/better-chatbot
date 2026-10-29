import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pg/db.pg", () => ({ pgDb: {} }));
vi.mock("@/lib/ai/models", () => ({
  projectBrainModelId: "test",
  customModelProvider: { getModel: () => "test" },
}));

const { limitCandidatesPerKey } = await import("./contradictions");

const candidate = (page: string, key: string, index: number) => ({
  aId: `${page}-${key}-a${index}`,
  bId: `${page}-${key}-b${index}`,
  pageId: page,
  pageTitle: page,
  factKey: key,
  aValue: "x",
  bValue: "y",
  aScope: "tool:1",
  bScope: "document:2",
  aObservedAt: "2026-09-01T00:00:00.000Z",
  bObservedAt: "2026-09-02T00:00:00.000Z",
});

describe("limitCandidatesPerKey", () => {
  it("keeps at most N pairs per page and fact key, preserving order", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => candidate("p1", "status", i)),
      candidate("p1", "owner", 0),
      candidate("p2", "status", 0),
    ];

    const limited = limitCandidatesPerKey(rows, 3);

    expect(limited).toHaveLength(5);
    expect(
      limited.filter((row) => row.factKey === "status" && row.pageId === "p1"),
    ).toHaveLength(3);
    expect(limited[0].aId).toBe("p1-status-a0");
  });
});
