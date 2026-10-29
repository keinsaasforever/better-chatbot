"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Component,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import { OCCLUDER_LAYER, SelectiveBloom } from "./solar-system/selective-bloom";
import { SHIP_ORBIT, SolarSystem } from "./solar-system/solar-system";

/**
 * Windshield view for /cockpit: the solar system seen from a ship coasting in
 * its own orbit just outside Jupiter's, with the keinsaas mark cruising ahead
 * as a starship that periodically jumps to hyperspace and returns. Pointer
 * "head movement" gives real parallax.
 */

// keinsaas mark, from public/brand/keinsaas-mark-on-dark.svg (viewBox 30x31).
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 31">
<path d="M20.9014 15.4897V15.4863V15.1942L29.0827 11.4996L25.2188 6.92523L16.1997 12.0942V15.4863V15.4897V18.8853L25.2188 24.0542L29.0827 19.4798L20.9014 15.7853V15.4897Z"/>
<path d="M9.62846 21.9509H9.63192L9.88812 22.0987L9.02257 30.9793L14.943 29.9449V19.607L11.9828 17.9092H11.9793L9.0191 16.2114L0 21.3804L2.06003 26.9892L9.37225 21.8031L9.62846 21.9509Z"/>
<path d="M9.63192 9.02846H9.62846L9.37225 9.17624L2.06003 3.99012L0 9.59897L9.0191 14.7679L11.9793 13.0701H11.9828L14.943 11.3724V1.03448L9.02257 0L9.88812 8.88068L9.63192 9.02846Z"/>
</svg>`;

const CRUISE_Z = -70;
// Display units → world units for the solar system.
const SYSTEM_SCALE = 20;
// The Sun sits ahead and below: we look across the ecliptic from just above it.
const SUN_POSITION: [number, number, number] = [
  0,
  -SHIP_ORBIT.height * SYSTEM_SCALE,
  -SHIP_ORBIT.radius * SYSTEM_SCALE,
];
// Pitch down a little so the Sun sits just below the middle of the glass.
const BASE_PITCH = -0.16;
const CYCLE = 34; // seconds per cruise + jump + return loop

// --- Starship --------------------------------------------------------------

function glowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(150,140,255,0.8)");
    g.addColorStop(0.5, "rgba(90,60,255,0.25)");
    g.addColorStop(1, "rgba(40,20,160,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const easeIn = (t: number) => t * t * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function Starship({ animate }: { animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const hull = useRef<THREE.Group>(null);
  const glow = useRef<THREE.Sprite>(null);
  const flash = useRef<THREE.Sprite>(null);

  const geometry = useMemo(() => {
    const data = new SVGLoader().parse(MARK_SVG);
    const shapes = data.paths.flatMap((path) => SVGLoader.createShapes(path));
    const g = new THREE.ExtrudeGeometry(shapes, {
      depth: 3.2,
      bevelEnabled: true,
      bevelThickness: 0.55,
      bevelSize: 0.35,
      bevelSegments: 4,
      curveSegments: 6,
    });
    g.center();
    return g;
  }, []);
  const texture = useMemo(() => glowTexture(), []);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
    },
    [geometry, texture],
  );
  const hullMesh = useRef<THREE.Mesh>(null);
  // The hull blocks the Sun's glow when it crosses in front of it.
  useLayoutEffect(() => {
    hullMesh.current?.layers.enable(OCCLUDER_LAYER);
  }, []);

  useFrame((state) => {
    if (!group.current || !hull.current) return;
    const t = animate ? state.clock.elapsedTime : 0;
    const phase = t % CYCLE;

    let z = CRUISE_Z;
    let stretch = 1;
    let flashOpacity = 0;
    let visible = true;

    if (phase > 27 && phase <= 28.4) {
      // Jump: accelerate away and stretch along the flight axis.
      const p = (phase - 27) / 1.4;
      z = CRUISE_Z - easeIn(p) * 1400;
      stretch = 1 + easeIn(p) * 14;
      flashOpacity = p > 0.8 ? (1 - p) * 5 : 0;
    } else if (phase > 28.4 && phase <= 30) {
      visible = false;
    } else if (phase > 30) {
      // Drop out of hyperspace back to cruise distance.
      const p = (phase - 30) / (CYCLE - 30);
      z = CRUISE_Z - (1 - easeOut(p)) * 900;
      stretch = 1 + (1 - easeOut(p)) * 8;
      flashOpacity = p < 0.15 ? (0.15 - p) * 6 : 0;
    }

    const cruiseT = t * 0.11;
    group.current.visible = visible;
    group.current.position.set(
      Math.sin(cruiseT) * 16,
      5.2 + Math.sin(t * 0.37) * 0.7,
      z,
    );
    hull.current.rotation.set(
      0.12 + Math.sin(t * 0.29) * 0.05,
      Math.cos(cruiseT) * 0.45,
      -Math.cos(cruiseT) * 0.18,
    );
    hull.current.scale.set(1, 1, stretch);

    if (glow.current) {
      const pulse = 0.85 + Math.sin(t * 6.0) * 0.08;
      glow.current.material.opacity = pulse;
      glow.current.scale.setScalar(16 + Math.sin(t * 6.0) * 0.6);
    }
    if (flash.current) {
      const { x, y } = group.current.position;
      flash.current.position.set(x, y, Math.max(z, CRUISE_Z - 500));
      flash.current.material.opacity = Math.min(1, flashOpacity);
      flash.current.visible = flashOpacity > 0.01;
    }
  });

  return (
    <>
      <group ref={group} position={[0, 5.2, CRUISE_Z]}>
        <group ref={hull}>
          {/* SVG y points down; the negative y scale flips it upright. */}
          <mesh ref={hullMesh} geometry={geometry} scale={[0.36, -0.36, 0.36]}>
            <meshPhysicalMaterial
              color="#4a3bff"
              emissive="#1c0fa0"
              emissiveIntensity={0.6}
              metalness={0.5}
              roughness={0.2}
              clearcoat={1}
              clearcoatRoughness={0.08}
              iridescence={1}
              iridescenceIOR={1.6}
              iridescenceThicknessRange={[180, 820]}
              envMapIntensity={3.6}
            />
          </mesh>
        </group>
        <sprite ref={glow} position={[0, 0, -2.5]} scale={16}>
          <spriteMaterial
            map={texture}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </sprite>
      </group>
      <sprite
        ref={flash}
        position={[0, 5.2, CRUISE_Z - 600]}
        scale={160}
        visible={false}
      >
        <spriteMaterial
          map={texture}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
          opacity={0}
        />
      </sprite>
    </>
  );
}

// --- Failure isolation ---------------------------------------------------

/**
 * The solar system streams ~1.4 MB of textures. If any fail to load, drop
 * the system (the windshield's CSS backdrop shows through) instead of
 * letting the error take down the cockpit page.
 */
class SceneBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[cockpit] solar system unavailable", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// --- Head movement ---------------------------------------------------------

function HeadMotion({ enabled }: { enabled: boolean }) {
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!enabled) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [enabled]);

  useFrame(({ camera, clock }) => {
    // Yaw before pitch, like a head turning, so the horizon stays level.
    camera.rotation.order = "YXZ";
    if (!enabled) {
      camera.rotation.set(BASE_PITCH, 0, 0);
      return;
    }
    const t = clock.elapsedTime;
    const yaw = -pointer.current.x * 0.06;
    const pitch =
      BASE_PITCH - pointer.current.y * 0.025 + Math.sin(t * 0.8) * 0.002;
    camera.rotation.y += (yaw - camera.rotation.y) * 0.04;
    camera.rotation.x += (pitch - camera.rotation.x) * 0.04;
    camera.rotation.z = Math.sin(t * 0.21) * 0.004;
    camera.position.x += (pointer.current.x * 0.08 - camera.position.x) * 0.04;
  });
  return null;
}

export default function CockpitScene({
  reducedMotion,
}: { reducedMotion: boolean }) {
  const animate = !reducedMotion;
  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 0], fov: 50, near: 0.05, far: 12000 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      frameloop={animate ? "always" : "demand"}
      fallback={null}
      aria-hidden
    >
      <SceneBoundary>
        <Suspense fallback={null}>
          <group position={SUN_POSITION} scale={SYSTEM_SCALE}>
            <SolarSystem animate={animate} />
          </group>
          <SelectiveBloom />
        </Suspense>
      </SceneBoundary>
      <Starship animate={animate} />
      <HeadMotion enabled={animate} />
      <Environment resolution={256} frames={1}>
        <Lightformer
          form="rect"
          intensity={5}
          color="#ff5bd1"
          position={[-6, 2, -4]}
          scale={[6, 2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={4}
          color="#4fd8ff"
          position={[6, -1, -3]}
          scale={[6, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3}
          color="#ff9a3d"
          position={[0, -5, 4]}
          scale={[12, 2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3}
          color="#ffffff"
          position={[0, 6, 3]}
          scale={[8, 2, 1]}
        />
      </Environment>
    </Canvas>
  );
}
