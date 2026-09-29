// The capture plan is the hero GIF's storyboard, and it is pure — so the thing
// the recording has to prove (the count climbing from one soldier to the whole
// crowd) is asserted here, in CI, rather than eyeballed in a GIF nobody re-watches.
import { describe, expect, it } from 'vitest'
import { capturePlan } from './plan.mjs'

// The plan's own input, not the page's: the capture reads its maximum off the
// page's slider (capture.mjs), so what is pinned here is what the plan does
// with whatever top it is handed.
const MAX_COUNT = 500

const plan = () => capturePlan({ maxCount: MAX_COUNT, frames: 40, holdStart: 4, holdEnd: 6 })

describe('the capture plan', () => {
  it('is exactly as long as the recording asked for', () => {
    expect(plan()).toHaveLength(40)
  })

  it('opens on the single soldier and holds there', () => {
    for (const frame of plan().slice(0, 4)) {
      expect(frame).toEqual({ count: 1, fraction: 0 })
    }
    // The fifth frame is where the drag starts, so the hold is a hold and not
    // an off-by-one that shows the crowd already moving.
    expect(plan()[4]!.count).toBeGreaterThan(1)
  })

  it('ends on the full crowd and holds there', () => {
    for (const frame of plan().slice(-6)) {
      expect(frame).toEqual({ count: MAX_COUNT, fraction: 1 })
    }
    const frames = plan()
    expect(frames[frames.length - 7]!.count).toBeLessThan(MAX_COUNT)
  })

  it('never goes backwards', () => {
    const counts = plan().map((f) => f.count)
    for (const [i, count] of counts.entries()) {
      if (i > 0) expect(count).toBeGreaterThanOrEqual(counts[i - 1]!)
    }
  })

  it('climbs through the drag, a new count every frame', () => {
    // Between the holds, a count repeated is a stall the GIF would show as a
    // hitch in the hand: never going backwards is not the same as moving.
    const drag = plan().slice(4, -6).map((f) => f.count)
    for (const [i, count] of drag.entries()) {
      if (i > 0) expect(count).toBeGreaterThan(drag[i - 1]!)
    }
  })

  it('asks the slider for counts it can actually take', () => {
    for (const { count } of plan()) {
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(MAX_COUNT)
    }
  })

  it('places each count where the slider track puts it', () => {
    // The driver moves a mouse, not a variable: `fraction` is where along the
    // track that count lives, and the ui panel's range input reads its track
    // linearly.
    for (const { count, fraction } of plan()) {
      expect(fraction).toBeGreaterThanOrEqual(0)
      expect(fraction).toBeLessThanOrEqual(1)
      expect(fraction).toBeCloseTo((count - 1) / (MAX_COUNT - 1), 5)
    }
  })

  it('refuses a plan with no drag left in it', () => {
    expect(() => capturePlan({ maxCount: MAX_COUNT, frames: 10, holdStart: 5, holdEnd: 5 })).toThrow(
      /drag/i,
    )
  })
})
