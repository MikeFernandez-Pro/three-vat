import { describe, expect, it } from 'vitest'
import { bakeVAT } from './bake.js'
import { makeSkinnedFixture } from './test-utils.js'

describe('bakeVAT', () => {
  it('produces textures sized vertexCount x totalFrames', () => {
    const { root, mesh, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, mesh, [clip], { fps: 30 })

    expect(vat.vertexCount).toBe(1)
    expect(vat.totalFrames).toBe(30)
    expect(vat.positionTexture.image.width).toBe(1)
    expect(vat.positionTexture.image.height).toBe(30)
    expect(vat.normalTexture.image.width).toBe(1)
    expect(vat.normalTexture.image.height).toBe(30)
    expect(vat.encoding).toBe('delta')
  })

  it('bakes a zero position delta at the bind pose (frame 0)', () => {
    const { root, mesh, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, mesh, [clip], { fps: 30 })
    const data = vat.positionTexture.image.data as Float32Array

    expect(data[0]).toBeCloseTo(0, 5) // dx
    expect(data[1]).toBeCloseTo(0, 5) // dy
    expect(data[2]).toBeCloseTo(0, 5) // dz
  })

  it('records a clip table with startFrame and a non-zero maxDelta for a moving clip', () => {
    const { root, mesh, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, mesh, [clip], { fps: 30 })

    expect(vat.clips).toHaveLength(1)
    const c = vat.clips[0]!
    expect(c.name).toBe('spin')
    expect(c.startFrame).toBe(0)
    expect(c.frames).toBe(30)
    // Vertex sweeps ~ (1,0,0) -> (0,1,0), so the max delta magnitude is ~1.3 m.
    expect(c.maxDelta).toBeGreaterThan(0.5)
  })

  it('stacks multiple clips vertically with contiguous frame bands', () => {
    const { root, mesh, clip } = makeSkinnedFixture()
    const second = clip.clone()
    second.name = 'spin2'
    const vat = bakeVAT(root, mesh, [clip, second], { fps: 30 })

    expect(vat.totalFrames).toBe(60)
    expect(vat.clips.map((c) => c.startFrame)).toEqual([0, 30])
    expect(vat.clips.map((c) => c.name)).toEqual(['spin', 'spin2'])
  })

  it('expands bounds to the union of all baked frames', () => {
    const { root, mesh, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, mesh, [clip], { fps: 30 })

    // The vertex arc reaches up toward y = 1 and left toward x = 0.
    expect(vat.bounds.max.y).toBeGreaterThan(0.5)
    expect(vat.bounds.min.x).toBeLessThan(1)
  })
})
