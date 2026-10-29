import { describe, expect, it } from "vitest";
import {
  PLANETS,
  centuriesSinceJ2000,
  createOrbit,
  eccentricAnomaly,
  meanAnomalyAt,
  positionAtMeanAnomaly,
} from "./orbits";

const planet = (key: string) => {
  const spec = PLANETS.find((p) => p.key === key);
  if (!spec) throw new Error(key);
  return spec;
};

describe("eccentricAnomaly", () => {
  it("solves Kepler's equation", () => {
    for (const e of [0, 0.0167, 0.2056, 0.6]) {
      for (const M of [0, 0.5, 2, 3.1, 5.9]) {
        const E = eccentricAnomaly(M, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(M, 9);
      }
    }
  });

  it("wraps negative and large mean anomalies", () => {
    const E = eccentricAnomaly(-1, 0.1);
    expect(E - 0.1 * Math.sin(E)).toBeCloseTo(2 * Math.PI - 1, 9);
  });
});

describe("planet orbits", () => {
  it("places J2000 at zero centuries", () => {
    expect(centuriesSinceJ2000(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(0, 6);
  });

  it("puts Earth at its real heliocentric longitude", () => {
    // 2024 March equinox: the Sun is at ecliptic longitude 0°, so Earth,
    // seen from the Sun, is at 180°.
    const orbit = createOrbit(
      planet("earth").elements,
      Date.UTC(2024, 2, 20, 3, 6),
    );
    const p = positionAtMeanAnomaly(orbit, meanAnomalyAt(orbit, 0), {
      x: 0,
      y: 0,
      z: 0,
    });
    // Scene frame: ecliptic x → x, ecliptic y → -z.
    const longitude = (Math.atan2(-p.z, p.x) * 180) / Math.PI;
    expect(Math.abs(Math.abs(longitude) - 180)).toBeLessThan(1);
  });

  it("follows the ellipse: Mercury's perihelion and aphelion", () => {
    const spec = planet("mercury");
    const orbit = createOrbit(spec.elements, Date.UTC(2026, 0, 1));
    const out = { x: 0, y: 0, z: 0 };
    const r = (M: number) => {
      positionAtMeanAnomaly(orbit, M, out);
      return Math.hypot(out.x, out.y, out.z);
    };
    const { a, e } = spec.elements;
    expect(r(0)).toBeCloseTo(a * (1 - e), 6);
    expect(r(Math.PI)).toBeCloseTo(a * (1 + e), 6);
  });

  it("tilts Mercury's orbit out of the ecliptic by its inclination", () => {
    const spec = planet("mercury");
    const orbit = createOrbit(spec.elements, Date.UTC(2026, 0, 1));
    const out = { x: 0, y: 0, z: 0 };
    let maxLat = 0;
    for (let k = 0; k < 720; k++) {
      positionAtMeanAnomaly(orbit, (k / 720) * Math.PI * 2, out);
      maxLat = Math.max(
        maxLat,
        Math.asin(out.y / Math.hypot(out.x, out.y, out.z)),
      );
    }
    expect((maxLat * 180) / Math.PI).toBeCloseTo(spec.elements.i, 1);
  });

  it("moves inner planets faster (Kepler's third law)", () => {
    const now = Date.UTC(2026, 0, 1);
    const mercury = createOrbit(planet("mercury").elements, now);
    const neptune = createOrbit(planet("neptune").elements, now);
    expect(mercury.n).toBeGreaterThan(neptune.n);
    const ratio = mercury.n / neptune.n;
    const expected =
      (planet("neptune").elements.a / planet("mercury").elements.a) ** 1.5;
    expect(ratio).toBeCloseTo(expected, 6);
  });
});
