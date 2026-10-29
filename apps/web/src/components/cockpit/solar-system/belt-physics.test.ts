import { describe, expect, it } from "vitest";
import { type BeltConfig, BeltSimulation } from "./belt-physics";

const BASE: BeltConfig = {
  count: 2,
  innerRadius: 4,
  outerRadius: 4,
  maxEccentricity: 0,
  maxInclination: 0,
  minSize: 0.05,
  maxSize: 0.05,
  gm: 0.18,
  restitution: 0.6,
  friction: 0.3,
  seed: 1,
};

/** Place two rocks head-on, far from the Sun's influence (gm = 0). */
function headOn(vA: number, vB: number, gap: number) {
  const sim = new BeltSimulation({ ...BASE, gm: 0 });
  sim.position.set([4 - gap / 2, 0, 0, 4 + gap / 2, 0, 0]);
  sim.velocity.set([vA, 0, 0, vB, 0, 0]);
  sim.angularVelocity.fill(0);
  return sim;
}

function momentumX(sim: BeltSimulation) {
  // Equal sizes → equal masses, so momentum is proportional to Σv.
  return sim.velocity[0] + sim.velocity[3];
}

describe("BeltSimulation collisions", () => {
  it("bounces approaching rocks apart, conserving momentum and losing energy", () => {
    // Overlapping (gap 0.09 < 2 × 0.05) and closing at 0.2 units/s.
    const sim = headOn(0.1, -0.1, 0.09);
    const before = momentumX(sim);
    sim.step(1 / 60);

    expect(sim.collisions).toBe(1);
    // Separating afterwards, with restitution 0.6 of the closing speed.
    expect(sim.velocity[3] - sim.velocity[0]).toBeCloseTo(0.2 * 0.6, 5);
    expect(momentumX(sim)).toBeCloseTo(before, 6);
    // Pushed out of overlap.
    expect(sim.position[3] - sim.position[0]).toBeGreaterThanOrEqual(
      0.1 - 1e-6,
    );
  });

  it("does not bounce rocks that are already separating", () => {
    const sim = headOn(-0.1, 0.1, 0.09);
    sim.step(1 / 60);
    expect(sim.collisions).toBe(0);
    expect(sim.velocity[0]).toBeCloseTo(-0.1, 6);
    expect(sim.velocity[3]).toBeCloseTo(0.1, 6);
  });

  it("turns a glancing blow into spin", () => {
    const sim = headOn(0.1, -0.1, 0.09);
    // Add sliding along z: friction should set both rocks spinning.
    sim.velocity[2] = 0.05;
    sim.velocity[5] = -0.05;
    sim.step(1 / 60);
    const spin = Math.hypot(
      sim.angularVelocity[0],
      sim.angularVelocity[1],
      sim.angularVelocity[2],
    );
    expect(spin).toBeGreaterThan(0);
  });
});

describe("BeltSimulation orbits", () => {
  it("keeps a lone rock on a stable circular orbit", () => {
    const sim = new BeltSimulation({ ...BASE, count: 1 });
    const r0 = sim.radialDistance(0);
    const e0 = sim.energy();
    // One full orbit at r = 4: T = 2π·sqrt(r³/GM) ≈ 118 s.
    for (let k = 0; k < 60 * 120; k++) sim.step(1 / 60);
    expect(sim.radialDistance(0)).toBeCloseTo(r0, 2);
    expect(Math.abs((sim.energy() - e0) / e0)).toBeLessThan(1e-3);
  });

  it("keeps a colliding belt bounded", () => {
    const sim = new BeltSimulation({
      ...BASE,
      count: 400,
      innerRadius: 4.15,
      outerRadius: 5,
      maxEccentricity: 0.06,
      maxInclination: 0.05,
      minSize: 0.006,
      maxSize: 0.026,
    });
    for (let k = 0; k < 60 * 90; k++) sim.step(1 / 60);
    expect(sim.collisions).toBeGreaterThan(0);
    for (let i = 0; i < sim.count; i++) {
      const r = sim.radialDistance(i);
      expect(r).toBeGreaterThan(3);
      expect(r).toBeLessThan(6.5);
    }
  });

  it("is deterministic for a seed", () => {
    const a = new BeltSimulation({ ...BASE, count: 50, outerRadius: 5 });
    const b = new BeltSimulation({ ...BASE, count: 50, outerRadius: 5 });
    expect(Array.from(a.position)).toEqual(Array.from(b.position));
  });
});
