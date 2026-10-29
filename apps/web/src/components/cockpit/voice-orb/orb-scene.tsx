"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { Wireframe } from "three/examples/jsm/lines/Wireframe.js";
import { WireframeGeometry2 } from "three/examples/jsm/lines/WireframeGeometry2.js";
import { CK } from "../instruments";
import { ORB_ENERGY, type OrbMode } from "./orb-state";

/**
 * The cockpit voice orb: the blue plasma ball of the ElevenLabs widget,
 * redrawn for the flight deck. A noise-displaced core in keinsaas blue with a
 * cyan fresnel rim, a fat-line geodesic cage around it (three.js'
 * `webgl_lines_fat_wireframe`), a dot field across its lower half and an
 * additive halo. Everything is driven by one smoothed `energy` value per mode.
 */

const BRAND_BLUE = "#0a00e0";
const MID_BLUE = "#3d5afe";

// Camera at z=5 with a 35° fov sees a 3.15-unit square: the core (r=1) fills
// about 60% of the box and the cage most of the rest.
const CAMERA_Z = 5;
const VIEW = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(35 / 2));

const noiseGlsl = /* glsl */ `
  // Sine-free hash and gradient noise, as in the windshield's sun.
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
  float unorm(float n) { return clamp(n * 0.5 + 0.5, 0.0, 1.0); }
`;

const coreVertex = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  ${noiseGlsl}
  void main() {
    float slow = gnoise(position * 1.6 + vec3(0.0, uTime * 0.45, uTime * 0.2));
    float fast = gnoise(position * 3.4 - vec3(uTime * 0.9));
    float amplitude = 0.03 + uEnergy * 0.13;
    vec3 p = position + normal * (slow * 0.75 + fast * 0.25 * uEnergy) * amplitude;
    vPos = p;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = -mv.xyz;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }
`;

const coreFragment = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;
  uniform float uHover;
  uniform vec3 uDeep;
  uniform vec3 uMid;
  uniform vec3 uRim;
  varying vec3 vNormal;
  varying vec3 vView;
  varying vec3 vPos;
  ${noiseGlsl}
  void main() {
    vec3 n = normalize(vNormal);
    float facing = clamp(dot(n, normalize(vView)), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.4);
    float swirl = unorm(gnoise(vPos * 2.0 + vec3(uTime * 0.25, -uTime * 0.18, uTime * 0.1)));
    float bands = smoothstep(0.35, 0.9, swirl);
    // Brighter from below, like the widget's glow under its dot field.
    float below = smoothstep(0.25, -0.95, vPos.y);
    vec3 color = mix(uDeep * 0.45, uMid, bands * 0.75 + below * 0.45);
    // A lit glass centre, the widget's white core dimmed for the dark deck.
    color += vec3(0.45, 0.65, 1.0) * pow(facing, 3.0) * (0.14 + uEnergy * 0.22);
    color += uRim * fresnel * (0.7 + uEnergy * 1.1 + uHover * 0.6);
    color += vec3(pow(swirl, 5.0) * (0.15 + uEnergy * 0.9));
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const haloVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const haloFragment = /* glsl */ `
  uniform float uEnergy;
  uniform float uHover;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    // Zero by the edge of the inscribed circle, so the square canvas never shows.
    float glow = smoothstep(1.0, 0.3, d) * (0.3 + uEnergy * 0.6 + uHover * 0.3);
    gl_FragColor = vec4(mix(uInner, uOuter, smoothstep(0.4, 0.95, d)), glow);
    #include <colorspace_fragment>
  }
