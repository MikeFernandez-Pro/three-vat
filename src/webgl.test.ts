import { BufferAttribute, BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { addInstancedVATAttributes } from './webgl.js'

const instance = { clip: { startFrame: 0, frames: 10, fps: 30 }, timeOffset: 1, speed: 2 }

describe('addInstancedVATAttributes', () => {
  it('attaches the per-instance attributes the shader reads', () => {
    const geometry = new BufferGeometry()
    addInstancedVATAttributes(geometry, [instance, instance])

    for (const name of ['aClipStart', 'aClipFrames', 'aClipFps', 'aTimeOffset', 'aSpeed']) {
      expect(geometry.getAttribute(name).count).toBe(2)
    }
  })

  it('strips morph targets, which the VAT supersedes', () => {
    // A morph-baked source geometry still carries its targets after cloning;
    // leaving them on an InstancedMesh crashes three's morph path.
    const geometry = new BufferGeometry()
    geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
    geometry.morphTargetsRelative = true

    addInstancedVATAttributes(geometry, [instance])

    expect(geometry.morphAttributes.position).toBeUndefined()
    expect(geometry.morphTargetsRelative).toBe(false)
  })
})
