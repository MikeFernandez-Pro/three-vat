// The capture plan is the hero GIF's storyboard, and it is pure — so the thing
// the recording has to prove (the count climbing across every band) is asserted
// here, in CI, rather than eyeballed in a GIF nobody re-watches.
import { describe, expect, it } from 'vitest'
import { BANDS, MAX_COUNT } from '../../examples/src/crowd.js'
import { capturePlan } from './plan.mjs'

const plan = () => capturePlan({ maxCount: MAX_COUNT, frames: 40, holdStart: 4, holdEnd: 6 })

describe('the capture plan', () => {
  it('is exactly as long as the recording asked for', () => {
    expect(plan()).toHaveLength(40)
  })

  it('opens on the single robot and holds there', () => {
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

  it('asks the slider for counts it can actually take', () => {
    for (const { count } of plan()) {
      expect(Number.isInteger(count)).toBe(true)
      expect(count).toBeGreaterThanOrEqual(1)
      expect(count).toBeLessThanOrEqual(MAX_COUNT)
    }
  })

  it('reaches every band, so the recording shows walkers and runners arrive', () => {
    // The whole reason the GIF is a drag and not a screenshot: a reader has to
    // see the crowd cross each threshold (ADR-0012).
    const counts = plan().map((f) => f.count)
    for (const band of BANDS) {
      expect(counts.some((count) => count >= band.from), band.label).toBe(true)
    }
  })

  it('places each count where the slider track puts it', () => {
    // The driver moves a mouse, not a variable: `fraction` is where along the
    // track that count lives, and lil-gui reads the track linearly.
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
