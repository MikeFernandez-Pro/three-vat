import {
  AdditiveAnimationBlendMode,
  AnimationMixer,
  HalfFloatType,
  LoopOnce,
  LoopPingPong,
  NearestFilter,
  RGBAFormat,
  RGFormat,
  UnsignedByteType,
  Vector3,
} from 'three'
import type { AnimationClip, Object3D } from 'three'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { bakeVAT } from './bake.js'
import { MAX_TEXTURE_SIZE } from './vat-texture.js'
import { EndMode, INFINITE_REPETITIONS, LoopMode } from './instance-playback.js'
import type { DeltaVAT, VAT } from './types.js'
import {
  decodeDeltaNormal as decodeNormal,
  deltaTexels,
  DELTA_FLOOR,
  DELTA_RELATIVE,
  expectDeltaClose,
  expectNormalClose,
  makeAbsoluteMorphFixture,
  makeAbsoluteMorphNormalFixture,
  makeBoneScaleFixture,
  makeHalfFloatOverflowFixture,
  makeMorphFixture,
  makeMorphNormalFixture,
  makeMorphNormalSkinnedFixture,
  makeNormalOnlyMorphFixture,
  makeMultiBoneFixture,
  makeRigidSubtreeFixture,
  makeSkinnedFixture,
  makeSkinnedMorphFixture,
  makeTangentFixture,
} from './test-utils.js'

// Positions are asserted through `expectDeltaClose`: it reconstructs vertex `v`
// at frame `row` exactly as the shader does — the merged rest position plus the
// baked delta — and holds the result to what the half-float store costs, which
// is a fraction of the delta and not a distance (#73). Tests assert on that,
// never on texels.

// Normals are stored absolute, so a texel read *is* the decoded normal — once
// unpacked from the two octahedral bytes it is stored in (#29), which is what
// the imported `decodeNormal` does. Asserted with `expectNormalClose`: the
// encoding's error is an angle, so the tolerance is stated in degrees, per
// format.

/** Assert a decoded vector matches a hand-computed one, component by component. */
function expectVector3Close(actual: Vector3, expected: Vector3): void {
  expect(actual.x).toBeCloseTo(expected.x, 5)
  expect(actual.y).toBeCloseTo(expected.y, 5)
  expect(actual.z).toBeCloseTo(expected.z, 5)
}

