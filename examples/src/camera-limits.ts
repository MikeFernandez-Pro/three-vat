// The camera every page shares: it orbits the subject and zooms, within limits,
// and never pans. Without them a wheel turned too far went through the
// soldiers or out to a dot, and a right-drag left the subject behind.
//
// The limits are webgpu_tsl_occlusion_dither's — 6 to 25 from a start about
// 16.6 away, a polar stop short of the floor — scaled to each page's own
// framing, since the pages start anywhere from 11 to 49 away.
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface Limits {
  minDistance: number;
  maxDistance: number;
  /** Radians from straight down the y axis; under a half pi, above the floor. */
  maxPolarAngle: number;
}

/** The limits for a page whose camera starts `distance` from its target. */
export function limitsFor(distance: number): Limits {
  return { minDistance: distance * 0.36, maxDistance: distance * 1.5, maxPolarAngle: Math.PI * 0.45 };
}

/** Limit `controls` from where its camera stands now: the page's framing. */
export function limitCamera(controls: OrbitControls): void {
  const distance = controls.object.position.distanceTo(controls.target);
  Object.assign(controls, limitsFor(distance), { enablePan: false });
}
