// The camera every page shares: it orbits the subject and zooms, within limits,
// and never pans. Without them a wheel turned too far went through the
// soldiers or out to a dot, and a right-drag left the subject behind.
//
// The limits are webgpu_tsl_occlusion_dither's — 6 to 25 from a start about
// 16.6 away, a polar stop short of the floor — scaled to each page's own
// framing, since the pages start anywhere from 11 to 49 away. The panel's
// "camera" group tunes them live, and puts the view back.
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { Panel } from "./ui.js";

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

export interface CameraLimits {
  /** The "camera" group on the page's panel: the limits, the pan, a reset. */
  addTo(panel: Panel): void;
}

/** Limit `controls` from where its camera stands now: the page's framing. */
export function limitCamera(controls: OrbitControls): CameraLimits {
  const camera = controls.object;
  const start = camera.position.clone();
  const target = controls.target.clone();
  const distance = start.distanceTo(target);
  Object.assign(controls, limitsFor(distance), { enablePan: false });

  return {
    addTo(panel) {
      const group = panel.group("camera");
      const range = { min: 0.5, max: Math.ceil(distance * 3), step: 0.5 };
      const round = (value: number) => Math.round(value * 2) / 2;
      group.slider("min distance", { ...range, value: round(controls.minDistance) }, (value) => {
        controls.minDistance = value;
      });
      group.slider("max distance", { ...range, value: round(controls.maxDistance) }, (value) => {
        controls.maxDistance = value;
      });
      const degrees = Math.round((controls.maxPolarAngle * 180) / Math.PI);
      group.slider("max polar", { min: 10, max: 180, step: 1, value: degrees }, (value) => {
        controls.maxPolarAngle = (value * Math.PI) / 180;
      });
      group.toggle("pan", false, (pan) => {
        controls.enablePan = pan;
        // Panned off the subject, the orbit would stay off it: back to it.
        if (!pan) controls.target.copy(target);
      });
      group.button("reset view", () => {
        camera.position.copy(start);
        controls.target.copy(target);
      });
    },
  };
}
