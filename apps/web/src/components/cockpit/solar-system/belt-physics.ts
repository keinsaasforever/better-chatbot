/**
 * N-body-lite asteroid belt: every rock orbits the Sun under real inverse
 * square gravity, tumbles, and bounces off its neighbours.
 *
 * - Gravity: a = -GM·r/|r|³ toward the Sun, integrated with semi-implicit
 *   (symplectic) Euler at a fixed step so orbits neither decay nor gain energy.
 * - Collisions: spheres sized to each rock, found through a uniform grid on
 *   the ecliptic plane (O(n) per step), resolved with an impulse along the
 *   contact normal (restitution < 1, so a little energy is lost) plus a
 *   Coulomb friction impulse that converts sliding into spin.
 * - Spin: angular velocity per rock, integrated into a unit quaternion.
 *
 * Pure TypeScript on typed arrays (no three.js) so it can be unit-tested and
 * written straight into an InstancedMesh's matrices.
 */

export type BeltConfig = {
  count: number;
  innerRadius: number;
  outerRadius: number;
  /** Max orbital eccentricity handed out at spawn. */
  maxEccentricity: number;
  /** Max orbital inclination at spawn, radians. */
  maxInclination: number;
  minSize: number;
  maxSize: number;
  gm: number;
  restitution: number;
  friction: number;
  seed: number;
};

export type Random = () => number;