describe('bakeVAT', () => {
  it('produces textures sized vertexCount x totalFrames', () => {
    const { root, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(vat.vertexCount).toBe(1)
    expect(vat.totalFrames).toBe(30)
    expect(vat.positionTexture.image.width).toBe(1)
    expect(vat.positionTexture.image.height).toBe(30)
    expect(vat.normalTexture!.image.width).toBe(1)
    expect(vat.normalTexture!.image.height).toBe(30)
    expect(vat.encoding).toBe('delta')
  })

  it('gives each layer its own format and both of them the same sampling', () => {
    // The two halves of ADR-0002 that a narrowed layer could break (#29, #73).
    // The formats part, because the layers stopped being the same texture:
    // RGBA half-float deltas, RG8 octahedral normals. The sampling part,
    // because the frame lerp is done by hand in the shader — any filtering
    // between rows would blend two frames behind the decode's back, and any
    // mipmap would blend two vertices.
    const { root, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(vat.positionTexture.format).toBe(RGBAFormat)
    expect(vat.positionTexture.type).toBe(HalfFloatType)
    expect(vat.normalTexture!.format).toBe(RGFormat)
    expect(vat.normalTexture!.type).toBe(UnsignedByteType)

    for (const layer of [vat.positionTexture, vat.normalTexture!]) {
      expect(layer.minFilter).toBe(NearestFilter)
      expect(layer.magFilter).toBe(NearestFilter)
      expect(layer.generateMipmaps).toBe(false)
    }
  })

  it('unpacks the normal layer a byte at a time, so an odd vertex count uploads straight', () => {
    // An RG8 row is `2 x width` bytes. At the default alignment of 4 the
    // driver starts every row of an odd-width bake at the wrong offset, and a
    // vertex count is as likely to be odd as even — so the assertion on the
    // fixture's width is part of the test, not a restatement of it. An RGBA
    // half-float row is `8 x width` bytes, a multiple of 4 at any width, which
    // is why the position layer needs nothing here (#73).
    const { root, clip } = makeSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expect(vat.vertexCount % 2).toBe(1)
    expect(vat.normalTexture!.unpackAlignment).toBe(1)
  })

  it('rejects a vertexCount above the caller-supplied maxTextureSize', () => {
    const { root, clip } = makeSkinnedFixture()

    // The fixture has 1 vertex, so a limit of 0 is the smallest way to trip it.
    expect(() => bakeVAT(root, [clip], { maxTextureSize: 0 })).toThrow(/vertexCount 1 exceeds maxTextureSize 0/)
  })

  it('refuses a position delta past half-float range, naming the value and the limit', () => {
    // The position layer's one hard limit since #73: 65 504. What it refuses
    // is *range*, not precision — a millimetre-unit asset with a hundred
    // metres of travel — and the alternative to refusing is a limb clipped to
    // infinity behind a console warning from three's own clamp. Asserted in
    // one call, because a bake that throws mid-loop leaves the subtree posed
    // and a second one would measure its deltas against that.
    const { root, clip } = makeHalfFloatOverflowFixture()

    expect(() => bakeVAT(root, [clip], { fps: 30 })).toThrow(
      /position delta component 66666\.\d+ \(clip "flung", frame 20, vertex 0\) exceeds the half-float limit of 65504/,
    )
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
    const data = deltaTexels(vat)

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
    const data = deltaTexels(vat)

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
    expect(vat.normalTexture!.image.width).toBe(1)
    expect(vat.normalTexture!.image.height).toBe(30)
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
    const data = deltaTexels(vat)

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
    const data = deltaTexels(vat)
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

    const da = deltaTexels(vatA)
    const db = deltaTexels(vatB)
    expect(da.length).toBe(db.length)
    for (let i = 0; i < da.length; i++) {
      // Relative, as everything the position layer stores now is: the two
      // bakes' float deltas agree to well under a micron, and then each
      // truncates to its own half-float, which can land them a mantissa step
      // apart (#73).
      expect(Math.abs(db[i]! - da[i]!)).toBeLessThanOrEqual(DELTA_FLOOR + DELTA_RELATIVE * Math.abs(da[i]!))
    }
  })
})

describe('bakeVAT with absolute morph targets', () => {
  it('measures every target against the base vertex, not the partially-morphed one', () => {
    const { root, clip } = makeAbsoluteMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const data = deltaTexels(vat)

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

describe('bakeVAT with a multi-bone blend', () => {
  it('blends four bones at fractional weights to the hand-computed position', () => {
    const { root, clip, expectedPosition } = makeMultiBoneFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // The pose is constant across the clip, so every frame must agree.
    for (const row of [0, 15, 29]) expectDeltaClose(vat, row, 0, expectedPosition)
  })

  it('blends four bones to the hand-computed normal, not merely a non-zero one', () => {
    const { root, clip, expectedNormal } = makeMultiBoneFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expectNormalClose(decodeNormal(vat, 0), expectedNormal)
  })

  it('bakes both skinning and morph deformation in one pass', () => {
    const { root, clip, expectedPosition } = makeSkinnedMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expectDeltaClose(vat, 0, 0, expectedPosition)
  })

  it('carries the skinned+morph normal through the bone transform', () => {
    const { root, clip, expectedNormal } = makeSkinnedMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expectNormalClose(decodeNormal(vat, 0), expectedNormal)
  })
})

describe('bakeVAT with bone scale', () => {
  it('bakes uniform bone scale correctly for position and normal', () => {
    const { root, clip } = makeBoneScaleFixture([2, 2, 2])
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // Position scales with the bone: (1, 0, 0) → (2, 0, 0).
    expectDeltaClose(vat, 0, 0, new Vector3(2, 0, 0))

    // A uniform scale leaves normal *direction* untouched once renormalised.
    expectNormalClose(decodeNormal(vat, 0), new Vector3(Math.SQRT1_2, Math.SQRT1_2, 0))
  })

  it('bakes non-uniform bone scale correctly for position', () => {
    const { root, clip } = makeBoneScaleFixture([2, 1, 1])
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // Positions are exact under any bone scale — linear blend skinning
    // transforms them by the skin matrix itself, which carries the scale.
    expectDeltaClose(vat, 0, 0, new Vector3(2, 0, 0))
  })

  it('bakes the documented linear-blend normal under non-uniform bone scale', () => {
    const { root, clip } = makeBoneScaleFixture([2, 1, 1])
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // What LBS produces: the skin matrix applied to normalize(1, 1, 0), then
    // renormalised — normalize(2, 1, 0). The geometrically correct answer is
    // the inverse-transpose one, normalize(1, 2, 0); pinning the value here is
    // what makes "approximate" a documented behaviour rather than a shrug.
    expectNormalClose(decodeNormal(vat, 0), new Vector3(2, 1, 0).normalize())
  })

  it('warns once, naming the bone, when a bone animates with non-uniform scale', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { root, clip } = makeBoneScaleFixture([2, 1, 1])
      bakeVAT(root, [clip], { fps: 30 })

      // 30 frames, but the caller must not be shouted at 30 times.
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]![0]).toMatch(/non-uniform scale/)
      expect(warn.mock.calls[0]![0]).toMatch(/"stretch"/)
      expect(warn.mock.calls[0]![0]).toMatch(/normal/i)
    } finally {
      warn.mockRestore()
    }
  })

  it('stays silent for uniform bone scale and for an unscaled rig', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const uniform = makeBoneScaleFixture([2, 2, 2])
      bakeVAT(uniform.root, [uniform.clip], { fps: 30 })
      const plain = makeMultiBoneFixture()
      bakeVAT(plain.root, [plain.clip], { fps: 30 })

      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('ignores a scaled bone no vertex is weighted to', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // Rigs carry decorative bones; squashing one cannot reach a normal, so
      // warning about it would be noise the caller can do nothing with.
      const { root, clip } = makeBoneScaleFixture([2, 1, 1], 'decor')
      bakeVAT(root, [clip], { fps: 30 })

      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('bakeVAT with morph normals', () => {
  it('bakes the morphed normal, not the rest normal, for a relative target', () => {
    const { root, clip, expectedPosition, expectedNormal } = makeMorphNormalFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // The influence is held at 1, so every frame carries the same answer.
    for (const row of [0, 15, 29]) {
      expectDeltaClose(vat, row, 0, expectedPosition)
      expectNormalClose(decodeNormal(vat, row), expectedNormal)
    }
  })

  it('measures each absolute normal target against the base normal', () => {
    const { root, clip, expectedPosition, expectedNormal } = makeAbsoluteMorphNormalFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expectDeltaClose(vat, 0, 0, expectedPosition)
    expectNormalClose(decodeNormal(vat, 0), expectedNormal)
  })

  it('composes morph, then the skin matrix, then the part matrix — in that order', () => {
    const { root, clip, expectedPosition, expectedNormal } = makeMorphNormalSkinnedFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expectNormalClose(decodeNormal(vat, 0), expectedNormal)
    expectDeltaClose(vat, 0, 0, expectedPosition)
  })

  it('morphs a normal on a target that carries no position', () => {
    const { root, clip, expectedPosition, expectedNormal } = makeNormalOnlyMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    expectDeltaClose(vat, 0, 0, expectedPosition)
    expectNormalClose(decodeNormal(vat, 0), expectedNormal)
  })

  it('leaves a mesh with morph positions but no morph normals baking as before', () => {
    const { root, clip } = makeMorphFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // The birds-style asset, asserted whole rather than sampled: one vertex,
    // thirty rows, four channels each, so these two loops pin down every texel
    // both textures contain. That is what "bakes exactly as it did" has to
    // mean — a claim three sampled rows would not support.
    const pos = deltaTexels(vat)
    const nrm = vat.normalTexture!.image.data as Uint8Array
    expect(pos).toHaveLength(30 * 4)
    // Two bytes a texel on the normal layer since #29, against the position
    // layer's four half-floats.
    expect(nrm).toHaveLength(30 * 2)

    for (let row = 0; row < 30; row++) {
      const o = row * 4
      // The influence ramps linearly 0 → 1 across the clip, sampled at row/30,
      // and the target displaces +1 along X. The x delta is held to what the
      // half-float store costs — a fraction of itself (#73) — while y and z
      // are exactly zero, as a zero delta is under any float format.
      expect(Math.abs(pos[o]! - row / 30)).toBeLessThanOrEqual(DELTA_RELATIVE * (row / 30))
      expect(pos[o + 1]!).toBe(0)
      expect(pos[o + 2]!).toBe(0)
      expect(pos[o + 3]!).toBe(1)

      // No normal target to follow, so the rest normal survives every frame.
      expectNormalClose(decodeNormal(vat, row), new Vector3(0, 0, 1))
    }
  })
})

describe('bakeVAT with bakeNormals: false', () => {
  // The memory dial for a crowd that never reads a normal: unlit, or flat-shaded
  // (where three derives the normal from the *deformed* position in the fragment
  // stage, which is better than anything the bake could store). An eighth of
  // the bytes it saved before the normal layer narrowed (#29), and still no
  // second encoding to keep in step.
  it('bakes no normal texture at all', () => {
    const { root, clip } = makeSkinnedFixture()

    const vat = bakeVAT(root, [clip], { fps: 30, bakeNormals: false })

    expect(vat.normalTexture).toBeNull()
  })

  it('drops the normal layer — the position layer is then the whole of it', () => {
    const { root, clip } = makeSkinnedFixture()

    const full = bakeVAT(root, [clip], { fps: 30 })
    const positionsOnly = bakeVAT(root, [clip], { fps: 30, bakeNormals: false })

    const bytes = (vat: DeltaVAT) =>
      (vat.positionTexture.image.data as Uint16Array).byteLength +
      ((vat.normalTexture?.image.data as Uint8Array | undefined)?.byteLength ?? 0)

    // Not half any more, and the name of the option is the part that aged:
    // the normal layer is two bytes a texel against the position layer's
    // eight (#29, #73), so dropping it takes 10 B per vertex per frame to 8 B.
    // Stated as the layer it removes rather than as a ratio, which is what the
    // option actually promises.
    expect(bytes(full) - bytes(positionsOnly)).toBe(full.vertexCount * full.totalFrames * 2)
    expect(bytes(positionsOnly)).toBe(full.vertexCount * full.totalFrames * 8)
  })

  it('bakes the positions it would have baked anyway', () => {
    // The option is a *subtraction*. If it moved a single delta it would be a
    // second encoding, which is exactly what it exists to avoid.
    const { root, clip } = makeSkinnedFixture()

    const full = bakeVAT(root, [clip], { fps: 30 })
    const positionsOnly = bakeVAT(root, [clip], { fps: 30, bakeNormals: false })

    expect(positionsOnly.positionTexture.image.data).toEqual(full.positionTexture.image.data)
    expect(positionsOnly.clips).toEqual(full.clips)
    expect(positionsOnly.bounds).toEqual(full.bounds)
  })

  it('defaults to baking one, so no existing bake changes', () => {
    const { root, clip } = makeSkinnedFixture()

    expect(bakeVAT(root, [clip], { fps: 30 }).normalTexture).not.toBeNull()
    expect(bakeVAT(root, [clip], { fps: 30, bakeNormals: true }).normalTexture).not.toBeNull()
  })
})

describe('bakeVAT over AnimationActions', () => {
  // Per-clip defaults, declared once at the bake instead of repeated at every
  // instance: a user configures the animation the way three already taught
  // them, hands the *action* to the baker, and every instance that plays that
  // clip inherits the configuration. One rule decides what is read — read
  // configuration, ignore transport state, refuse loudly what a VAT cannot
  // represent.
  const actionFor = (root: Object3D, clip: AnimationClip) =>
    new AnimationMixer(root).clipAction(clip)

  const defaultsOf = (vat: VAT, i = 0) => {
    const { loopMode, repetitions, endMode, speed } = vat.clips[i]!
    return { loopMode, repetitions, endMode, speed }
  }

  it('takes clips and actions in the same array', () => {
    const { root, clip } = makeSkinnedFixture()
    const second = clip.clone()
    second.name = 'spin2'

    const vat = bakeVAT(root, [clip, actionFor(root, second)], { fps: 10 })

    expect(vat.clips.map((c) => c.name)).toEqual(['spin', 'spin2'])
  })

  it('bakes an action to the texels its clip would have baked to', () => {
    // An action is a way of *configuring* a bake, never of changing its geometry.
    const { root, clip } = makeSkinnedFixture()

    const fromClip = bakeVAT(root, [clip], { fps: 10 })
    const fromAction = bakeVAT(root, [actionFor(root, clip)], { fps: 10 })

    expect(fromAction.positionTexture.image.data).toEqual(fromClip.positionTexture.image.data)
    expect(fromAction.normalTexture!.image.data).toEqual(fromClip.normalTexture!.image.data)
  })

  it('gives a plain clip the library defaults, so the simple case needs no mixer', () => {
    const { root, clip } = makeSkinnedFixture()

    const vat = bakeVAT(root, [clip], { fps: 10 })

    expect(defaultsOf(vat)).toEqual({
      loopMode: LoopMode.Repeat,
      repetitions: INFINITE_REPETITIONS,
      endMode: EndMode.Clamp,
      speed: 1,
    })
  })

  it('reads loop and repetitions off the action, and clamps a clampWhenFinished one-shot', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.loop = LoopOnce
    action.clampWhenFinished = true

    const vat = bakeVAT(root, [action], { fps: 10 })

    expect(defaultsOf(vat)).toEqual({
      loopMode: LoopMode.Once,
      repetitions: 1,
      endMode: EndMode.Clamp,
      speed: 1,
    })
  })

  it('clamps a one-shot action that left clampWhenFinished alone', () => {
    // three's `false` is what the field already holds when nobody has touched
    // it, and the bake cannot tell that apart from a decision — so it reads it
    // as the silence it usually is, and a crowd's answer to silence is to hold
    // the last frame. Rewind stays available per instance (#43).
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.loop = LoopOnce

    expect(defaultsOf(bakeVAT(root, [action], { fps: 10 })).endMode).toBe(EndMode.Clamp)
  })

  it('carries a ping-pong and its repetition count across', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.loop = LoopPingPong
    action.repetitions = 3

    const vat = bakeVAT(root, [action], { fps: 10 })

    expect(defaultsOf(vat)).toMatchObject({ loopMode: LoopMode.PingPong, repetitions: 3 })
  })

  it('spells an endless repeat count as INFINITE_REPETITIONS', () => {
    // three says `Infinity`; a Float32Array cannot carry it usefully, so the
    // conversion happens once, here, at the boundary.
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.repetitions = Infinity

    expect(defaultsOf(bakeVAT(root, [action], { fps: 10 })).repetitions).toBe(
      INFINITE_REPETITIONS,
    )
  })

  it('reads timeScale as the clip’s default speed', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.timeScale = 2.5

    expect(defaultsOf(bakeVAT(root, [action], { fps: 10 })).speed).toBe(2.5)
  })

  it('ignores time and paused, which are playhead position and not configuration', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.time = 0.5
    action.paused = true

    const vat = bakeVAT(root, [action], { fps: 10 })

    // Neither the texels — a VAT band is the whole clip, always sampled from
    // its own start — nor the defaults, where a playhead has no say.
    expect(vat.positionTexture.image.data).toEqual(
      bakeVAT(root, [clip], { fps: 10 }).positionTexture.image.data,
    )
    expect(defaultsOf(vat)).toEqual(defaultsOf(bakeVAT(root, [actionFor(root, clip)], { fps: 10 })))
  })

  it('refuses a non-unit weight, because a VAT cannot blend two clips at once', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.weight = 0.5

    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/weight/)
    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/#30/)
  })

  it('refuses an additive blend mode for the same reason', () => {
    const { root, clip } = makeSkinnedFixture()
    const mixer = new AnimationMixer(root)
    const action = mixer.clipAction(clip, undefined, AdditiveAnimationBlendMode)

    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/blendMode/)
    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/#30/)
  })

  it('refuses a negative timeScale, because a baked band only plays forward', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.timeScale = -1

    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/timeScale/)
    // The fixture's clip is named "spin": this refusal names its clip too, and
    // says the one thing a caller can act on — bake the reversed clip.
    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/spin/)
    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/revers/)
  })

  it('keeps a zero timeScale, which is a held first row rather than an error', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.timeScale = 0

    expect(bakeVAT(root, [action], { fps: 10 }).clips[0]!.speed).toBe(0)
  })

  it('names the clip it is refusing, so a long array is searchable', () => {
    const { root, clip } = makeSkinnedFixture()
    const action = actionFor(root, clip)
    action.weight = 0

    expect(() => bakeVAT(root, [action], { fps: 10 })).toThrow(/spin/)
  })

  it('refuses before it bakes anything, rather than partway through', () => {
    // The refusal is a configuration check, and a bake of a real character is
    // seconds of work — spending them to then throw would be the worst of both.
    const { root, clip } = makeSkinnedFixture()
    const bad = actionFor(root, clip)
    bad.weight = 0.5

    const posed = vi.spyOn(root, 'updateMatrixWorld')
    expect(() => bakeVAT(root, [clip, bad], { fps: 10 })).toThrow(/weight/)
    // At most one call: the rest pose. Not one per frame of the clip that came
    // first in the array.
    expect(posed.mock.calls.length).toBeLessThanOrEqual(1)
    posed.mockRestore()
  })
})

