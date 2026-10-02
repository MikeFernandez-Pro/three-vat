// The pause (ADR-0041): one instance's own clock stopping at a moment while the
// shared clock runs on, and resuming from exactly there. Everything here asserts
// what a caller can see: what `resolveVATFrame` and `endsAt` answer for the
// instance a pause or a resume hands back, and what the playback texture holds
// after the write.
import { describe, expect, it } from 'vitest'
import {
  createVATPlaybackTexture,
  endsAt,
  EndMode,
  LoopMode,
  PACK_TEXELS,
  PACK_WIDTH,
  pauseVATInstance,
  resolveVATFrame,
  resumeVATInstance,
  setVATInstance,
  turnVATInstance,
} from './instance-playback.js'
import type { VATFrame, VATInstance, VATPlaybackTexture } from './instance-playback.js'
import * as core from './index.js'

const ten = { startFrame: 5, frames: 10, fps: 10 } // one second, rows 5 to 14
const eight = { startFrame: 20, frames: 8, fps: 16 } // half a second, rows 20 to 27

/** What a frame draws: both bands' rows, their mixes, and the weight between them. */
function drawn(frame: VATFrame) {
  return {
    row: frame.row,
    rowNext: frame.rowNext,
    mix: frame.mix,
    finished: frame.finished,
    outgoing: frame.outgoing && {
      row: frame.outgoing.row,
      rowNext: frame.outgoing.rowNext,
      mix: frame.outgoing.mix,
      weight: frame.outgoing.weight,
    },
  }
}

/** Two frames that draw the same thing, to float32's precision. */
function expectDrawn(actual: VATFrame, expected: VATFrame, where: string) {
  const a = drawn(actual)
  const e = drawn(expected)
  expect({ row: a.row, rowNext: a.rowNext, finished: a.finished }, where).toEqual({
    row: e.row,
    rowNext: e.rowNext,
    finished: e.finished,
  })
  expect(a.mix, where).toBeCloseTo(e.mix, 4)
  expect(a.outgoing === null, `${where}: transitioning`).toBe(e.outgoing === null)
  if (a.outgoing && e.outgoing) {
    expect({ row: a.outgoing.row, rowNext: a.outgoing.rowNext }, where).toEqual({
      row: e.outgoing.row,
      rowNext: e.outgoing.rowNext,
    })
    expect(a.outgoing.mix, where).toBeCloseTo(e.outgoing.mix, 4)
    expect(a.outgoing.weight, where).toBeCloseTo(e.outgoing.weight, 4)
  }
}

/** One instance's whole row, as plain numbers. */
const rowOf = (playback: VATPlaybackTexture, i: number) =>
  Array.from((playback.texture.image.data as Float32Array).slice(i * PACK_WIDTH * 4, (i + 1) * PACK_WIDTH * 4))

/** The component of the crossfade texel the pause sits in. */
const pauseOf = (playback: VATPlaybackTexture, i: number) => rowOf(playback, i)[PACK_TEXELS.crossfade * 4 + 2]!

const walking: VATInstance = { clip: ten, startTime: 0.25, speed: 1.5 }
const dying: VATInstance = { clip: ten, startTime: 0.25, loopMode: LoopMode.Once, endMode: EndMode.Clamp }
const rewinding: VATInstance = { ...dying, endMode: EndMode.Rewind }
/** A walk into the eight-frame clip, a quarter of the way through a 0.8 s blend at t = 2.45. */
const blending: VATInstance = {
  clip: eight,
  startTime: 2.25,
  speed: -0.75,
  from: { clip: ten, startTime: 0.1, speed: 1.25 },
  fadeDuration: 0.8,
}

const PAUSE = 2.45
const LATER = [PAUSE + 0.013, PAUSE + 0.5, PAUSE + 3.7, PAUSE + 41.3]

/** Write `instance` into a crowd of its own and pause it. */
function paused(instance: VATInstance, at = PAUSE) {
  const playback = createVATPlaybackTexture([instance])
  return { playback, instance: pauseVATInstance(playback, 0, at) }
}

