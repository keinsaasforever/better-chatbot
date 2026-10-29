import type * as THREE from "three";

/** Scene time in seconds; frozen at 0 for reduced motion. */
export function sceneTime(state: { clock: THREE.Clock }, animate: boolean) {
  return animate ? state.clock.elapsedTime : 0;
}