describe('bakeVAT and the merge of tangent', () => {
  // A crowd with a normalMap shades from the TBN basis, and three only builds
  // one — only defines USE_TANGENT at all — when the geometry carries
  // `tangent`. Dropping it in the merge is silent: no error, just lighting off
  // the wrong basis.
  it('carries tangent through the merge when every part has one', () => {
    const { root, clip } = makeTangentFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })

    const tangent = vat.geometry.attributes.tangent
    expect(tangent).toBeDefined()
    expect(tangent!.itemSize).toBe(4) // vec4: xyz direction, w handedness
    expect(tangent!.count).toBe(vat.vertexCount)
  })

  it('rotates the tangent direction into root space, like the normal', () => {
    const { root, clip } = makeTangentFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const tangent = vat.geometry.attributes.tangent!

    // arm rests rotated 90° about +Z, so its (1, 0, 0) lands on (0, 1, 0).
    expectVector3Close(
      new Vector3(tangent.getX(0), tangent.getY(0), tangent.getZ(0)),
      new Vector3(0, 1, 0),
    )
    // body never rotates, so its tangent is the one it shipped with.
    expectVector3Close(
      new Vector3(tangent.getX(1), tangent.getY(1), tangent.getZ(1)),
      new Vector3(1, 0, 0),
    )
  })

  it('copies the handedness w across untouched, as three itself does', () => {
    const { root, clip } = makeTangentFixture()
    const vat = bakeVAT(root, [clip], { fps: 30 })
    const tangent = vat.geometry.attributes.tangent!

    expect(tangent.getW(0)).toBe(-1)
    expect(tangent.getW(1)).toBe(-1)
  })

  it('drops tangent when a part carries one the merge cannot read', () => {
    const { root, clip } = makeTangentFixture({ bodyTangent: 'interleaved' })

    // Dropped, not thrown: an interleaved tangent bakes today — tangentless,
    // and rendering — so refusing it here would turn this fix into a worse bug
    // than the one it closes.
    expect(() => bakeVAT(root, [clip], { fps: 30 })).not.toThrow()
    expect(bakeVAT(root, [clip], { fps: 30 }).geometry.attributes.tangent).toBeUndefined()
  })

  it('drops tangent when only some parts carry it, as it does uv and color', () => {
    const { root, clip } = makeTangentFixture({ bodyTangent: false })
    const vat = bakeVAT(root, [clip], { fps: 30 })

    // All-or-nothing: a merged buffer half-filled with a basis and half with
    // zeroes would shade the missing half off a degenerate TBN, which is worse
    // than the tangentless path three falls back to.
    expect(vat.geometry.attributes.tangent).toBeUndefined()
  })
})

