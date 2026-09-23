// A crowd twisted toward a target after the VAT has posed it: where each
// instance stands, how far it turns, and what the HUD says about it.
//
// Kept free of three.js, the DOM *and* three-vat, like `crowd.ts` and
// `spawning.ts` beside it. The deform pages bring the deformation — the
// caller's own GLSL on the WebGL path, the caller's own node graph on the TSL
// one — and this file brings the arithmetic underneath both of them, so the two
// pages twist one crowd rather than two similar ones.
//
// The rule, stated once and implemented three times on purpose (here, in GLSL,
// in TSL): an instance yaws toward the target by the angle from where it
// *stands* to it, clamped so the crowd leans rather than spins, scaled by a
// gain of its own, and eased in with height so its feet stay planted. The
// JavaScript copy is not a fourth renderer — it is what lets the HUD report the
// twist the crowd is actually under, which ADR-0020 requires of every figure a
// page shows.

/** The top of the count slider — the whole grid, filled. */
export const MAX_COUNT = 180;

/**
 * Instances across the grid. Wide enough that the crowd's far edges read the
 * target at a different angle from its middle — which is the evidence that the
 * angle is per instance — and no wider than the camera's opening frame.
 */
export const COLUMNS = 15;

/** Rows into the grid. */
export const DEPTH = MAX_COUNT / COLUMNS;

/**
 * Ground spacing as a multiple of an instance's real width, as `CLEARANCE` is
 * for the crowd pages. Roomier than shoulder to shoulder, because a twist is a
 * silhouette and a crowd packed tight hides it in its neighbours.
 */
export const SPACING = 1.35;

/** Where one instance stands: the ground, and what the shader is handed about it. */
export interface Home {
  x: number;
  z: number;
  /** How much of the clamped angle this instance takes — its own, and fixed. */
  gain: number;
}

/** A point on the ground the crowd can be asked to look at. */
export interface Target {
  x: number;
  z: number;
}

/**
 * Where instance `index` stands, centred on the origin.
 *
 * Row-major, so the count slider fills the grid a row at a time and the crowd
 * a visitor sees at any count is a block rather than a scatter — and from the
 * **front** row back, because the count draws a prefix of this layout and a
 * crowd that filled in from the horizon would put its first robots where they
 * are hardest to watch. Nothing here moves: the whole page is about a crowd
 * that stands still and turns.
 */
export function cellOf(index: number, pitch: number): { x: number; z: number } {
  const column = index % COLUMNS;
  const depth = Math.floor(index / COLUMNS);
  return {
    x: (column - (COLUMNS - 1) / 2) * pitch,
    z: ((DEPTH - 1) / 2 - depth) * pitch,
  };
}

/**
 * How far instance `index` turns, as a fraction of the clamped angle.
 *
 * Per instance and keyed by the index, because a crowd that turns in perfect
 * unison reads as one object rotating rather than as many characters looking —
 * and because reading it *through the index* is the whole of what the hook's
 * `vatInstanceIndex` is for. The band bottoms out well above zero: an instance
 * that ignored the target would read as a bug rather than as variety.
 */
export function gainOf(index: number): number {
  // The golden-ratio stride, as `yawOf` uses it: an even spread with no
  // sequence a neighbouring pair could fall into.
  return 0.55 + ((index * 0.6180339887) % 1) * 0.45;
}

/** Floats per instance in the home texture — one RGBA texel: x, z, gain, unused. */
export const HOME_TEXELS = 4;

/**
 * The per-instance data the shader reads by index, as the texture's own bytes:
 * one texel per instance, `x` and `z` where it stands and `z`'s neighbour its
 * gain.
 *
 * The whole grid, not the drawn prefix: the texture is written once and the
 * count slider moves how many instances are drawn, never what row `i` holds.
 */
export function homeRows(pitch: number): Float32Array {
  const rows = new Float32Array(MAX_COUNT * HOME_TEXELS);
  for (let index = 0; index < MAX_COUNT; index++) {
    const { x, z } = cellOf(index, pitch);
    rows.set([x, z, gainOf(index), 0], index * HOME_TEXELS);
  }
  return rows;
}

/**
 * The angle one instance twists by — the rule both decode paths implement.
 *
 * `atan( dx, dz )` and not `atan( dz, dx )`: the crowd is authored facing `+z`,
 * and a positive rotation about `y` takes `+z` toward `+x`, so this is the yaw
 * that points a standing instance at the target. The clamp is what makes it a
 * twist: a target behind the crowd turns a head as far as it goes and no
 * further, rather than spinning a torso through the back it is attached to.
 */
export function twistAngleOf(home: Home, target: Target, limit: number): number {
  const angle = Math.atan2(target.x - home.x, target.z - home.z);
  return Math.max(-limit, Math.min(limit, angle)) * home.gain;
}

/**
 * The widest twist on screen right now, in radians — measured over the
 * instances that are drawn, and not over the layout they are a prefix of.
 *
 * This is the HUD's number, and it is the crowd's rather than the control's:
 * the limit says what the crowd *may* do, and a visitor dragging the target
 * away from the field should watch the twist fall off on its own.
 */
export function widestTwist(count: number, pitch: number, target: Target, limit: number): number {
  let widest = 0;
  for (let index = 0; index < count; index++) {
    const { x, z } = cellOf(index, pitch);
    widest = Math.max(widest, Math.abs(twistAngleOf({ x, z, gain: gainOf(index) }, target, limit)));
  }
  return widest;
}

/**
 * Where the twist starts and where it has all arrived, in the bake's own units.
 *
 * In the bake's units because the chunk runs *before* the instance matrix has
 * scaled anything — and derived from the baked bounds rather than typed in, so
 * the same page works on a model of any size. Knee to shoulder, roughly: below
 * the knee nothing turns, which is what keeps the feet planted and the twist
 * reading as a twist.
 */
export function twistProfile(minY: number, height: number): { knee: number; span: number } {
  return { knee: minY + height * 0.25, span: height * 0.45 };
}

/** The twist the crowd is under, as the HUD says it. */
export function twistLine(limit: number): string {
  return `widest right now, of a ${Math.round((limit * 180) / Math.PI)}° limit — each instance reads the target for itself`;
}

/** The crowd, as the HUD says it. Shared, so the pair cannot word it differently. */
export function crowdLine(count: number): string {
  return `${count} ${count === 1 ? "robot" : "robots"}, each twisting by its own angle — position and normal together, so the twist is lit as well as drawn`;
}