`;

type OrbProps = {
  mode: OrbMode;
  hovered: boolean;
  reducedMotion: boolean;
};

/** Points on the lower half of a sphere, for the widget's dot field. */
function dotField(radius: number): THREE.BufferGeometry {
  const source = new THREE.IcosahedronGeometry(radius, 5);
  const position = source.getAttribute("position");
  const seen = new Set<string>();
  const points: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    if (y > -0.15 * radius || seen.has(key)) continue;
    seen.add(key);
    points.push(x, y, z);
  }
  source.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  return geometry;
}

function Orb({ mode, hovered, reducedMotion }: OrbProps) {
  const group = useRef<THREE.Group>(null);
  const cage = useRef<THREE.Group>(null);
  const live = useRef({ energy: ORB_ENERGY.connecting, hover: 0, time: 0 });
  // Read inside useFrame, so a mode change never rebuilds a material.
  const inputs = useRef({ mode, hovered, reducedMotion });
  inputs.current = { mode, hovered, reducedMotion };

  const core = useMemo(
    () => ({
      geometry: new THREE.IcosahedronGeometry(1, 24),
      material: new THREE.ShaderMaterial({
        vertexShader: coreVertex,
        fragmentShader: coreFragment,
        uniforms: {
          uTime: { value: 0 },
          uEnergy: { value: 0 },
          uHover: { value: 0 },
          uDeep: { value: new THREE.Color(BRAND_BLUE) },
          uMid: { value: new THREE.Color(MID_BLUE) },
          uRim: { value: new THREE.Color(CK.cyan) },
        },
      }),
    }),
    [],
  );

  const halo = useMemo(
    () => ({
      geometry: new THREE.PlaneGeometry(VIEW, VIEW),
      material: new THREE.ShaderMaterial({
        vertexShader: haloVertex,
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uEnergy: { value: 0 },
          uHover: { value: 0 },
          uInner: { value: new THREE.Color(MID_BLUE) },
          uOuter: { value: new THREE.Color(BRAND_BLUE) },
        },
      }),
    }),
    [],
  );

  // Fat lines: a plain LineBasicMaterial is always 1px in WebGL.
  const wire = useMemo(() => {
    const geometry = new WireframeGeometry2(
      new THREE.IcosahedronGeometry(1.3, 1),
    );
    const material = new LineMaterial({
      color: CK.cyan,
      linewidth: 1,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      toneMapped: false,
    });
    const wireframe = new Wireframe(geometry, material);
    wireframe.computeLineDistances();
    return { object: wireframe, geometry, material };
  }, []);

  const dots = useMemo(
    () => ({
      geometry: dotField(1.04),
      material: new THREE.PointsMaterial({
        color: "#ffffff",
        size: 1.6,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        toneMapped: false,
      }),
    }),
    [],
  );

  useEffect(
    () => () => {
      core.geometry.dispose();
      core.material.dispose();
      halo.geometry.dispose();
      halo.material.dispose();
      wire.geometry.dispose();
      wire.material.dispose();
      dots.geometry.dispose();
      dots.material.dispose();
    },
    [core, halo, wire, dots],
  );

  const cyan = useMemo(() => new THREE.Color(CK.cyan), []);
  const amber = useMemo(() => new THREE.Color(CK.amber), []);

  useFrame((_, delta) => {
    const { mode, hovered, reducedMotion } = inputs.current;
    const state = live.current;
    const dt = Math.min(delta, 0.1);
    // Reduced motion keeps the colours and glow but nearly stops the flow.
    state.time += dt * (reducedMotion ? 0.15 : 1);
    const t = state.time;

    // Speech has syllables: modulate the target so a talking orb flickers
    // instead of just sitting brighter.
    let target = ORB_ENERGY[mode];
    if (!reducedMotion && mode === "assistant") {
      target += 0.15 * Math.sin(t * 9.1) * Math.sin(t * 3.3 + 1.2);
    } else if (!reducedMotion && mode === "user") {
      target += 0.12 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
    }
    state.energy += (target - state.energy) * (1 - Math.exp(-dt * 6));
    state.hover += ((hovered ? 1 : 0) - state.hover) * (1 - Math.exp(-dt * 10));
    const { energy, hover } = state;

    core.material.uniforms.uTime.value = t;
    core.material.uniforms.uEnergy.value = energy;
    core.material.uniforms.uHover.value = hover;
    halo.material.uniforms.uEnergy.value = energy;
    halo.material.uniforms.uHover.value = hover;

    const connecting = mode === "connecting" ? 1 : 0;
    wire.material.color.lerpColors(cyan, amber, connecting);
    wire.material.opacity = 0.22 + energy * 0.3 + hover * 0.3;
    dots.material.opacity = 0.3 + energy * 0.5;

    // Hover pulse: a quick heartbeat on top of the slow breath.
    const breath = reducedMotion ? 0 : Math.sin(t * 1.6) * 0.015;
    const pulse = reducedMotion ? 0 : Math.sin(t * 7) * 0.045 * hover;
    group.current?.scale.setScalar(1 + energy * 0.06 + breath + pulse);

    if (cage.current && !reducedMotion) {
      cage.current.rotation.y += dt * (0.18 + energy * 0.7 + connecting * 0.9);
      cage.current.rotation.x = Math.sin(t * 0.3) * 0.25;
    }
  });

  return (
    <>
      <mesh geometry={halo.geometry} material={halo.material} />
      <group ref={group}>
        <mesh geometry={core.geometry} material={core.material} />
        <points geometry={dots.geometry} material={dots.material} />
        <group ref={cage}>
          <primitive object={wire.object} />
        </group>
      </group>
    </>
  );
}

export default function OrbScene(props: OrbProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, CAMERA_Z], fov: 35 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      flat
      fallback={null}
      aria-hidden
      style={{ pointerEvents: "none" }}
    >
      <Orb {...props} />
    </Canvas>
  );
}
