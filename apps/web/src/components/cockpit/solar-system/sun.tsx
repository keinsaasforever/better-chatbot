"use client";

import { Billboard } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { sceneTime } from "./clock";
import { BLOOM_LAYER } from "./selective-bloom";

/**
 * The Sun, built entirely in shaders so it stays sharp at any size:
 *
 * - Photosphere: the Solar System Scope map, domain-warped by slowly boiling
 *   noise (supergranulation cells, granules, bright magnetic filaments,
 *   cooler active regions), mapped through an orange heat ramp with limb
 *   darkening and a hot rim. Kept in a moderate HDR range so bloom gives a
 *   glow, not a white blowout.
 * - Corona: billboarded polar-noise streamers flowing outward and flickering.
 * - Prominences: instanced ribbons arching off the surface between two
 *   footpoints. Each loop rises, drains and fades, then respawns elsewhere;
 *   all of it is computed on the GPU from a per-instance seed.
 * - Ejecta: sparks thrown off the surface that drift out and cool.
 */

export const SUN_RADIUS = 0.72;

/** Sun position in world space (the system group is pivoted on it). */
export const sunWorld = new THREE.Vector3();

const noiseGlsl = /* glsl */ `
  // Sine-free hashes (Dave Hoskins): sin()-based ones lose precision on
  // some GPUs and shimmer as their inputs grow with time.
  vec3 hash3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return -1.0 + 2.0 * fract((p.xxy + p.yxx) * p.zyx);
  }
  float gnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i), f),
                       dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                       dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                       dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                       dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
  float fbm3(vec3 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * gnoise(p); p *= 2.07; a *= 0.5; }
    return s;
  }
  // Noise mapped to [0, 1] and clamped: gradient noise can overshoot ±1, and
  // a negative factor in an additive shader subtracts light (black blotches),
  // while pow() of a negative base is NaN on real GPUs.
  float unorm(float n) { return clamp(n * 0.5 + 0.5, 0.0, 1.0); }
  float hash1(float n) {
    n = fract(n * 0.1031);
    n *= n + 33.33;
    n *= n + n;
    return fract(n);
  }
  // Unit vector perpendicular to a, never NaN (falls back if a ∥ b).
  vec3 safeCross(vec3 a, vec3 b) {
    vec3 c = cross(a, b);
    float l = length(c);
    if (l < 1e-5) {
      c = cross(a, abs(a.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0));
      l = length(c);
    }
    return c / l;
  }
  vec3 randomDirection(float s) {
    float z = hash1(s) * 2.0 - 1.0;
    float a = hash1(s + 1.73) * 6.2831853;
    float r = sqrt(max(1.0 - z * z, 0.0));
    return vec3(r * cos(a), z, r * sin(a));
  }
`;

// --- Photosphere ----------------------------------------------------------

const photosphereVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  void main() {
    vUv = uv;
    vObj = position;
    vNormalV = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const photosphereFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uBrightness;
  varying vec2 vUv;
  varying vec3 vObj;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  ${noiseGlsl}

  // Plasma temperature → colour: deep red troughs, orange body, yellow-white
  // only in the hottest filaments.
  vec3 heatRamp(float h) {
    vec3 c = mix(vec3(0.24, 0.02, 0.0), vec3(0.7, 0.13, 0.01), smoothstep(0.0, 0.3, h));
    c = mix(c, vec3(0.98, 0.36, 0.03), smoothstep(0.28, 0.56, h));
    c = mix(c, vec3(1.0, 0.58, 0.11), smoothstep(0.56, 0.84, h));
    c = mix(c, vec3(1.0, 0.8, 0.42), smoothstep(0.84, 1.12, h));
    return c;
  }

  void main() {
    vec3 p = normalize(vObj);
    // Domain warp: the large-scale flow that drags everything around.
    vec3 q = vec3(
      fbm3(p * 2.6 + vec3(0.0, uTime * 0.018, 0.0)),
      fbm3(p * 2.6 + vec3(5.2, -uTime * 0.014, 1.3)),
      fbm3(p * 2.6 + vec3(9.7, 2.8, uTime * 0.016))
    );
    float cells = fbm3(p * 5.5 + q * 1.8);
    float granules = fbm3(p * 42.0 + q * 3.0 + vec3(0.0, uTime * 0.22, 0.0));
    float ridge = clamp(1.0 - abs(gnoise(p * 8.0 + q * 2.6 + uTime * 0.03)), 0.0, 1.0);
    float filaments = pow(ridge, 7.0);
    vec3 tex = texture2D(uMap, vUv + q.xy * 0.02).rgb;
    float lum = dot(tex, vec3(0.299, 0.587, 0.114));
    // Cooler, darker active regions drifting across the disc.
    float spots = smoothstep(0.32, 0.55, fbm3(p * 2.0 + vec3(31.0, uTime * 0.004, 0.0)));

    float heat = 0.36 + 0.6 * (lum - 0.5) + 0.45 * cells + 0.28 * granules
      + 0.18 * filaments - 0.25 * spots;
    vec3 col = heatRamp(heat);

    float mu = clamp(dot(normalize(vNormalV), normalize(-vViewPos)), 0.0, 1.0);
    // Limb darkening on the disc, then a thin hot rim where the light
    // grazes through the chromosphere.
    float limb = 0.5 + 0.5 * pow(mu, 0.55);
    float rim = pow(1.0 - mu, 5.0);
    col = col * limb * uBrightness + vec3(1.0, 0.48, 0.08) * rim * 0.9;
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`;

// --- Corona -----------------------------------------------------------------

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const coronaFragment = /* glsl */ `
  uniform float uTime;
  uniform float uDisc;
  uniform float uIntensity;
  varying vec2 vUv;
  ${noiseGlsl}
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    if (r < uDisc * 0.985 || r > 1.0) discard;
    float a = atan(q.y, q.x);
    float h = (r - uDisc) / (1.0 - uDisc);
    vec2 ring = vec2(cos(a), sin(a));
    // Broad streamers, warped and flowing outward.
    vec3 sp = vec3(ring * 2.6, h * 2.2 - uTime * 0.09);
    float warp = fbm3(sp * 1.7 + vec3(0.0, 0.0, uTime * 0.05));
    float streamers = unorm(fbm3(sp + warp * 1.4));
    // Fine radial rays that flicker.
    float rays = unorm(fbm3(vec3(ring * 11.0, h * 1.4 - uTime * 0.16)));
    rays = pow(rays, 3.0);
    float flicker = 0.88 + 0.12 * sin(uTime * 1.7 + a * 3.0 + warp * 6.0);
    // Spicules: a ragged fringe of short flames licking off the limb.
    float flames = unorm(fbm3(vec3(ring * 34.0, h * 9.0 - uTime * 0.7)));
    flames = smoothstep(0.42, 0.8, flames) * exp(-h * 10.0);
    float glow = exp(-h * 6.5) * (0.35 + 1.0 * streamers)
      + rays * exp(-h * 3.5) * 0.9
      + flames * 2.2
      + exp(-h * 28.0) * 1.0;
    glow *= flicker * smoothstep(1.0, 0.6, r);
    vec3 col = mix(vec3(0.85, 0.2, 0.02), vec3(1.0, 0.58, 0.18), exp(-h * 7.0));
    gl_FragColor = vec4(col * max(glow, 0.0) * uIntensity, 1.0);
  }
`;

// --- Prominences ------------------------------------------------------------

const LOOPS = 34;
const STRANDS = 5;
const LOOP_SEGMENTS = 64;

const prominenceVertex = /* glsl */ `
  attribute float aS;
  attribute float aSide;
  attribute float aSeed;
  attribute vec4 aTiming; // life (s), time offset, strand jitter, width scale
  uniform float uTime;
  uniform float uRadius;
  uniform vec3 uCamera; // camera position in this object's space
  uniform float uPixelScale; // device pixels per world unit at distance 1
  varying float vS;
  varying float vSide;
  varying float vAlpha;
  varying float vSeed;
  ${noiseGlsl}

  // A point on loop "seed" at parameter s, raised by "rise".
  vec3 loopPoint(float s, float seed, float rise, float jitter) {
    vec3 c = randomDirection(seed);
    vec3 axis = safeCross(c, randomDirection(seed + 5.0));
    vec3 bin = cross(c, axis);
    float span = mix(0.06, 0.22, hash1(seed + 9.0)) * (1.0 + jitter * 0.15);
    float height = mix(0.05, 0.32, pow(hash1(seed + 11.0), 1.5)) * uRadius * (1.0 + jitter * 0.2);
    float tilt = (hash1(seed + 13.0) - 0.5) * 0.6;
    float ang = (s - 0.5) * span;
    vec3 dir = normalize(c * cos(ang) + axis * sin(ang));
    float arch = sin(s * 3.14159265);
    // Twisting, drifting plasma: each strand wanders a little on its own.
    float wobble = gnoise(vec3(s * 3.5, seed + jitter * 4.0, uTime * 0.25));
    vec3 lean = bin * (tilt * arch + wobble * 0.4) * height * rise;
    return dir * (uRadius * 0.992 + arch * height * rise) + lean;
  }

  void main() {
    float life = aTiming.x;
    float t = uTime + aTiming.y;
    float cycle = floor(t / life);
    float phase = fract(t / life);
    float seed = aSeed * 17.0 + cycle * 3.137;
    float rise = 0.25 + 0.75 * smoothstep(0.0, 0.45, phase);

    vec3 pos = loopPoint(aS, seed, rise, aTiming.z);
    vec3 ahead = loopPoint(min(aS + 0.01, 1.0), seed, rise, aTiming.z);
    vec3 behind = loopPoint(max(aS - 0.01, 0.0), seed, rise, aTiming.z);
    vec3 tangent = normalize(ahead - behind);
    // Ribbon faces the camera. A leg pointing straight at the camera makes
    // the cross product vanish; safeCross keeps it finite.
    vec3 side = safeCross(tangent, normalize(uCamera - pos));
    float width = uRadius * 0.022 * aTiming.w * (0.45 + 0.55 * sin(aS * 3.14159265));
    // Never thinner than ~1.5 px: sub-pixel ribbons alias and shimmer. A
    // widened ribbon is dimmed by the same factor so its brightness holds.
    float worldScale = length(modelMatrix[0].xyz);
    float depth = max(-(modelViewMatrix * vec4(pos, 1.0)).z, 1e-3);
    float widthPx = 2.0 * width * worldScale * uPixelScale / depth;
    float widen = max(1.0, 1.5 / max(widthPx, 1e-4));
    pos += side * aSide * width * widen;

    // Loops on the limb read best (as in coronagraph images); the ones on
    // the face of the disc stay faint.
    vec3 c = randomDirection(seed);
    float limb = 1.0 - abs(dot(c, normalize(uCamera)));
    float fade = smoothstep(0.0, 0.12, phase) * (1.0 - smoothstep(0.62, 1.0, phase));

    vS = aS;
    vSide = aSide;
    vSeed = seed;
    vAlpha = fade * mix(0.25, 1.0, limb) / widen;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const prominenceFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying float vS;
  varying float vSide;
  varying float vAlpha;
  varying float vSeed;
  ${noiseGlsl}
  void main() {
    float across = pow(clamp(1.0 - abs(vSide), 0.0, 1.0), 1.6);
    // Plasma draining down both legs of the loop.
    float flow = unorm(gnoise(vec3(abs(vS - 0.5) * 16.0 + uTime * 0.9, vSeed, uTime * 0.15)));
    float a = across * vAlpha * (0.25 + 0.9 * flow);
    vec3 col = mix(vec3(0.95, 0.22, 0.02), vec3(1.0, 0.56, 0.16), flow * across);
    gl_FragColor = vec4(col * max(a, 0.0) * uIntensity, 1.0);
  }
`;

export function createProminenceGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  const verts = (LOOP_SEGMENTS + 1) * 2;
  const s = new Float32Array(verts);
  const side = new Float32Array(verts);
  for (let i = 0; i <= LOOP_SEGMENTS; i++) {
    s[i * 2] = s[i * 2 + 1] = i / LOOP_SEGMENTS;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
  }
  const index: number[] = [];
  for (let i = 0; i < LOOP_SEGMENTS; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  g.setIndex(index);
  // Positions are computed in the shader; three still wants the attribute.
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(verts * 3), 3),
  );
  g.setAttribute("aS", new THREE.BufferAttribute(s, 1));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));

  const count = LOOPS * STRANDS;
  const seeds = new Float32Array(count);
  const timing = new Float32Array(count * 4);
  for (let loop = 0; loop < LOOPS; loop++) {
    // Loops keep their own lifetimes and are staggered so some are always up.
    const life = 9 + ((loop * 7.31) % 11);
    const offset = (loop / LOOPS) * life * 3.7;
    for (let k = 0; k < STRANDS; k++) {
      const i = loop * STRANDS + k;
      seeds[i] = loop + 1;
      // Strands fan out around the loop's core; the middle one is widest.
      const spread = k - (STRANDS - 1) / 2;
      timing.set([life, offset, spread, 1.1 - Math.abs(spread) * 0.25], i * 4);
    }
  }
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 1));
  g.setAttribute("aTiming", new THREE.InstancedBufferAttribute(timing, 4));
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SUN_RADIUS * 2);
  return g;
}

// --- Ejecta -----------------------------------------------------------------

const EJECTA = 900;

const ejectaVertex = /* glsl */ `
  attribute vec2 aSpark; // seed, lifetime
  uniform float uTime;
  uniform float uRadius;
  uniform float uPixelScale;
  varying float vAlpha;
  varying float vHeat;
  ${noiseGlsl}
  void main() {
    float life = aSpark.y;
    float t = uTime + aSpark.x * 41.0;
    float cycle = floor(t / life);
    float phase = fract(t / life);
    float seed = aSpark.x * 13.0 + cycle * 7.31;
    vec3 d = randomDirection(seed);
    vec3 drift = safeCross(d, randomDirection(seed + 3.0));
    float reach = mix(0.15, 1.1, pow(hash1(seed + 2.0), 2.0));
    float r = uRadius * (1.0 + phase * reach);
    vec3 pos = d * r + drift * phase * phase * uRadius * 0.25;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uRadius * 0.03 * uPixelScale / -mv.z, 1.0, 3.0);
    vHeat = 1.0 - phase;
    vAlpha = smoothstep(0.0, 0.06, phase) * pow(1.0 - phase, 2.0);
  }
`;

const ejectaFragment = /* glsl */ `
  varying float vAlpha;
  varying float vHeat;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    vec3 col = mix(vec3(0.9, 0.2, 0.02), vec3(1.0, 0.7, 0.3), vHeat);
    gl_FragColor = vec4(col * a * 0.9, 1.0);
  }
