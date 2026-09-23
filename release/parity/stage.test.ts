// The one decision in stage.ts that needs no GPU: are two bakes the same bake?
//
// The gate hands each path its own `bakeVAT` result (see `describeBakeMismatch`
// for why), and takes back the guarantee that both saw identical texels as
// evidence. Under the vertex encoding that evidence is a texel walk over two
// layers; under the rig encoding it is a walk over the one rig texture, and a
// mismatch has to name a slot rather than a vertex. Pinned here on bakes made
// of arithmetic, so the rig case's evidence is checked in CI and not only on a
// release machine.
//
// And beside it, the one refusal: a self-test fault that silently had nothing to
// corrupt would render the clean frame twice and report no difference, which is
// the tolerance-has-drifted failure the self-test exists to catch, wearing the
// self-test's own name.
import { describe, expect, it } from 'vitest'
import { Box3, BufferGeometry, DataTexture, FloatType, HalfFloatType, RGBAFormat } from 'three'
import { decodeOctahedral, encodeOctahedral, makeVATNormalTexture, makeVATTexture, resolveVATFrame } from 'three-vat'
import type { DeltaVAT, RigVAT, VATClip, VATInstance } from 'three-vat'
import { describeBakeMismatch, withWrongNormals, withWrongWeight } from './stage.js'

/** Only what the comparison reads of a clip: its name and its band. */
const CLIP = { name: 'Walk', startFrame: 0, frames: 2, fps: 30 } as VATClip

/** A band with room in it, for the cases that read a row back rather than a texel. */
const BAND = { name: 'Walk', startFrame: 10, frames: 40, fps: 30 } as VATClip

const texture = (texels: number[], width: number, height: number) =>
  new DataTexture(new Float32Array(texels), width, height, RGBAFormat, FloatType)

/** A rig bake of `slotCount` slots over `totalFrames` rows, its texels `paint(i)`. */
function rigBake(slotCount: number, totalFrames: number, paint: (i: number) => number = (i) => i): RigVAT {
  const floats = slotCount * 2 * totalFrames * 4
  return {
    encoding: 'rig',
    rigTexture: texture(Array.from({ length: floats }, (_, i) => paint(i)), slotCount * 2, totalFrames),
    slotCount,
    vertexCount: 3,
    totalFrames,
    clips: [{ ...CLIP, frames: totalFrames }],
    geometry: new BufferGeometry(),
    materials: [],
    bounds: new Box3(),
  }
}

function vertexBake(): DeltaVAT {
  return {
    encoding: 'delta',
    // Half-float, as the baker writes it (#73) — a stand-in float layer would
    // be a texel the comparison cannot meet in the wild.
    positionTexture: makeVATTexture(new Uint16Array(12), 3, 1, HalfFloatType),
    normalTexture: null,
    vertexCount: 3,
    totalFrames: 1,
    clips: [{ ...CLIP, frames: 1 }],
    geometry: new BufferGeometry(),
    materials: [],
    bounds: new Box3(),
  }
}

describe('describeBakeMismatch, rig encoding', () => {
  it('calls two identical rig bakes the same bake', () => {
    expect(describeBakeMismatch(rigBake(2, 3), rigBake(2, 3))).toBeNull()
  })

  it('names the slot, the texel and the frame a rig texture first differs at', () => {
    // Float 44 sits in texel 11 of the texture: with two slots (four texels a
    // row), that is row 2, texel 3 — slot 1's second texel, its placement.
    const bent = rigBake(2, 3, (i) => (i === 44 ? -1 : i))

    const mismatch = describeBakeMismatch(rigBake(2, 3), bent)

    expect(mismatch).toContain('rigTexture differs at float 44')
    expect(mismatch).toContain('slot 1')
    expect(mismatch).toContain('placement texel')
    expect(mismatch).toContain('frame 2')
  })

  it('names a different slot count before it walks a texel', () => {
    expect(describeBakeMismatch(rigBake(2, 3), rigBake(3, 3))).toContain('different slot counts')
  })

  it('names two encodings as the mismatch rather than comparing their textures', () => {
    expect(describeBakeMismatch(vertexBake(), rigBake(2, 1))).toContain('different encodings')
  })
})

/**
 * A vertex bake with a normal layer: three vertices, one frame, every normal
 * tilted well off +Z. Tilted rather than axis-aligned because the fault below
 * mirrors x, and a normal with no x to mirror is one it cannot move — true of
 * the float fault it replaces too, and the reason the gate corrupts a whole
 * character rather than one vertex.
 */
function litVertexBake(): DeltaVAT {
  const normals = new Uint8Array(3 * 2)
  for (let v = 0; v < 3; v++) encodeOctahedral(0.6, 0, 0.8, normals, v * 2)
  return { ...vertexBake(), normalTexture: makeVATNormalTexture(normals, 3, 1) }
}

