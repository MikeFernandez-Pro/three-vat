// The twisted crowd's cube, swinging along its line: a cosine of a phase, so it
// slows into each end, turns and comes back, rather than running flat out into
// a hard stop and reversing at once.
//
// In half-lines: -1 is the left end of the line, 1 the right, and the page
// scales it to metres. Kept free of three.js and the DOM so it runs in Node,
// where sweep.test.ts holds it.

/** Where the cube is at a phase of its swing: on the right at 0, on the left at a half turn. */
export function sweepAt(phase: number): number {
  return Math.cos(phase);
}

/** Which way the cube is going at a phase: left (-1) on the way out, right (1) on the way back. */
export function headingAt(phase: number): -1 | 1 {
  const turn = 2 * Math.PI;
  return ((phase % turn) + turn) % turn < Math.PI ? -1 : 1;
}

/**
 * The phase that puts the cube at `x`, heading `heading`: where a swing picks
 * up from a cube let go mid-line, so it carries on the way it was going.
 */
export function phaseAt(x: number, heading: -1 | 1): number {
  const out = Math.acos(Math.min(1, Math.max(-1, x)));
  return heading === -1 ? out : 2 * Math.PI - out;
}
