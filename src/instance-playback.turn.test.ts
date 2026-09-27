// The turn (ADR-0036): an instance changing direction at the pose it is
// showing, and from then on retracing its path. Everything here asserts what a
// caller can see: what `resolveVATFrame` and `endsAt` answer for the instance
// the turn hands back, and what the playback texture holds after the write.
import { describe, expect, it } from 'vitest'
import {
  createVATPlaybackTexture,
  endsAt,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PACK_TEXELS,
  PACK_WIDTH,
  resolveVATFrame,
  setVATInstance,
  turnVATInstance,
} from './instance-playback.js'
import type { VATFrame, VATInstance, VATPlaybackState, VATPlaybackTexture } from './instance-playback.js'
import * as core from './index.js'

const ten = { startFrame: 5, frames: 10, fps: 10 } // one second, rows 5 to 14

/** What a frame draws: its two rows and the mix between them. */
const pose = (frame: VATFrame) => ({ row: frame.row, rowNext: frame.rowNext, mix: frame.mix })

function expectPose(actual: VATFrame, expected: VATFrame, where: string) {
  expect({ row: actual.row, rowNext: actual.rowNext }, where).toEqual({ row: expected.row, rowNext: expected.rowNext })
  expect(actual.mix, where).toBeCloseTo(expected.mix, 5)
}

/** One instance's whole row, as plain numbers. */
const rowOf = (playback: VATPlaybackTexture, i: number) =>
  Array.from((playback.texture.image.data as Float32Array).slice(i * PACK_WIDTH * 4, (i + 1) * PACK_WIDTH * 4))

/** Write `instance` into a crowd of its own, turn it at `time`, and hand back what the turn wrote. */
function turned(instance: VATInstance, time: number) {
  const playback = createVATPlaybackTexture([instance])
  return turnVATInstance(playback, 0, time)
}

/**
 * The same play with its start moved back a whole number of periods — the
 * same pose at every moment after the original's start, and a path that goes
 * on before it. What an endless play retraces into.
 */
const extended = (instance: VATInstance, rate: number): VATInstance => ({
  ...instance,
  startTime: instance.startTime - (20 * ten.frames) / ten.fps / rate,
})

const START = 0.25

interface Case {
  loopMode: LoopMode
  repetitions: number
  endMode: EndMode
  speed: number
}

const cases: Case[] = []
for (const loopMode of [LoopMode.Repeat, LoopMode.Once, LoopMode.PingPong]) {
  const counts =
    loopMode === LoopMode.Once ? [1, 2.5] : loopMode === LoopMode.Repeat ? [INFINITE_REPETITIONS, 3, 2.5] : [INFINITE_REPETITIONS, 1, 2, 3, 2.5]
  for (const repetitions of counts) {
    for (const endMode of [EndMode.Clamp, EndMode.Rewind]) {
      for (const speed of [1, -1, 1.5, -0.75]) cases.push({ loopMode, repetitions, endMode, speed })
    }
  }
}

/**
 * Where in the play to turn, in loops of the clip: in the first repetition, a
 * middle one and the final one. Off every frame boundary; the intervals that
 * cross a seam have a test of their own below.
 */
function turnsOf({ repetitions }: Case): number[] {
  if (repetitions === INFINITE_REPETITIONS) return [0.3713, 1.4327, 7.6149]
  const last = repetitions - 0.3471
  return repetitions > 2 ? [0.3713, 1.4327, last] : repetitions > 1 ? [0.3713, last] : [0.3713, 0.6419]
}

const describeCase = (c: Case) =>
  `mode=${c.loopMode} reps=${c.repetitions} end=${c.endMode} speed=${c.speed}`