describe('describeBakeMismatch, the normal layer', () => {
  // The layer whose texel is two unsigned bytes and not four floats (#29): the
  // walk has to address it by its own stride, or it names the wrong vertex and
  // reads past the end of the shorter buffer.
  it('calls two identical lit bakes the same bake', () => {
    expect(describeBakeMismatch(litVertexBake(), litVertexBake())).toBeNull()
  })

  it('names the byte, and the vertex it belongs to, rather than a float', () => {
    const bent = litVertexBake()
    ;(bent.normalTexture!.image.data as Uint8Array)[5] = 3

    const mismatch = describeBakeMismatch(litVertexBake(), bent)

    expect(mismatch).toContain('normalTexture differs at byte 5')
    expect(mismatch).toContain('vertex 2')
    expect(mismatch).toContain('frame 0')
  })
})

describe('withWrongNormals', () => {
  it('mirrors x, and leaves each normal a normal', () => {
    // The fault has to be visible in the shading and invisible in the
    // silhouette: the same x-mirror the float bake was corrupted with, and
    // every texel still decoding to a unit vector — a NaN would show as a
    // hole, and prove the gate sees holes rather than shading.
    const wrong = withWrongNormals(litVertexBake()) as DeltaVAT
    const bytes = wrong.normalTexture!.image.data as Uint8Array

    for (let v = 0; v < 3; v++) {
      const n = decodeOctahedral(bytes[v * 2]!, bytes[v * 2 + 1]!)
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5)
      expect(n.x).toBeCloseTo(-0.6, 2)
      expect(n.z).toBeCloseTo(0.8, 2)
    }
  })

  it('leaves the bake it was handed alone', () => {
    // The gate renders the clean frame too, from the same bake.
    const clean = litVertexBake()
    const before = (clean.normalTexture!.image.data as Uint8Array).slice()

    withWrongNormals(clean)

    expect(clean.normalTexture!.image.data).toEqual(before)
  })

  it('refuses a bake with no normal layer rather than rendering the clean frame twice', () => {
    expect(() => withWrongNormals(vertexBake())).toThrow(/bakeNormals: true/)
  })

  it('refuses the rig encoding, which has no normal layer to corrupt', () => {
    expect(() => withWrongNormals(rigBake(2, 1))).toThrow(/vertex encoding/)
  })
})

describe('withWrongWeight', () => {
  const band = { clip: BAND, startTime: 0 }

  it('doubles the fade of the transitioning instance and leaves the others alone', () => {
    const instances: VATInstance[] = [{ ...band }, { ...band, from: { ...band, startTime: -1 }, fadeDuration: 3.2 }]

    const mistimed = withWrongWeight(instances)

    expect(mistimed[1]!.fadeDuration).toBe(6.4)
    // Same bands, same clocks: only the number between them moved.
    expect(mistimed[1]!.from).toEqual(instances[1]!.from)
    expect(mistimed[0]).toEqual(instances[0])
  })

  it('moves the blend and nothing else, read back through the resolver', () => {
    // What makes this a *third* fault rather than the slip again: resolved at
    // the same moment, the doubled duration must move the outgoing weight and
    // leave both bands on the very rows they were. A fault that also moved
    // geometry would prove the gate sees geometry, which the slip already does.
    const clean: VATInstance = { ...band, startTime: -0.37, from: { ...band, startTime: -1.9 }, fadeDuration: 3.2 }
    const [mistimed] = withWrongWeight([clean])

    const before = resolveVATFrame(clean, 1.234)
    const after = resolveVATFrame(mistimed!, 1.234)

    expect(after.outgoing!.weight).not.toBeCloseTo(before.outgoing!.weight, 2)
    expect([after.row, after.rowNext, after.mix]).toEqual([before.row, before.rowNext, before.mix])
    expect([after.outgoing!.row, after.outgoing!.rowNext, after.outgoing!.mix]).toEqual([
      before.outgoing!.row,
      before.outgoing!.rowNext,
      before.outgoing!.mix,
    ])
  })

  it('refuses a crowd with no transition in it rather than rendering the clean frame twice', () => {
    // The trap: a table that lost its `from` would make this fault a no-op, and
    // a no-op fault reports "no difference" — which reads exactly like a
    // tolerance too loose to see a real one.
    expect(() => withWrongWeight([{ ...band }])).toThrow(/mid-transition/)
    // A `fadeDuration` with nothing to blend away is a cut, and is no transition.
    expect(() => withWrongWeight([{ ...band, fadeDuration: 3.2 }])).toThrow(/mid-transition/)
  })
})
