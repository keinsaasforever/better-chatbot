import * as THREE from "three";
import { ImprovedNoise } from "three/examples/jsm/math/ImprovedNoise.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "./belt-physics";

const noise = new ImprovedNoise();

function fbm(x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise.noise(x * freq, y * freq, z * freq);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

/**
 * An irregular, cratered rock of unit-ish radius: an icosphere stretched into
 * a potato, displaced with fractal noise, with bowl-shaped craters carved in.
 * Positions are displaced as a function of direction only, so the faces of
 * the (non-indexed) icosphere stay watertight; creased normals keep sharp
 * ridges sharp and smooth the rest.
 */
export function createRockGeometry(seed: number, detail: number) {
  const random = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const stretch = new THREE.Vector3(
    1,
    0.62 + random() * 0.3,
    0.5 + random() * 0.32,
  );
  const offset = new THREE.Vector3(random(), random(), random()).multiplyScalar(
    100,
  );
  const craters = Array.from({ length: 3 + Math.floor(random() * 4) }, () => ({
    dir: new THREE.Vector3(
      random() * 2 - 1,
      random() * 2 - 1,
      random() * 2 - 1,
    ).normalize(),
    size: 0.25 + random() * 0.35,
    depth: 0.08 + random() * 0.12,
  }));
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r =
      1 +
      0.32 * fbm(v.x * 1.3 + offset.x, v.y * 1.3 + offset.y, v.z * 1.3, 3) +
      0.06 * fbm(v.x * 5 + offset.z, v.y * 5, v.z * 5 + offset.x, 2);
    for (const c of craters) {
      const d = Math.acos(Math.min(1, v.dot(c.dir))) / c.size;
      if (d < 1.25) {
        // Bowl with a raised rim.
        r +=
          d < 1
            ? -c.depth * (1 - d * d)
            : c.depth * 0.3 * Math.sin(((d - 1) / 0.25) * Math.PI);
      }
    }
    v.multiplyScalar(r).multiply(stretch);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  const creased = toCreasedNormals(g, Math.PI / 3.2);
  g.dispose();
  creased.computeBoundingSphere();
  return creased;
}

/**
 * Greyscale regolith height map for the rocks' bump map: fractal noise plus
 * a scatter of small craters, wrapped horizontally so the UV seam is clean.
 */
export function createRegolithBumpTexture(width = 256, height = 128) {
  const random = mulberry32(4242);
  const data = new Uint8Array(width * height * 4);
  const field = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sample on a cylinder so the left and right edges meet seamlessly.
      const a = (x / width) * Math.PI * 2;
      const nx = Math.cos(a) * 2;
      const nz = Math.sin(a) * 2;
      const ny = (y / height) * 4;
      field[y * width + x] = fbm(nx * 2, ny * 2, nz * 2, 5);
    }
  }
  for (let k = 0; k < 140; k++) {
    const cx = random() * width;
    const cy = random() * height;
    const rad = 1.5 + Math.pow(random(), 3) * 9;
    for (
      let y = Math.max(0, Math.floor(cy - rad * 1.4));
      y < Math.min(height, cy + rad * 1.4);
      y++
    ) {
      for (let dx = -Math.ceil(rad * 1.4); dx <= rad * 1.4; dx++) {
        const x = (Math.floor(cx) + dx + width) % width;
        const d = Math.hypot(dx + Math.floor(cx) - cx, y - cy) / rad;
        if (d < 1) field[y * width + x] -= 0.35 * (1 - d * d);
        else if (d < 1.4) field[y * width + x] += 0.18 * (1.4 - d) * 2.5;
      }
    }
  }
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const f of field) {
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  for (let i = 0; i < field.length; i++) {
    const value = Math.round(((field[i] - lo) / (hi - lo)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.wrapS = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/** Uranus' rings: a few thin, dark, narrow bands (radial strip, inner→outer). */
export function createUranusRingTexture() {
  const width = 256;
  const data = new Uint8Array(width * 4);
  // Approximate radii of rings 6,5,4,α,β,η,γ,δ,ε normalised across the system.
  const rings = [0.02, 0.06, 0.1, 0.3, 0.4, 0.55, 0.62, 0.7, 0.96];
  for (let x = 0; x < width; x++) {
    const u = x / (width - 1);
    let a = 0;
    for (const r of rings) {
      const w = r === 0.96 ? 0.025 : 0.008;
      a = Math.max(a, Math.exp(-(((u - r) / w) ** 2)));
    }
    data[x * 4] = 190;
    data[x * 4 + 1] = 200;
    data[x * 4 + 2] = 210;
    data[x * 4 + 3] = Math.round(a * 70);
  }
  const texture = new THREE.DataTexture(data, width, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** A ring geometry in the XZ plane whose u coordinate runs inner→outer edge. */
export function createRingGeometry(inner: number, outer: number) {
  const g = new THREE.RingGeometry(inner, outer, 192, 1);
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  g.rotateX(-Math.PI / 2);
  return g;
}
