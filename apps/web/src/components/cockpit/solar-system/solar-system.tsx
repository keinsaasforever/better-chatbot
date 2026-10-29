"use client";

import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import { type BeltConfig, BeltSimulation, mulberry32 } from "./belt-physics";
import { sceneTime } from "./clock";
import {
  GM,
  KUIPER_BELT,
  MAIN_BELT,
  type Orbit,
  PLANETS,
  type PlanetSpec,
  SPIN_SECONDS_PER_HOUR,
  createOrbit,
  meanAnomalyAt,
  positionAtMeanAnomaly,
} from "./orbits";
import {
  createRegolithBumpTexture,
  createRingGeometry,
  createRockGeometry,
  createUranusRingTexture,
} from "./procedural";
import { OCCLUDER_LAYER } from "./selective-bloom";
import { Sun, sunWorld } from "./sun";

/**
 * The solar system seen from a ship parked in its own orbit just outside
 * Jupiter's: the Sun ahead with a selectively bloomed corona, planets on
 * their real elliptical orbits (with fading orbit trails), a main belt of
 * tumbling, colliding rocks and a sparse Kuiper belt, both dusted with
 * subtle particles, all over the Milky Way.
 *
 * Adapted from bobbyroe/solar-system (MIT): sun/corona + fresnel rims,
 * instanced asteroid belt, ecliptic orbit lines, starfield.
 */

const TEXTURES = "/cockpit/solar-system";
/** Ship's own orbital radius and height above the ecliptic (display units). */
export const SHIP_ORBIT = { radius: 6.8, height: 1.45 };

type Vec3 = { x: number; y: number; z: number };

// --- Planets -------------------------------------------------------------------

const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const atmosphereFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSun;
  uniform float uStrength;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 l = normalize(uSun - vWorld);
    // Fresnel rim, lit only on the day side and a little past the terminator
    // (light scattering through the limb).
    float rim = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.6);
    float day = smoothstep(-0.3, 0.45, dot(n, l));
    gl_FragColor = vec4(uColor * rim * day * uStrength, 1.0);
  }
