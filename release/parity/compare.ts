// Frame comparison for the cross-path release gate (#14).
//
// Everything else in the gate is a browser, a GPU and two renderers; this is the
// part that decides pass or fail, and it is deliberately none of those. Pure
// typed-array arithmetic, so the tolerance that the whole gate rests on is
// pinned by a test that runs in CI (compare.test.ts) rather than by whatever a
// developer's GPU happened to produce the day it was written.

/** Frame dimensions in pixels. Frames are RGBA8, four bytes per pixel. */
export interface FrameSize {
  width: number;
  height: number;
}

/**
 * One path's contribution to the gate: the three frames it renders.
 *
 * Declared here, with the comparison, rather than with either renderer — both
 * paths produce one of these and the verdict reads two, so it belongs to none
 * of the three.
 */
export interface PathFrames {
  /** The rest-pose mesh, no VAT: the backends' own shading, with no decode in it. */
  calibration: Uint8Array;
  /** The crowd at `TIME`. This is the comparison. */
  clean: Uint8Array;
  /** The crowd one baked frame late: geometry in the wrong place (see `FAULT_FRAMES`). */
  slipped: Uint8Array;
  /** The crowd with every baked normal's x negated: geometry exact, shading wrong. */
  wrongNormals: Uint8Array;
  /**
   * The decode's *inputs*, painted as colour instead of sampled: the vertex's
   * texel column and its instance's clip band. Not a picture of a crowd — a
   * picture of the addressing, which is what separates "the two paths read
   * different texels" from "they read the same texels and do different things
   * with them".
   */
  probe: Uint8Array;
  /**
   * The decode's time-to-row arithmetic, painted rather than sampled: the exact
   * texture row this vertex would read, and the blend factor between it and the
   * next. With {@link PathFrames.probe}, every input the texture read receives.
   */
  sampleProbe: Uint8Array;
  /**
   * The same crowd on the second carrier — a `BatchedMesh`, culling and sorting
   * per instance at three's defaults, one material because a batch takes one.
   * Compared across the paths, this is the carrier's own parity check.
   */
  batched: Uint8Array;
  /**
   * {@link PathFrames.batched} again, with the batch's draw order reversed and
   * nothing else changed — the stripe test. A decode reading the pack by the
   * drawn slot renders a different crowd here; one reading it by the logical
   * index renders the same pixels.
   */
  batchedReordered: Uint8Array;
}

/** What one comparison of two frames found. */
export interface FrameDiff {
  /** Every pixel in the frame. */
  pixels: number;
  /** Pixels the two frames between them put something in — the crowd, not the backdrop. */
  drawn: number;
  /** Pixels whose worst channel moved further than the channel tolerance. */
  differing: number;
  /**
   * `differing / drawn` — the share of the *picture* that moved, not the share
   * of the canvas. Measured against the backdrop the budget would grow every
   * time the camera pulled back, which is a tolerance that loosens itself.
   */
  differingFraction: number;
  maxChannelDelta: number;
  meanChannelDelta: number;
}

/**
 * The gate's tolerance, and the one number in this repository that is a
 * judgement call rather than a derivation.
 *
 * Two budgets, because the two failure modes look nothing alike. A backend
 * difference is *shallow and everywhere*: every pixel a shade off, because two
 * BRDF implementations round differently. A decode divergence is *deep and
 * somewhere*: a silhouette in the wrong place, a band of pixels holding
 * background where there should be a robot, a face lit from the wrong side. So a
 * channel move of up to 8/255 is not counted at all, and up to 2% of the *drawn*
 * pixels may move past it — enough for a silhouette's worth of rasterisation
 * edges, far less than any vertex or normal that decoded wrong.
 *
 * Drawn, not total: a budget measured against the whole canvas is a budget that
 * grows every time the camera pulls back, which is a tolerance that loosens
 * itself for free.
 *
 * The self-tests in the harness are what keep these honest: a one-frame slip and
 * a wrong-normal decode, on either path, both have to blow through them.
 */
export const PARITY_TOLERANCE = {
  /** Per-channel move, 0-255, that is not counted as a differing pixel. */
  channelDelta: 8,
  /** Share of the drawn pixels allowed to differ past that. */
  differingFraction: 0.02,
} as const;

export type ParityTolerance = typeof PARITY_TOLERANCE;

/**
 * Compare two RGBA8 frames, channel by channel.
 *
 * Alpha is skipped: the two backends write it into a render target differently
 * and nothing about the decode is visible in it.
 */
