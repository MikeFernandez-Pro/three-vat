// Where the studio's floor fades out, on both renderers (floor.ts and
// webgpu/floor.ts).

/**
 * The fade for a page whose camera starts `reach` from its target: solid under
 * everything the page frames, gone by the time the camera's own distance is.
 */
export function floorFadeFor(reach: number): { inner: number; outer: number } {
  return { inner: reach * 0.5, outer: reach * 1.1 };
}