describe('a paused instance', () => {
  for (const [name, instance] of [
    ['a walk', walking],
    ['a one-shot', dying],
    ['a blend', blending],
  ] as const) {
    it(`shows what it showed at the pause, at any later time: ${name}`, () => {
      const still = paused(instance).instance
      for (const t of LATER) expectDrawn(resolveVATFrame(still, t), resolveVATFrame(instance, PAUSE), `t = ${t}`)
    })

    it(`resumes from exactly there, as if the pause had never been: ${name}`, () => {
      const { playback } = paused(instance)
      const resume = 7.3
      const going = resumeVATInstance(playback, 0, resume)
      for (const x of [0, 0.013, 0.31, 0.62, 1.7, 9.1]) {
        expectDrawn(resolveVATFrame(going, resume + x), resolveVATFrame(instance, PAUSE + x), `${x} s after resuming`)
      }
    })
  }

  it('holds a crossfade’s weight, and the resume finishes the blend from there', () => {
    const before = resolveVATFrame(blending, PAUSE).outgoing!.weight
    expect(before, 'the pause falls mid-blend').toBeGreaterThan(0.5)
    expect(before).toBeLessThan(1)

    const { playback, instance: still } = paused(blending)
    for (const t of LATER) expect(resolveVATFrame(still, t).outgoing!.weight, `t = ${t}`).toBeCloseTo(before, 5)

    const going = resumeVATInstance(playback, 0, 10)
    expect(resolveVATFrame(going, 10).outgoing!.weight).toBeCloseTo(before, 5)
    // What was left of the blend when it paused, and no more.
    const left = blending.startTime + blending.fadeDuration! - PAUSE
    expect(resolveVATFrame(going, 10 + left - 0.01).outgoing!.weight).toBeGreaterThan(0)
    expect(resolveVATFrame(going, 10 + left + 0.01).outgoing!.weight).toBe(0)
  })

  it('does not finish, clamp or rewind a one-shot paused before its end', () => {
    for (const oneShot of [dying, rewinding]) {
      const still = paused(oneShot, 0.75).instance
      const pose = resolveVATFrame(oneShot, 0.75)
      expect(pose.finished).toBe(false)
      for (const t of [1.25, 1.26, 5, 100]) {
        expect(resolveVATFrame(oneShot, t).finished, 'it would have finished by now').toBe(true)
        expectDrawn(resolveVATFrame(still, t), pose, `t = ${t}`)
      }
    }
  })

  it('holds the end pose of a one-shot paused after its end, and resumes still finished', () => {
    const { playback, instance: still } = paused(dying, 3)
    expectDrawn(resolveVATFrame(still, 9), resolveVATFrame(dying, 3), 'held')
    expect(resolveVATFrame(resumeVATInstance(playback, 0, 9), 9.5).finished).toBe(true)
  })

  it('moves the end out by the length of the pause', () => {
    const end = endsAt(dying)!
    const { playback, instance: still } = paused(dying, 0.75)
    // Paused short of its end, it does not get there until something resumes it.
    expect(endsAt(still)).toBeNull()
    expect(endsAt(resumeVATInstance(playback, 0, 4))).toBeCloseTo(end + (4 - 0.75), 5)

    // Paused past it, it got there already.
    expect(endsAt(paused(dying, 3).instance)).toBeCloseTo(end, 5)
    // And an endless play has no end to move.
    expect(endsAt(paused(walking).instance)).toBeNull()
  })

  it('is left where it is by a turn', () => {
    for (const instance of [walking, dying, blending]) {
      const { playback, instance: still } = paused(instance)
      const before = rowOf(playback, 0)
      const turned = turnVATInstance(playback, 0, PAUSE + 1.3)
      expect(rowOf(playback, 0)).toEqual(before)
      expectDrawn(resolveVATFrame(turned, PAUSE + 2), resolveVATFrame(still, PAUSE + 2), 'after the turn')
    }
  })

  it('changes nothing when paused again', () => {
    const { playback } = paused(walking)
    const before = rowOf(playback, 0)
    const again = pauseVATInstance(playback, 0, PAUSE + 1)
    expect(rowOf(playback, 0)).toEqual(before)
    expectDrawn(resolveVATFrame(again, 9), resolveVATFrame(walking, PAUSE), 'still the first pause')
  })

  it('carries a turn made before the pause into the resume', () => {
    const playback = createVATPlaybackTexture([walking])
    const back = turnVATInstance(playback, 0, 1.6)
    pauseVATInstance(playback, 0, PAUSE)
    const going = resumeVATInstance(playback, 0, 5)
    expectDrawn(resolveVATFrame(going, 5.4), resolveVATFrame(back, PAUSE + 0.4), 'retracing again')
  })
})

