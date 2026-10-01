// The playback policy lineup: one soldier per loop mode, side by side, every
// one answering the same repetitions, end mode and speed from the panel. The
// line is written here as the page writes it, and asked of the library's own
// frame resolution, as the shader asks it, so the test reads what the line
// shows rather than what the page meant.
import { describe, expect, it } from 'vitest'
import { EndMode, endsAt, LoopMode, resolveVATFrame, type VATClip, type VATInstance } from 'three-vat'
import { labelOf, LINEUP } from './policy-lineup.js'

// Soldier's Walk, as the bake lays it out: 31 rows at 30 fps.
const walk = { name: 'Walk', startFrame: 0, frames: 31, fps: 30, duration: 31 / 30 } as VATClip
const policy = { repetitions: 2, endMode: EndMode.Clamp, speed: 1 }

/** The line played from `now`, written as the page writes it. */
function lineAt(now: number, { repetitions, endMode, speed } = policy): VATInstance[] {
  return LINEUP.map(({ loopMode, counted }) => ({
    clip: walk,
    startTime: now,
    loopMode,
    repetitions: counted ? repetitions : undefined,
    endMode,
    speed,
  }))
}

describe('LINEUP', () => {
  it('is one soldier per loop mode: Repeat, Once, PingPong, in that order', () => {
    expect(LINEUP.map(({ loopMode }) => loopMode)).toEqual([LoopMode.Repeat, LoopMode.Once, LoopMode.PingPong])
  })

  it('has Repeat and PingPong play the count, and Once play once whatever it says', () => {
    const [repeat, once, pingPong] = lineAt(0, { ...policy, repetitions: 3 })
    expect(endsAt(repeat!)).toBeCloseTo(3 * walk.duration)
    expect(endsAt(pingPong!)).toBeCloseTo(3 * walk.duration)
    expect(endsAt(once!)).toBeCloseTo(walk.duration)
  })

  it('has every soldier walking the moment the line plays, and every one finished by the last end', () => {
    const line = lineAt(10)
    for (const instance of line) expect(resolveVATFrame(instance, 10).finished).toBe(false)
    const last = Math.max(...line.map((instance) => endsAt(instance)!))
    for (const instance of line) expect(resolveVATFrame(instance, last + 0.01).finished).toBe(true)
  })

  it('has the whole line answer the speed', () => {
    for (const instance of lineAt(0, { ...policy, speed: 2 })) expect(endsAt(instance)).toBeLessThanOrEqual(walk.duration + 1e-9)
  })
})

describe('labelOf', () => {
  it('names the loop mode, with the count where it is read', () => {
    expect(LINEUP.map((entry) => labelOf(entry, 2))).toEqual(['Repeat × 2', 'Once', 'PingPong × 2'])
  })
})