`;

function Atmosphere({
  color,
  scale,
  strength,
}: {
  color: [number, number, number];
  scale: number;
  strength: number;
}) {
  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(...color) },
      uSun: { value: sunWorld },
      uStrength: { value: strength },
    }),
    [color, strength],
  );
  return (
    <mesh scale={scale}>
      <sphereGeometry args={[1, 64, 32]} />
      <shaderMaterial
        vertexShader={atmosphereVertex}
        fragmentShader={atmosphereFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

type PlanetTextures = Record<string, THREE.Texture>;

function Planet({
  spec,
  textures,
  animate,
  orbit,
  children,
}: {
  spec: PlanetSpec;
  textures: PlanetTextures;
  animate: boolean;
  orbit: Orbit;
  children?: ReactNode;
}) {
  const body = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Mesh>(null);
  const clouds = useRef<THREE.Mesh>(null);
  const position = useRef<Vec3>({ x: 0, y: 0, z: 0 });
  const spinRate = (Math.PI * 2) / (spec.dayHours * SPIN_SECONDS_PER_HOUR);

  useLayoutEffect(() => {
    spin.current?.layers.enable(OCCLUDER_LAYER);
  }, []);

  useFrame((state) => {
    const t = sceneTime(state, animate);
    const p = positionAtMeanAnomaly(
      orbit,
      meanAnomalyAt(orbit, t),
      position.current,
    );
    body.current?.position.set(p.x, p.y, p.z);
    if (spin.current) spin.current.rotation.y = t * spinRate + 1.3;
    if (clouds.current) clouds.current.rotation.y = t * spinRate * 1.12 + 1.3;
  });

  const map = textures[spec.key];
  const bump = textures[`${spec.key}-bump`];
  const isEarth = spec.key === "earth";

  return (
    <group ref={body}>
      {/* Obliquity: the spin axis keeps its direction in space all year. */}
      <group rotation-x={(spec.tilt * Math.PI) / 180}>
        <mesh ref={spin} scale={spec.radius}>
          <sphereGeometry args={[1, 96, 64]} />
          <meshStandardMaterial
            map={map}
            bumpMap={bump ?? null}
            bumpScale={spec.bumpScale}
            roughness={1}
            roughnessMap={isEarth ? textures["earth-roughness"] : null}
            metalness={0}
            envMapIntensity={0}
          />
        </mesh>
        {isEarth && (
          <mesh ref={clouds} scale={spec.radius * 1.012}>
            <sphereGeometry args={[1, 96, 64]} />
            <meshStandardMaterial
              color="#ffffff"
              alphaMap={textures["earth-clouds"]}
              transparent
              depthWrite={false}
              roughness={1}
              metalness={0}
              envMapIntensity={0}
            />
          </mesh>
        )}
        {spec.atmosphere && (
          <Atmosphere
            color={spec.atmosphere}
            scale={spec.radius * (isEarth ? 1.06 : 1.035)}
            strength={isEarth ? 1.5 : 0.9}
          />
        )}
        {spec.key === "saturn" && (
          <SaturnRings radius={spec.radius} map={textures["saturn-ring"]} />
        )}
        {spec.key === "uranus" && <UranusRings radius={spec.radius} />}
      </group>
      {children}
    </group>
  );
}

function SaturnRings({ radius, map }: { radius: number; map: THREE.Texture }) {
  // C ring inner edge to A ring outer edge, in Saturn radii.
  const geometry = useMemo(
    () => createRingGeometry(radius * 1.24, radius * 2.27),
    [radius],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        map={map}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        roughness={1}
        metalness={0}
        envMapIntensity={0}
      />
    </mesh>
  );
}

function UranusRings({ radius }: { radius: number }) {
  const geometry = useMemo(
    () => createRingGeometry(radius * 1.64, radius * 2.0),
    [radius],
  );
  const texture = useMemo(() => createUranusRingTexture(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
    },
    [geometry, texture],
  );
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        map={texture}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
        roughness={1}
        metalness={0}
        envMapIntensity={0}
      />
    </mesh>
  );
}

function Moon({
  map,
  bump,
  animate,
}: {
  map: THREE.Texture;
  bump: THREE.Texture;
  animate: boolean;
}) {
  const pivot = useRef<THREE.Group>(null);
  const mesh = useRef<THREE.Mesh>(null);
  useLayoutEffect(() => {
    mesh.current?.layers.enable(OCCLUDER_LAYER);
  }, []);
  useFrame((state) => {
    // Tidally locked: rotating the pivot keeps the same face toward Earth.
    if (pivot.current)
      pivot.current.rotation.y = sceneTime(state, animate) * 0.26 + 2;
  });
  return (
    // Lunar orbit is inclined ~5.1° to the ecliptic.
    <group rotation-z={0.089}>
      <group ref={pivot}>
        <mesh ref={mesh} position-x={0.34} scale={0.038}>
          <sphereGeometry args={[1, 64, 32]} />
          <meshStandardMaterial
            map={map}
            bumpMap={bump}
            bumpScale={2.4}
            roughness={1}
            metalness={0}
            envMapIntensity={0}
          />
        </mesh>
      </group>
    </group>
  );
}

// --- Orbit lines ------------------------------------------------------------------

const orbitVertex = /* glsl */ `
  attribute float aPhase;
  uniform float uPhase;
  uniform float uGap;
  varying float vAlpha;
  void main() {
    // 0 at the planet, growing behind it: a comet-like fading trail plus a
    // faint full ellipse so the whole orbit stays readable.
    float behind = fract(uPhase - aPhase);
    vAlpha = 0.07 + 0.6 * pow(1.0 - behind, 5.0);
    // Open a gap at the planet so the line never draws across its disc.
    float near = min(behind, 1.0 - behind);
    vAlpha *= smoothstep(uGap, uGap * 2.5, near);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const orbitFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor * vAlpha, 1.0);
  }
