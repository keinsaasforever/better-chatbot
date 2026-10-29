import { describe, expect, it } from "vitest";
import { computeForceLayout } from "./graph-layout";

describe("computeForceLayout", () => {
  it("returns a finite position for every node and pins the hub at the centre", () => {
    const nodes = [
      { id: "hub", isHub: true, size: 0 },
      { id: "a", size: 1 },
      { id: "b", size: 2 },
      { id: "c", size: 0 },
    ];
    const edges = [
      { source: "a", target: "b" },
      { source: "hub", target: "c", virtual: true },
    ];

    const positions = computeForceLayout(nodes, edges, {
      width: 1000,
      height: 600,
    });

    expect(positions.size).toBe(4);
    for (const position of positions.values()) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
    expect(positions.get("hub")).toEqual({ x: 500, y: 300 });
  });

  it("keeps linked nodes closer than unlinked ones", () => {
    const nodes = [
      { id: "a", size: 1 },
      { id: "b", size: 1 },
      { id: "far", size: 1 },
    ];
    const positions = computeForceLayout(
      nodes,
      [{ source: "a", target: "b" }],
      { width: 0, height: 0 },
    );
    const distance = (p: string, q: string) => {
      const a = positions.get(p)!;
      const b = positions.get(q)!;
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    expect(distance("a", "b")).toBeLessThan(distance("a", "far"));
  });

  it("ignores edges that reference unknown nodes", () => {
    const positions = computeForceLayout(
      [{ id: "a", size: 0 }],
      [{ source: "a", target: "ghost" }],
    );
    expect(positions.size).toBe(1);
  });
});
