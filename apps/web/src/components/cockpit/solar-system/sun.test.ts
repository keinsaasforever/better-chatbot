import { describe, expect, it } from "vitest";
import { createEjectaGeometry, createProminenceGeometry } from "./sun";

describe("prominence geometry", () => {
  it("builds one ribbon instance per loop strand with valid timing", () => {
    const g = createProminenceGeometry();
    const timing = g.getAttribute("aTiming");
    expect(g.instanceCount).toBe(timing.count);
    expect(g.instanceCount).toBeGreaterThan(0);
    for (let i = 0; i < timing.count; i++) {
      // Lifetime must be positive, or fract(t / life) in the shader is NaN.
      expect(timing.getX(i)).toBeGreaterThan(0);
      // Strand width scale must stay positive so no strand collapses.
      expect(timing.getW(i)).toBeGreaterThan(0);
    }
    // Ribbon runs footpoint to footpoint (s 0 → 1) with both edges.
    const s = g.getAttribute("aS");
    expect(s.getX(0)).toBe(0);
    expect(s.getX(s.count - 1)).toBe(1);
    expect(g.getIndex()?.count).toBe(((s.count - 2) / 2) * 6);
  });
});

describe("ejecta geometry", () => {
  it("gives every spark a positive lifetime", () => {
    const g = createEjectaGeometry();
    const spark = g.getAttribute("aSpark");
    for (let i = 0; i < spark.count; i++) {
      expect(spark.getY(i)).toBeGreaterThan(0);
    }
  });
});