describe('turnVATInstance', () => {
  it('is exported from the core entry point, beside setVATInstance and endsAt', () => {
    expect(core.turnVATInstance).toBe(turnVATInstance)
    expect(core.setVATInstance).toBe(setVATInstance)
    expect(core.endsAt).toBe(endsAt)
  })

  describe('the write', () => {
    it('writes the pack of the instance it returns, and flags only that row', () => {
      const playback = createVATPlaybackTexture([
        { clip: ten, startTime: 0 },
        { clip: ten, startTime: START, loopMode: LoopMode.Once, speed: 1.5 },
        { clip: ten, startTime: 0 },
      ])
      playback.texture.updateRanges.length = 0
      const before = [rowOf(playback, 0), rowOf(playback, 2)]

      const written = turnVATInstance(playback, 1, START + 0.4)

      expect(rowOf(playback, 1)).toEqual(rowOf(createVATPlaybackTexture([written]), 0))
      expect([rowOf(playback, 0), rowOf(playback, 2)]).toEqual(before)
      expect(playback.texture.updateRanges).toEqual([{ start: PACK_WIDTH * 4, count: PACK_WIDTH * 4 }])
    })

    it('refuses an index outside the crowd, by name', () => {
      const playback = createVATPlaybackTexture([{ clip: ten, startTime: 0 }])

      expect(() => turnVATInstance(playback, 1, 0.5)).toThrow(/instance 1 is outside this crowd's 1 rows/)
      expect(() => turnVATInstance(playback, -1, 0.5)).toThrow(/instance -1/)
      expect(() => turnVATInstance(playback, 0.5, 0.5)).toThrow(/instance 0.5/)
    })

    it('keeps the speed magnitude, and writes a finite play with Clamp', () => {
      const written = turned(
        { clip: ten, startTime: START, speed: 1.5, repetitions: 3, endMode: EndMode.Rewind },
        START + 0.5,
      )

      expect(Math.abs(written.speed!)).toBe(1.5)
      expect(written.endMode).toBe(EndMode.Clamp)
    })
  })

  describe('the retrace', () => {
    it('shows at the turn the pose the instance was showing', () => {
      for (const c of cases) {
        const original = { clip: ten, startTime: START, ...c }
        const rate = Math.abs(c.speed)
        for (const loops of turnsOf(c)) {
          const time = START + loops / rate
          expectPose(resolveVATFrame(turned(original, time), time), resolveVATFrame(original, time), `${describeCase(c)} loops=${loops}`)
        }
      }
    })

    it('shows at each moment after the turn the pose it showed that long before it, back to its start', () => {
      for (const c of cases) {
        const original = { clip: ten, startTime: START, ...c }
        const rate = Math.abs(c.speed)
        for (const loops of turnsOf(c)) {
          const time = START + loops / rate
          const back = turned(original, time)
          for (let x = 0.00317; x < time - START; x += 0.0137) {
            const where = `${describeCase(c)} loops=${loops} x=${x}`
            expectPose(resolveVATFrame(back, time + x), resolveVATFrame(original, time - x), where)
          }
        }
      }
    })

    it('finishes a finite play exactly when it is back at its start, holding the pose it started on', () => {
      for (const c of cases.filter((c) => c.repetitions !== INFINITE_REPETITIONS)) {
        const original = { clip: ten, startTime: START, ...c }
        const rate = Math.abs(c.speed)
        for (const loops of turnsOf(c)) {
          const time = START + loops / rate
          const back = turned(original, time)
          const where = `${describeCase(c)} loops=${loops}`
          const home = time + (time - START)

          const end = endsAt(back)!
          expect(end, where).toBeCloseTo(home, 9)
          expect(resolveVATFrame(back, end - 1e-6).finished, where).toBe(false)
          for (const after of [end, end + 0.3, end + 40]) {
            const frame = resolveVATFrame(back, after)
            expect(frame.finished, where).toBe(true)
            expectPose(frame, resolveVATFrame(original, START), `${where} at ${after}`)
          }
        }
      }
    })

    it('retraces an endless play endlessly, past its original start', () => {
      for (const c of cases.filter((c) => c.repetitions === INFINITE_REPETITIONS)) {
        const original = { clip: ten, startTime: START, ...c }
        const rate = Math.abs(c.speed)
        const path = extended(original, rate)
        for (const loops of turnsOf(c)) {
          const time = START + loops / rate
          const back = turned(original, time)
          expect(endsAt(back)).toBe(null)
          for (let x = 0.00317; x < time - START + 6; x += 0.0337) {
            const where = `${describeCase(c)} loops=${loops} x=${x}`
            expect(resolveVATFrame(back, time + x).finished, where).toBe(false)
            expectPose(resolveVATFrame(back, time + x), resolveVATFrame(path, time - x), where)
          }
        }
      }
    })

    it('turns at a repetition boundary without a jump', () => {
      for (const speed of [1, -1]) {
        const original = { clip: ten, startTime: START, speed, repetitions: 3 }
        const back = turned(original, START + 1)
        expectPose(resolveVATFrame(back, START + 1), resolveVATFrame(original, START + 1), `speed=${speed}`)
        expectPose(resolveVATFrame(back, START + 1.04), resolveVATFrame(original, START + 0.96), `speed=${speed}`)
      }
    })

    it('turns in the interval that crosses the seam, or holds across it under Clamp', () => {
      // The turned play is the mirror of the whole play, so a repetition that
      // crossed into the next one retraces across it, and the final one of a
      // Clamp play, which held its last row, retraces the hold (#88).
      for (const [speed, endMode] of [[1, EndMode.Clamp], [-1, EndMode.Clamp], [1, EndMode.Rewind], [-1, EndMode.Rewind]] as const) {
        const original = { clip: ten, startTime: START, speed, repetitions: 3, endMode }
        for (const loops of [0.0413, 1.9587, 2.0413, 2.9587, 2.9713]) {
          const time = START + loops
          const back = turned(original, time)
          for (const x of [0, 0.0211, 0.0391]) {
            const where = `speed=${speed} loops=${loops} x=${x}`
            expectPose(resolveVATFrame(back, time + x), resolveVATFrame(original, time - x), where)
          }
        }
      }
    })
  })

  describe('a play that is not moving', () => {
    it('turns a finished Clamp play from the moment it finished, so it moves at once', () => {
      for (const speed of [1, -1]) {
        for (const loopMode of [LoopMode.Once, LoopMode.PingPong]) {
          const original = { clip: ten, startTime: START, speed, loopMode }
          const finish = endsAt(original)!
          const time = finish + 7 // long after, holding
          const back = turned(original, time)
          const where = `speed=${speed} mode=${loopMode}`

          expectPose(resolveVATFrame(back, time), resolveVATFrame(original, time), where)
          for (const x of [0.03, 0.25, 0.61, 0.97]) {
            expectPose(resolveVATFrame(back, time + x), resolveVATFrame(original, finish - x), `${where} x=${x}`)
          }
          expect(endsAt(back), where).toBeCloseTo(time + (finish - START), 9)
        }
      }
    })

    it('holds a finished Rewind play where it is: on the pose it started from', () => {
      for (const speed of [1, -1]) {
        const original = { clip: ten, startTime: START, speed, loopMode: LoopMode.Once, endMode: EndMode.Rewind }
        const time = endsAt(original)! + 2
        const back = turned(original, time)

        for (const after of [time, time + 0.3, time + 50]) {
          expect(pose(resolveVATFrame(back, after)), `speed=${speed}`).toEqual(pose(resolveVATFrame(original, time)))
        }
        expect(endsAt(back)).toBe(time)
      }
    })

    it('holds a play still waiting to start on its waiting pose, and it never starts', () => {
      for (const c of cases) {
        const original = { clip: ten, startTime: START + 3, ...c }
        const time = START + 1
        const back = turned(original, time)

        for (const after of [time, time + 1, time + 2.5, time + 40]) {
          expect(pose(resolveVATFrame(back, after)), `${describeCase(c)} at ${after}`).toEqual(
            pose(resolveVATFrame(original, time)),
          )
        }
      }
    })

    it('leaves a play at a speed of zero as it was', () => {
      const original = { clip: ten, startTime: START, speed: 0, loopMode: LoopMode.Once }
      const back = turned(original, 3)

      expect(pose(resolveVATFrame(back, 9))).toEqual(pose(resolveVATFrame(original, 3)))
    })
  })

  describe('turning twice', () => {
    // The instance goes on along the path it was on, from the pose it is
    // showing: late by twice the time between the two turns, the time it
    // spent going back and coming forward again.
    it('gives back the path the instance was on', () => {
      const twice = cases.filter(
        (c) =>
          c.endMode === EndMode.Clamp &&
          (c.repetitions === INFINITE_REPETITIONS || Number.isInteger(c.repetitions)) &&
          // An even ping-pong clamps on a pose its path did not end on; the
          // path itself comes back, and is checked below up to its finish.
          !(c.loopMode === LoopMode.PingPong && c.repetitions % 2 === 0),
      )
      for (const c of twice) {
        const original = { clip: ten, startTime: START, ...c }
        const rate = Math.abs(c.speed)
        const playback = createVATPlaybackTexture([original])
        const first = START + 0.6317 / rate
        turnVATInstance(playback, 0, first)
        const second = first + 0.2113 / rate
        const again = turnVATInstance(playback, 0, second)
        const late = 2 * (second - first)
        const path = c.repetitions === INFINITE_REPETITIONS ? extended(original, rate) : original

        const end = c.repetitions === INFINITE_REPETITIONS ? second + 5 : endsAt(original)! + late + 1
        for (let t = second + 0.00317; t < end; t += 0.0173) {
          expectPose(resolveVATFrame(again, t), resolveVATFrame(path, t - late), `${describeCase(c)} t=${t}`)
        }
        if (c.repetitions === INFINITE_REPETITIONS) expect(endsAt(again)).toBe(null)
        else expect(endsAt(again), describeCase(c)).toBeCloseTo(endsAt(original)! + late, 4)
      }
    })

    it('gives back an even ping-pong up to its finish', () => {
      for (const speed of [1, -1]) {
        const original = { clip: ten, startTime: START, speed, loopMode: LoopMode.PingPong, repetitions: 2 }
        const playback = createVATPlaybackTexture([original])
        turnVATInstance(playback, 0, START + 0.6317)
        const again = turnVATInstance(playback, 0, START + 0.843)
        const late = 2 * (0.843 - 0.6317)

        for (let t = START + 0.84617; t < endsAt(original)! + late; t += 0.0173) {
          expectPose(resolveVATFrame(again, t), resolveVATFrame(original, t - late), `speed=${speed} t=${t}`)
        }
      }
    })
  })

  describe('a crossfade', () => {
    const walk = { startFrame: 0, frames: 10, fps: 10 }
    const run = { startFrame: 20, frames: 10, fps: 10 }

    /**
     * The turned instance at `time + x` against the original at `time − x`:
     * the bands swap places, so the live band shows what the outgoing one did,
     * the outgoing band what the live one did, and the weights swap with them.
     */
    function expectMirroredBlend(actual: VATFrame, expected: VATFrame, where: string) {
      const weight = expected.outgoing?.weight ?? 0
      const mirrored = actual.outgoing?.weight ?? 0
      expect(mirrored, `${where} weight`).toBeCloseTo(1 - weight, 5)
      // A band at weight zero draws nothing, so only a band that shows is compared.
      if (weight > 0) expectPose(actual, expected.outgoing!, `${where} live band`)
      if (mirrored > 0) expectPose(actual.outgoing!, expected, `${where} outgoing band`)
    }

    /** A walk blending into a run from `fadeStart`, written as a caller writes it. */
    function blending(from: VATPlaybackState, to: VATInstance) {
      const playback = createVATPlaybackTexture([{ ...from }])
      setVATInstance(playback, 0, to)
      return { playback, original: { ...to, from } as VATInstance }
    }

    const blends: { name: string; from: VATPlaybackState; to: VATInstance }[] = [
      { name: 'endless into endless', from: { clip: walk, startTime: -0.37 }, to: { clip: run, startTime: 1, fadeDuration: 0.5 } },
      {
        name: 'reversed into a ping-pong',
        from: { clip: walk, startTime: 0.2, speed: -1.3, repetitions: 4 },
        to: { clip: run, startTime: 1, speed: 0.75, loopMode: LoopMode.PingPong, repetitions: 3, fadeDuration: 0.6 },
      },
      {
        name: 'into a one-shot that finishes mid-blend',
        from: { clip: walk, startTime: 0.1, repetitions: 5 },
        to: { clip: run, startTime: 1, speed: 3, loopMode: LoopMode.Once, fadeDuration: 0.5 },
      },
    ]

    it('shows at the turn both bands and the weight the instance was showing', () => {
      for (const { name, from, to } of blends) {
        for (const into of [0.05, 0.5, 0.95]) {
          const { playback, original } = blending(from, to)
          const time = to.startTime + into * to.fadeDuration!
          const back = turnVATInstance(playback, 0, time)
          const now = resolveVATFrame(back, time)
          const was = resolveVATFrame(original, time)
          const where = `${name} into=${into}`

          expect(now.outgoing!.weight, where).toBeCloseTo(1 - was.outgoing!.weight, 5)
          expectPose(now, was.outgoing!, `${where} live band`)
          expectPose(now.outgoing!, was, `${where} outgoing band`)
        }
      }
    })

    it('runs the blend back: at each moment after the turn, the mirror of the moment as long before it', () => {
      for (const { name, from, to } of blends) {
        for (const into of [0.05, 0.5, 0.95]) {
          const { playback, original } = blending(from, to)
          const time = to.startTime + into * to.fadeDuration!
          const back = turnVATInstance(playback, 0, time)
          for (let x = 0.00317; x < time - from.startTime; x += 0.0137) {
            expectMirroredBlend(resolveVATFrame(back, time + x), resolveVATFrame(original, time - x), `${name} into=${into} x=${x}`)
          }
        }
      }
    })

    it('plays the retraced outgoing clip alone once the retrace passes the blend’s start', () => {
      for (const { name, from, to } of blends) {
        const { playback } = blending(from, to)
        const time = to.startTime + 0.3 * to.fadeDuration!
        const back = turnVATInstance(playback, 0, time)
        const passed = time + (time - to.startTime)

        expect(resolveVATFrame(back, passed).outgoing?.weight ?? 0, name).toBeCloseTo(0, 9)
        for (const after of [passed + 0.00317, passed + 0.0531, passed + 0.4131]) {
          const frame = resolveVATFrame(back, after)
          expect(frame.outgoing?.weight ?? 0, `${name} at ${after}`).toBe(0)
          expectPose(frame, resolveVATFrame(from, 2 * time - after), `${name} at ${after}`)
        }
      }
    })

    it('retraces an outgoing one-shot that clamped mid-blend from its hold', () => {
      // The walk runs out at 1.0, a second after it began, and holds its last
      // row while the blend into the run goes on to 1.4. Turned at 1.3, it
      // holds that row until 1.6, the mirror of its finish, then walks back.
      const from = { clip: walk, startTime: 0, loopMode: LoopMode.Once }
      for (const speed of [1, -1]) {
        const { playback, original } = blending({ ...from, speed }, { clip: run, startTime: 0.8, fadeDuration: 0.6 })
        const back = turnVATInstance(playback, 0, 1.3)

        for (let x = 0.00317; x < 1.3; x += 0.0137) {
          expectMirroredBlend(resolveVATFrame(back, 1.3 + x), resolveVATFrame(original, 1.3 - x), `speed=${speed} x=${x}`)
        }
        expect(resolveVATFrame(back, 1.5).row, `speed=${speed}`).toBe(resolveVATFrame(back, 1.3).row)
        expect(endsAt(back), `speed=${speed}`).toBeCloseTo(2.6, 5)
      }
    })

    it('holds an outgoing one-shot that rewound mid-blend on the pose it started from, as a turn alone does', () => {
      // No mirror of the rewind's snap: the band holds for good, and only the
      // weight and the other band run back.
      const from = { clip: walk, startTime: 0, loopMode: LoopMode.Once, endMode: EndMode.Rewind }
      for (const speed of [1, -1]) {
        const { playback, original } = blending({ ...from, speed }, { clip: run, startTime: 0.8, fadeDuration: 0.6 })
        const back = turnVATInstance(playback, 0, 1.3)
        const held = resolveVATFrame(original, 1.3).outgoing!

        for (const after of [1.3, 1.5, 1.8, 2.4, 9]) {
          expect(pose(resolveVATFrame(back, after)), `speed=${speed} at ${after}`).toEqual(pose(held))
        }
        for (const x of [0.00317, 0.2113, 0.4731]) {
          const weight = resolveVATFrame(back, 1.3 + x).outgoing?.weight ?? 0
          expect(weight, `speed=${speed} x=${x}`).toBeCloseTo(1 - (resolveVATFrame(original, 1.3 - x).outgoing?.weight ?? 0), 5)
        }
      }
    })

    it('gives back the original blend when turned twice', () => {
      for (const { name, from, to } of blends) {
        const { playback, original } = blending(from, to)
        const first = to.startTime + 0.4 * to.fadeDuration!
        turnVATInstance(playback, 0, first)
        const second = first + 0.1
        const again = turnVATInstance(playback, 0, second)
        const late = 2 * (second - first)

        for (let t = second + 0.00317; t < second + 3; t += 0.0173) {
          const now = resolveVATFrame(again, t)
          const was = resolveVATFrame(original, t - late)
          const where = `${name} t=${t}`
          expectPose(now, was, where)
          expect(now.outgoing?.weight ?? 0, where).toBeCloseTo(was.outgoing?.weight ?? 0, 4)
          if ((was.outgoing?.weight ?? 0) > 0) expectPose(now.outgoing!, was.outgoing!, `${where} outgoing band`)
        }
      }
    })

    it('answers endsAt for the retraced band it now plays', () => {
      const { playback } = blending(
        { clip: walk, startTime: 0.1, repetitions: 5 },
        { clip: run, startTime: 1, fadeDuration: 0.5 },
      )
      const back = turnVATInstance(playback, 0, 1.2)

      // The walk played 1.1 s of its five; retraced, it is back at its start
      // 1.1 s after the turn, give or take the start time's trip through a float.
      expect(endsAt(back)).toBeCloseTo(2.3, 6)
    })

    it('writes the pack of the instance it returns, blend start included', () => {
      const { playback } = blending({ clip: walk, startTime: -0.37 }, { clip: run, startTime: 1, fadeDuration: 0.5 })
      const back = turnVATInstance(playback, 0, 1.2)

      expect(rowOf(playback, 0)).toEqual(rowOf(createVATPlaybackTexture([back]), 0))
      // The blend ends where the original's began, mirrored about the turn: 1.4 − 0.5.
      expect(back.fadeStart).toBeCloseTo(0.9, 9)
      expect(rowOf(playback, 0)[PACK_TEXELS.crossfade * 4 + 1]).toBeCloseTo(0.9, 6)
    })

    it('turns once the crossfade is over, dropping the band it blended out of', () => {
      const playback = createVATPlaybackTexture([{ clip: walk, startTime: 0 }])
      setVATInstance(playback, 0, { clip: run, startTime: 1, fadeDuration: 0.5 })

      const written = turnVATInstance(playback, 0, 2.3)

      expect(written.from).toBeUndefined()
      expect(resolveVATFrame(written, 2.3).outgoing).toBe(null)
      expectPose(resolveVATFrame(written, 2.55), resolveVATFrame({ clip: run, startTime: 1 }, 2.05), 'after the blend')
    })
  })
})