`;

function OrbitPath({
  orbit,
  color,
  bodyRadius,
  animate,
}: {
  orbit: Orbit;
  color: [number, number, number];
  bodyRadius: number;
  animate: boolean;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const segments = 512;
    const positions = new Float32Array(segments * 3);
    const phases = new Float32Array(segments);
    const p = { x: 0, y: 0, z: 0 };
    const { e } = orbit.elements;
    for (let s = 0; s < segments; s++) {
      // Sample evenly in eccentric anomaly (smooth at perihelion), store the
      // matching mean anomaly so the trail follows the planet's real pace.
      const E = (s / segments) * Math.PI * 2;
      const M = E - e * Math.sin(E);
      positionAtMeanAnomaly(orbit, M, p);
      positions.set([p.x, p.y, p.z], s * 3);
      phases[s] = M / (Math.PI * 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    return g;
  }, [orbit]);
  const uniforms = useMemo(
    () => ({
      uPhase: { value: 0 },
      uColor: { value: new THREE.Color(...color) },
      // Fraction of the orbit covered by the body (plus rings), as a phase.
      uGap: {
        value: (bodyRadius * 1.4) / (Math.PI * 2 * orbit.elements.a),
      },
    }),
    [color, bodyRadius, orbit],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (!material.current) return;
    const M = meanAnomalyAt(orbit, sceneTime(state, animate));
    const phase = M / (Math.PI * 2);
    material.current.uniforms.uPhase.value = phase - Math.floor(phase);
  });

  return (
    <lineLoop geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={orbitVertex}
        fragmentShader={orbitFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineLoop>
  );
}

// --- Asteroid belts ---------------------------------------------------------------

type RockPalette = { color: [number, number, number]; weight: number }[];

const MAIN_BELT_PALETTE: RockPalette = [
  { color: [0.2, 0.195, 0.19], weight: 0.72 }, // C-type: carbonaceous, dark
  { color: [0.38, 0.32, 0.25], weight: 0.2 }, // S-type: silicate, brownish
  { color: [0.4, 0.4, 0.42], weight: 0.08 }, // M-type: metallic grey
];

const KUIPER_PALETTE: RockPalette = [
  { color: [0.5, 0.38, 0.33], weight: 0.6 }, // "ultra-red" organics-rich ice
  { color: [0.5, 0.52, 0.56], weight: 0.4 }, // neutral water ice
];

const PHYSICS_STEP = 1 / 60;
const VARIANTS = 5;

function AsteroidBelt({
  config,
  palette,
  detail,
  bumpScale,
  animate,
}: {
  config: BeltConfig;
  palette: RockPalette;
  detail: number;
  bumpScale: number;
  animate: boolean;
}) {
  const sim = useMemo(() => new BeltSimulation(config), [config]);
  const geometries = useMemo(
    () =>
      Array.from({ length: VARIANTS }, (_, k) =>
        createRockGeometry(config.seed * 31 + k, detail),
      ),
    [config.seed, detail],
  );
  const bump = useMemo(() => createRegolithBumpTexture(), []);
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const accumulator = useRef(0);
  const perVariant = Math.ceil(sim.count / VARIANTS);

  useEffect(
    () => () => {
      for (const g of geometries) g.dispose();
      bump.dispose();
    },
    [geometries, bump],
  );

  // Colours are static: assign once per instance.
  useLayoutEffect(() => {
    const random = mulberry32(config.seed + 99);
    const color = new THREE.Color();
    const total = palette.reduce((s, p) => s + p.weight, 0);
    for (let i = 0; i < sim.count; i++) {
      let pick = random() * total;
      const entry = palette.find((p) => (pick -= p.weight) <= 0) ?? palette[0];
      const shade = 0.82 + random() * 0.36;
      color.setRGB(
        entry.color[0] * shade,
        entry.color[1] * shade,
        entry.color[2] * shade,
      );
      meshes.current[i % VARIANTS]?.setColorAt(Math.floor(i / VARIANTS), color);
    }
    for (const m of meshes.current) {
      if (!m) continue;
      m.layers.enable(OCCLUDER_LAYER);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [sim, palette, config.seed]);

  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const position = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (animate) {
      // Fixed-step physics; clamp so a backgrounded tab doesn't explode it.
      accumulator.current += Math.min(delta, 0.1);
      let steps = 0;
      while (accumulator.current >= PHYSICS_STEP && steps < 4) {
        sim.step(PHYSICS_STEP);
        accumulator.current -= PHYSICS_STEP;
        steps++;
      }
      if (steps === 4) accumulator.current = 0;
    }
    const { position: p, quaternion: q, radius } = sim;
    for (let i = 0; i < sim.count; i++) {
      const mesh = meshes.current[i % VARIANTS];
      if (!mesh) continue;
      position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      quaternion.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
      // Collision sphere ≈ rock size (rock geometry spans ~0.6-1.3 units).
      scale.setScalar(radius[i] * 1.05);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(Math.floor(i / VARIANTS), matrix);
    }
    for (const m of meshes.current) if (m) m.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {geometries.map((geometry, k) => (
        <instancedMesh
          key={k}
          ref={(m) => {
            meshes.current[k] = m;
          }}
          args={[geometry, undefined, perVariant]}
          count={Math.ceil((sim.count - k) / VARIANTS)}
          frustumCulled={false}
        >
          <meshStandardMaterial
            bumpMap={bump}
            bumpScale={bumpScale}
            roughness={0.95}
            metalness={0}
            envMapIntensity={0}
          />
        </instancedMesh>
      ))}
    </>
  );
}

// --- Dust (GPU-animated Keplerian particles) ---------------------------------------

const dustVertex = /* glsl */ `
  attribute vec4 aOrbit; // radius, phase, height, seed
  uniform float uTime;
  uniform float uGM;
  uniform float uSize;
  uniform float uPixelScale;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float r = aOrbit.x;
    float a = aOrbit.y + sqrt(uGM / (r * r * r)) * uTime;
    vec3 p = vec3(r * cos(a), aOrbit.z, -r * sin(a));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float size = uSize * uPixelScale / -mv.z;
    gl_PointSize = clamp(size, 1.0, 2.4);
    // Sub-pixel grains fade instead of popping; a slow glint from tumbling.
    float glint = 0.65 + 0.35 * sin(uTime * (0.4 + aOrbit.w) + aOrbit.w * 61.0);
    vAlpha = uOpacity * glint * clamp(size, 0.2, 1.0);
  }