export function diffFrames(a: Uint8Array, b: Uint8Array, size: FrameSize): FrameDiff {
  const pixels = size.width * size.height;
  if (a.length !== pixels * 4 || b.length !== pixels * 4) {
    throw new Error(
      `parity: frame size mismatch — expected ${pixels * 4} bytes for ${size.width}x${size.height}, got ${a.length} and ${b.length}`,
    );
  }

  const backgroundA = medianColor(a);
  const backgroundB = medianColor(b);

  let drawn = 0;
  let differing = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;

  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a[i + c]! - b[i + c]!);
      totalChannelDelta += delta;
      if (delta > worst) worst = delta;
    }
    if (worst > maxChannelDelta) maxChannelDelta = worst;
    if (worst > PARITY_TOLERANCE.channelDelta) differing++;
    if (isDrawn(a, i, backgroundA) || isDrawn(b, i, backgroundB)) drawn++;
  }

  return {
    pixels,
    drawn,
    differing,
    // A frame pair with nothing drawn in it divides by zero; it is also the case
    // the blank guard exists to fail, so report no difference and let it.
    differingFraction: drawn === 0 ? 0 : differing / drawn,
    maxChannelDelta,
    meanChannelDelta: totalChannelDelta / (pixels * 3),
  };
}

/** Is there something other than the backdrop at this pixel? */
function isDrawn(frame: Uint8Array, i: number, background: readonly [number, number, number]): boolean {
  return (
    Math.max(
      Math.abs(frame[i]! - background[0]),
      Math.abs(frame[i + 1]! - background[1]),
      Math.abs(frame[i + 2]! - background[2]),
    ) > PARITY_TOLERANCE.channelDelta
  );
}

/** Does this difference sit inside the gate's budget? */
export function withinTolerance(diff: FrameDiff, tolerance: ParityTolerance = PARITY_TOLERANCE): boolean {
  return diff.differingFraction <= tolerance.differingFraction;
}

/**
 * Turn a bottom-up readback into a top-down one.
 *
 * WebGL hands back rows from the bottom of the framebuffer up; WebGPU hands them
 * back from the top down. Comparing the two without this is comparing a frame
 * with its own reflection — which fails, loudly, for a reason that has nothing
 * to do with the decode. The harness flips at the WebGL readback and then
 * checks that it guessed right (see `orientationOf`).
 */
export function flipRows(frame: Uint8Array, size: FrameSize): Uint8Array {
  const stride = size.width * 4;
  const flipped = new Uint8Array(frame.length);
  for (let y = 0; y < size.height; y++) {
    flipped.set(frame.subarray(y * stride, (y + 1) * stride), (size.height - 1 - y) * stride);
  }
  return flipped;
}

/**
 * Which way up does `b` have to be to match `a`?
 *
 * A readback convention is a thing a renderer is free to change, and if one of
 * them ever does, every frame in this gate diverges at once. That deserves its
 * own verdict — "the frames are upside down relative to each other" — rather
 * than being reported as a decode failure and sending someone into the shaders.
 */
export function orientationOf(a: Uint8Array, b: Uint8Array, size: FrameSize): "upright" | "flipped" {
  const upright = diffFrames(a, b, size);
  if (withinTolerance(upright)) return "upright";
  return withinTolerance(diffFrames(a, flipRows(b, size), size)) ? "flipped" : "upright";
}

/**
 * Is there nothing drawn in this frame?
 *
 * Guards the guard. Two frames of empty background match perfectly, so a harness
 * that failed to build a crowd on *either* path — a bad model URL, a renderer
 * that never initialised — would otherwise report the cleanest pass of its life.
 *
 * The background colour is taken as the frame's per-channel median rather than a
 * corner pixel: a median cannot be moved by whatever is drawn in the frame
 * unless the frame is mostly drawn in, which is the case this is trying to
 * recognise. A frame is blank when less than `occupancy` of it differs from that.
 */
export function isBlank(frame: Uint8Array, occupancy = 0.02): boolean {
  const pixels = frame.length / 4;
  const background = medianColor(frame);
  let drawn = 0;
  for (let p = 0; p < pixels; p++) if (isDrawn(frame, p * 4, background)) drawn++;
  return drawn / pixels < occupancy;
}

/** The frame's per-channel median — its background, for any frame not mostly covered. */
function medianColor(frame: Uint8Array): readonly [number, number, number] {
  const pixels = frame.length / 4;
  const median = (channel: number) => {
    const values = new Uint8Array(pixels);
    for (let p = 0; p < pixels; p++) values[p] = frame[p * 4 + channel]!;
    values.sort();
    return values[pixels >> 1]!;
  };
  return [median(0), median(1), median(2)];
}
