import { FloatType, NearestFilter } from 'three'
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
} from './instance-playback.js'
import type { VATInstance, VATPlaybackTexture } from './instance-playback.js'
import { MAX_TEXTURE_SIZE } from './vat-texture.js'

const clip = { startFrame: 5, frames: 10, fps: 30 }

/** One texel of one instance's row of the playback texture, as plain numbers. */
const texel = (playback: VATPlaybackTexture, field: number, i: number) => {
  const data = playback.texture.image.data as Float32Array
  const start = i * PACK_WIDTH * 4 + field * 4
  return Array.from(data.slice(start, start + 4))
}

describe('createVATPlaybackTexture', () => {
  it('packs clip and rate into the clip texel, one row per instance', () => {
    const playback = createVATPlaybackTexture([
      { clip, startTime: 1, speed: 2 },
      { clip: { startFrame: 0, frames: 4, fps: 24 }, startTime: 0.5, speed: 0.25 },
    ])

    // r = clip start row, g = clip frames, b = clip fps, a = speed
    expect(texel(playback, PACK_TEXELS.clip, 0)).toEqual([5, 10, 30, 2])
    expect(texel(playback, PACK_TEXELS.clip, 1)).toEqual([0, 4, 24, 0.25])
  })

  it('packs the start time into the playback texel, with the policy alongside it', () => {
    const playback = createVATPlaybackTexture([
      { clip, startTime: 1, speed: 2 },
      { clip, startTime: -3.5, speed: 1 },
    ])

    // r = start time, g = loop mode, b = repetitions, a = end mode. An
    // instance that says nothing about policy carries the library default:
    // repeat, forever.
    expect(texel(playback, PACK_TEXELS.playback, 0)).toEqual([
      1,
      LoopMode.Repeat,
      INFINITE_REPETITIONS,
      EndMode.Clamp,
    ])
    // A start time in the past is how a crowd desyncs, so it must survive as
    // written rather than being folded or clamped.
    expect(texel(playback, PACK_TEXELS.playback, 1)[0]).toBe(-3.5)
  })

  it('writes no transition: a crowd being created has no animation to blend out of', () => {
    const playback = createVATPlaybackTexture([{ clip, startTime: 0, speed: 1 }])

    expect(texel(playback, PACK_TEXELS.crossfade, 0)).toEqual([0, 0, 0, 0])
    expect(texel(playback, PACK_TEXELS.outgoingClip, 0)).toEqual([0, 0, 0, 0])
    expect(texel(playback, PACK_TEXELS.outgoingPlayback, 0)).toEqual([0, 0, 0, 0])
  })

  it('is five texels wide and one row per instance, keyed by the logical index', () => {
    // The carrier ADR-0016 chose: `x = field, y = instance`. A row rather than
    // an instanced attribute because an attribute is indexed by the drawn
    // slot, and the drawn slot stops being the instance the moment a renderer
    // culls or sorts per instance.
    const playback = createVATPlaybackTexture([
      { clip, startTime: 0, speed: 1 },
      { clip, startTime: 0, speed: 1 },
    ])

    expect(Object.values(PACK_TEXELS)).toEqual([0, 1, 2, 3, 4])
    expect(playback.count).toBe(2)
    expect(playback.texture.image.width).toBe(PACK_WIDTH)
    expect(playback.texture.image.height).toBe(2)
  })

  it('carries the pack at full float precision, nearest-sampled', () => {
    // `startTime` is a clock in seconds and does not survive half precision
    // (one second of resolution at 2 048 s), and every fetch of this texture
    // is a texel fetch, so filtering must stay off.
    const playback = createVATPlaybackTexture([{ clip, startTime: 0 }])

    expect(playback.texture.type).toBe(FloatType)
    expect(playback.texture.minFilter).toBe(NearestFilter)
    expect(playback.texture.magFilter).toBe(NearestFilter)
    expect(playback.texture.generateMipmaps).toBe(false)
  })

  it('refuses a crowd past the texture ceiling, saying that is what the ceiling is', () => {
    // One row per instance, so `MAX_TEXTURE_SIZE` *is* the instance ceiling.
    // Asserted rather than worked around: square packing would buy headroom
    // nobody is asking for and a second way to index a pack.
    const tooMany = { length: MAX_TEXTURE_SIZE + 1 } as { length: number }
    const instances = Array.from(tooMany, () => ({ clip, startTime: 0 }))

    expect(() => createVATPlaybackTexture(instances)).toThrow(/past the 16384-row ceiling of MAX_TEXTURE_SIZE/)
  })

  it('refuses a crowd past the limit it is given, naming the limit and where it came from', () => {
    // The Mi 9 reports 4096 (ADR-0027). Without the option a crowd of 4097
    // passes here and fails at upload, with nothing naming the cause.
    expect(() => createVATPlaybackTexture([], { capacity: 4097, maxTextureSize: 4096 })).toThrow(
      /4097 rows .* past the 4096-row ceiling of the maxTextureSize option/,
    )
    expect(() => createVATPlaybackTexture([], { capacity: 4096, maxTextureSize: 4096 })).not.toThrow()
  })

  it('points a crowd refused by the default at the real limit', () => {
    expect(() => createVATPlaybackTexture([], { capacity: MAX_TEXTURE_SIZE + 1 })).toThrow(
      /getMaxTextureSize\(renderer\)/,
    )
    expect(() => createVATPlaybackTexture([], { capacity: MAX_TEXTURE_SIZE })).not.toThrow()
  })

  it('refuses an empty crowd rather than building a texture with no rows', () => {
    expect(() => createVATPlaybackTexture([])).toThrow(/at least one instance/)
  })
})