describe('a pause still to come', () => {
  // Written by hand, a `pausedAt` may be ahead of the clock: the instance plays
  // until then, as the decodes' `min` has it, and is not paused yet.
  const scheduled = (at: number) => createVATPlaybackTexture([{ ...walking, pausedAt: at }])

  it('is turned like an instance that is moving, and keeps its pause', () => {
    const playback = scheduled(9)
    const back = turnVATInstance(playback, 0, 1.6)
    const unscheduled = turnVATInstance(createVATPlaybackTexture([walking]), 0, 1.6)
    expect(back.pausedAt).toBe(9)
    expectDrawn(resolveVATFrame(back, 2.3), resolveVATFrame(unscheduled, 2.3), 'retracing')
    expectDrawn(resolveVATFrame(back, 12), resolveVATFrame(unscheduled, 9), 'stopped where the retrace was at 9')
  })

  it('is brought forward by a pause now', () => {
    const playback = scheduled(9)
    const still = pauseVATInstance(playback, 0, PAUSE)
    expect(still.pausedAt).toBeCloseTo(PAUSE, 5)
    expectDrawn(resolveVATFrame(still, 5), resolveVATFrame(walking, PAUSE), 'stopped now')
  })
})

describe('resuming', () => {
  it('changes nothing on an instance that is playing', () => {
    const playback = createVATPlaybackTexture([blending])
    const before = rowOf(playback, 0)
    const going = resumeVATInstance(playback, 0, 4)
    expect(rowOf(playback, 0)).toEqual(before)
    expectDrawn(resolveVATFrame(going, 2.6), resolveVATFrame(blending, 2.6), 'unmoved')
  })
})

describe('setVATInstance and a pause', () => {
  it('clears a pause', () => {
    const { playback } = paused(walking)
    setVATInstance(playback, 0, { clip: eight, startTime: 4 })
    expect(pauseOf(playback, 0)).toBe(pauseOf(createVATPlaybackTexture([walking]), 0))
    // So the walk it was paused in plays again, with nothing left to resume.
    const going = resumeVATInstance(playback, 0, 9)
    expectDrawn(resolveVATFrame(going, 9.3), resolveVATFrame({ clip: eight, startTime: 4 }, 9.3), 'playing')
  })

  it('blends out of a paused pose from where it stopped, not from where it would be', () => {
    // The clip being left resumes at the moment the transition begins, so the
    // first frame of the blend is the pose the pause was showing.
    const { playback } = paused(walking)
    setVATInstance(playback, 0, { clip: eight, startTime: 6, fadeDuration: 0.5 })
    const going = resumeVATInstance(playback, 0, 7) // nothing to resume: the write cleared it
    const outgoing = resolveVATFrame(going, 6).outgoing!
    const held = resolveVATFrame(walking, PAUSE)
    expect({ row: outgoing.row, rowNext: outgoing.rowNext }).toEqual({ row: held.row, rowNext: held.rowNext })
    expect(outgoing.mix).toBeCloseTo(held.mix, 4)
    expect(outgoing.weight).toBe(1)
    // And it plays on from there through the blend.
    const on = resolveVATFrame(going, 6.2).outgoing!
    expect(on.row).toBe(resolveVATFrame(walking, PAUSE + 0.2).row)
  })

  it('shows one chosen pose as a placed start time and a pause, at a speed of its own', () => {
    // 0.43 s into the walk, held there — the speed is the walk's, not zero.
    const playback = createVATPlaybackTexture([{ clip: ten, startTime: 0 }])
    setVATInstance(playback, 0, { clip: ten, startTime: 5 - 0.43, pausedAt: 5 })
    const pose = resolveVATFrame({ clip: ten, startTime: 0 }, 0.43)
    const still = pauseVATInstance(playback, 0, 9) // already paused, so this reads it back
    expectDrawn(resolveVATFrame(still, 9), pose, 'the chosen pose')
    expect(rowOf(playback, 0)[PACK_TEXELS.clip * 4 + 3]).toBe(1)
  })

  it('refuses a pause no clock reaches, by name', () => {
    const playback = createVATPlaybackTexture([walking])
    for (const pausedAt of [Number.NaN, Infinity, -Infinity]) {
      expect(() => setVATInstance(playback, 0, { ...walking, pausedAt })).toThrow(/pausedAt/)
    }
    expect(() => createVATPlaybackTexture([{ ...walking, pausedAt: Number.NaN }])).toThrow(/pausedAt/)
  })
})

