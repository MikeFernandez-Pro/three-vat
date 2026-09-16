import { BufferAttribute, BufferGeometry, InstancedBufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'
import { addVATInstanceAttributes } from './instance-playback.js'
import { addInstancedVATAttributes } from './webgl.js'

const clip = { startFrame: 5, frames: 10, fps: 30 }

describe('addVATInstanceAttributes', () => {
  it('writes the playback triple into the contract attributes, one per instance', () => {
    const geometry = new BufferGeometry()
    addVATInstanceAttributes(geometry, [
      { clip, timeOffset: 1, speed: 2 },
      { clip: { startFrame: 0, frames: 4, fps: 24 }, timeOffset: 0.5, speed: 0.25 },
    ])

    const values = (name: string) => Array.from(geometry.getAttribute(name).array)
    expect(values('aClipStart')).toEqual([5, 0])
    expect(values('aClipFrames')).toEqual([10, 4])
    expect(values('aClipFps')).toEqual([30, 24])
    expect(values('aTimeOffset')).toEqual([1, 0.5])
    expect(values('aSpeed')).toEqual([2, 0.25])
  })

  it('writes them as one-component instanced attributes, so a decode path can read them per instance', () => {
    const geometry = new BufferGeometry()
    addVATInstanceAttributes(geometry, [{ clip, timeOffset: 0, speed: 1 }])

    for (const name of ['aClipStart', 'aClipFrames', 'aClipFps', 'aTimeOffset', 'aSpeed']) {
      const attribute = geometry.getAttribute(name)
      expect(attribute, name).toBeInstanceOf(InstancedBufferAttribute)
      expect(attribute.itemSize, name).toBe(1)
    }
  })

  it('strips morph targets, which the VAT supersedes', () => {
    const geometry = new BufferGeometry()
    geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
    geometry.morphTargetsRelative = true

    addVATInstanceAttributes(geometry, [{ clip, timeOffset: 0, speed: 1 }])

    expect(geometry.morphAttributes.position).toBeUndefined()
    expect(geometry.morphTargetsRelative).toBe(false)
  })
})

describe('the deprecated WebGL name', () => {
  it('is the same function, so existing WebGL callers keep working', () => {
    expect(addInstancedVATAttributes).toBe(addVATInstanceAttributes)
  })
})
