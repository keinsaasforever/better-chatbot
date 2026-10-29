/**
 * Orbital mechanics for the cockpit solar system.
 *
 * Distances are compressed "display units" (the Sun's radius is ~1) so the
 * whole system fits a windshield, but everything that moves obeys one shared
 * gravity field: planets, asteroids and dust all orbit with Kepler's third law
 * for the same GM, so their relative speeds stay physically consistent.
 * Orbital shapes (eccentricity, inclination, node, perihelion) and starting
 * positions are real: elements from JPL's "Keplerian Elements for Approximate
 * Positions of the Major Planets" (J2000), advanced to the current date.
 *
 * Frame: three.js y-up. Ecliptic north is +y; prograde motion runs from +x
 * toward -z (counter-clockwise seen from the north).
 */

/** Sun's gravitational parameter in display units³/s² (Earth year ≈ 70 s). */
export const GM = 0.18;

export type OrbitalElements = {
  /** Display semi-major axis. */
  a: number;
  e: number;
  /** Inclination to the ecliptic, degrees. */
  i: number;
  /** Mean longitude at J2000, degrees. */
  L: number;
  /** Mean longitude rate, degrees per Julian century. */
  dL: number;
  /** Longitude of perihelion, degrees. */
  peri: number;
  /** Longitude of the ascending node, degrees. */
  node: number;
};

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

export function meanMotion(a: number, gm = GM): number {
  return Math.sqrt(gm / (a * a * a));
}

/** Kepler's equation M = E - e·sin(E), solved for E by Newton iteration. */
export function eccentricAnomaly(meanAnomaly: number, e: number): number {
  const M = ((meanAnomaly % TAU) + TAU) % TAU;
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 8; k++) {
    const f = E - e * Math.sin(E) - M;
    E -= f / (1 - e * Math.cos(E));
    if (Math.abs(f) < 1e-10) break;
  }
  return E;
}

/** Julian centuries since J2000 for a JS timestamp. */
export function centuriesSinceJ2000(ms: number): number {
  return (ms / 86_400_000 + 2_440_587.5 - 2_451_545.0) / 36_525;
}

export type Orbit = {
  elements: OrbitalElements;
  /** Mean anomaly (radians) at simulation time zero. */
  m0: number;
  /** Mean motion in the shared display gravity field, rad/s. */
  n: number;
  /** Rotation from the orbital plane into the scene frame (row-major 3×2). */
  basis: [number, number, number, number, number, number];
};

export function createOrbit(elements: OrbitalElements, nowMs: number): Orbit {
  const T = centuriesSinceJ2000(nowMs);
  const L = elements.L + elements.dL * T;
  const w = (elements.peri - elements.node) * DEG; // argument of perihelion
  const O = elements.node * DEG;
  const I = elements.i * DEG;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const cO = Math.cos(O);
  const sO = Math.sin(O);
  const cI = Math.cos(I);
  const sI = Math.sin(I);
  // Ecliptic (x, y, z-north) components of the orbital-plane axes.
  const ex = [cw * cO - sw * sO * cI, cw * sO + sw * cO * cI, sw * sI];
  const ey = [-sw * cO - cw * sO * cI, -sw * sO + cw * cO * cI, cw * sI];
  // Ecliptic → scene: (x, y, z) → (x, z, -y).
  return {
    elements,
    m0: (L - elements.peri) * DEG,
    n: meanMotion(elements.a),
    basis: [ex[0], ey[0], ex[2], ey[2], -ex[1], -ey[1]],
  };
}

/**
 * Writes the position at mean anomaly `M` into `out` and returns it. Takes
 * an explicit anomaly so orbit lines and moving bodies share one code path.
 */
export function positionAtMeanAnomaly(
  orbit: Orbit,
  M: number,
  out: { x: number; y: number; z: number },
) {
  const { a, e } = orbit.elements;
  const E = eccentricAnomaly(M, e);
  const px = a * (Math.cos(E) - e);
  const py = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const b = orbit.basis;
  out.x = b[0] * px + b[1] * py;
  out.y = b[2] * px + b[3] * py;
  out.z = b[4] * px + b[5] * py;
  return out;
}

export function meanAnomalyAt(orbit: Orbit, seconds: number): number {
  return orbit.m0 + orbit.n * seconds;
}

/**
 * Planets: real e/i/node/perihelion/mean longitude (JPL J2000, valid
 * 1800-2050), compressed semi-major axes, real radii ratios softened so
 * Mercury stays visible next to Jupiter. Tilt is obliquity in degrees
 * (>90 = retrograde spin), day is the sidereal rotation period in hours.
 */
