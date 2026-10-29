"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** Objects that glow (the Sun). Keep them on layer 0 too so they render. */
export const BLOOM_LAYER = 1;
/** Solid objects that must block the glow when they pass in front of it. */
export const OCCLUDER_LAYER = 2;

/**
 * Renders only what should glow: occluders as black silhouettes (depth
 * included, so a planet crossing the Sun cuts its glow), then the glowing
 * layer on top. Everything else (stars, dust, orbit lines) never blooms.
 */
class GlowSourcePass extends Pass {
  private readonly black = new THREE.MeshBasicMaterial({ color: 0x000000 });
  private readonly clearColor = new THREE.Color();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    const { scene, camera } = this;
    const mask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);

    renderer.setRenderTarget(readBuffer);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.autoClear = false;

    camera.layers.set(OCCLUDER_LAYER);
    scene.overrideMaterial = this.black;
    renderer.render(scene, camera);

    camera.layers.set(BLOOM_LAYER);
    scene.overrideMaterial = null;
    renderer.render(scene, camera);

    camera.layers.mask = mask;
    renderer.autoClear = autoClear;
    renderer.setClearColor(this.clearColor, clearAlpha);
  }

  dispose() {
    this.black.dispose();
  }
}

const mixShader = {
  uniforms: {
    baseTexture: { value: null },
    bloomTexture: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(baseTexture, vUv);
      // Glow only ever adds light; never let a stray negative darken the frame.
      vec3 glow = max(texture2D(bloomTexture, vUv).rgb, vec3(0.0));
      gl_FragColor = vec4(base.rgb + glow, base.a);
    }
  `,
};

/**
 * Selective bloom (three.js "unreal bloom selective" technique): a half-res
 * composer blooms only the glow layer, and the full-res composer adds that
 * glow onto the normal render before tone mapping. Takes over rendering.
 */
export function SelectiveBloom({
  strength = 1.1,
  radius = 0.75,
}: { strength?: number; radius?: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const pipeline = useMemo(() => {
    const glow = new EffectComposer(gl);
    glow.renderToScreen = false;
    const source = new GlowSourcePass(scene, camera);
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256),
      strength,
      radius,
      0,
    );
    glow.addPass(source);
    glow.addPass(bloom);

    // MSAA target so orbit lines and limbs stay smooth through the composer.
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    const final = new EffectComposer(gl, target);
    final.addPass(new RenderPass(scene, camera));
    const mix = new ShaderPass(
      new THREE.ShaderMaterial(mixShader),
      "baseTexture",
    );
    mix.material.uniforms.bloomTexture.value = glow.renderTarget2.texture;
    final.addPass(mix);
    final.addPass(new OutputPass());
    return { glow, final, source, bloom, mix };
  }, [gl, scene, camera, strength, radius]);

  useEffect(() => {
    pipeline.final.setPixelRatio(dpr);
    pipeline.final.setSize(size.width, size.height);
    // The glow is soft; half resolution is indistinguishable and 4× cheaper.
    pipeline.glow.setPixelRatio(dpr * 0.5);
    pipeline.glow.setSize(size.width, size.height);
  }, [pipeline, size.width, size.height, dpr]);

  useEffect(
    () => () => {
      pipeline.source.dispose();
      pipeline.bloom.dispose();
      pipeline.mix.material.dispose();
      pipeline.mix.dispose();
      pipeline.glow.dispose();
      pipeline.final.dispose();
    },
    [pipeline],
  );

  // Priority 1 hands rendering over from R3F to the composers.
  useFrame(() => {
    pipeline.glow.render();
    pipeline.final.render();
  }, 1);

  return null;
}
