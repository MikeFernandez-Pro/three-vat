import { FloatType, NearestFilter, Vector3 } from 'three'
import type { AnimationClip, Object3D } from 'three'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { bakeVAT } from './bake.js'
import type { BakeOptions } from './bake.js'
import { RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import {
  decodeDeltaNormal,
  decodeDeltaPosition,
  makeBoneScaleFixture,
  makeFullSpinFixture,
  makeMultiBoneFixture,
  makePlacedSkinnedFixture,
  makeRigidSubtreeFixture,
  makeSkinnedFixture,
  makeSkinnedMorphFixture,
  skinFromRig,
  slotTexels,
} from './test-utils.js'
import type { DeltaVAT, RigVAT, VAT } from './types.js'

// The rig encoding (ADR-0018), checked against the library's own oracle: the
// vertex encoding already knows where every vertex ends up, so a rig bake is
// right when skinning the rest pose from its row — exactly as the shader will,
// `skinFromRig` in test-utils — lands on the same answer. Every assertion here
// is on what a caller can observe: texels, dimensions, the clip table, the
// bounds, the type.

function expectVector3Close(actual: Vector3, expected: Vector3, digits = 5): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

/** Both encodings of one fixture, from one root — the mixer restores the rest pose between them. */
function bothBakes(root: Object3D, clips: AnimationClip[], fps = 30): { delta: DeltaVAT; rig: RigVAT } {
  return {
    delta: bakeVAT(root, clips, { fps }),
    rig: bakeVAT(root, clips, { fps, encoding: 'rig' }),
  }
}

/** Every skinned fixture the suite has that a rig can express, by name. */
const SKINNED_FIXTURES = {
  'one bone, spinning': () => makeSkinnedFixture(),
  'four bones, blended': () => makeMultiBoneFixture(),
  'a placed part, two bones bound off the origin': () => makePlacedSkinnedFixture(),
  'a uniformly scaled bone': () => makeBoneScaleFixture([2, 2, 2]),
  'a full turn, across the quaternion hemisphere': () => makeFullSpinFixture(),
} satisfies Record<string, () => { root: Object3D; clip: AnimationClip }>

// ------------------------------------------------------------ the rig texture

describe('bakeVAT with encoding: "rig"', () => {
  it('writes a rig texture two texels per slot wide and one row per frame, through the texture factory', () => {
    const { root, clip } = makeMultiBoneFixture()

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(vat.encoding).toBe('rig')
    expect(vat.slotCount).toBe(4)
    expect(vat.totalFrames).toBe(30)
    expect(vat.rigTexture.image.width).toBe(4 * RIG_TEXELS_PER_SLOT)
    expect(vat.rigTexture.image.height).toBe(30)
    // The factory's fixed flags: float texels, no filtering between them.
    expect(vat.rigTexture.type).toBe(FloatType)
    expect(vat.rigTexture.minFilter).toBe(NearestFilter)
    expect(vat.rigTexture.magFilter).toBe(NearestFilter)
    expect(vat.rigTexture.generateMipmaps).toBe(false)
  })

  it('carries no position or normal texture — the type says so, and so does the object', () => {
    const { root, clip } = makeSkinnedFixture()

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expectTypeOf(vat).toEqualTypeOf<RigVAT>()
    expect('positionTexture' in vat).toBe(false)
    expect('normalTexture' in vat).toBe(false)
  })

  it('keeps the rest geometry in part-local space, with skinIndex and skinWeight remapped to slots', () => {
    // The slot carries the placement, so the vertex must not also carry it —
    // the part sits under a carrier turned 90° and lifted, and the merged
    // position is the source attribute untouched.
    const { root, mesh, clip } = makePlacedSkinnedFixture()

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    const position = vat.geometry.attributes.position!
    const source = mesh.geometry.attributes.position!
    for (let v = 0; v < 2; v++) {
      expect([position.getX(v), position.getY(v), position.getZ(v)]).toEqual([
        source.getX(v),
        source.getY(v),
        source.getZ(v),
      ])
    }
    expect(vat.geometry.attributes.skinIndex!.itemSize).toBe(4)
    expect(vat.geometry.attributes.skinWeight!.itemSize).toBe(4)
    expect(Array.from(vat.geometry.attributes.skinWeight!.array)).toEqual([1, 0, 0, 0, 0.5, 0.5, 0, 0])
    // One part, so its slots start at 0 and its bone indices are its slot indices.
    expect(Array.from(vat.geometry.attributes.skinIndex!.array)).toEqual([0, 0, 0, 0, 0, 1, 0, 0])
  })

  it('shares the vertex bake’s clip table, and its vertex count', () => {
    const { root, clip } = makePlacedSkinnedFixture()
    const second = clip.clone()
    second.name = 'reach2'

    const { delta, rig } = bothBakes(root, [clip, second])

    expect(rig.vertexCount).toBe(delta.vertexCount)
    expect(rig.totalFrames).toBe(delta.totalFrames)
    expect(rig.clips.map(({ maxDelta: _, ...rest }) => rest)).toEqual(
      delta.clips.map(({ maxDelta: _, ...rest }) => rest),
    )
  })
})

// ---------------------------------------------------------------- the oracle

describe('a rig row, composed and skinned on the CPU, lands where the vertex bake put the vertex', () => {
  for (const [name, make] of Object.entries(SKINNED_FIXTURES)) {
    it(`for ${name}, every frame, position and normal`, () => {
      const { root, clip } = make()
      const { delta, rig } = bothBakes(root, [clip])

      for (let row = 0; row < rig.totalFrames; row++) {
        for (let v = 0; v < rig.vertexCount; v++) {
          const { position, normal } = skinFromRig(rig, v, row)
          expectVector3Close(position, decodeDeltaPosition(delta, row, v))
          expectVector3Close(normal, decodeDeltaNormal(delta, row, v))
        }
      }
    })
  }

  it('across two clips stacked as bands', () => {
    const { root, clip } = makePlacedSkinnedFixture()
    const second = clip.clone()
    second.name = 'reach2'
    const { delta, rig } = bothBakes(root, [clip, second])

    for (const band of rig.clips) {
      for (const row of [band.startFrame, band.startFrame + band.frames - 1]) {
        for (let v = 0; v < rig.vertexCount; v++) {
          expectVector3Close(skinFromRig(rig, v, row).position, decodeDeltaPosition(delta, row, v))
        }
      }
    }
  })

  it('blended between two rows as the shader blends them, is a rotation at every point', () => {
    // The blend the decode does — normalised lerp of the quaternions, lerp of
    // the rest — against the mixer posed halfway between two rows. At a 30 fps
    // step the angular difference from a true slerp is far below the tolerance;
    // what this pins is that the row-to-row blend lands on the mixer's pose
    // rather than shortening the limb as a componentwise matrix lerp would.
    const { root, clip } = makeFullSpinFixture()
    const rig = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })
    // The same clip sampled at twice the rate: its odd rows are the midpoints.
    const fine = bakeVAT(makeFullSpinFixture().root, [clip], { fps: 60 })

    for (let row = 0; row + 1 < rig.totalFrames; row++) {
      const blended = skinFromRig(rig, 0, row, row + 1, 0.5).position
      expectVector3Close(blended, decodeDeltaPosition(fine, row * 2 + 1, 0), 3)
    }
  })

  it('blended across the wrap, from the band’s last row into its first, is a rotation too', () => {
    // A looping clip's decode blends its last row into its first. Hemisphere
    // continuity was kept between neighbours, and these two are not: a bone
    // that turned a full circle arrives at its last row on the far side of its
    // first. The decode's sign check is what keeps this frame from passing
    // through zero — the full spin's midpoint between 348° and 360° is 354°,
    // the fine bake's last row.
    const { root, clip } = makeFullSpinFixture()
    const rig = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })
    const fine = bakeVAT(makeFullSpinFixture().root, [clip], { fps: 60 })

    const last = rig.totalFrames - 1
    expect(slotTexels(rig, last, 0).q.dot(slotTexels(rig, 0, 0).q)).toBeLessThan(0)
    const blended = skinFromRig(rig, 0, last, 0, 0.5).position
    expectVector3Close(blended, decodeDeltaPosition(fine, fine.totalFrames - 1, 0), 3)
  })

  it('keeps consecutive rows of a slot on one hemisphere, so a neighbour blend needs no sign check', () => {
    // A quaternion read off a matrix comes back with w >= 0, which flips sign
    // as the angle crosses 180°. The bake smooths that away; a shader that
    // lerped across the flip would pass through zero and turn the limb inside
    // out for a frame.
    const { root, clip } = makeFullSpinFixture()
    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    let crossed = false
    for (let row = 0; row + 1 < vat.totalFrames; row++) {
      const a = slotTexels(vat, row, 0).q
      const b = slotTexels(vat, row + 1, 0).q
      expect(a.dot(b)).toBeGreaterThanOrEqual(0)
      if (b.w < 0) crossed = true
    }
    // …and the fixture really does cross: a bake that never wrote a negative w
    // never had a flip to smooth.
    expect(crossed).toBe(true)
  })
})