// ------------------------------------------------------------- the capacity

describe('a reserved capacity', () => {
  // A crowd that spawns and dies is sized from its ceiling rather than from
  // its current population (ADR-0022). The rows are reserved once; the caller
  // owns which of them are live, because the carrier already hands that
  // numbering out.
  it('sizes the texture from the capacity rather than from the instance list', () => {
    const playback = createVATPlaybackTexture([{ clip, startTime: 0 }], { capacity: 8 })

    expect(playback.count).toBe(8)
    expect(playback.texture.image.height).toBe(8)
    expect(playback.texture.image.width).toBe(PACK_WIDTH)
  })

  it('fills the first rows with the instances it was given', () => {
    const playback = createVATPlaybackTexture([{ clip, startTime: 1, speed: 2 }], { capacity: 4 })

    expect(texel(playback, PACK_TEXELS.clip, 0)).toEqual([5, 10, 30, 2])
  })

  it('holds a reserved row on a first frame rather than leaving it zeroed', () => {
    // Not zeroes: a band of no frames divides by zero the day a caller raises
    // their carrier's count past their live instances. One frame, held.
    const playback = createVATPlaybackTexture([], { capacity: 2 })
    const [startFrame, frames, fps, speed] = texel(playback, PACK_TEXELS.clip, 1)

    expect(startFrame).toBe(0)
    expect(frames).toBe(1)
    expect(fps).toBeGreaterThan(0)
    expect(speed).toBe(0)
    expect(texel(playback, PACK_TEXELS.crossfade, 1)).toEqual([0, 0, 0, 0])
  })

  it('resolves a reserved row to a real frame rather than to NaN', () => {
    // The reason the row is not zeroes, stated as the behaviour it buys.
    const reserved = resolveVATFrame({ clip: { startFrame: 0, frames: 1, fps: 30 }, startTime: 0, speed: 0 }, 9)

    expect(reserved.row).toBe(0)
    expect(Number.isNaN(reserved.mix)).toBe(false)
  })

  it('builds a crowd with no live instances at all, for a level that starts empty', () => {
    const playback = createVATPlaybackTexture([], { capacity: 400 })

    expect(playback.count).toBe(400)
  })

  it('still refuses an empty crowd when no capacity reserves the rows', () => {
    expect(() => createVATPlaybackTexture([])).toThrow(/at least one instance/)
    expect(() => createVATPlaybackTexture([], { capacity: 0 })).toThrow(/at least one instance/)
  })

  it('refuses a capacity smaller than the crowd it was handed', () => {
    expect(() => createVATPlaybackTexture([{ clip, startTime: 0 }, { clip, startTime: 0 }], { capacity: 1 })).toThrow(
      /capacity/,
    )
  })

  it('refuses a capacity past the texture ceiling, in the ceiling’s own words', () => {
    expect(() => createVATPlaybackTexture([], { capacity: MAX_TEXTURE_SIZE + 1 })).toThrow(
      /so the texture ceiling is the instance ceiling/,
    )
  })

  it('fills a reserved row with setVATInstance and leaves its neighbours reserved', () => {
    // Spawning is the write the caller already knows: one row, by the index
    // the carrier gave them.
    const playback = createVATPlaybackTexture([], { capacity: 3 })
    const before = texel(playback, PACK_TEXELS.clip, 2)

    setVATInstance(playback, 1, { clip, startTime: 4 })

    expect(texel(playback, PACK_TEXELS.clip, 1)).toEqual([5, 10, 30, 1])
    expect(texel(playback, PACK_TEXELS.playback, 1)[0]).toBe(4)
    expect(texel(playback, PACK_TEXELS.clip, 2)).toEqual(before)
  })

  it('bounds setVATInstance by the capacity, because a reserved row is a row', () => {
    const playback = createVATPlaybackTexture([], { capacity: 3 })

    expect(() => setVATInstance(playback, 2, { clip, startTime: 0 })).not.toThrow()
    expect(() => setVATInstance(playback, 3, { clip, startTime: 0 })).toThrow(/3 rows/)
  })
})

