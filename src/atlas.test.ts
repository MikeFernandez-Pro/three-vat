// The atlas (ADR-0040): several bakes side by side in one VAT, so one
// material samples every character and one `BatchedMesh` draws them all.
//
// The decode does not change, so the whole claim is a CPU one: a character's
// vertex, decoded from the atlas where its batch puts it, is the vertex its
// own VAT decodes to — read through the same helpers that hold the shaders to
// the bake (`skinFromRig`, `skinFromRigFrame`, `decodeDeltaPosition`,
// `decodeDeltaNormal`).
import { BufferAttribute, type BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { composeVATAtlas } from './atlas.js'
import { bakeVAT } from './bake.js'
import { resolveVATFrame } from './instance-playback.js'
import {
  decodeDeltaNormal,
  decodeDeltaPosition,
  makeChainFixture,
  makeMorphFixture,
  makeMultiMaterialFixture,
  makeRigidSubtreeFixture,
  skinFromRig,
  skinFromRigFrame,
  slotHierarchy,
} from './test-utils.js'
import type { DeltaVAT, RigVAT, VAT } from './types.js'

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

/**
 * The same three shapes on the vertex encoding: the chain with two clips and
 * four vertices, the quad spelled out as six, unindexed and carrying vertex
 * colours, and the rigid pair's two. Vertex counts differ as well as clip
 * lengths, so a character read at another's columns is a different vertex.
 */
function vertexCast({ bakeNormals = [true, true, true] }: { bakeNormals?: boolean[] } = {}): DeltaVAT[] {
  const chain = makeChainFixture()
  const quad = makeMultiMaterialFixture({ indexed: false, morph: true })
  const rigid = makeRigidSubtreeFixture()
  return [
    bakeVAT(chain.root, chain.clips, { encoding: 'delta', fps: 12, bakeNormals: bakeNormals[0] }),
    bakeVAT(quad.root, [quad.clip], { encoding: 'delta', fps: 30, mergeFlatMaterials: true, bakeNormals: bakeNormals[1] }),
    bakeVAT(rigid.root, [rigid.clip], { encoding: 'delta', fps: 7, bakeNormals: bakeNormals[2] }),
  ] as DeltaVAT[]
}

describe('composeVATAtlas, vertex encoding', () => {
  it('guards its cast: the shapes the atlas has to absorb are really there', () => {
    const vats = vertexCast()

    expect(vats.map((own) => own.encoding)).toEqual(['delta', 'delta', 'delta'])
    expect(new Set(vats.map((own) => own.vertexCount)).size).toBe(3)
    expect(new Set(vats.map((own) => own.totalFrames)).size).toBe(3)
    expect(vats.map((own) => own.rowsPerFrame)).toEqual([1, 1, 1])
    expect(vats[1]!.geometry.getAttribute('color')).toBeDefined()
    expect(vats[0]!.geometry.getAttribute('color')).toBeUndefined()
  })

  it("decodes every character's vertex at every row, normals included, to what its own VAT decodes it to", () => {
    const vats = vertexCast()
    const atlas = composeVATAtlas(vats)
    const vat = atlas.vat as DeltaVAT

    vats.forEach((own, k) => {
      const { vertexStart, geometry } = atlas.characters[k]!
      // The batch puts the character's vertices at its vertexStart, and its
      // rest pose there is its own geometry's.
      expect(geometry.getAttribute('position')).toBe(own.geometry.getAttribute('position'))
      for (let row = 0; row < own.totalFrames; row++) {
        for (let v = 0; v < own.vertexCount; v++) {
          const at = `character ${k}, vertex ${v}, row ${row}`
          expect(decodeDeltaPosition(vat, row, vertexStart + v).toArray(), at).toEqual(decodeDeltaPosition(own, row, v).toArray())
          expect(decodeDeltaNormal(vat, row, vertexStart + v).toArray(), at).toEqual(decodeDeltaNormal(own, row, v).toArray())
        }
      }
    })
  })

  it('decodes without normals where no character baked them', () => {
    const vats = vertexCast({ bakeNormals: [false, false, false] })
    const atlas = composeVATAtlas(vats)
    const vat = atlas.vat as DeltaVAT

    expect(vat.normalTexture).toBeNull()
    vats.forEach((own, k) => {
      for (let row = 0; row < own.totalFrames; row++) {
        for (let v = 0; v < own.vertexCount; v++) {
          expect(decodeDeltaPosition(vat, row, atlas.characters[k]!.vertexStart + v).toArray()).toEqual(
            decodeDeltaPosition(own, row, v).toArray(),
          )
        }
      }
    })
  })

  it('records where each character sits, and is as wide as its vertices and as tall as its tallest character', () => {
    const vats = vertexCast()
    const atlas = composeVATAtlas(vats)
    const vat = atlas.vat as DeltaVAT
    const width = vats.reduce((n, own) => n + own.vertexCount, 0)
    const totalFrames = Math.max(...vats.map((own) => own.totalFrames))

    expect(vat.encoding).toBe('delta')
    expect(vat.rowsPerFrame).toBe(1)
    expect(vat.vertexCount).toBe(width)
    expect(vat.totalFrames).toBe(totalFrames)
    for (const layer of [vat.positionTexture, vat.normalTexture!]) {
      expect([layer.image.width, layer.image.height]).toEqual([width, totalFrames])
    }
    let vertexStart = 0
    expect(vat.characters).toEqual(
      vats.map((own) => {
        const range = { vertexStart, vertexCount: own.vertexCount, slotStart: 0, slotCount: 0 }
        vertexStart += own.vertexCount
        return range
      }),
    )
  })

  it("moves no clip: each character's clips are its own, startFrames and all", () => {
    const vats = vertexCast()
    const atlas = composeVATAtlas(vats)

    vats.forEach((own, k) => expect(atlas.characters[k]!.clips).toEqual(own.clips))
    expect(atlas.vat.clips).toEqual(vats.flatMap((own) => own.clips))
  })

  it('gives every geometry the attributes they all share, and an index in vertex order where a bake had none', () => {
    const vats = vertexCast()
    // Every bake indexes its merge; a VAT built by other means need not.
    vats[1]!.geometry.setIndex(null)
    const atlas = composeVATAtlas(vats)

    for (const c of atlas.characters) expect(Object.keys(c.geometry.attributes).sort()).toEqual(['color', 'normal', 'position'])
    const { geometry } = atlas.characters[1]!
    expect(Array.from(geometry.getIndex()!.array)).toEqual([...Array(vats[1]!.vertexCount).keys()])
    // Which moves no vertex: every attribute is the bake's own, vertex for vertex.
    for (const name of ['position', 'normal', 'color']) expect(geometry.getAttribute(name)).toBe(vats[1]!.geometry.getAttribute(name))
  })

  it('fills colour in white only where a character lacks it', () => {
    const vats = vertexCast()
    const atlas = composeVATAtlas(vats)

    expect(atlas.characters[1]!.geometry.getAttribute('color')).toBe(vats[1]!.geometry.getAttribute('color'))
    for (const k of [0, 2]) {
      expect(Array.from(atlas.characters[k]!.geometry.getAttribute('color').array)).toEqual(Array(vats[k]!.vertexCount * 3).fill(1))
    }
    // And nowhere when no character carries it.
    const plain = composeVATAtlas([vats[0]!, vats[2]!])
    for (const c of plain.characters) expect(c.geometry.getAttribute('color')).toBeUndefined()
  })

  it('leaves every input as it was', () => {
    const vats = vertexCast()
    const before = vats.map((own) => [
      (own.positionTexture.image.data as Uint16Array).slice(),
      (own.normalTexture!.image.data as Uint8Array).slice(),
    ])

    composeVATAtlas(vats)

    vats.forEach((own, k) => {
      expect(own.positionTexture.image.data).toEqual(before[k]![0])
      expect(own.normalTexture!.image.data).toEqual(before[k]![1])
    })
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

  it('a vertex atlas with normals on some characters and not others, naming which', () => {
    const vats = vertexCast({ bakeNormals: [true, false, true] })

    expect(() => composeVATAtlas(vats)).toThrow(/normals in every character or in none.*characters 0 and 2 have them.*character 1 has none/s)
  })

  it('a vertex atlas wider than the texture ceiling, naming the width, the limit and the character that does not fit', () => {
    const vats = vertexCast()
    const width = vats.reduce((n, own) => n + own.vertexCount, 0)

    expect(() => composeVATAtlas(vats, { maxTextureSize: width - 1 })).toThrow(
      new RegExp(`atlas width ${width} .*exceeds maxTextureSize ${width - 1}.*character 2 does not fit`, 's'),
    )
    expect(() => composeVATAtlas(vats, { maxTextureSize: vats[0]!.vertexCount })).toThrow(/character 1 does not fit/)
    expect(() => composeVATAtlas(vats, { maxTextureSize: width })).not.toThrow()
  })

  it('a character whose frames span rows, naming it', () => {
    const [chain, quad] = vertexCast()
    const many = makeMultiMaterialFixture({ indexed: false, morph: true })
    const spanned = bakeVAT(many.root, [many.clip], { encoding: 'delta', fps: 1, maxTextureSize: 4 }) as DeltaVAT
    expect(spanned.rowsPerFrame).toBe(2)

    expect(() => composeVATAtlas([chain!, quad!, spanned])).toThrow(/character 2 spans 2 rows a frame/)
  })

  it('nothing to compose', () => {
    expect(() => composeVATAtlas([])).toThrow(/at least one/)
  })
})