/** Deterministic PRNG so the belt is identical on every load. */
export function mulberry32(seed: number): Random {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class BeltSimulation {
  readonly count: number;
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  readonly radius: Float32Array;
  readonly quaternion: Float32Array;
  readonly angularVelocity: Float32Array;
  /** Running total, for tests and debugging. */
  collisions = 0;

  private readonly invMass: Float32Array;
  private readonly invInertia: Float32Array;
  private readonly gm: number;
  private readonly restitution: number;
  private readonly friction: number;
  // Uniform grid over the belt's bounding square (counting-sort layout).
  private readonly cellSize: number;
  private readonly gridDim: number;
  private readonly gridOrigin: number;
  private readonly cellOf: Int32Array;
  private readonly cellStart: Int32Array;
  private readonly cellBodies: Int32Array;

  constructor(config: BeltConfig, random: Random = mulberry32(config.seed)) {
    const n = config.count;
    this.count = n;
    this.gm = config.gm;
    this.restitution = config.restitution;
    this.friction = config.friction;
    this.position = new Float32Array(n * 3);
    this.velocity = new Float32Array(n * 3);
    this.radius = new Float32Array(n);
    this.quaternion = new Float32Array(n * 4);
    this.angularVelocity = new Float32Array(n * 3);
    this.invMass = new Float32Array(n);
    this.invInertia = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      // Size distribution skewed to small rocks, like a real belt.
      const size =
        config.minSize +
        (config.maxSize - config.minSize) * Math.pow(random(), 2.2);
      this.radius[i] = size;
      const mass = size * size * size;
      this.invMass[i] = 1 / mass;
      this.invInertia[i] = 1 / (0.4 * mass * size * size);

      // Spawn on a Keplerian orbit: semi-major axis, eccentricity,
      // inclination, node and phase, then place at that phase.
      const a =
        config.innerRadius +
        (config.outerRadius - config.innerRadius) * random();
      const e = config.maxEccentricity * random();
      const inc = config.maxInclination * (random() * 2 - 1);
      const node = random() * Math.PI * 2;
      const anomaly = random() * Math.PI * 2;
      const p = a * (1 - e * e);
      const r = p / (1 + e * Math.cos(anomaly));
      const peri = random() * Math.PI * 2;
      const theta = anomaly + peri;
      // Radial and transverse speed of a Kepler orbit at true anomaly.
      const h = Math.sqrt(config.gm * p);
      const vr = (config.gm / h) * e * Math.sin(anomaly);
      const vt = h / r;
      // In-plane position/velocity (prograde: +x toward -z).
      const cx = Math.cos(theta);
      const sx = Math.sin(theta);
      const lx = r * cx;
      const lz = -r * sx;
      const lvx = vr * cx - vt * sx;
      const lvz = -(vr * sx + vt * cx);
      // Tilt the orbital plane about the line of nodes.
      this.writeInclined(i, lx, lz, lvx, lvz, inc, node);

      // Random orientation and a slow random tumble.
      const u1 = random();
      const u2 = random() * Math.PI * 2;
      const u3 = random() * Math.PI * 2;
      const q = i * 4;
      this.quaternion[q] = Math.sqrt(1 - u1) * Math.sin(u2);
      this.quaternion[q + 1] = Math.sqrt(1 - u1) * Math.cos(u2);
      this.quaternion[q + 2] = Math.sqrt(u1) * Math.sin(u3);
      this.quaternion[q + 3] = Math.sqrt(u1) * Math.cos(u3);
      const w = i * 3;
      const spin = 0.15 + random() * 0.6;
      this.angularVelocity[w] = (random() * 2 - 1) * spin;
      this.angularVelocity[w + 1] = (random() * 2 - 1) * spin;
      this.angularVelocity[w + 2] = (random() * 2 - 1) * spin;
    }

    // Grid cells at least one rock diameter wide, so neighbours are always
    // within the 3×3 block around a rock's own cell; capped at 160² cells so
    // a wide, sparse belt does not pay for a huge grid every step.
    const extent = config.outerRadius * (1 + config.maxEccentricity) * 1.25;
    this.cellSize = Math.max(config.maxSize * 2.05, (extent * 2) / 160);
    this.gridOrigin = -extent;
    this.gridDim = Math.ceil((extent * 2) / this.cellSize) + 1;
    this.cellOf = new Int32Array(n);
    this.cellStart = new Int32Array(this.gridDim * this.gridDim + 1);
    this.cellBodies = new Int32Array(n);
  }

  private writeInclined(
    i: number,
    x: number,
    z: number,
    vx: number,
    vz: number,
    inc: number,
    node: number,
  ) {
    // Rodrigues rotation about the line of nodes k = (cos Ω, 0, -sin Ω).
    const kx = Math.cos(node);
    const kz = -Math.sin(node);
    const ci = Math.cos(inc);
    const si = Math.sin(inc);
    const rotate = (px: number, pz: number) => {
      const along = (px * kx + pz * kz) * (1 - ci);
      return [
        px * ci + kx * along,
        (kz * px - kx * pz) * si,
        pz * ci + kz * along,
      ];
    };
    const [px, py, pz] = rotate(x, z);
    const [qx, qy, qz] = rotate(vx, vz);
    const o = i * 3;
    this.position[o] = px;
    this.position[o + 1] = py;
    this.position[o + 2] = pz;
    this.velocity[o] = qx;
    this.velocity[o + 1] = qy;
    this.velocity[o + 2] = qz;
  }

  /** Advance by `dt` seconds. Keep dt ≲ 1/30 s for stable contacts. */
  step(dt: number) {
    const { position: p, velocity: v, gm } = this;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      const x = p[o];
      const y = p[o + 1];
      const z = p[o + 2];
      const r2 = x * x + y * y + z * z;
      const inv = gm / (r2 * Math.sqrt(r2));
      v[o] -= x * inv * dt;
      v[o + 1] -= y * inv * dt;
      v[o + 2] -= z * inv * dt;
      p[o] += v[o] * dt;
      p[o + 1] += v[o + 1] * dt;
      p[o + 2] += v[o + 2] * dt;
    }
    this.collide();
    this.spin(dt);
  }

  private collide() {
    const n = this.count;
    const dim = this.gridDim;
    const { cellOf, cellStart, cellBodies, position: p } = this;
    cellStart.fill(0);
    for (let i = 0; i < n; i++) {
      const cx = this.cellCoord(p[i * 3]);
      const cz = this.cellCoord(p[i * 3 + 2]);
      const c = cz * dim + cx;
      cellOf[i] = c;
      cellStart[c + 1]++;
    }
    for (let c = 0; c < dim * dim; c++) cellStart[c + 1] += cellStart[c];
    // Fill buckets; cellStart is restored by walking it back afterwards.
    for (let i = 0; i < n; i++) cellBodies[cellStart[cellOf[i]]++] = i;
    for (let c = dim * dim; c > 0; c--) cellStart[c] = cellStart[c - 1];
    cellStart[0] = 0;

    for (let i = 0; i < n; i++) {
      const c = cellOf[i];
      const cx = c % dim;
      const cz = (c - cx) / dim;
      for (let dz = -1; dz <= 1; dz++) {
        const z = cz + dz;
        if (z < 0 || z >= dim) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          if (x < 0 || x >= dim) continue;
          const cell = z * dim + x;
          for (let k = cellStart[cell]; k < cellStart[cell + 1]; k++) {
            const j = cellBodies[k];
            if (j > i) this.resolve(i, j);
          }
        }
      }
    }
  }

  private cellCoord(value: number): number {
    const c = Math.floor((value - this.gridOrigin) / this.cellSize);
    return c < 0 ? 0 : c >= this.gridDim ? this.gridDim - 1 : c;
  }

  private resolve(i: number, j: number) {
    const { position: p, velocity: v, angularVelocity: w } = this;
    const oi = i * 3;
    const oj = j * 3;
    let nx = p[oj] - p[oi];
    let ny = p[oj + 1] - p[oi + 1];
    let nz = p[oj + 2] - p[oi + 2];
    const ri = this.radius[i];
    const rj = this.radius[j];
    const reach = ri + rj;
    const d2 = nx * nx + ny * ny + nz * nz;
    if (d2 >= reach * reach || d2 === 0) return;
    const d = Math.sqrt(d2);
    nx /= d;
    ny /= d;
    nz /= d;

    const mi = this.invMass[i];
    const mj = this.invMass[j];
    const msum = mi + mj;

    // Push the pair apart so they never interpenetrate, heavier moves less.
    const overlap = reach - d;
    p[oi] -= nx * overlap * (mi / msum);
    p[oi + 1] -= ny * overlap * (mi / msum);
    p[oi + 2] -= nz * overlap * (mi / msum);
    p[oj] += nx * overlap * (mj / msum);
    p[oj + 1] += ny * overlap * (mj / msum);
    p[oj + 2] += nz * overlap * (mj / msum);

    // Relative velocity of j with respect to i.
    const rvx = v[oj] - v[oi];
    const rvy = v[oj + 1] - v[oi + 1];
    const rvz = v[oj + 2] - v[oi + 2];
    const vn = rvx * nx + rvy * ny + rvz * nz;
    if (vn >= 0) return; // already separating

    this.collisions++;
    const jn = (-(1 + this.restitution) * vn) / msum;
    v[oi] -= jn * mi * nx;
    v[oi + 1] -= jn * mi * ny;
    v[oi + 2] -= jn * mi * nz;
    v[oj] += jn * mj * nx;
    v[oj + 1] += jn * mj * ny;
    v[oj + 2] += jn * mj * nz;

    // Friction along the sliding direction; the torque sets them spinning.
    const tx = rvx - vn * nx;
    const ty = rvy - vn * ny;
    const tz = rvz - vn * nz;
    const vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (vt < 1e-9) return;
    const jt = Math.min(this.friction * jn, (vt / msum) * 0.5);
    const ux = tx / vt;
    const uy = ty / vt;
    const uz = tz / vt;
    v[oi] += jt * mi * ux;
    v[oi + 1] += jt * mi * uy;
    v[oi + 2] += jt * mi * uz;
    v[oj] -= jt * mj * ux;
    v[oj + 1] -= jt * mj * uy;
    v[oj + 2] -= jt * mj * uz;
    // Torque = contact arm × tangential impulse (n × u for both bodies).
    const cx = ny * uz - nz * uy;
    const cy = nz * ux - nx * uz;
    const cz = nx * uy - ny * ux;
    const ki = jt * ri * this.invInertia[i];
    const kj = jt * rj * this.invInertia[j];
    w[oi] += cx * ki;
    w[oi + 1] += cy * ki;
    w[oi + 2] += cz * ki;
    w[oj] += cx * kj;
    w[oj + 1] += cy * kj;
    w[oj + 2] += cz * kj;
  }

  private spin(dt: number) {
    const { quaternion: q, angularVelocity: w } = this;
    for (let i = 0; i < this.count; i++) {
      const o = i * 4;
      const a = i * 3;
      const wx = w[a] * 0.5 * dt;
      const wy = w[a + 1] * 0.5 * dt;
      const wz = w[a + 2] * 0.5 * dt;
      const x = q[o];
      const y = q[o + 1];
      const z = q[o + 2];
      const s = q[o + 3];
      // q += ½·(ω, 0)·q·dt, then renormalise.
      const nx = x + wx * s + wy * z - wz * y;
      const ny = y + wy * s + wz * x - wx * z;
      const nz = z + wz * s + wx * y - wy * x;
      const ns = s - wx * x - wy * y - wz * z;
      const len = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + ns * ns);
      q[o] = nx * len;
      q[o + 1] = ny * len;
      q[o + 2] = nz * len;
      q[o + 3] = ns * len;
    }
  }

  /** Orbital radius of rock `i` in the ecliptic plane. */
  radialDistance(i: number): number {
    return Math.hypot(this.position[i * 3], this.position[i * 3 + 2]);
  }

  /** Total kinetic + potential energy (for tests). */
  energy(): number {
    let e = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      const m = 1 / this.invMass[i];
      const v2 =
        this.velocity[o] ** 2 +
        this.velocity[o + 1] ** 2 +
        this.velocity[o + 2] ** 2;
      const r = Math.hypot(
        this.position[o],
        this.position[o + 1],
        this.position[o + 2],
      );
      e += m * (0.5 * v2 - this.gm / r);
    }
    return e;
  }
}
