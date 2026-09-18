// The hero GIF's storyboard: which count each recorded frame is taken at.
//
// Pure, and kept apart from the driver that screenshots the browser, because
// this is the half that carries the argument — the crowd has to climb from one
// robot to the whole crowd, through every band, with a beat at each end so a
// looping GIF reads as a drag and not a flicker (ADR-0012). That is assertable
// in CI; a browser on a GPU is not.
//
// The plan speaks in *slider positions*, not in assignments to `params.count`.
// The driver moves a real mouse across the real control, so what the GIF shows
// is the demo a reader will touch, and `fraction` is where along the track a
// given count lives. lil-gui reads its track linearly, so the mapping is too.

/**
 * @typedef {object} HeroFrame
 * @property {number} count    Robots on screen when this frame is taken.
 * @property {number} fraction Where along the slider track that count sits, 0..1.
 */

/**
 * @typedef {object} CapturePlanOptions
 * @property {number} maxCount  Top of the count slider.
 * @property {number} frames    Total frames in the recording, holds included.
 * @property {number} holdStart Frames held on the single robot before the drag.
 * @property {number} holdEnd   Frames held on the full crowd after it.
 */

/**
 * The frames to record, in order.
 *
 * The drag itself is linear in count, which is what a hand on a slider does —
 * and what makes the draw-call readout's stillness legible, since the crowd
 * grows at a steady rate beside a number that does not move at all.
 *
 * @param {CapturePlanOptions} options
 * @returns {HeroFrame[]}
 */
export function capturePlan({ maxCount, frames, holdStart, holdEnd }) {
  // Two drag frames minimum: one to leave 1, one to arrive at `maxCount`. Fewer
  // and the "recording" is two stills with nothing between them, which is the
  // stale screenshot this script exists to replace.
  const dragFrames = frames - holdStart - holdEnd
  if (dragFrames < 2) {
    throw new Error(
      `a ${frames}-frame plan holding ${holdStart} + ${holdEnd} leaves ${dragFrames} frames of drag; at least 2 are needed`,
    )
  }

  const at = (/** @type {number} */ count) => ({
    count,
    fraction: (count - 1) / (maxCount - 1),
  })

  return [
    ...Array.from({ length: holdStart }, () => at(1)),
    // The drag's own frames sit strictly *between* the extremes: the holds are
    // the only frames showing 1 and the only frames showing `maxCount`, so each
    // hold reads as a beat rather than as one frame of a ramp that paused. The
    // clamp only bites on a plan with more drag frames than robots, where the
    // ramp would otherwise step onto an extreme it does not own.
    ...Array.from({ length: dragFrames }, (_, i) =>
      at(
        Math.min(
          maxCount - 1,
          Math.max(2, 1 + Math.round(((maxCount - 1) * (i + 1)) / (dragFrames + 1))),
        ),
      ),
    ),
    ...Array.from({ length: holdEnd }, () => at(maxCount)),
  ]
}