// --------------------------------------------------------- bounds and maxDelta

describe('the rig bake’s bounds and frozen-clip diagnostic', () => {
  it('bounds the same union of frames the vertex bake does', () => {
    for (const make of Object.values(SKINNED_FIXTURES)) {
      const { root, clip } = make()
      const { delta, rig } = bothBakes(root, [clip])

      expectVector3Close(rig.bounds.min, delta.bounds.min)
      expectVector3Close(rig.bounds.max, delta.bounds.max)
      expect(rig.geometry.boundingBox).toEqual(rig.bounds)
      expect(rig.geometry.boundingSphere!.radius).toBeCloseTo(delta.geometry.boundingSphere!.radius, 5)
    }
  })

  it('reads maxDelta near zero for a static clip and far from it for a moving one', () => {
    const { root, clip } = makePlacedSkinnedFixture()
    const held = clip.clone()
    held.name = 'held'
    // Every track pinned to its first key: a pose, not an animation.
    for (const track of held.tracks) {
      track.times = new Float32Array([0, 1])
      const size = track.getValueSize()
      const first = Array.from(track.values.slice(0, size))
      track.values = new Float32Array([...first, ...first])
    }

    const vat = bakeVAT(root, [clip, held], { fps: 30, encoding: 'rig' })

    expect(vat.clips[0]!.maxDelta).toBeGreaterThan(0.5)
    expect(vat.clips[1]!.maxDelta).toBeLessThan(1e-6)
  })

  it('measures the same maxDelta the vertex bake does, so the diagnostic means one thing', () => {
    for (const make of Object.values(SKINNED_FIXTURES)) {
      const { root, clip } = make()
      const { delta, rig } = bothBakes(root, [clip])

      expect(rig.clips[0]!.maxDelta).toBeCloseTo(delta.clips[0]!.maxDelta, 5)
    }
  })
})

