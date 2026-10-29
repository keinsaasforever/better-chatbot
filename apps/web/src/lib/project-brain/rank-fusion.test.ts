import { describe, expect, it } from "vitest";
import { rrfFuse } from "./rank-fusion";

const item = (id: string) => ({ id });

describe("rrfFuse", () => {
  it("ranks items present in both lists above single-list items", () => {
    const fused = rrfFuse([
      [item("a"), item("b"), item("c")],
      [item("c"), item("d")],
    ]);

    expect(fused[0].item.id).toBe("c");
    expect(fused[0].hits).toBe(2);
    expect(fused.map((row) => row.item.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("applies per-list weights", () => {
    const fused = rrfFuse([[item("a")], [item("b")]], { weights: [1, 3] });

    expect(fused[0].item.id).toBe("b");
  });

  it("returns an empty list for no input", () => {
    expect(rrfFuse([])).toEqual([]);
    expect(rrfFuse([[], []])).toEqual([]);
  });
});