export type PlanetSpec = {
  key: string;
  elements: OrbitalElements;
  radius: number;
  tilt: number;
  dayHours: number;
  /** Atmosphere rim colour, or null for airless bodies. */
  atmosphere: [number, number, number] | null;
  /** Orbit line tint. */
  orbitColor: [number, number, number];
  bumpScale: number;
};

export const PLANETS: PlanetSpec[] = [
  {
    key: "mercury",
    elements: {
      a: 1.75,
      e: 0.20563593,
      i: 7.00497902,
      L: 252.2503235,
      dL: 149472.67411175,
      peri: 77.45779628,
      node: 48.33076593,
    },
    radius: 0.065,
    tilt: 0.03,
    dayHours: 1407.6,
    atmosphere: null,
    orbitColor: [0.75, 0.7, 0.65],
    bumpScale: 2.2,
  },
  {
    key: "venus",
    elements: {
      a: 2.3,
      e: 0.00677672,
      i: 3.39467605,
      L: 181.9790995,
      dL: 58517.81538729,
      peri: 131.60246718,
      node: 76.67984255,
    },
    radius: 0.13,
    tilt: 177.4,
    dayHours: 5832.5,
    atmosphere: [1.0, 0.86, 0.6],
    orbitColor: [1.0, 0.85, 0.55],
    bumpScale: 0,
  },
  {
    key: "earth",
    elements: {
      a: 2.9,
      e: 0.01671123,
      i: -0.00001531,
      L: 100.46457166,
      dL: 35999.37244981,
      peri: 102.93768193,
      node: 0,
    },
    radius: 0.14,
    tilt: 23.44,
    dayHours: 23.93,
    atmosphere: [0.35, 0.62, 1.0],
    orbitColor: [0.45, 0.7, 1.0],
    bumpScale: 1.4,
  },
  {
    key: "mars",
    elements: {
      a: 3.55,
      e: 0.0933941,
      i: 1.84969142,
      L: -4.55343205,
      dL: 19140.30268499,
      peri: -23.94362959,
      node: 49.55953891,
    },
    radius: 0.09,
    tilt: 25.19,
    dayHours: 24.62,
    atmosphere: [1.0, 0.6, 0.42],
    orbitColor: [1.0, 0.5, 0.35],
    bumpScale: 1.8,
  },
  {
    key: "jupiter",
    elements: {
      a: 6.0,
      e: 0.04838624,
      i: 1.30439695,
      L: 34.39644051,
      dL: 3034.74612775,
      peri: 14.72847983,
      node: 100.47390909,
    },
    radius: 0.42,
    tilt: 3.13,
    dayHours: 9.93,
    atmosphere: [0.95, 0.85, 0.7],
    orbitColor: [0.95, 0.78, 0.6],
    bumpScale: 0,
  },
  {
    key: "saturn",
    elements: {
      a: 7.5,
      e: 0.05386179,
      i: 2.48599187,
      L: 49.95424423,
      dL: 1222.49362201,
      peri: 92.59887831,
      node: 113.66242448,
    },
    radius: 0.35,
    tilt: 26.73,
    dayHours: 10.66,
    atmosphere: [1.0, 0.9, 0.7],
    orbitColor: [0.95, 0.88, 0.65],
    bumpScale: 0,
  },
  {
    key: "uranus",
    elements: {
      a: 8.9,
      e: 0.04725744,
      i: 0.77263783,
      L: 313.23810451,
      dL: 428.48202785,
      peri: 170.9542763,
      node: 74.01692503,
    },
    radius: 0.22,
    tilt: 97.77,
    dayHours: 17.24,
    atmosphere: [0.6, 0.9, 0.95],
    orbitColor: [0.55, 0.85, 0.9],
    bumpScale: 0,
  },
  {
    key: "neptune",
    elements: {
      a: 10.1,
      e: 0.00859048,
      i: 1.77004347,
      L: -55.12002969,
      dL: 218.45945325,
      peri: 44.96476227,
      node: 131.78422574,
    },
    radius: 0.21,
    tilt: 28.32,
    dayHours: 16.11,
    atmosphere: [0.35, 0.55, 1.0],
    orbitColor: [0.35, 0.5, 1.0],
    bumpScale: 0,
  },
];

/** Main belt between Mars and Jupiter, Kuiper belt beyond Neptune. */
export const MAIN_BELT = { inner: 4.15, outer: 5.0 };
export const KUIPER_BELT = { inner: 11.0, outer: 12.8 };

/** Real-time seconds per sidereal hour of planetary spin. */
export const SPIN_SECONDS_PER_HOUR = 2.4;
