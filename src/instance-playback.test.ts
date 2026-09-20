import { BufferAttribute, BufferGeometry, InstancedBufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'
import {
  addVATInstanceAttributes,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PLAYBACK_ATTRIBUTES,
} from './instance-playback.js'

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
