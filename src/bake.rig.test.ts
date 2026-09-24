import {
  AdditiveAnimationBlendMode,
  AnimationClip,
  AnimationMixer,
  FloatType,
  DetachedBindMode,
  Group,
  Matrix4,
  NearestFilter,
  NumberKeyframeTrack,
  Object3D,
  Vector3,
  VectorKeyframeTrack,
} from 'three'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { bakeVAT } from './bake.js'
import type { BakeOptions } from './bake.js'
import { RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import {
  decodeDeltaNormal,
  expectDeltaClose,
  expectNormalClose,
  makeAbsoluteMorphNormalFixture,
  makeBoneScaleFixture,
  makeFullSpinFixture,
  makeMorphFixture,
  makeMorphNormalSkinnedFixture,
  makeMultiBoneFixture,
  makePlacedSkinnedFixture,
  makeRigidSubtreeFixture,
  makeScaledPartFixture,
  makeSharedRigFixture,
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

afterEach(() => vi.restoreAllMocks())

function expectVector3Close(actual: Vector3, expected: Vector3, digits = 5): void {
  expect(actual.x).toBeCloseTo(expected.x, digits)
  expect(actual.y).toBeCloseTo(expected.y, digits)
  expect(actual.z).toBeCloseTo(expected.z, digits)
}

/** Both encodings of one fixture, from one root — the mixer restores the rest pose between them. */
function bothBakes(root: Object3D, clips: AnimationClip[], fps = 30): { delta: DeltaVAT; rig: RigVAT } {
  return {
    delta: bakeVAT(root, clips, { encoding: 'delta', fps }),
    rig: bakeVAT(root, clips, { fps, encoding: 'rig' }),
  }
}

/**
 * Every fixture the suite has that a rig can express, by name: the skinned
 * ones, the rigid subtree (one slot per part), the morphed ones whose influence
 * no clip animates (folded into the rest pose), and two parts on one skeleton
 * (shared slots).
 */
const RIG_FIXTURES = {
  'one bone, spinning': () => makeSkinnedFixture(),
  'four bones, blended': () => makeMultiBoneFixture(),
  'a placed part, two bones bound off the origin': () => makePlacedSkinnedFixture(),
  'a uniformly scaled bone': () => makeBoneScaleFixture([2, 2, 2]),
  'a full turn, across the quaternion hemisphere': () => makeFullSpinFixture(),
  'a skinned part whose own node is animated': () => {
    // Under three's default attached bind mode a skinned mesh's node does not
    // move its vertices — `bindMatrixInverse` follows `matrixWorld` — and a
    // bake that read the bind matrix once, at rest, would move them twice.
    const { root, clip } = makePlacedSkinnedFixture()
    return {
      root,
      clip: new AnimationClip('reachAndSlide', 1, [
        ...clip.tracks,
        new VectorKeyframeTrack('carrier.position', [0, 1], [0, 2, 0, 3, 2, 0]),
      ]),
    }
  },
  'a rigid subtree, one part swinging and one still': () => makeRigidSubtreeFixture(),
  'a skinned part with a static morph': () => makeSkinnedMorphFixture(),
  'a placed skinned part with a static morph on position and normal': () => makeMorphNormalSkinnedFixture(),
  'a rigid part with two static absolute morphs': () => makeAbsoluteMorphNormalFixture(),
  'two parts on one skeleton and one bind matrix': () => makeSharedRigFixture(),
  'two parts on one skeleton and two bind matrices': () =>
    makeSharedRigFixture({ visorBind: new Matrix4().makeTranslation(0, 1, 0) }),
  // A mirror has a negative determinant, which a decomposition carries as one
  // negated axis: stored as one scale, that axis would come back unflipped and
  // the other two flipped instead (#79).
  'a rigid part mirrored across one axis': () => makeScaledPartFixture({ scale: [-1, 1, 1] }),
  'a rigid part mirrored through its origin': () => makeScaledPartFixture({ scale: [-2, -2, -2] }),
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
  for (const [name, make] of Object.entries(RIG_FIXTURES)) {
    it(`for ${name}, every frame, position and normal`, () => {
      const { root, clip } = make()
      const { delta, rig } = bothBakes(root, [clip])

      for (let row = 0; row < rig.totalFrames; row++) {
        for (let v = 0; v < rig.vertexCount; v++) {
          const { position, normal } = skinFromRig(rig, v, row)
          expectDeltaClose(delta, row, v, position)
          expectNormalClose(decodeDeltaNormal(delta, row, v), normal)
        }
      }
    })
  }

  it('for a part a clip hides by scaling it to nothing, at every frame', () => {
    // A zero matrix has no rotation to decompose, and three hands back the
    // identity and a scale of one for it — the part at full size (#79). Only
    // positions: a collapsed part has no normal to compare.
    const { root, clip } = makeScaledPartFixture({ scaleTrack: [1, 1, 1, 0, 0, 0, 0, 0, 0] })
    const { delta, rig } = bothBakes(root, [clip])

    for (let row = 0; row < rig.totalFrames; row++) {
      expectDeltaClose(delta, row, 0, skinFromRig(rig, 0, row).position)
    }
    // Hidden, it keeps the last rotation it was seen at — a unit quaternion, so
    // the shader's normalised blend between two hidden rows stays finite.
    const hidden = slotTexels(rig, rig.totalFrames - 1, 0)
    expect(hidden.ts.w).toBe(0)
    expect(hidden.q.length()).toBeCloseTo(1)
    expect(slotTexels(rig, rig.totalFrames - 2, 0).q.toArray()).toEqual(hidden.q.toArray())
  })

  it('across two clips stacked as bands', () => {
    const { root, clip } = makePlacedSkinnedFixture()
    const second = clip.clone()
    second.name = 'reach2'
    const { delta, rig } = bothBakes(root, [clip, second])

    for (const band of rig.clips) {
      for (const row of [band.startFrame, band.startFrame + band.frames - 1]) {
        for (let v = 0; v < rig.vertexCount; v++) {
          expectDeltaClose(delta, row, v, skinFromRig(rig, v, row).position)
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
    const fine = bakeVAT(makeFullSpinFixture().root, [clip], { encoding: 'delta', fps: 60 })

    for (let row = 0; row + 1 < rig.totalFrames; row++) {
      const blended = skinFromRig(rig, 0, row, row + 1, 0.5).position
      expectDeltaClose(fine, row * 2 + 1, 0, blended, 0.5e-3)
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
    const fine = bakeVAT(makeFullSpinFixture().root, [clip], { encoding: 'delta', fps: 60 })

    const last = rig.totalFrames - 1
    expect(slotTexels(rig, last, 0).q.dot(slotTexels(rig, 0, 0).q)).toBeLessThan(0)
    const blended = skinFromRig(rig, 0, last, 0, 0.5).position
    expectDeltaClose(fine, fine.totalFrames - 1, 0, blended, 0.5e-3)
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
    for (const make of Object.values(RIG_FIXTURES)) {
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
    for (const make of Object.values(RIG_FIXTURES)) {
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

  it('narrows to the member an explicit encoding names, and returns the union for the default (ADR-0027)', () => {
    const { root, clip } = makeSkinnedFixture()
    const options: BakeOptions = { encoding: 'rig' }

    expectTypeOf(bakeVAT(root, [clip], { encoding: 'rig' })).toEqualTypeOf<RigVAT>()
    expectTypeOf(bakeVAT(root, [clip], { encoding: 'delta' })).toEqualTypeOf<DeltaVAT>()
    // The default chooses at the bake, so only the result can say which it chose.
    expectTypeOf(bakeVAT(root, [clip])).toEqualTypeOf<VAT>()
    expectTypeOf(bakeVAT(root, [clip], { fps: 30 })).toEqualTypeOf<VAT>()
    expectTypeOf(bakeVAT(root, [clip], { encoding: 'auto' })).toEqualTypeOf<VAT>()
    expectTypeOf(bakeVAT(root, [clip], options)).toEqualTypeOf<VAT>()

    const vat: VAT = bakeVAT(root, [clip], options)
    if (vat.encoding === 'rig') {
      expectTypeOf(vat).toEqualTypeOf<RigVAT>()
      expect(vat.rigTexture.image.height).toBe(vat.totalFrames)
    }
  })

  it('warns nothing for bakeNormals: false — a no-op is not a mistake', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { root, clip } = makeSkinnedFixture()

    bakeVAT(root, [clip], { fps: 30, encoding: 'rig', bakeNormals: false })

    expect(warn).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------- the slot table

describe('the rig bake’s slot table', () => {
  it('bakes a rigid part as one slot of weight one, so a rigid subtree is one slot per part', () => {
    const { root, clip } = makeRigidSubtreeFixture()

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    // Two parts, two materials, two slots — the arm's and the body's.
    expect(vat.slotCount).toBe(2)
    expect(vat.rigTexture.image.width).toBe(2 * RIG_TEXELS_PER_SLOT)
    expect(Array.from(vat.geometry.attributes.skinWeight!.array)).toEqual([1, 0, 0, 0, 1, 0, 0, 0])
    const index = Array.from(vat.geometry.attributes.skinIndex!.array)
    expect(index.slice(1, 4)).toEqual([0, 0, 0])
    expect(index.slice(5, 8)).toEqual([0, 0, 0])
    expect(new Set([index[0], index[4]]).size).toBe(2)
  })

  it('leaves the still part of a rigid subtree at zero displacement, and lands the swinging one where the vertex bake did', () => {
    const { root, body, clip } = makeRigidSubtreeFixture()
    const { delta, rig } = bothBakes(root, [clip])

    const bodyVertex = rig.geometry.groups.find((g) => rig.materials[g.materialIndex!] === body.material)!.start
    for (let row = 0; row < rig.totalFrames; row++) {
      for (let v = 0; v < rig.vertexCount; v++) {
        expectDeltaClose(delta, row, v, skinFromRig(rig, v, row).position)
      }
      expectVector3Close(skinFromRig(rig, bodyVertex, row).position, new Vector3(0, 0, 0))
    }
    expect(rig.clips[0]!.maxDelta).toBeCloseTo(delta.clips[0]!.maxDelta, 5)
  })

  it('mixes skinned and rigid parts in one bake — a slot per bone, and a slot per rigid part', () => {
    // A placed two-bone limb hung under the rigid subtree's root, its tracks
    // added to the swing: the character shape ADR-0018 names, skinned body
    // and rigid prop, with no animated morph anywhere.
    const rigid = makeRigidSubtreeFixture()
    const limb = makePlacedSkinnedFixture()
    rigid.root.add(limb.root)
    const clip = new AnimationClip('mixed', 1, [...rigid.clip.tracks, ...limb.clip.tracks])

    const { delta, rig } = bothBakes(rigid.root, [clip])

    expect(rig.slotCount).toBe(2 + 2)
    expect(rig.vertexCount).toBe(delta.vertexCount)
    for (let row = 0; row < rig.totalFrames; row++) {
      for (let v = 0; v < rig.vertexCount; v++) {
        const { position, normal } = skinFromRig(rig, v, row)
        expectDeltaClose(delta, row, v, position)
        expectNormalClose(decodeDeltaNormal(delta, row, v), normal)
      }
    }
  })

  it('gives two parts on one skeleton and one bind matrix a single set of slots', () => {
    const { root, clip } = makeSharedRigFixture()

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    // One bone, shared: one slot, and both vertices read it.
    expect(vat.slotCount).toBe(1)
    expect(Array.from(vat.geometry.attributes.skinIndex!.array)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(Array.from(vat.geometry.attributes.skinWeight!.array)).toEqual([1, 0, 0, 0, 1, 0, 0, 0])
  })

  it('gives two parts on one skeleton but two bind matrices a set of slots each', () => {
    // The same bone read through two bind spaces is two different slot
    // matrices — the bind matrix is inside the slot chain, so it keys the slot.
    const { root, clip } = makeSharedRigFixture({ visorBind: new Matrix4().makeTranslation(0, 1, 0) })

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(vat.slotCount).toBe(2)
    // The weighted lane of each vertex: the body reads slot 0, the visor slot 1.
    const index = vat.geometry.attributes.skinIndex!
    expect([index.getX(0), index.getX(1)]).toEqual([0, 1])
  })

  it('gives two parts on two Skeleton objects over the same bone a single slot — the key is the bone, not the object', () => {
    // What a glTF loader actually hands back for one character in two skins:
    // two `Skeleton`s, each listing (some of) the same `Bone` nodes through the
    // same inverses. Soldier's visor and RobotExpressive's hands are this
    // shape. The slot chain is identical term for term, so it is one slot.
    const { root, clip } = makeSharedRigFixture({ visorSkeleton: {} })

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(vat.slotCount).toBe(1)
    expect(Array.from(vat.geometry.attributes.skinIndex!.array)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    // And it is the shared slot the visor's vertex actually follows.
    for (const v of [0, 1]) {
      const rest = new Vector3().fromBufferAttribute(vat.geometry.attributes.position!, v)
      const end = skinFromRig(vat, v, vat.totalFrames - 1).position
      expect(end.distanceTo(rest)).toBeGreaterThan(0.5)
    }
  })

  it('gives two skeletons reading the same bone through different inverses a slot each', () => {
    // The bone inverse is inside the slot chain, like the bind matrix: the
    // same bone bound from a different pose is a different slot.
    const { root, clip } = makeSharedRigFixture({
      visorSkeleton: { boneInverse: new Matrix4().makeTranslation(0, 1, 0) },
    })

    const vat = bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(vat.slotCount).toBe(2)
    const index = vat.geometry.attributes.skinIndex!
    expect([index.getX(0), index.getX(1)]).toEqual([0, 1])
  })
})

// ------------------------------------------------------------- morph folding

describe('a morph influence no baked clip animates is folded into the rest pose', () => {
  it('folds an influence set on the mesh and touched by no track, positions and normals', () => {
    // The vertex bake sees this influence at every frame, because nothing
    // changes it; the rig bake bakes it into the geometry once, in part-local
    // space, and the vertex encoding's answer is the oracle for the rest.
    const { root, mesh, clip } = makeMorphNormalSkinnedFixture()
    mesh.morphTargetInfluences![0] = 1
    const skinOnly = new AnimationClip('swing', 1, clip.tracks.filter((t) => !t.name.includes('morph')))

    const { delta, rig } = bothBakes(root, [skinOnly])

    // Base (1, 0, 0) + target (0, 0, 1); base normal (0, 0, 1) + target (1, 0, 0), normalised.
    expectVector3Close(new Vector3().fromBufferAttribute(rig.geometry.attributes.position!, 0), new Vector3(1, 0, 1))
    expectVector3Close(
      new Vector3().fromBufferAttribute(rig.geometry.attributes.normal!, 0),
      new Vector3(Math.SQRT1_2, 0, Math.SQRT1_2),
    )
    for (let row = 0; row < rig.totalFrames; row++) {
      expectDeltaClose(delta, row, 0, skinFromRig(rig, 0, row).position)
      expectNormalClose(decodeDeltaNormal(delta, row, 0), skinFromRig(rig, 0, row).normal)
    }
    expect(rig.clips[0]!.maxDelta).toBeCloseTo(delta.clips[0]!.maxDelta, 5)
  })

  it('folds an influence a track holds constant at one value across every baked clip', () => {
    // A constant track is a pose, not an animation: the fixture's clip pins
    // its morph at 1 for the whole second, and a second clip does the same.
    const { root, clip } = makeSkinnedMorphFixture()
    const second = clip.clone()
    second.name = 'flapAndSwing2'

    const { delta, rig } = bothBakes(root, [clip, second])

    expectVector3Close(new Vector3().fromBufferAttribute(rig.geometry.attributes.position!, 0), new Vector3(1, 0, 1))
    for (let row = 0; row < rig.totalFrames; row++) {
      expectDeltaClose(delta, row, 0, skinFromRig(rig, 0, row).position)
    }
  })

  it('leaves the geometry alone when the static influence is zero', () => {
    const { root, mesh, clip } = makeSkinnedMorphFixture()
    const skinOnly = new AnimationClip('swing', 1, clip.tracks.filter((t) => !t.name.includes('morph')))

    const vat = bakeVAT(root, [skinOnly], { fps: 30, encoding: 'rig' })

    expect(Array.from(vat.geometry.attributes.position!.array)).toEqual(
      Array.from(mesh.geometry.attributes.position!.array),
    )
  })
})

// --------------------------------------------------------------- refusals

describe('what the rig encoding refuses, by name, before a frame is sampled', () => {

  /** A clip that ramps the fixture's one morph influence, under the fixture's own skinning. */
  function animatedMorph(name: string, from: number, to: number): AnimationClip {
    const { clip } = makeSkinnedMorphFixture()
    return new AnimationClip(name, 1, [
      ...clip.tracks.filter((t) => !t.name.includes('morph')),
      new NumberKeyframeTrack('flapper.morphTargetInfluences[0]', [0, 1], [from, to]),
    ])
  }

  it('refuses a skinned part whose clip animates a morph influence, naming the part, the clip and the fix', () => {
    const { root } = makeSkinnedMorphFixture()
    const sampled = vi.spyOn(AnimationMixer.prototype, 'setTime')

    const bake = () => bakeVAT(root, [animatedMorph('blink', 0, 1)], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"flapper"/)
    expect(bake).toThrow(/"blink"/)
    expect(bake).toThrow(/morph/)
    expect(bake).toThrow(/vertex encoding/)
    expect(sampled).not.toHaveBeenCalled()
  })

  it('names every offending clip, and none of the innocent ones', () => {
    const { root, clip } = makeSkinnedMorphFixture()
    const swing = new AnimationClip('swing', 1, clip.tracks.filter((t) => !t.name.includes('morph')))

    const bake = () =>
      bakeVAT(root, [animatedMorph('blink', 0, 1), swing, animatedMorph('wink', 1, 0)], {
        fps: 30,
        encoding: 'rig',
      })

    expect(bake).toThrow(/"blink"/)
    expect(bake).toThrow(/"wink"/)
    expect(bake).not.toThrow(/"swing"/)
  })

  it('refuses an influence one clip holds at a value the other clips do not — that is animation between clips', () => {
    // A constant track at 1 in one clip and no track in another: the vertex
    // bake would bake the morph in one band and not the other, which no single
    // folded rest pose can reproduce.
    const { root, clip } = makeSkinnedMorphFixture()
    const swing = new AnimationClip('swing', 1, clip.tracks.filter((t) => !t.name.includes('morph')))

    const bake = () => bakeVAT(root, [clip, swing], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"flapper"/)
    expect(bake).toThrow(/"flapAndSwing"/)
  })

  it('refuses a whole-array influence track, the shape glTF emits', () => {
    const { root, clip } = makeSkinnedMorphFixture()
    const gltfShaped = new AnimationClip('face', 1, [
      ...clip.tracks.filter((t) => !t.name.includes('morph')),
      new NumberKeyframeTrack('flapper.morphTargetInfluences', [0, 1], [0, 1]),
    ])

    expect(() => bakeVAT(root, [gltfShaped], { fps: 30, encoding: 'rig' })).toThrow(/"face"/)
  })

  it('refuses a morph-only mesh whose clip animates the influence, the same way', () => {
    const { root, clip } = makeMorphFixture()
    const sampled = vi.spyOn(AnimationMixer.prototype, 'setTime')

    const bake = () => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"bird"/)
    expect(bake).toThrow(/"flap"/)
    expect(bake).toThrow(/vertex encoding/)
    expect(sampled).not.toHaveBeenCalled()
  })

  it('names every part whose morphs a clip animates in one refusal, not the first it met', () => {
    // A character's face is several meshes (RobotExpressive's head is three),
    // and a caller who fixes the first one named should not meet the second on
    // the next bake.
    const flapper = makeSkinnedMorphFixture()
    const bird = makeMorphFixture()
    const root = new Group()
    root.add(flapper.mesh, bird.mesh)
    root.updateMatrixWorld(true)
    const both = new AnimationClip('faces', 1, [...animatedMorph('blink', 0, 1).tracks, ...bird.clip.tracks])

    const bake = () => bakeVAT(root, [both], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"flapper"/)
    expect(bake).toThrow(/"bird"/)
    expect(bake).toThrow(/"faces"/)
    expect(bake).toThrow(/vertex encoding/)
  })

  it('refuses a bone a vertex reads whose clip scales it unevenly, naming the bone, before sampling', () => {
    // Quaternion plus uniform scale cannot store it, and storing a wrong
    // deformation quietly is the failure the encoding must not have.
    const { root, clip } = makeBoneScaleFixture([2, 1, 1])
    const sampled = vi.spyOn(AnimationMixer.prototype, 'setTime')

    const bake = () => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"stretch"/)
    expect(bake).toThrow(/non-uniform/)
    expect(bake).toThrow(/vertex encoding/)
    expect(sampled).not.toHaveBeenCalled()
  })

  it('refuses a bone a vertex reads that rests at a non-uniform scale no track touches', () => {
    // Not in any clip — the fixture's only scale track is on the unread
    // `decor` bone — so the pre-sampling check cannot see it; the posed slot
    // matrix can, at the first row.
    const { root, mesh, clip } = makeBoneScaleFixture([1, 1, 1], 'decor')
    mesh.skeleton.bones[0]!.scale.set(1, 3, 1)

    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).toThrow(/"stretch"/)
  })

  it('refuses a rigid part scaled unevenly at rest, naming the part', () => {
    const { root, arm, clip } = makeRigidSubtreeFixture()
    arm.scale.set(2, 1, 1)

    const bake = () => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"arm"/)
    expect(bake).toThrow(/non-uniform/)
  })

  it('refuses a part its parent shears, even when the sheared axes come out one length', () => {
    // An uneven parent scale over a rotated child can leave the child's axes
    // equal in length and not square, which lengths alone cannot see (#79).
    const { root, mesh, clip } = makeScaledPartFixture()
    root.getObjectByName('pivot')!.scale.set(Math.sqrt(1.5), Math.sqrt(0.5), 1)
    mesh.rotation.z = Math.PI / 4

    const bake = () => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"part"/)
    expect(bake).toThrow(/non-uniform/)
    expect(bakeVAT(root, [clip], { fps: 30 }).encoding).toBe('delta')
  })

  it('refuses a rigid part whose pivot a clip scales unevenly, before sampling', () => {
    // The scale lands on the arm through its pivot, so the pivot's track is
    // the arm's problem — and is read off the clip, not off a sampled frame.
    const { root, clip } = makeRigidSubtreeFixture()
    const squash = new AnimationClip('squash', 1, [
      ...clip.tracks,
      new VectorKeyframeTrack('pivot.scale', [0, 1], [1, 1, 1, 1, 3, 1]),
    ])
    const sampled = vi.spyOn(AnimationMixer.prototype, 'setTime')

    const bake = () => bakeVAT(root, [squash], { fps: 30, encoding: 'rig' })

    expect(bake).toThrow(/"arm"/)
    expect(bake).toThrow(/"squash"/)
    expect(sampled).not.toHaveBeenCalled()
  })

  it('refuses two parts sharing slots that a clip moves apart', () => {
    // Detached bind mode is the one where a skinned mesh's node places its
    // vertices, so two parts on one skeleton and one bind matrix can be
    // placed alike at rest and then pulled apart — which one set of slots
    // cannot follow.
    const { root, body, visor, clip } = makeSharedRigFixture()
    for (const part of [body, visor]) part.bindMode = DetachedBindMode
    const sled = new Object3D()
    sled.name = 'sled'
    root.add(sled)
    sled.add(visor)
    const apart = new AnimationClip('apart', 1, [
      ...clip.tracks,
      // Apart from its first key, so a pose stranded anywhere in the clip is not the rest pose.
    new VectorKeyframeTrack('sled.position', [0, 1], [0, 0, 5, 0, 0, 10]),
    ])

    expect(bakeVAT(root, [clip], { fps: 30, encoding: 'rig' }).slotCount).toBe(1)
    // Twice, and alike: a refusal mid-bake hands the subtree back at rest, so a
    // second bake does not find the two parts already apart before it starts.
    for (let i = 0; i < 2; i++) {
      expect(() => bakeVAT(root, [apart], { fps: 30, encoding: 'rig' })).toThrow(
        /parts "body" and "visor" .* move apart in clip "apart"/,
      )
    }
    expect(visor.getWorldPosition(new Vector3()).z).toBe(0)
  })

  it('bakes past an unevenly scaled bone no vertex is weighted to', () => {
    const { root, clip } = makeBoneScaleFixture([2, 1, 1], 'decor')

    expect(() => bakeVAT(root, [clip], { fps: 30, encoding: 'rig' })).not.toThrow()
  })
})

describe('the existing refusals fire unchanged under the rig encoding', () => {
  it('refuses a negative timeScale, a non-unit weight and an additive blend, by clip name', () => {
    const { root, clip } = makeSkinnedFixture()
    const mixer = new AnimationMixer(root)
    const rig = { fps: 30, encoding: 'rig' } as const

    const backwards = mixer.clipAction(clip)
    backwards.timeScale = -1
    expect(() => bakeVAT(root, [backwards], rig)).toThrow(/"spin".*timeScale -1/)

    const half = mixer.clipAction(clip)
    half.timeScale = 1
    half.weight = 0.5
    expect(() => bakeVAT(root, [half], rig)).toThrow(/"spin".*weight 0.5/)

    const additive = mixer.clipAction(clip)
    additive.weight = 1
    additive.blendMode = AdditiveAnimationBlendMode
    expect(() => bakeVAT(root, [additive], rig)).toThrow(/"spin".*additive/)
  })

  it('refuses before it samples anything', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = new AnimationMixer(root).clipAction(clip)
    action.weight = 0.5
    const sampled = vi.spyOn(AnimationMixer.prototype, 'setTime')

    expect(() => bakeVAT(root, [action], { fps: 30, encoding: 'rig' })).toThrow()
    expect(sampled).not.toHaveBeenCalled()
  })
})

/** The shared-rig fixture with the visor carried apart mid-clip: refused by the rig encoding at a row, not before. */
function makeApartFixture() {
  const { root, body, visor, clip } = makeSharedRigFixture()
  for (const part of [body, visor]) part.bindMode = DetachedBindMode
  const sled = new Object3D()
  sled.name = 'sled'
  root.add(sled)
  sled.add(visor)
  const apart = new AnimationClip('apart', 1, [
    ...clip.tracks,
    // Apart from its first key, so a pose stranded anywhere in the clip is not the rest pose.
    new VectorKeyframeTrack('sled.position', [0, 1], [0, 0, 5, 0, 0, 10]),
  ])
  return { root, clip: apart }
}

/** Two bakes of one encoding hold the same texels, the same geometry and the same clip table. */
function expectSameBake(actual: VAT, expected: VAT) {
  expect(actual.encoding).toBe(expected.encoding)
  if (actual.encoding === 'rig' && expected.encoding === 'rig') {
    expect(actual.rigTexture.image.data).toEqual(expected.rigTexture.image.data)
  } else if (actual.encoding === 'delta' && expected.encoding === 'delta') {
    expect(actual.positionTexture.image.data).toEqual(expected.positionTexture.image.data)
    expect(actual.normalTexture?.image.data).toEqual(expected.normalTexture?.image.data)
  }
  expect(actual.geometry.attributes.position!.array).toEqual(expected.geometry.attributes.position!.array)
  expect(actual.clips).toEqual(expected.clips)
  expect(actual.bounds).toEqual(expected.bounds)
}

describe('the default encoding: the rig where the asset allows it (ADR-0027)', () => {
  it('bakes the rig when nothing refuses it', () => {
    const a = makeSkinnedFixture()
    const b = makeSkinnedFixture()
    const chosen = bakeVAT(a.root, [a.clip], { fps: 30 })
    expect(chosen.encoding).toBe('rig')
    expectSameBake(chosen, bakeVAT(b.root, [b.clip], { fps: 30, encoding: 'rig' }))
  })

  it("is what `encoding: 'auto'` asks for by name", () => {
    const a = makeRigidSubtreeFixture()
    const b = makeRigidSubtreeFixture()
    expectSameBake(bakeVAT(a.root, [a.clip], { fps: 30 }), bakeVAT(b.root, [b.clip], { fps: 30, encoding: 'auto' }))
  })

  it('falls back to the vertices on a refusal the rig reaches before sampling: an animated morph', () => {
    const a = makeMorphFixture()
    const b = makeMorphFixture()
    expect(() => bakeVAT(a.root, [a.clip], { fps: 30, encoding: 'rig' })).toThrow(/morph target/)
    const chosen = bakeVAT(a.root, [a.clip], { fps: 30 })
    expect(chosen.encoding).toBe('delta')
    expectSameBake(chosen, bakeVAT(b.root, [b.clip], { fps: 30, encoding: 'delta' }))
  })

  it('falls back from a refusal a row reaches, from the rest pose and not from where the rig stopped', () => {
    const a = makeApartFixture()
    const b = makeApartFixture()
    const chosen = bakeVAT(a.root, [a.clip], { fps: 30 })
    expect(chosen.encoding).toBe('delta')
    expectSameBake(chosen, bakeVAT(b.root, [b.clip], { fps: 30, encoding: 'delta' }))
  })

  it('honours bakeNormals when it falls back, and ignores it when it does not', () => {
    const morph = makeMorphFixture()
    const skinned = makeSkinnedFixture()
    const fallen = bakeVAT(morph.root, [morph.clip], { fps: 30, bakeNormals: false })
    expect(fallen.encoding === 'delta' && fallen.normalTexture).toBeNull()
    expect(bakeVAT(skinned.root, [skinned.clip], { fps: 30, bakeNormals: false }).encoding).toBe('rig')
  })

  it('falls back on nothing both encodings refuse', () => {
    const { root, clip } = makeSkinnedFixture()
    expect(() => bakeVAT(root, [clip], { fps: 30, maxTextureSize: 29 })).toThrow(/totalFrames 30 exceeds/)
    const action = new AnimationMixer(root).clipAction(clip)
    action.weight = 0.5
    expect(() => bakeVAT(root, [action], { fps: 30 })).toThrow(/weight 0.5/)
  })
})
