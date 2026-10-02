// The atlas (ADR-0040): several rig bakes side by side in one VAT, so one
// material samples every character and one `BatchedMesh` draws them all.
//
// The decode does not change, so the whole claim is a CPU one: a character's
// vertex, decoded from the atlas through its rebased geometry, is the vertex
// its own VAT decodes to — read through the same helpers that hold the shaders
// to the bake (`skinFromRig`, `skinFromRigFrame`).
import { BufferAttribute, type BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { composeVATAtlas } from './atlas.js'
import { bakeVAT } from './bake.js'
import { resolveVATFrame } from './instance-playback.js'
import {
  makeChainFixture,
  makeMorphFixture,
  makeMultiMaterialFixture,
  makeRigidSubtreeFixture,
  skinFromRig,
  skinFromRigFrame,
  slotHierarchy,
} from './test-utils.js'
import type { RigVAT, VAT } from './types.js'

/**
 * Three rig bakes that differ in every way an atlas has to absorb: a chain of
 * three slots with parents and two clips, a one-slot quad carrying uv and
 * vertex colours, and a rigid pair with neither. Their clip
 * lengths differ, so the atlas's rows below the shorter ones are padding.
 */
function cast(): RigVAT[] {
  const chain = makeChainFixture()
  const quad = makeMultiMaterialFixture({ skinned: true })
  const rigid = makeRigidSubtreeFixture()
  return [
    bakeVAT(chain.root, chain.clips, { encoding: 'rig', fps: 12 }),
    bakeVAT(quad.root, [quad.clip], { encoding: 'rig', fps: 30, mergeFlatMaterials: true }),
    bakeVAT(rigid.root, [rigid.clip], { encoding: 'rig', fps: 7 }),
  ] as RigVAT[]
}

/** The atlas, as one character's instance decodes it: the atlas's texels, read through that character's geometry. */
function asCharacter(vat: VAT, geometry: BufferGeometry): RigVAT {
  return { ...(vat as RigVAT), geometry }
}

describe('composeVATAtlas, rig encoding', () => {
  it('guards its cast: the shapes the atlas has to absorb are really there', () => {
    const [chain, quad, rigid] = cast()

    expect(chain!.slotCount).toBe(3)
    expect(new Set([chain!.totalFrames, quad!.totalFrames, rigid!.totalFrames]).size).toBe(3)
    expect(quad!.geometry.getAttribute('color')).toBeDefined()
    expect(chain!.geometry.getAttribute('color')).toBeUndefined()
    expect([0, 1, 2].map((s) => slotHierarchy(chain!, s).parent).filter((p) => p >= 0)).not.toEqual([])
  })

  it("decodes every character's vertex at every row to what its own VAT decodes it to", () => {
    const vats = cast()
    const atlas = composeVATAtlas(vats)

    vats.forEach((own, k) => {
      const inAtlas = asCharacter(atlas.vat, atlas.characters[k]!.geometry)
      for (let row = 0; row < own.totalFrames; row++) {
        for (let v = 0; v < own.vertexCount; v++) {
          const expected = skinFromRig(own, v, row)
          const actual = skinFromRig(inAtlas, v, row)
          expect(actual.position.toArray(), `character ${k}, vertex ${v}, row ${row}`).toEqual(expected.position.toArray())
          expect(actual.normal.toArray(), `character ${k}, vertex ${v}, row ${row}`).toEqual(expected.normal.toArray())
        }
      }
    })
  })

  it('decodes a crossfade, which walks the hierarchy row, to what the own VAT decodes it to', () => {
    const vats = cast()
    const atlas = composeVATAtlas(vats)
    const own = vats[0]!
    const [kick, sweep] = atlas.characters[0]!.clips
    const frame = resolveVATFrame(
      { clip: sweep!, startTime: 0.2, from: { clip: kick!, startTime: 0 }, fadeDuration: 1, fadeStart: 0.3 },
      0.73,
    )
    expect(frame.outgoing?.weight).toBeGreaterThan(0)

    const inAtlas = asCharacter(atlas.vat, atlas.characters[0]!.geometry)
    for (let v = 0; v < own.vertexCount; v++) {
      expect(skinFromRigFrame(inAtlas, v, frame).position.toArray()).toEqual(skinFromRigFrame(own, v, frame).position.toArray())
    }
  })

  it("rebases each geometry's skinIndex by its character's slot offset, widened to Uint16", () => {
    const vats = cast()
    const atlas = composeVATAtlas(vats)

    expect(atlas.characters.map((c) => [c.slotStart, c.slotCount])).toEqual([
      [0, 3],
      [3, vats[1]!.slotCount],
      [3 + vats[1]!.slotCount, vats[2]!.slotCount],
    ])
    vats.forEach((own, k) => {
      const { geometry, slotStart } = atlas.characters[k]!
      const rebased = geometry.getAttribute('skinIndex') as BufferAttribute
      const original = own.geometry.getAttribute('skinIndex') as BufferAttribute
      expect(rebased.array).toBeInstanceOf(Uint16Array)
      expect(Array.from(rebased.array)).toEqual(Array.from(original.array, (slot) => slot + slotStart))
      // The bake's own geometry is the bake's, untouched.
      expect(original).not.toBe(rebased)
    })
  })

  it('rebases each parent in the hierarchy row, and keeps that row last', () => {
    const vats = cast()
    const atlas = composeVATAtlas(vats)
    const vat = atlas.vat as RigVAT

    expect(vat.rigTexture.image.height).toBe(vat.totalFrames + 1)
    vats.forEach((own, k) => {
      const { slotStart } = atlas.characters[k]!
      for (let s = 0; s < own.slotCount; s++) {
        const mine = slotHierarchy(own, s)
        const there = slotHierarchy(vat, slotStart + s)
        expect(there.parent, `character ${k}, slot ${s}`).toBe(mine.parent < 0 ? -1 : mine.parent + slotStart)
        expect(there.pivot.toArray()).toEqual(mine.pivot.toArray())
      }
    })
  })

  it("moves no clip: each character's clips are its own, startFrames and all", () => {
    const vats = cast()
    const atlas = composeVATAtlas(vats)

    vats.forEach((own, k) => expect(atlas.characters[k]!.clips).toEqual(own.clips))
    expect(atlas.vat.clips).toEqual(vats.flatMap((own) => own.clips))
    // Every band starts at row 0, so the second character's first clip is where it was.
    expect(atlas.characters[1]!.clips[0]!.startFrame).toBe(0)
  })

  it('records where each character sits, and is as wide as its slots and as tall as its tallest character', () => {
    const vats = cast()
    const atlas = composeVATAtlas(vats)
    const vat = atlas.vat as RigVAT
    const slots = vats.reduce((n, own) => n + own.slotCount, 0)

    expect(vat.encoding).toBe('rig')
    expect(vat.slotCount).toBe(slots)
    expect(vat.rigTexture.image.width).toBe(slots * 2)
    expect(vat.totalFrames).toBe(Math.max(...vats.map((own) => own.totalFrames)))
    expect(vat.vertexCount).toBe(vats.reduce((n, own) => n + own.vertexCount, 0))
    let vertexStart = 0
    let slotStart = 0
    expect(vat.characters).toEqual(
      vats.map((own) => {
        const range = { vertexStart, vertexCount: own.vertexCount, slotStart, slotCount: own.slotCount }
        vertexStart += own.vertexCount
        slotStart += own.slotCount
        return range
      }),
    )
  })

  it('gives every geometry the attributes they all share and an index, and colour in white where a bake had none', () => {
    const vats = cast()
    // Every bake indexes its merge; a VAT built by other means need not.
    vats[2]!.geometry.setIndex(null)
    const atlas = composeVATAtlas(vats)

    const names = atlas.characters.map((c) => Object.keys(c.geometry.attributes).sort())
    for (const n of names) expect(n).toEqual(['color', 'normal', 'position', 'skinIndex', 'skinWeight'])
    // Indexed in vertex order where the bake was not, which moves nothing.
    expect(Array.from(atlas.characters[2]!.geometry.getIndex()!.array)).toEqual([...Array(vats[2]!.vertexCount).keys()])
    expect(atlas.characters[1]!.geometry.getAttribute('color')).toBe(vats[1]!.geometry.getAttribute('color'))
    const white = atlas.characters[0]!.geometry.getAttribute('color')
    expect(Array.from(white.array)).toEqual(Array(vats[0]!.vertexCount * 3).fill(1))
  })

  it("bounds each geometry by its own character's every frame, which is what a batch culls an instance by", () => {
    const vats = cast()
    const atlas = composeVATAtlas(vats)

    vats.forEach((own, k) => {
      expect(atlas.characters[k]!.geometry.boundingBox).toEqual(own.bounds)
      expect(atlas.characters[k]!.geometry.boundingSphere).not.toBeNull()
    })
  })

  it("leaves every input as it was", () => {
    const vats = cast()
    const before = vats.map((own) => (own.rigTexture.image.data as Float32Array).slice())

    composeVATAtlas(vats)

    vats.forEach((own, k) => expect(own.rigTexture.image.data).toEqual(before[k]))
  })
})

describe('composeVATAtlas refuses', () => {
  it('an atlas that mixes encodings, naming the characters and why one encoding takes the whole atlas', () => {
    const [chain] = cast()
    const morph = makeMorphFixture()
    const vertex = bakeVAT(morph.root, [morph.clip], { fps: 10 })
    expect(vertex.encoding).toBe('delta')

    expect(() => composeVATAtlas([chain!, vertex])).toThrow(/mix.*character 0 is on the rig encoding.*character 1 on the vertex encoding/s)
    expect(() => composeVATAtlas([chain!, vertex])).toThrow(/puts the whole atlas on the vertex encoding/)
  })

  it('a rig atlas wider than the texture ceiling, naming the width and the limit', () => {
    const vats = cast()
    const width = vats.reduce((n, own) => n + own.slotCount, 0) * 2

    expect(() => composeVATAtlas(vats, { maxTextureSize: width - 1 })).toThrow(
      new RegExp(`atlas width ${width} .*exceeds maxTextureSize ${width - 1}`),
    )
    expect(() => composeVATAtlas(vats, { maxTextureSize: width })).not.toThrow()
  })

  it('a vertex-encoded atlas, which is not built yet', () => {
    const morph = makeMorphFixture()
    const vertex = bakeVAT(morph.root, [morph.clip], { fps: 10 })

    expect(() => composeVATAtlas([vertex, vertex])).toThrow(/vertex encoding.*rig encoding only/s)
  })

  it('nothing to compose', () => {
    expect(() => composeVATAtlas([])).toThrow(/at least one/)
  })
})