// -------------------------------------------------------------- options, type

describe('the rig bake’s options', () => {
  it('accepts and ignores bakeNormals: false — there is no normal texture to drop', () => {
    const { root, clip } = makeSkinnedFixture()

    const plain = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })
    const asked = bakeVAT(root, [clip], { fps: 30, encoding: 'rig', bakeNormals: false })

    expect(asked.rigTexture.image.data).toEqual(plain.rigTexture.image.data)
    expect(asked.clips).toEqual(plain.clips)
  })

  it('checks slotCount × 2 and totalFrames against maxTextureSize, not the vertex count', () => {
    const { root, clip } = makeMultiBoneFixture() // one vertex, four slots

    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig', maxTextureSize: 7 })).toThrow(
      /8 .*exceeds maxTextureSize 7/,
    )
    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig', maxTextureSize: 29 })).toThrow(
      /totalFrames 30 exceeds maxTextureSize 29/,
    )
    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig', maxTextureSize: 30 })).not.toThrow()
  })

  it('returns the rig member for encoding: "rig", the vertex member otherwise, the union when it cannot tell', () => {
    const { root, clip } = makeSkinnedFixture()
    const options: BakeOptions = { encoding: 'rig' }

    expectTypeOf(bakeVAT(root, [clip], { encoding: 'rig' })).toEqualTypeOf<RigVAT>()
    expectTypeOf(bakeVAT(root, [clip], { encoding: 'delta' })).toEqualTypeOf<DeltaVAT>()
    expectTypeOf(bakeVAT(root, [clip])).toEqualTypeOf<DeltaVAT>()
    expectTypeOf(bakeVAT(root, [clip], options)).toEqualTypeOf<VAT>()

    const vat: VAT = bakeVAT(root, [clip], options)
    if (vat.encoding === 'rig') {
      expectTypeOf(vat).toEqualTypeOf<RigVAT>()
      expect(vat.rigTexture.image.height).toBe(vat.totalFrames)
    }
  })
})

// --------------------------------------------------------------- refusals

describe('what this rig bake does not take yet (three-vat#53)', () => {
  // Rigid parts, morph folding and the refusals proper are the next ticket. Until
  // then a subtree with either is refused with a placeholder that names the part,
  // the ticket and the encoding that would take it — never baked wrong.
  it('refuses a rigid part by name, before sampling a frame', () => {
    const { root, clip } = makeRigidSubtreeFixture()

    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/"arm"/)
    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/#53/)
    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/vertex encoding/)
  })

  it('refuses a part with morph targets by name', () => {
    const { root, clip } = makeSkinnedMorphFixture()

    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/"flapper"/)
    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/morph/)
  })

  it('refuses a bone a vertex reads that scales unevenly, naming the bone', () => {
    // Quaternion plus uniform scale cannot store it, and storing a wrong
    // deformation quietly is the failure the encoding must not have.
    const { root, clip } = makeBoneScaleFixture([2, 1, 1])

    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/"stretch"/)
    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/non-uniform/)
  })

  it('bakes past an unevenly scaled bone no vertex is weighted to', () => {
    const { root, clip } = makeBoneScaleFixture([2, 1, 1], 'decor')

    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).not.toThrow()
  })
})