describe('the VAT type narrows on its encoding', () => {
  // The seam is `bakeVAT`'s return type. A caller who asks for nothing, or for
  // the vertex encoding by name, holds the narrow member and reads its two
  // textures with no check; a caller holding the union narrows on `encoding`.
  // Behaviour is untouched: the texels are the ones every other test reads.
  it('returns the vertex-encoding member for a bake asked for none, or for delta', () => {
    const { root, clip } = makeSkinnedFixture()
    const plain = bakeVAT(root, [clip])
    const asked = bakeVAT(root, [clip], { encoding: 'delta' })

    expectTypeOf(plain).toEqualTypeOf<DeltaVAT>()
    expectTypeOf(asked).toEqualTypeOf<DeltaVAT>()
    expect(plain.encoding).toBe('delta')
    expect(asked.positionTexture.image.width).toBe(plain.positionTexture.image.width)
  })

  it('discriminates the union on encoding, so a texture read follows a check', () => {
    const { root, clip } = makeSkinnedFixture()
    const vat: VAT = bakeVAT(root, [clip])
    if (vat.encoding === 'delta') {
      expectTypeOf(vat).toEqualTypeOf<DeltaVAT>()
      expect(vat.positionTexture.image.height).toBe(vat.totalFrames)
    }
    expectTypeOf<VAT['encoding']>().toEqualTypeOf<'delta' | 'rig'>()
  })
})
