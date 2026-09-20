import { BufferAttribute, BufferGeometry, InstancedBufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'
import {
  addVATInstanceAttributes,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PLAYBACK_ATTRIBUTES,
  resolveVATFrame,
} from './instance-playback.js'
import type { VATInstance } from './instance-playback.js'

const clip = { startFrame: 5, frames: 10, fps: 30 }

/** One instance's slice of a named attribute, as plain numbers. */
const slice = (geometry: BufferGeometry, name: string, i: number) => {
  const attribute = geometry.getAttribute(name)
  return Array.from(attribute.array.slice(i * attribute.itemSize, (i + 1) * attribute.itemSize))
}

describe('addVATInstanceAttributes', () => {
  it('packs clip and rate into aVatClip, one vec4 per instance', () => {
    const geometry = new BufferGeometry()
    addVATInstanceAttributes(geometry, [
      { clip, startTime: 1, speed: 2 },
      { clip: { startFrame: 0, frames: 4, fps: 24 }, startTime: 0.5, speed: 0.25 },
    ])

    // x = clip start row, y = clip frames, z = clip fps, w = speed
    expect(slice(geometry, PLAYBACK_ATTRIBUTES.clip, 0)).toEqual([5, 10, 30, 2])
    expect(slice(geometry, PLAYBACK_ATTRIBUTES.clip, 1)).toEqual([0, 4, 24, 0.25])
  })

  it('packs the start time into aVatPlayback, with the playback policy alongside it', () => {
    const geometry = new BufferGeometry()
    addVATInstanceAttributes(geometry, [
      { clip, startTime: 1, speed: 2 },
      { clip, startTime: -3.5, speed: 1 },
    ])

    // x = start time, y = loop mode, z = repetitions, w = end mode. Nothing
    // reads y/z/w yet (#35), so every instance carries today's one behaviour:
    // repeat, forever.
    expect(slice(geometry, PLAYBACK_ATTRIBUTES.playback, 0)).toEqual([
      1,
      LoopMode.Repeat,
      INFINITE_REPETITIONS,
      EndMode.Clamp,
    ])
    // A start time in the past is how a crowd desyncs, so it must survive as
    // written rather than being folded or clamped.
    expect(slice(geometry, PLAYBACK_ATTRIBUTES.playback, 1)[0]).toBe(-3.5)
  })

  it('writes aVatFade as zeroes, because no instance is fading yet', () => {
    const geometry = new BufferGeometry()
    addVATInstanceAttributes(geometry, [{ clip, startTime: 0, speed: 1 }])

    expect(slice(geometry, PLAYBACK_ATTRIBUTES.fade, 0)).toEqual([0, 0, 0, 0])
  })

  it('writes three instanced vec4s and no more', () => {
    // Three slots, not five and not thirteen: `position`, `normal`, `uv` and
    // the four rows of `instanceMatrix` already take seven of the sixteen
    // vertex attributes WebGL2 guarantees, and a crowd that exceeds them does
    // not fail to render — it fails to link.
    const geometry = new BufferGeometry()
    addVATInstanceAttributes(geometry, [{ clip, startTime: 0, speed: 1 }])

    const names = Object.values(PLAYBACK_ATTRIBUTES)
    expect(names).toHaveLength(3)
    expect(Object.keys(geometry.attributes)).toEqual(names)
    for (const name of names) {
      const attribute = geometry.getAttribute(name)
      expect(attribute, name).toBeInstanceOf(InstancedBufferAttribute)
      expect(attribute.itemSize, name).toBe(4)
      expect(attribute.count, name).toBe(1)
    }
  })

  it('strips morph targets, which the VAT supersedes', () => {
    const geometry = new BufferGeometry()
    geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
    geometry.morphTargetsRelative = true

    addVATInstanceAttributes(geometry, [{ clip, startTime: 0, speed: 1 }])

    expect(geometry.morphAttributes.position).toBeUndefined()
    expect(geometry.morphTargetsRelative).toBe(false)
  })
})

describe('the playback modes', () => {
  it('mirrors three’s own loop constants, in three’s own order', () => {
    // THREE.LoopRepeat / LoopOnce / LoopPingPong, as numbers a Float32Array can
    // carry. Nothing reads them until #35; they land here so the bake-side work
    // (#37) can name them.
    expect(LoopMode).toEqual({ Repeat: 0, Once: 1, PingPong: 2 })
  })

  it('offers clamp and rewind, with clamp first because it is the default', () => {
    expect(EndMode).toEqual({ Clamp: 0, Rewind: 1 })
  })

  it('spells an infinite repeat count as -1, which a Float32Array can carry', () => {
    // `Infinity` does not survive a Float32Array usefully, so the sentinel is
    // converted once, here, at the boundary.
    expect(INFINITE_REPETITIONS).toBe(-1)
  })
})

// ------------------------------------------------------------ resolveVATFrame

describe('resolveVATFrame', () => {
  // The one definition of the playback semantics, and the only place CI can
  // evaluate them: both decode paths transcribe this function, and neither a
  // GLSL string nor a TSL node graph runs without a GPU.
  const ten = { startFrame: 5, frames: 10, fps: 10 } // one second, ten rows
  const at = (time: number, instance: Partial<VATInstance> = {}) =>
    resolveVATFrame({ clip: ten, startTime: 0, speed: 1, ...instance }, time)

  describe('a repeating clip', () => {
    it('walks its rows in step with the clock', () => {
      expect(at(0)).toMatchObject({ row: 5, rowNext: 6, mix: 0, wraps: true, finished: false })
      expect(at(0.35)).toMatchObject({ row: 8, rowNext: 9, wraps: true })
      expect(at(0.35).mix).toBeCloseTo(0.5)
    })

    it('wraps its last row back into its first', () => {
      // The interpolation crossing back is the point: row 9 blends into row 0
      // across the last tenth of a second, and that is what makes a loop seam
      // continuous rather than a jump.
      const last = at(0.95)

      expect(last).toMatchObject({ row: 14, rowNext: 5, wraps: true })
      expect(last.mix).toBeCloseTo(0.5)
    })

    it('keeps looping forever, because -1 repetitions never run out', () => {
      expect(at(1000.25)).toMatchObject({ row: 7, finished: false })
    })
  })

  describe('a one-shot', () => {
    const once = { loopMode: LoopMode.Once }

    it('clamps to its last row by default, and does not wrap off it', () => {
      // The corpse does not stand back up: held on the last row, with the row
      // it would interpolate toward being that same row.
      expect(at(1, once)).toMatchObject({ row: 14, rowNext: 14, mix: 0, wraps: false, finished: true })
      expect(at(60, once)).toMatchObject({ row: 14, rowNext: 14, finished: true })
    })

    it('returns to its first row at the exact finish time when told to rewind', () => {
      const rewinding = { ...once, endMode: EndMode.Rewind }

      expect(at(0.99, rewinding).finished).toBe(false)
      // Back on the first row, with nothing blended into it — the row it would
      // interpolate toward is irrelevant while `mix` is zero.
      expect(at(1, rewinding)).toMatchObject({ row: 5, mix: 0, wraps: false, finished: true })
    })

    it('plays a fixed number of repetitions before it finishes', () => {
      const twice = { ...once, repetitions: 2 }

      expect(at(1.5, twice).finished).toBe(false)
      expect(at(2, twice)).toMatchObject({ row: 14, finished: true })
    })
  })

  describe('ping-pong', () => {
    const pingPong = { loopMode: LoopMode.PingPong, repetitions: 2 }

    it('bounces at both ends rather than wrapping', () => {
      // Forward across the first second, backward across the second, and never
      // interpolating row 9 into row 0 — a bounce is not a wrap.
      expect(at(0, pingPong)).toMatchObject({ row: 5, wraps: false })
      expect(at(0.5, pingPong).row).toBe(9)
      expect(at(1, pingPong)).toMatchObject({ row: 14, rowNext: 14, wraps: false })
      expect(at(1.5, pingPong).row).toBe(9)
      expect(at(1.9, pingPong).row).toBe(5)
    })

    it('honours its repetition count', () => {
      expect(at(1.99, pingPong).finished).toBe(false)
      expect(at(2, pingPong)).toMatchObject({ finished: true, row: 14 })
    })

    it('never leaves the clip’s own band of rows', () => {
      for (let t = 0; t < 2; t += 0.017) {
        const frame = resolveVATFrame({ clip: ten, startTime: 0, speed: 1, ...pingPong }, t)
        expect(frame.row, `t=${t}`).toBeGreaterThanOrEqual(5)
        expect(frame.row, `t=${t}`).toBeLessThanOrEqual(14)
        expect(frame.rowNext, `t=${t}`).toBeLessThanOrEqual(14)
      }
    })
  })

  describe('the clock', () => {
    it('scales local time by speed', () => {
      expect(at(0.5, { speed: 2 })).toMatchObject(at(1, { speed: 1 }))
    })

    it('reads a start time in the future as not yet started', () => {
      // Sits on the clip's first row, unstarted rather than finished — an
      // instance scheduled for t=10 must not read as a finished one-shot.
      // Sitting on its first row with nothing blended in, and pointedly not
      // finished. `rowNext` is the row after it, as it is for any unwrapped
      // phase of 0 — the two decode paths fall through the same arithmetic, and
      // a `mix` of 0 makes the row it points at moot.
      expect(at(4, { startTime: 10, loopMode: LoopMode.Once })).toMatchObject({
        row: 5,
        rowNext: 6,
        mix: 0,
        wraps: false,
        finished: false,
      })
    })

    it('treats a start time in the past as phase already elapsed — desync', () => {
      expect(at(0, { startTime: -0.35 })).toMatchObject(at(0.35))
    })
  })
})

// ------------------------------------------------- inheriting a clip's defaults

describe('a clip’s playback defaults', () => {
  // Declared once at the bake (#37) and carried in the clip table, so a crowd
  // of a thousand deaths does not repeat "once, clamped" a thousand times. An
  // instance still overrides any field it names.
  const configured = {
    ...clip,
    loopMode: LoopMode.Once,
    repetitions: 1,
    endMode: EndMode.Clamp,
    speed: 2,
  }

  const packed = (instance: VATInstance) => {
    const geometry = new BufferGeometry()
    addVATInstanceAttributes(geometry, [instance])
    return {
      speed: slice(geometry, PLAYBACK_ATTRIBUTES.clip, 0)[3],
      loopMode: slice(geometry, PLAYBACK_ATTRIBUTES.playback, 0)[1],
      repetitions: slice(geometry, PLAYBACK_ATTRIBUTES.playback, 0)[2],
      endMode: slice(geometry, PLAYBACK_ATTRIBUTES.playback, 0)[3],
    }
  }

  it('reaches an instance that says nothing about playback', () => {
    expect(packed({ clip: configured, startTime: 0 })).toEqual({
      speed: 2,
      loopMode: LoopMode.Once,
      repetitions: 1,
      endMode: EndMode.Clamp,
    })
  })

  it('gives way, field by field, to anything the instance sets', () => {
    expect(
      packed({
        clip: configured,
        startTime: 0,
        speed: 0.5,
        loopMode: LoopMode.PingPong,
        repetitions: 4,
        endMode: EndMode.Rewind,
      }),
    ).toEqual({
      speed: 0.5,
      loopMode: LoopMode.PingPong,
      repetitions: 4,
      endMode: EndMode.Rewind,
    })
  })

  it('takes the new mode’s count when the instance replaces the loop mode', () => {
    // A repetition count belongs to the mode it was configured under. A
    // one-shot over a clip baked to loop forever must finish, not inherit
    // "forever" and hold its crowd mid-death indefinitely.
    expect(
      packed({ clip: { ...clip, loopMode: LoopMode.Repeat, repetitions: INFINITE_REPETITIONS }, startTime: 0, loopMode: LoopMode.Once }),
    ).toMatchObject({ loopMode: LoopMode.Once, repetitions: 1 })
  })

  it('keeps the clip’s count when the instance leaves the loop mode alone', () => {
    expect(
      packed({ clip: { ...clip, loopMode: LoopMode.PingPong, repetitions: 3 }, startTime: 0 }),
    ).toMatchObject({ loopMode: LoopMode.PingPong, repetitions: 3 })
  })

  it('falls back to the library defaults for a clip that carries none', () => {
    // A clip table built by hand, and every clip band before #37 — the defaults
    // are optional on the clip precisely so this keeps working.
    expect(packed({ clip, startTime: 0 })).toEqual({
      speed: 1,
      loopMode: LoopMode.Repeat,
      repetitions: INFINITE_REPETITIONS,
      endMode: EndMode.Clamp,
    })
  })

  it('drives resolveVATFrame by the same inherited policy the pack carries', () => {
    // The pack and the resolver read one policy or they render two different
    // crowds. A clip defaulted to speed 2 is half a second into its one-second
    // band at t = 0.25.
    const tenAtDoubleSpeed = { startFrame: 5, frames: 10, fps: 10, speed: 2 }

    const frame = resolveVATFrame({ clip: tenAtDoubleSpeed, startTime: 0 }, 0.25)

    expect(frame.row).toBe(5 + 5)
  })

  it('lets an instance override an inherited speed', () => {
    const tenAtDoubleSpeed = { startFrame: 5, frames: 10, fps: 10, speed: 2 }

    const frame = resolveVATFrame({ clip: tenAtDoubleSpeed, startTime: 0, speed: 1 }, 0.25)

    expect(frame.row).toBe(5 + 2)
  })

  it('finishes a one-shot it inherited, with no instance field in sight', () => {
    const once = { startFrame: 0, frames: 10, fps: 10, loopMode: LoopMode.Once, repetitions: 1 }

    expect(resolveVATFrame({ clip: once, startTime: 0 }, 0.5).finished).toBe(false)
    expect(resolveVATFrame({ clip: once, startTime: 0 }, 2).finished).toBe(true)
  })
})