describe('the pause in the pack', () => {
  it('is one component of the crossfade texel, and the pack does not widen', () => {
    expect(PACK_WIDTH).toBe(5)
    const { playback } = paused(walking)
    expect(pauseOf(playback, 0)).toBe(Math.fround(PAUSE))

    // The rest of the row is what it was.
    const unpaused = rowOf(createVATPlaybackTexture([walking]), 0)
    const row = rowOf(playback, 0)
    row[PACK_TEXELS.crossfade * 4 + 2] = unpaused[PACK_TEXELS.crossfade * 4 + 2]!
    expect(row).toEqual(unpaused)
  })

  it('is a moment past any clock while playing, so a decode reads it with a min', () => {
    const playing = pauseOf(createVATPlaybackTexture([walking]), 0)
    expect(Number.isFinite(playing)).toBe(true)
    expect(playing).toBeGreaterThan(1e15) // past thirty million years of clock
    expect(Math.fround(playing)).toBe(playing)
  })

  it('reads back what a crowd was created with', () => {
    const playback = createVATPlaybackTexture([{ ...walking, pausedAt: 1.5 }, walking])
    expectDrawn(resolveVATFrame(resumeVATInstance(playback, 0, 4), 4), resolveVATFrame(walking, 1.5), 'paused at 1.5')
    expect(pauseOf(playback, 1)).toBe(pauseOf(createVATPlaybackTexture([walking]), 0))
  })

  it('flags only the paused instance’s row for upload', () => {
    const playback = createVATPlaybackTexture([walking, walking, walking])
    playback.texture.clearUpdateRanges()
    pauseVATInstance(playback, 1, PAUSE)
    expect(playback.texture.updateRanges).toEqual([{ start: PACK_WIDTH * 4, count: PACK_WIDTH * 4 }])
    playback.texture.clearUpdateRanges()
    resumeVATInstance(playback, 1, 5)
    expect(playback.texture.updateRanges).toEqual([{ start: PACK_WIDTH * 4, count: PACK_WIDTH * 4 }])
  })

  it('refuses an instance outside the crowd', () => {
    const playback = createVATPlaybackTexture([walking])
    expect(() => pauseVATInstance(playback, 1, 0)).toThrow(/outside/)
    expect(() => resumeVATInstance(playback, -1, 0)).toThrow(/outside/)
  })
})

describe('the entry point', () => {
  it('exports the pause and the resume', () => {
    expect(core.pauseVATInstance).toBe(pauseVATInstance)
    expect(core.resumeVATInstance).toBe(resumeVATInstance)
  })
})