`;

export function createEjectaGeometry() {
  const g = new THREE.BufferGeometry();
  const sparks = new Float32Array(EJECTA * 2);
  for (let i = 0; i < EJECTA; i++) {
    sparks[i * 2] = (i * 0.618034) % 1;
    sparks[i * 2 + 1] = 3 + ((i * 2.399) % 5);
  }
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(EJECTA * 3), 3),
  );
  g.setAttribute("aSpark", new THREE.BufferAttribute(sparks, 2));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SUN_RADIUS * 2.5);
  return g;
}

// --- Component ----------------------------------------------------------------

export function Sun({
  map,
  animate,
}: { map: THREE.Texture; animate: boolean }) {
  const photosphere = useRef<THREE.Mesh>(null);
  const corona = useRef<THREE.Mesh>(null);
  const prominences = useRef<THREE.Mesh>(null);
  // R3F copies each uniform into the material, so per-frame values must be
  // written through the material, not the objects passed as props.
  const surfaceMat = useRef<THREE.ShaderMaterial>(null);
  const coronaMat = useRef<THREE.ShaderMaterial>(null);
  const haloMat = useRef<THREE.ShaderMaterial>(null);
  const prominenceMat = useRef<THREE.ShaderMaterial>(null);
  const ejectaMat = useRef<THREE.ShaderMaterial>(null);
  const coronaSize = SUN_RADIUS * 3.6;
  const haloSize = SUN_RADIUS * 8;

  const surfaceUniforms = useMemo(
    () => ({
      uMap: { value: map },
      uTime: { value: 0 },
      uBrightness: { value: 1.15 },
    }),
    [map],
  );
  const coronaUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDisc: { value: (SUN_RADIUS * 2) / coronaSize },
      uIntensity: { value: 0.9 },
    }),
    [coronaSize],
  );
  const haloUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uDisc: { value: (SUN_RADIUS * 2) / haloSize },
      uIntensity: { value: 0.12 },
    }),
    [haloSize],
  );
  const prominenceUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRadius: { value: SUN_RADIUS },
      uCamera: { value: new THREE.Vector3() },
      uPixelScale: { value: 1 },
      uIntensity: { value: 0.75 },
    }),
    [],
  );
  const ejectaUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRadius: { value: SUN_RADIUS },
      uPixelScale: { value: 1 },
    }),
    [],
  );
  const prominenceGeometry = useMemo(() => createProminenceGeometry(), []);
  const ejectaGeometry = useMemo(() => createEjectaGeometry(), []);
  useEffect(
    () => () => {
      prominenceGeometry.dispose();
      ejectaGeometry.dispose();
    },
    [prominenceGeometry, ejectaGeometry],
  );

  useLayoutEffect(() => {
    photosphere.current?.layers.enable(BLOOM_LAYER);
    corona.current?.layers.enable(BLOOM_LAYER);
    prominences.current?.layers.enable(BLOOM_LAYER);
  }, []);

  useFrame((state) => {
    const t = sceneTime(state, animate);
    for (const m of [surfaceMat, coronaMat, prominenceMat, ejectaMat]) {
      if (m.current) m.current.uniforms.uTime.value = t;
    }
    if (haloMat.current) haloMat.current.uniforms.uTime.value = t * 0.5;
    if (photosphere.current) {
      // ~25-day equatorial rotation, sped up like everything else.
      photosphere.current.rotation.y = t * 0.012;
      photosphere.current.getWorldPosition(sunWorld);
    }
    if (prominences.current && prominenceMat.current) {
      const camera = prominenceMat.current.uniforms.uCamera.value;
      camera.copy(state.camera.position);
      prominences.current.worldToLocal(camera);
    }
    const cam = state.camera as THREE.PerspectiveCamera;
    const pixelScale =
      (state.size.height * state.viewport.dpr * 0.5) /
      Math.tan((cam.fov * Math.PI) / 360);
    for (const m of [ejectaMat, prominenceMat]) {
      if (m.current) m.current.uniforms.uPixelScale.value = pixelScale;
    }
  });

  return (
    <group>
      <mesh ref={photosphere}>
        <sphereGeometry args={[SUN_RADIUS, 128, 96]} />
        <shaderMaterial
          ref={surfaceMat}
          vertexShader={photosphereVertex}
          fragmentShader={photosphereFragment}
          uniforms={surfaceUniforms}
          toneMapped={false}
        />
      </mesh>
      <mesh
        ref={prominences}
        geometry={prominenceGeometry}
        frustumCulled={false}
      >
        <shaderMaterial
          ref={prominenceMat}
          vertexShader={prominenceVertex}
          fragmentShader={prominenceFragment}
          uniforms={prominenceUniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <points geometry={ejectaGeometry} frustumCulled={false}>
        <shaderMaterial
          ref={ejectaMat}
          vertexShader={ejectaVertex}
          fragmentShader={ejectaFragment}
          uniforms={ejectaUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </points>
      <Billboard>
        {/* Inner corona: blooms. */}
        <mesh ref={corona}>
          <planeGeometry args={[coronaSize, coronaSize]} />
          <shaderMaterial
            ref={coronaMat}
            vertexShader={quadVertex}
            fragmentShader={coronaFragment}
            uniforms={coronaUniforms}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
        {/* Faint outer haze: main render only. */}
        <mesh>
          <planeGeometry args={[haloSize, haloSize]} />
          <shaderMaterial
            ref={haloMat}
            vertexShader={quadVertex}
            fragmentShader={coronaFragment}
            uniforms={haloUniforms}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
      {/* No falloff: compressed distances would leave Neptune pitch black. */}
      <pointLight intensity={3.0} decay={0} color="#ffe6c8" />
    </group>
  );
}