describe('the playback modes', () => {
  it('mirrors three’s own loop constants, in three’s own order', () => {
    // THREE.LoopRepeat / LoopOnce / LoopPingPong, as numbers a Float32Array can
    // carry — the spelling `resolveVATFrame` and both decode paths read.
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
    const playback = createVATPlaybackTexture([instance])
    return {
      speed: texel(playback, PACK_TEXELS.clip, 0)[3],
      loopMode: texel(playback, PACK_TEXELS.playback, 0)[1],
      repetitions: texel(playback, PACK_TEXELS.playback, 0)[2],
      endMode: texel(playback, PACK_TEXELS.playback, 0)[3],
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

// ------------------------------------------------------------ setVATInstance

describe('setVATInstance', () => {
  // The event-driven half: one instance's animation changes at the moment
  // something happens to it, and nothing is touched per frame.
  const death = { startFrame: 20, frames: 6, fps: 12 }

  const crowd = () =>
    createVATPlaybackTexture([
      { clip, startTime: -1, speed: 1 },
      { clip, startTime: -2, speed: 1 },
      { clip, startTime: -3, speed: 1 },
    ])

  it('writes the one instance it was given', () => {
    const playback = crowd()

    setVATInstance(playback, 1, { clip: death, startTime: 12.5, loopMode: LoopMode.Once })

    expect(texel(playback, PACK_TEXELS.clip, 1)).toEqual([20, 6, 12, 1])
    expect(texel(playback, PACK_TEXELS.playback, 1)).toEqual([
      12.5,
      LoopMode.Once,
      1,
      EndMode.Clamp,
    ])
  })

  it('leaves every other instance of the crowd exactly as it was', () => {
    const playback = crowd()
    const before = [0, 2].map((i) => texel(playback, PACK_TEXELS.playback, i))

    setVATInstance(playback, 1, { clip: death, startTime: 12.5 })

    expect([0, 2].map((i) => texel(playback, PACK_TEXELS.playback, i))).toEqual(before)
  })

  it('flags only that instance’s row for upload', () => {
    // The whole point of the write: a crowd of a thousand uploads one row of
    // twelve floats, not twelve thousand. `WebGLRenderer` turns that range
    // into one `texSubImage2D`; the WebGPU backend ignores it and re-uploads
    // the image, which is the asymmetry docs/usage.md records.
    const playback = crowd()
    const uploaded = playback.texture.version

    setVATInstance(playback, 1, { clip: death, startTime: 12.5 })

    expect(playback.texture.updateRanges).toEqual([{ start: PACK_WIDTH * 4, count: PACK_WIDTH * 4 }])
    expect(playback.texture.version, 'flagged for re-upload').toBe(uploaded + 1)
  })

  it('plays the new clip from the given start time', () => {
    const playback = crowd()
    const switched = { clip: death, startTime: 12.5, loopMode: LoopMode.Once }

    setVATInstance(playback, 1, switched)

    // A quarter second into a six-frame, 12 fps clip: three rows in.
    expect(resolveVATFrame(switched, 12.75).row).toBe(23)
  })

  it('inherits the new clip’s baked defaults, as creation does', () => {
    const playback = crowd()

    setVATInstance(playback, 0, {
      clip: { ...death, loopMode: LoopMode.Once, repetitions: 2, endMode: EndMode.Rewind, speed: 3 },
      startTime: 0,
    })

    expect(texel(playback, PACK_TEXELS.clip, 0)[3]).toBe(3)
    expect(texel(playback, PACK_TEXELS.playback, 0)).toEqual([
      0,
      LoopMode.Once,
      2,
      EndMode.Rewind,
    ])
  })

  it('refuses an index outside the crowd', () => {
    expect(() => setVATInstance(crowd(), 3, { clip, startTime: 0 })).toThrow(/3/)
  })
})

// ----------------------------------------------------- a negative speed

describe('a negative speed', () => {
  // A VAT band is sampled forwards from its own first row, and `resolveVATFrame`
  // reads a negative local time as "not started yet" — so a negative speed is
  // not backwards playback, it is an instance frozen on row 0 for ever. Refused
  // where the value enters, rather than rendered as a mystery.
  const backwards = { clip, startTime: 0, speed: -1 }

  it('refuses an instance written into a new crowd, naming the index', () => {
    expect(() => createVATPlaybackTexture([{ clip, startTime: 0 }, backwards])).toThrow(/instance 1/)
  })

  it('says a VAT plays forward, and what to do instead', () => {
    expect(() => createVATPlaybackTexture([backwards])).toThrow(/speed/)
    expect(() => createVATPlaybackTexture([backwards])).toThrow(/revers/)
  })

  it('refuses one written over a live crowd too', () => {
    const playback = createVATPlaybackTexture([{ clip, startTime: 0 }, { clip, startTime: 0 }])

    expect(() => setVATInstance(playback, 1, backwards)).toThrow(/instance 1/)
  })

  it('refuses a negative inherited from the clip’s baked default', () => {
    // The instance says nothing about speed; the clip it was baked from says
    // −1. Resolved, not declared, is what a frame actually plays at.
    const reversed = { ...clip, speed: -1 }

    expect(() => createVATPlaybackTexture([{ clip: reversed, startTime: 0 }])).toThrow(/speed/)
  })

  it('lets an instance override its clip’s negative default back to forwards', () => {
    const reversed = { ...clip, speed: -1 }

    const playback = createVATPlaybackTexture([{ clip: reversed, startTime: 0, speed: 1 }])

    expect(texel(playback, PACK_TEXELS.clip, 0)[3]).toBe(1)
  })

  it('builds no texture at all when it refuses', () => {
    // A crowd refused at instance 1 must leave nothing behind: the pack is
    // filled before the texture exists, so a refusal is a throw and not a
    // half-written crowd the caller now owns.
    expect(() => createVATPlaybackTexture([{ clip, startTime: 0 }, backwards])).toThrow(/speed/)
  })

  it('leaves zero alone: a held first row is a legal thing to ask for', () => {
    const playback = createVATPlaybackTexture([{ clip, startTime: 0, speed: 0 }])

    expect(texel(playback, PACK_TEXELS.clip, 0)[3]).toBe(0)
    expect(endsAt({ clip, startTime: 0, speed: 0 })).toBe(null)
  })
})

// ------------------------------------------------------------------- endsAt

describe('endsAt', () => {
  const ten = { startFrame: 5, frames: 10, fps: 10 } // one second, ten rows
  const once = { clip: ten, startTime: 4, loopMode: LoopMode.Once }

  it('returns the moment resolveVATFrame first reports finished', () => {
    const end = endsAt(once)!

    expect(resolveVATFrame(once, end - 0.001).finished).toBe(false)
    expect(resolveVATFrame(once, end).finished).toBe(true)
  })

  it('counts every repetition, at the instance’s own speed', () => {
    // Two plays of a one-second clip at double speed: one second of clock.
    expect(endsAt({ ...once, repetitions: 2, speed: 2 })).toBe(5)
  })

  it('returns null for an endless loop, because there is no such moment', () => {
    expect(endsAt({ clip: ten, startTime: 0 })).toBe(null)
    expect(endsAt({ clip: ten, startTime: 0, repetitions: INFINITE_REPETITIONS })).toBe(null)
  })

  it('returns null for an instance whose clock never advances', () => {
    expect(endsAt({ ...once, speed: 0 })).toBe(null)
  })

  it('reads a clip’s baked defaults, so a chained one-shot needs no fields', () => {
    const bakedOnce = { ...ten, loopMode: LoopMode.Once, repetitions: 1, endMode: EndMode.Clamp, speed: 1 }

    expect(endsAt({ clip: bakedOnce, startTime: 4 })).toBe(5)
  })

  it('schedules a chain with one write and no polling', () => {
    // The whole chaining story: the next clip is written once, at a time known
    // the moment the first was written. The GPU never learns about it.
    const playback = createVATPlaybackTexture([{ clip: ten, startTime: 0 }])
    const hit = { clip: ten, startTime: 4, loopMode: LoopMode.Once }
    setVATInstance(playback, 0, hit)

    const next = { clip: ten, startTime: endsAt(hit)! }
    setVATInstance(playback, 0, next)

    expect(texel(playback, PACK_TEXELS.playback, 0)[0]).toBe(5)
  })
})

// ------------------------------------------------------------- the crossfade

describe('the crossfade', () => {
  // An instance blends between two clips and **both keep playing** (ADR-0025).
  // Everything here is a behaviour a caller can see: the floats a write leaves
  // in a row, and the rows and weight the resolver answers with at a moment.
  const walk = { startFrame: 0, frames: 10, fps: 10 } // one second, ten rows
  const death = { startFrame: 20, frames: 10, fps: 10 }

  const walking = () => createVATPlaybackTexture([{ clip: walk, startTime: 0 }])

  /** One instance's whole row, as plain numbers — every texel of the pack. */
  const row = (playback: VATPlaybackTexture, i: number) =>
    Array.from((playback.texture.image.data as Float32Array).slice(i * PACK_WIDTH * 4, (i + 1) * PACK_WIDTH * 4))

  /** Half a second into the walk, switching to a death over half a second. */
  const transition = (over = 0.5, from: VATInstance['from'] = { clip: walk, startTime: 0 }) => ({
    clip: death,
    startTime: 0.5,
    loopMode: LoopMode.Once,
    fadeDuration: over,
    from,
  })

  describe('the write', () => {
    it('fills the outgoing band from the row the instance was already playing', () => {
      const playback = walking()

      setVATInstance(playback, 0, { clip: death, startTime: 0.5, loopMode: LoopMode.Once, fadeDuration: 0.5 })

      // A whole playback state, not a photograph of one: the outgoing clip's
      // band, its own start time, its own speed and its own policy.
      expect(texel(playback, PACK_TEXELS.crossfade, 0)).toEqual([0.5, 0, 0, 0])
      expect(texel(playback, PACK_TEXELS.outgoingClip, 0)).toEqual([0, 10, 10, 1])
      expect(texel(playback, PACK_TEXELS.outgoingPlayback, 0)).toEqual([
        0,
        LoopMode.Repeat,
        INFINITE_REPETITIONS,
        EndMode.Clamp,
      ])
    })

    it('honours a `from` the caller writes by hand, as given', () => {
      // The primitives stay composable for a crowd the library does not build:
      // what you pass is what is written, and nothing is filled in over it.
      const playback = walking()

      setVATInstance(playback, 0, {
        clip: death,
        startTime: 1,
        fadeDuration: 0.25,
        from: { clip: { startFrame: 40, frames: 4, fps: 8 }, startTime: 0.25, speed: 0.5, loopMode: LoopMode.PingPong },
      })

      expect(texel(playback, PACK_TEXELS.outgoingClip, 0)).toEqual([40, 4, 8, 0.5])
      expect(texel(playback, PACK_TEXELS.outgoingPlayback, 0)).toEqual([0.25, LoopMode.PingPong, 1, EndMode.Clamp])
    })

    it('keeps the duration uncapped: a long, deliberate transition is the caller’s to ask for', () => {
      const playback = walking()

      setVATInstance(playback, 0, { clip: death, startTime: 0, fadeDuration: 10 })

      expect(texel(playback, PACK_TEXELS.crossfade, 0)[0]).toBe(10)
    })

    it('writes no outgoing band for a cut — no duration, or a duration of zero', () => {
      // Which is what spawning into a recycled row must be: a blend there would
      // blend out of the previous occupant's clip.
      const playback = walking()

      setVATInstance(playback, 0, { clip: death, startTime: 0.5 })
      expect(row(playback, 0).slice(8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])

      setVATInstance(playback, 0, { clip: death, startTime: 0.5, fadeDuration: 0 })
      expect(row(playback, 0).slice(8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    })

    it('clears an outgoing band the next write does not ask for', () => {
      // A cut over a transition is a cut: the older band must not survive in
      // texels the decode would read the moment a duration is written again.
      const playback = walking()

      setVATInstance(playback, 0, { clip: death, startTime: 0.5, fadeDuration: 0.5 })
      setVATInstance(playback, 0, { clip: walk, startTime: 1 })

      expect(row(playback, 0).slice(8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    })

    it('replaces the outgoing band mid-transition, dropping the older one', () => {
      // The pack holds two bands and they are the incoming clip and the one it
      // replaced; a third would be a different contract. The documented
      // discontinuity, asserted as the two bands that remain.
      const playback = walking()

      setVATInstance(playback, 0, { clip: death, startTime: 0.5, fadeDuration: 0.5 })
      setVATInstance(playback, 0, { clip: walk, startTime: 0.6, fadeDuration: 0.5 })

      expect(texel(playback, PACK_TEXELS.clip, 0)).toEqual([0, 10, 10, 1])
      // The death it was switching to, at the start time that write gave it —
      // not the walk it had been leaving.
      expect(texel(playback, PACK_TEXELS.outgoingClip, 0)).toEqual([20, 10, 10, 1])
      expect(texel(playback, PACK_TEXELS.outgoingPlayback, 0)[0]).toBe(0.5)
    })

    it('refuses a negative or non-finite duration by name, leaving the row untouched', () => {
      // A bad value is a mistake in the caller's code; left to the GPU it is a
      // crowd that quietly never finishes transitioning.
      const playback = walking()
      const before = row(playback, 0)

      for (const fadeDuration of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => setVATInstance(playback, 0, { clip: death, startTime: 1, fadeDuration })).toThrow(
          /fadeDuration/,
        )
      }
      expect(row(playback, 0)).toEqual(before)
    })

    it('refuses a negative speed on the outgoing band too, and writes nothing', () => {
      const playback = walking()
      const before = row(playback, 0)

      expect(() =>
        setVATInstance(playback, 0, {
          clip: death,
          startTime: 1,
          fadeDuration: 0.5,
          from: { clip: walk, startTime: 0, speed: -1 },
        }),
      ).toThrow(/outgoing band of instance 0/)
      expect(row(playback, 0)).toEqual(before)
    })

    it('covers the whole row with one upload range, five texels wide', () => {
      const playback = createVATPlaybackTexture([{ clip: walk, startTime: 0 }, { clip: walk, startTime: 0 }])

      setVATInstance(playback, 1, { clip: death, startTime: 0.5, fadeDuration: 0.5 })

      expect(playback.texture.image.width).toBe(5)
      expect(playback.texture.updateRanges).toEqual([{ start: PACK_WIDTH * 4, count: PACK_WIDTH * 4 }])
    })
  })

  describe('the resolved frame', () => {
    it('keeps the outgoing clip playing: its rows advance through the transition', () => {
      // The whole of what a crossfade is, and the whole of what the pose freeze
      // was not: the walk is still walking while the death plays over it.
      const blending = transition()

      expect(resolveVATFrame(blending, 0.5).outgoing!.row).toBe(5)
      expect(resolveVATFrame(blending, 0.8).outgoing!.row).toBe(8)
    })

    it('falls from one to zero over the duration, and stays there', () => {
      const blending = transition()

      expect(resolveVATFrame(blending, 0.5).outgoing!.weight).toBe(1)
      expect(resolveVATFrame(blending, 0.75).outgoing!.weight).toBe(0.5)
      expect(resolveVATFrame(blending, 1).outgoing!.weight).toBe(0)
      expect(resolveVATFrame(blending, 5).outgoing!.weight).toBe(0)
    })

    it('measures the transition in wall clock, whatever the incoming clip’s speed', () => {
      // A half-speed clip does not get a transition twice as long.
      const slow = { ...transition(), speed: 0.5 }

      expect(resolveVATFrame(slow, 0.75).outgoing!.weight).toBe(0.5)
      expect(resolveVATFrame(slow, 1).outgoing!.weight).toBe(0)
    })

    it('keeps the outgoing band’s own speed', () => {
      // A fast walk blends out as a fast walk: at t = 0.25 a double-speed walk
      // is half a second in.
      const blending = { ...transition(), startTime: 0, from: { clip: walk, startTime: 0, speed: 2 } }

      expect(resolveVATFrame(blending, 0.25).outgoing!.row).toBe(5)
    })

    it('clamps an outgoing one-shot that runs out mid-transition', () => {
      // The outgoing half obeys the playback policy it always did, rather than
      // wrapping back to its first row under a long blend.
      const blending = transition(2, { clip: walk, startTime: 0, loopMode: LoopMode.Once })

      expect(resolveVATFrame(blending, 1.5).outgoing).toMatchObject({ row: 9, rowNext: 9, finished: true })
    })

    it('blends out of a finished one-shot by the end pose it was holding', () => {
      // The corpse that gets back up: the outgoing instance had finished and
      // was clamped seconds ago, and that is the pose it leaves from.
      const playback = createVATPlaybackTexture([{ clip: death, startTime: 0, loopMode: LoopMode.Once }])

      setVATInstance(playback, 0, { clip: walk, startTime: 4, fadeDuration: 0.25 })

      expect(texel(playback, PACK_TEXELS.outgoingPlayback, 0)).toEqual([0, LoopMode.Once, 1, EndMode.Clamp])
      const leaving = {
        clip: walk,
        startTime: 4,
        fadeDuration: 0.25,
        from: { clip: death, startTime: 0, loopMode: LoopMode.Once },
      }
      // Row 29 — the last of the death band — and it stays there.
      expect(resolveVATFrame(leaving, 4.1).outgoing!.row).toBe(29)
      expect(resolveVATFrame(leaving, 4.2).outgoing!.row).toBe(29)
    })

    it('answers `null` rather than a weight of zero for an instance that is not transitioning', () => {
      // A reader with no interest in transitions ignores one field rather than
      // testing one — and a cut resolves to no outgoing band at all.
      expect(resolveVATFrame({ clip: death, startTime: 0.5 }, 0.6).outgoing).toBe(null)
      expect(resolveVATFrame({ clip: death, startTime: 0.5, fadeDuration: 0 }, 0.6).outgoing).toBe(null)
      expect(resolveVATFrame({ clip: death, startTime: 0.5, fadeDuration: 0.5 }, 0.6).outgoing).toBe(null)
    })

    it('carries a reserved row with no transition', () => {
      const playback = createVATPlaybackTexture([], { capacity: 2 })

      expect(texel(playback, PACK_TEXELS.crossfade, 1)).toEqual([0, 0, 0, 0])
      expect(resolveVATFrame({ clip: { startFrame: 0, frames: 1, fps: 1 }, startTime: 0, speed: 0 }, 9).outgoing).toBe(
        null,
      )
    })

    it('resolves the outgoing band through itself, one level deep', () => {
      // The outgoing half is a frame like any other — the same function, the
      // same fields — and the pack holds two bands, so it has none of its own.
      const outgoing = resolveVATFrame(transition(), 0.6).outgoing!

      expect(outgoing.outgoing).toBe(null)
      expect(Object.keys(outgoing).sort()).toEqual(
        ['finished', 'mix', 'outgoing', 'phase', 'row', 'rowNext', 'weight', 'wraps'].sort(),
      )
    })

    it('leaves the incoming band, and `endsAt`, exactly as they were', () => {
      // The transition has no bearing on when the clip an instance is playing
      // finishes, or on which rows it is between while it plays.
      const cut = { clip: death, startTime: 0.5, loopMode: LoopMode.Once }
      const blending = transition()

      expect(resolveVATFrame(blending, 0.7)).toMatchObject({
        row: resolveVATFrame(cut, 0.7).row,
        rowNext: resolveVATFrame(cut, 0.7).rowNext,
        finished: false,
      })
      expect(endsAt(blending)).toBe(endsAt(cut))
    })
  })
})

