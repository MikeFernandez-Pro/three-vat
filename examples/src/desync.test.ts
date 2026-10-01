// The policy line's desync: the moment the line plays, every soldier is
// already walking, each at a very different point of one clip, and no two
// neighbours close together. Asked of the library's own frame resolution, as
// the shader asks it, under the policy the page opens on, so the test reads
// the phase the page shows.
import { describe, expect, it } from 'vitest'
import { LoopMode, resolveVATFrame, type VATClip } from 'three-vat'
import { headStartOf } from './desync.js'

// Soldier's Walk, as the bake lays it out: 31 rows at 30 fps.
const walk = { name: 'Walk', startFrame: 0, frames: 31, fps: 30, duration: 31 / 30 } as VATClip

/** Each soldier of a line `count` long, played at `now` under the page's opening policy: repeat twice, then clamp. */
function lineAt(count: number, now: number) {
  return Array.from({ length: count }, (_, i) =>
    resolveVATFrame(
      { clip: walk, startTime: now - headStartOf(i, count, walk.duration), loopMode: LoopMode.Repeat, repetitions: 2 },
      now,
    ),
  )
}

describe('headStartOf', () => {
  it('has every soldier walking the moment the line plays', () => {
    for (const frame of lineAt(5, 10)) expect(frame.finished).toBe(false)
  })

  it('spreads the line evenly over the whole clip at once', () => {
    const count = 5
    const sorted = lineAt(count, 10)
      .map((frame) => frame.phase)
      .sort((a, b) => a - b)
    for (let i = 1; i < count; i++) expect(sorted[i]! - sorted[i - 1]!).toBeCloseTo(1 / count, 5)
  })

  it('keeps neighbours far apart in the clip, never one step along', () => {
    const phases = lineAt(5, 10).map((frame) => frame.phase)
    for (let i = 1; i < phases.length; i++) {
      const gap = Math.abs(phases[i]! - phases[i - 1]!)
      expect(Math.min(gap, 1 - gap)).toBeGreaterThan(0.3)
    }
  })

  it('spreads a line of any length over distinct points of the clip', () => {
    for (const count of [2, 3, 4, 6, 7, 8]) {
      const distinct = new Set(lineAt(count, 10).map((frame) => Math.round(frame.phase * count) % count))
      expect(distinct.size).toBe(count)
    }
  })
})
