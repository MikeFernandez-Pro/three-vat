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
import { Box3, BufferGeometry, DataTexture, FloatType, RGBAFormat } from 'three'
import { resolveVATFrame } from 'three-vat'
import type { DeltaVAT, RigVAT, VATClip, VATInstance } from 'three-vat'
import { describeBakeMismatch, withWrongWeight } from './stage.js'

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
    positionTexture: texture([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3, 1),
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
