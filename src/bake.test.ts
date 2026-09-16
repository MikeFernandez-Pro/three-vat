import { describe, expect, it } from 'vitest'
import { bakeVAT, MAX_TEXTURE_SIZE } from './bake.js'
import {
  makeAbsoluteMorphFixture,
  makeMorphFixture,
  makeRigidSubtreeFixture,
  makeSkinnedFixture,
} from './test-utils.js'

describe('bakeVAT', () => {
  it('produces textures sized vertexCount x totalFrames', () => {
    const { root, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(vat.vertexCount).toBe(1)
    expect(vat.totalFrames).toBe(30)
    expect(vat.positionTexture.image.width).toBe(1)
    expect(vat.positionTexture.image.height).toBe(30)
    expect(vat.normalTexture.image.width).toBe(1)
    expect(vat.normalTexture.image.height).toBe(30)
    expect(vat.encoding).toBe('delta')
  })

  it('rejects a vertexCount above the caller-supplied maxTextureSize', () => {
    const { root, clip } = makeSkinnedFixture()

    // The fixture has 1 vertex, so a limit of 0 is the smallest way to trip it.
    expect(() => bakeVAT(root, [clip], { maxTextureSize: 0 })).toThrow(/vertexCount 1 exceeds maxTextureSize 0/)
  })

  it('rejects a totalFrames above maxTextureSize — frames are rows, same cap', () => {
    const { root, clip } = makeSkinnedFixture()

    expect(() => bakeVAT(root, [clip], { fps: 30, maxTextureSize: 10 })).toThrow(
      /totalFrames 30 exceeds maxTextureSize 10/,
    )
  })

  it('defaults maxTextureSize to MAX_TEXTURE_SIZE when unspecified', () => {
    const { root, clip } = makeSkinnedFixture()

    expect(() => bakeVAT(root, [clip], { fps: 30 })).not.toThrow()
    expect(MAX_TEXTURE_SIZE).toBe(16384)
  })

  it('bakes a zero position delta at the bind pose (frame 0)', () => {
    const { root, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const data = vat.positionTexture.image.data as Float32Array

    expect(data[0]).toBeCloseTo(0, 5) // dx
    expect(data[1]).toBeCloseTo(0, 5) // dy
    expect(data[2]).toBeCloseTo(0, 5) // dz
  })

  it('records a clip table with startFrame and a non-zero maxDelta for a moving clip', () => {
    const { root, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(vat.clips).toHaveLength(1)
    const c = vat.clips[0]!
    expect(c.name).toBe('spin')
    expect(c.startFrame).toBe(0)
    expect(c.frames).toBe(30)
    // Vertex sweeps ~ (1,0,0) -> (0,1,0), so the max delta magnitude is ~1.3 m.
    expect(c.maxDelta).toBeGreaterThan(0.5)
  })

  it('stacks multiple clips vertically with contiguous frame bands', () => {
    const { root, clip } = makeSkinnedFixture()
    const second = clip.clone()
    second.name = 'spin2'
    const vat = bakeVAT(root, [clip, second], { fps: 30 })

    expect(vat.totalFrames).toBe(60)
    expect(vat.clips.map((c) => c.startFrame)).toEqual([0, 30])
    expect(vat.clips.map((c) => c.name)).toEqual(['spin', 'spin2'])
  })

  it('expands bounds to the union of all baked frames', () => {
    const { root, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // The vertex arc reaches up toward y = 1 and left toward x = 0.
    expect(vat.bounds.max.y).toBeGreaterThan(0.5)
    expect(vat.bounds.min.x).toBeLessThan(1)
  })

  it('bakes morph-target deformation on a mesh with no skeleton', () => {
    const { root, clip } = makeMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const data = vat.positionTexture.image.data as Float32Array

    expect(vat.vertexCount).toBe(1)
    expect(vat.totalFrames).toBe(30)

    // Frame 0: influence 0 → no morph, zero delta.
    expect(data[0]).toBeCloseTo(0, 5)

    // The target displaces +1 along x as influence ramps to ~1, so the last
    // frame's delta and the clip's maxDelta both approach 1.
    const last = (29 * 1 + 0) * 4
    expect(data[last]).toBeGreaterThan(0.9)
    expect(data[last + 1]).toBeCloseTo(0, 5)
    expect(vat.clips[0]!.maxDelta).toBeGreaterThan(0.9)
  })

  it('derives normals when the geometry ships without them', () => {
    // The three.js birds carry position + color but no normal attribute.
    const { root, mesh, clip } = makeMorphFixture()
    mesh.geometry.deleteAttribute('normal')

    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(mesh.geometry.attributes.normal).toBeDefined() // computed in-place
    expect(vat.normalTexture.image.width).toBe(1)
    expect(vat.normalTexture.image.height).toBe(30)
  })
})

describe('bakeVAT over a rigid node-animated subtree', () => {
  // The RobotExpressive case: no skinning, no morph targets, all motion in the
  // node hierarchy. The single-mesh baker saw zero deformation here.
  it('bakes non-zero deltas for a part moved only by its node transform', () => {
    const { root, clip } = makeRigidSubtreeFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // maxDelta is the library's own "frozen pose" diagnostic; it must not fire.
    expect(vat.clips[0]!.maxDelta).toBeGreaterThan(1)
  })

  it('merges every mesh in the subtree into one vertex range', () => {
    const { root, clip } = makeRigidSubtreeFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(vat.vertexCount).toBe(2) // arm + body
    expect(vat.positionTexture.image.width).toBe(2)
    expect(vat.geometry.attributes.position!.count).toBe(2)
  })

  it('keeps materials separate as geometry groups, one per material', () => {
    const { root, clip } = makeRigidSubtreeFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(vat.materials).toHaveLength(2)
    expect(vat.geometry.groups).toHaveLength(2)
    // Every group must address a real material slot.
    for (const g of vat.geometry.groups) {
      expect(vat.materials[g.materialIndex!]).toBeDefined()
    }
  })

  it('bakes the rest pose into the merged geometry, so frame 0 has zero delta', () => {
    const { root, clip } = makeRigidSubtreeFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const data = vat.positionTexture.image.data as Float32Array

    // Row 0 covers both vertices: 2 verts x 4 channels.
    for (let i = 0; i < 8; i++) {
      if (i % 4 === 3) continue // w channel is padding
      expect(Math.abs(data[i]!)).toBeLessThan(1e-6)
    }
    // And the rest pose itself is the arm's root-space position (1, 0, 0).
    const pos = vat.geometry.attributes.position!
    const xs = [pos.getX(0), pos.getX(1)].sort()
    expect(xs).toEqual([0, 1])
  })

  it('leaves a static part at zero delta across every frame', () => {
    const { root, body, clip } = makeRigidSubtreeFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const data = vat.positionTexture.image.data as Float32Array
    const pos = vat.geometry.attributes.position!

    // Find the merged index of the never-moving body (it rests at the origin).
    const bodyIndex = pos.getX(0) === 0 && pos.getY(0) === 0 ? 0 : 1
    expect(body.name).toBe('body')

    for (let row = 0; row < vat.totalFrames; row++) {
      const o = (row * vat.vertexCount + bodyIndex) * 4
      expect(Math.hypot(data[o]!, data[o + 1]!, data[o + 2]!)).toBeLessThan(1e-6)
    }
  })

  it('records deltas in root space, so moving the root does not change them', () => {
    const a = makeRigidSubtreeFixture()
    const vatA = bakeVAT(a.root, [a.clip], { fps: 30 })

    const b = makeRigidSubtreeFixture()
    b.root.position.set(100, -5, 3)
    b.root.rotateY(0.7)
    b.root.updateMatrixWorld(true)
    const vatB = bakeVAT(b.root, [b.clip], { fps: 30 })

    const da = vatA.positionTexture.image.data as Float32Array
    const db = vatB.positionTexture.image.data as Float32Array
    expect(da.length).toBe(db.length)
    for (let i = 0; i < da.length; i++) {
      expect(db[i]!).toBeCloseTo(da[i]!, 5)
    }
  })
})

describe('bakeVAT with absolute morph targets', () => {
  it('measures every target against the base vertex, not the partially-morphed one', () => {
    const { root, clip } = makeAbsoluteMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const data = vat.positionTexture.image.data as Float32Array

    // Two absolute targets, A = (2, 0, 0) and B = (0, 2, 0), each at influence
    // ~0.5 by the last frame: base + 0.5 * (A - base) + 0.5 * (B - base), so
    // the vertex lands at ~(1, 1, 0). Subtracting the running total instead of
    // the base would skew it toward ~(0.5, 1, 0).
    const last = 29 * 4
    expect(data[last]!).toBeCloseTo(0.966, 2)
    expect(data[last + 1]!).toBeCloseTo(0.966, 2)
    expect(data[last + 2]!).toBeCloseTo(0, 5)
  })
})
