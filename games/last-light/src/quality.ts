// How much of the look a device draws: a ladder of steps, from the whole look
// down to fewer rats, and a governor that moves along it by how the frames
// come. Too many slow frames, and it steps down; a while of smooth ones, and
// it tries a step up. No renderer and no DOM, so it is tested in Node.
//
// A 60 Hz screen shows a frame every 16.7 ms however little the GPU needed,
// so room to spare cannot be read off the frames. The governor finds it by
// trying: it steps up, and if that step is too slow it comes back down and
// waits longer before trying again; failed twice, it never tries that step
// again. A phone that heats up only gets slower, so a step given up stays
// given up.
//
// Measured on an iPhone 15 Pro Max over WebGPU, 2,000 rats (2026-10-07): the
// whole look at a pixel ratio of 2 is 35 fps; without depth of field and AO,
// or at a pixel ratio of 1, it holds 60.

/** One step of the ladder: what is drawn, and the share of the rats asked for. */
export interface Step {
  dof: boolean
  ao: boolean
  dpr: number
  rats: number
}

/**
 * The ladder for a screen whose pixel ratio is drawn at `maxDpr` at most:
 * depth of field off, then AO, then the pixel ratio down to 1.5 and 1, then
 * half the rats and a quarter. A pixel ratio the screen does not go above is
 * no step.
 */
export function ladder(maxDpr: number): Step[] {
  const steps: Step[] = [
    { dof: true, ao: true, dpr: maxDpr, rats: 1 },
    { dof: false, ao: true, dpr: maxDpr, rats: 1 },
    { dof: false, ao: false, dpr: maxDpr, rats: 1 },
  ]
  for (const dpr of [1.5, 1]) if (dpr < maxDpr) steps.push({ dof: false, ao: false, dpr, rats: 1 })
  const lowest = steps[steps.length - 1].dpr
  for (const rats of [0.5, 0.25]) steps.push({ dof: false, ao: false, dpr: lowest, rats })
  return steps
}

/** Where a device starts: a phone without depth of field or AO, the most it held 60 fps with; anything else with the whole look. */
export function startingStep(steps: Step[], phone: boolean): number {
  return phone ? steps.findIndex((s) => !s.dof && !s.ao) : 0
}

/** The frames are judged over this long, ms. */
const WINDOW = 1500
/** After a change of step, frames are not judged for this long, ms: the new pipeline compiles, and the first frames hitch. */
const SETTLE = 1000
/** A frame longer than this is slow, ms: past one vsync at 60 Hz. */
const SLOW_FRAME = 20
/** More than this share of slow frames in a window, and the device is not keeping up. */
const SLOW_SHARE = 0.25
/** A gap longer than this is no frame, ms: the tab put away, or the page paused. */
const GAP = 250
/** How long the frames must keep up before a step up is tried, ms; doubled each time a try fails. */
const UP_WAIT = 5000
/** Tries at a step before it is given up. */
const TRIES = 2

export class Quality {
  /** The step drawn now: an index into the ladder, 0 the whole look. */
  level: number
  /** No step above this is tried again: those were too slow. */
  private ceiling = 0
  private readonly failures: number[]
  private windowStart = -1
  private frames = 0
  private slow = 0
  /** Until when frames are not judged, ms. */
  private settledAt: number
  /** How long the frames have kept up since the last change, ms. */
  private smooth = 0
  private upWait = UP_WAIT
  /** Stepped up and not yet judged at the new step: slow there, and the try failed. */
  private trying = false

  constructor(
    readonly steps: Step[],
    start: number,
  ) {
    this.level = start
    this.failures = steps.map(() => 0)
    this.settledAt = SETTLE
  }

  get step(): Step {
    return this.steps[this.level]
  }

  /** A frame `ms` long, ending at `now` ms: true when the step changes. */
  frame(ms: number, now: number): boolean {
    if (ms > GAP || now < this.settledAt) {
      this.windowStart = -1
      return false
    }
    if (this.windowStart < 0) {
      this.windowStart = now - ms
      this.frames = this.slow = 0
    }
    this.frames++
    if (ms > SLOW_FRAME) this.slow++
    if (now - this.windowStart < WINDOW) return false

    const keepingUp = this.slow <= this.frames * SLOW_SHARE
    const length = now - this.windowStart
    this.windowStart = -1
    if (!keepingUp) {
      this.smooth = 0
      if (this.trying) {
        // The step up was too slow: back down, wait longer, and after enough tries give it up.
        this.trying = false
        if (++this.failures[this.level] >= TRIES) this.ceiling = this.level + 1
        this.upWait *= 2
      }
      if (this.level === this.steps.length - 1) return false
      return this.change(this.level + 1, now)
    }
    if (this.trying) {
      this.trying = false
      this.upWait = UP_WAIT
    }
    this.smooth += length
    if (this.smooth < this.upWait || this.level <= this.ceiling) return false
    this.trying = true
    return this.change(this.level - 1, now)
  }

  private change(level: number, now: number): boolean {
    this.level = level
    this.smooth = 0
    this.settledAt = now + SETTLE
    return true
  }
}