`;

const dustFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vAlpha;
    gl_FragColor = vec4(uColor * a, 1.0);
  }
`;

/** Kirkwood gaps: Jupiter resonances (3:1, 5:2, 7:3, 2:1) clear these radii. */
const KIRKWOOD_AU = [2.5, 2.82, 2.95, 3.27];

function sampleBeltRadius(
  random: () => number,
  belt: { inner: number; outer: number },
  kind: "main" | "kuiper",
) {
  for (;;) {
    // Soft-edged distribution: denser core, thinning edges.
    const u = (random() + random() + random()) / 3;
    const r = belt.inner + (belt.outer - belt.inner) * u;
    if (kind === "kuiper") return r;
    const au = 2.1 + ((r - belt.inner) / (belt.outer - belt.inner)) * 1.25;
    const gap = KIRKWOOD_AU.some((g) => Math.abs(au - g) < 0.025);
    if (!gap || random() < 0.12) return r;
  }
}

function DustBelt({
  belt,
  kind,
  count,
  color,
  opacity,
  thickness,
  animate,
}: {
  belt: { inner: number; outer: number };
  kind: "main" | "kuiper";
  count: number;
  color: string;
  opacity: number;
  thickness: number;
  animate: boolean;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const random = mulberry32(kind === "main" ? 314 : 2718);
    const orbits = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const r = sampleBeltRadius(random, belt, kind);
      // Gaussian-ish height (Box–Muller) scaled with distance.
      const g =
        Math.sqrt(-2 * Math.log(random() + 1e-9)) *
        Math.cos(2 * Math.PI * random());
      orbits.set(
        [r, random() * Math.PI * 2, g * thickness * r, random()],
        i * 4,
      );
    }
    const g = new THREE.BufferGeometry();
    // Positions are computed in the shader; three still wants an attribute.
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    );
    g.setAttribute("aOrbit", new THREE.BufferAttribute(orbits, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), belt.outer * 1.2);
    return g;
  }, [belt, kind, count, thickness]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uGM: { value: GM },
      uSize: { value: 0.012 },
      uPixelScale: { value: 1 },
      uOpacity: { value: opacity },
      uColor: { value: new THREE.Color(color) },
    }),
    [color, opacity],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((state) => {
    if (!material.current) return;
    const u = material.current.uniforms;
    u.uTime.value = sceneTime(state, animate);
    // Pixels per world unit at distance 1, in device pixels.
    const cam = state.camera as THREE.PerspectiveCamera;
    u.uPixelScale.value =
      (state.size.height * state.viewport.dpr * 0.5) /
      Math.tan((cam.fov * Math.PI) / 360);
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={dustVertex}
        fragmentShader={dustFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// --- Sky -------------------------------------------------------------------------

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  uniform float uDpr;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uDpr;
  }
`;

const starFragment = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * core * core, 1.0);
  }
`;

/** Approximate blackbody colour for a stellar temperature (Kelvin). */
function starColor(kelvin: number): [number, number, number] {
  const t = kelvin / 100;
  const r = t <= 66 ? 1 : Math.min(1, 1.292936 * Math.pow(t - 60, -0.1332047));
  const g =
    t <= 66
      ? Math.min(1, Math.max(0, 0.3900815 * Math.log(t) - 0.6318414))
      : Math.min(1, 1.129891 * Math.pow(t - 60, -0.0755148));
  const b =
    t >= 66
      ? 1
      : t <= 19
        ? 0
        : Math.min(1, Math.max(0, 0.5432068 * Math.log(t - 10) - 1.1962541));
  return [r, g, b];
}

function Sky({ milkyWay }: { milkyWay: THREE.Texture }) {
  const radius = 220;
  const geometry = useMemo(() => {
    const random = mulberry32(1977);
    const count = 7000;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // A third of the stars hug the galactic plane (this group's equator).
      const lon = random() * Math.PI * 2;
      const lat =
        random() < 0.35
          ? (random() - 0.5) * 0.35 * random()
          : Math.asin(random() * 2 - 1);
      positions.set(
        [
          Math.cos(lat) * Math.cos(lon) * radius,
          Math.sin(lat) * radius,
          Math.cos(lat) * Math.sin(lon) * radius,
        ],
        i * 3,
      );
      // Most stars are cool and faint; a few are hot and bright.
      const temperature = 2800 + Math.pow(random(), 2.4) * 22000;
      const magnitude = Math.pow(random(), 7);
      const [r, g, b] = starColor(temperature);
      const brightness = 0.25 + magnitude * 2.2;
      colors.set([r * brightness, g * brightness, b * brightness], i * 3);
      sizes[i] = 1.1 + magnitude * 2.6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    return g;
  }, []);
  const uniforms = useMemo(() => ({ uDpr: { value: 1 } }), []);
  const material = useRef<THREE.ShaderMaterial>(null);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((state) => {
    // Through the material: R3F copies uniform objects passed as props.
    if (material.current)
      material.current.uniforms.uDpr.value = state.viewport.dpr;
  });

  return (
    // The galactic plane is inclined ~60° to the ecliptic.
    <group rotation={[1.05, 0.4, 0]}>
      <mesh renderOrder={-10}>
        <sphereGeometry args={[radius * 1.05, 64, 32]} />
        <meshBasicMaterial
          map={milkyWay}
          side={THREE.BackSide}
          depthWrite={false}
          color={[0.9, 0.9, 1.0]}
        />
      </mesh>
      <points geometry={geometry} renderOrder={-9}>
        <shaderMaterial
          ref={material}
          vertexShader={starVertex}
          fragmentShader={starFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

// --- Assembly ----------------------------------------------------------------------

const MAIN_BELT_CONFIG: BeltConfig = {
  count: 1100,
  innerRadius: MAIN_BELT.inner,
  outerRadius: MAIN_BELT.outer,
  maxEccentricity: 0.06,
  maxInclination: 0.05,
  minSize: 0.006,
  maxSize: 0.026,
  gm: GM,
  restitution: 0.6,
  friction: 0.3,
  seed: 7,
};

const KUIPER_BELT_CONFIG: BeltConfig = {
  count: 300,
  innerRadius: KUIPER_BELT.inner,
  outerRadius: KUIPER_BELT.outer,
  maxEccentricity: 0.08,
  maxInclination: 0.05,
  minSize: 0.012,
  maxSize: 0.04,
  gm: GM,
  restitution: 0.5,
  friction: 0.3,
  seed: 11,
};

const TEXTURE_FILES = {
  sun: "sun.jpg",
  mercury: "mercury.jpg",
  "mercury-bump": "mercury-bump.jpg",
  venus: "venus.jpg",
  earth: "earth.jpg",
  "earth-bump": "earth-bump.jpg",
  "earth-clouds": "earth-clouds.jpg",
  "earth-roughness": "earth-roughness.jpg",
  moon: "moon.jpg",
  "moon-bump": "moon-bump.jpg",
  mars: "mars.jpg",
  "mars-bump": "mars-bump.jpg",
  jupiter: "jupiter.jpg",
  saturn: "saturn.jpg",
  "saturn-ring": "saturn-ring.png",
  uranus: "uranus.jpg",
  neptune: "neptune.jpg",
  "milky-way": "milky-way.jpg",
} as const;

/** Colour maps are sRGB; bump/roughness/alpha maps are linear data. */
const COLOR_MAPS = new Set([
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "saturn-ring",
  "uranus",
  "neptune",
  "milky-way",
]);

const TEXTURE_URLS = Object.fromEntries(
  Object.entries(TEXTURE_FILES).map(([k, f]) => [k, `${TEXTURES}/${f}`]),
) as Record<keyof typeof TEXTURE_FILES, string>;

const TEXTURE_KEYS = Object.keys(TEXTURE_URLS);

// Module-level so useTexture's onLoad effect runs once, not every render.
// drei types the argument as the keyed object but passes the loaded array;
// both keep TEXTURE_URLS order.
function configureTextures(loaded: object) {
  const list = (
    Array.isArray(loaded) ? loaded : Object.values(loaded)
  ) as THREE.Texture[];
  list.forEach((texture, i) => {
    texture.colorSpace = COLOR_MAPS.has(TEXTURE_KEYS[i])
      ? THREE.SRGBColorSpace
      : THREE.NoColorSpace;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  });
}

export function SolarSystem({ animate }: { animate: boolean }) {
  const textures = useTexture(
    TEXTURE_URLS,
    configureTextures,
  ) as unknown as PlanetTextures;

  // Real configuration of the planets today; time zero is "now".
  const orbits = useMemo(() => {
    const now = Date.now();
    return PLANETS.map((spec) => createOrbit(spec.elements, now));
  }, []);

  const system = useRef<THREE.Group>(null);
  const shipRate = Math.sqrt(GM / SHIP_ORBIT.radius ** 3);
  useFrame((state) => {
    // The ship coasts on its own (slower) circular orbit, so the view slowly
    // revolves around the Sun and the inner bodies overtake us.
    if (system.current)
      system.current.rotation.y = -sceneTime(state, animate) * shipRate;
  });

  return (
    <group ref={system}>
      <Sky milkyWay={textures["milky-way"]} />
      <Sun map={textures.sun} animate={animate} />
      {PLANETS.map((spec, i) => (
        <OrbitPath
          key={`orbit-${spec.key}`}
          orbit={orbits[i]}
          color={spec.orbitColor}
          bodyRadius={spec.key === "saturn" ? spec.radius * 2.3 : spec.radius}
          animate={animate}
        />
      ))}
      {PLANETS.map((spec, i) => (
        <Planet
          key={spec.key}
          spec={spec}
          orbit={orbits[i]}
          textures={textures}
          animate={animate}
        >
          {spec.key === "earth" && (
            <Moon
              map={textures.moon}
              bump={textures["moon-bump"]}
              animate={animate}
            />
          )}
        </Planet>
      ))}
      <AsteroidBelt
        config={MAIN_BELT_CONFIG}
        palette={MAIN_BELT_PALETTE}
        detail={2}
        bumpScale={2.2}
        animate={animate}
      />
      <AsteroidBelt
        config={KUIPER_BELT_CONFIG}
        palette={KUIPER_PALETTE}
        detail={1}
        bumpScale={1.6}
        animate={animate}
      />
      <DustBelt
        belt={MAIN_BELT}
        kind="main"
        count={12000}
        color="#d8c3a5"
        opacity={0.55}
        thickness={0.025}
        animate={animate}
      />
      <DustBelt
        belt={KUIPER_BELT}
        kind="kuiper"
        count={14000}
        color="#a9c0e2"
        opacity={0.45}
        thickness={0.035}
        animate={animate}
      />
      <ambientLight intensity={0.035} />
    </group>
  );
}
