// Where the studio's floor fades out, on both renderers (floor.ts and
// webgpu/floor.ts), and the panel's "floor" group that tunes it live.
import type { Panel } from "./ui.js";

/** A radius on the floor, as either renderer holds it: a uniform's value. */
export interface FloorFade {
  /** Fully opaque inside this radius. */
  inner: { value: number };
  /** Gone past this one. */
  outer: { value: number };
}

/**
 * The fade for a page whose camera starts `reach` from its target: solid under
 * everything the page frames, gone by the time the camera's own distance is.
 */
export function floorFadeFor(reach: number): { inner: number; outer: number } {
  return { inner: reach * 0.5, outer: reach * 1.1 };
}

/** The "floor" group on the page's panel. */
export function addFloorControls(panel: Panel, fade: FloorFade): void {
  const group = panel.group("floor");
  // Inside the floor's 400-wide plane.
  const range = { min: 0, max: 200, step: 0.5 };
  const round = (value: number) => Math.round(value * 2) / 2;
  group.slider("fade start", { ...range, value: round(fade.inner.value) }, (value) => {
    fade.inner.value = value;
  });
  group.slider("fade end", { ...range, value: round(fade.outer.value) }, (value) => {
    fade.outer.value = value;
  });
}
