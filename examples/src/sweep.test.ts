// The twisted crowd's cube swings along its line on a cosine: it slows into
// each end, turns, and comes back, with no hard stop anywhere. And a cube let
// go mid-line picks the swing up from where it was dropped, the way it was
// going. Both are held here, where they run without a renderer.
import { describe, expect, it } from 'vitest'
import { headingAt, phaseAt, sweepAt } from './sweep.js'

const STEP = 1e-4
/** How fast the cube moves at a phase, in half-lines per radian. */
const speed = (phase: number) => (sweepAt(phase + STEP) - sweepAt(phase - STEP)) / (2 * STEP)

describe('sweepAt', () => {
  it('starts on the right and runs the whole line, end to end', () => {
    expect(sweepAt(0)).toBe(1)
    expect(sweepAt(Math.PI)).toBeCloseTo(-1, 12)
    for (let phase = 0; phase < 2 * Math.PI; phase += 0.01) {
      expect(Math.abs(sweepAt(phase))).toBeLessThanOrEqual(1)
    }
  })

  it('eases into both ends: it all but stops there', () => {
    expect(Math.abs(speed(0))).toBeLessThan(1e-6)
    expect(Math.abs(speed(Math.PI))).toBeLessThan(1e-6)
    // Fastest in the middle of the line.
    expect(Math.abs(speed(Math.PI / 2))).toBeCloseTo(1, 6)
  })

  it('is continuous through the turn, in where it is and how fast it goes', () => {
    for (const end of [0, Math.PI, 2 * Math.PI]) {
      expect(Math.abs(sweepAt(end + STEP) - sweepAt(end - STEP))).toBeLessThan(1e-6)
      expect(Math.abs(speed(end + 0.001) - speed(end - 0.001))).toBeLessThan(0.01)
    }
  })

  it('heads left on the way out and right on the way back', () => {
    expect(headingAt(Math.PI / 2)).toBe(-1)
    expect(headingAt((3 * Math.PI) / 2)).toBe(1)
  })
})

describe('phaseAt', () => {
  it('picks the swing up where a cube was let go, the way it was going', () => {
    for (const x of [-0.9, -0.3, 0, 0.4, 0.95]) {
      for (const heading of [-1, 1] as const) {
        const phase = phaseAt(x, heading)
        expect(sweepAt(phase)).toBeCloseTo(x, 9)
        expect(headingAt(phase)).toBe(heading)
      }
    }
  })

  it('takes a cube dragged past the line as standing at its end', () => {
    expect(sweepAt(phaseAt(1.2, -1))).toBeCloseTo(1, 9)
    expect(sweepAt(phaseAt(-3, 1))).toBeCloseTo(-1, 9)
  })
})
