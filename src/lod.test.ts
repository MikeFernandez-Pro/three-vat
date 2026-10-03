// Levels of detail (#91): the VAT at a lower detail, drawn from the same
// textures, so a far instance draws fewer vertices off one bake and changes
// level with `setGeometryIdAt`, keeping its row in the playback texture.
//
// A level keeps every vertex and draws fewer of them: the caller's simplified
// index over the source's own vertices. Under the rig encoding a vertex names
// its slots by `skinIndex`, wherever the batch puts it. Under the vertex
// encoding it reads its column at its batch vertex index modulo the VAT's
// width, which the order `createVATLODs` hands the geometries back in makes
// the source vertex's own column. The claim is a CPU one: decoded where a
// batch puts it, every vertex a level draws is the source vertex.
import { BatchedMesh, MeshStandardMaterial, type BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { composeVATAtlas } from './atlas.js'
import { bakeVAT } from './bake.js'
import { assertVATCarrier } from './carrier.js'
import { createVATLODs, type VATLODs } from './lod.js'
import {
  decodeDeltaNormal,
  decodeDeltaPosition,
  makeChainFixture,
  makeMultiMaterialFixture,
  makeRigidSubtreeFixture,
  skinFromRig,
} from './test-utils.js'
import type { DeltaVAT, RigVAT, VAT } from './types.js'

const chainVAT = (encoding: 'rig' | 'delta') => {
  const chain = makeChainFixture()
  return bakeVAT(chain.root, chain.clips, { encoding, fps: 12 })
}

/** Two triangles over the chain's four vertices: vertex 0 dropped. */
const HALF = [3, 1, 2, 2, 1, 3]
/** One triangle. */
const THIRD = [1, 2, 3]

/** A batch holding every geometry, added in the order given — the order `createVATLODs` asks for. */
function batchOf(geometries: readonly BufferGeometry[]): BatchedMesh {
  const vertices = geometries.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const indices = geometries.reduce((n, g) => n + g.getIndex()!.count, 0)
  const batch = new BatchedMesh(4, vertices, indices, new MeshStandardMaterial())
  for (const g of geometries) batch.addGeometry(g)
  return batch
}

/**
 * Every vertex each level draws, as `[character, source vertex, column]`: the
 * column read the way the vertex-encoding decode reads it, the batch vertex
 * index modulo the VAT's width.
 */
function drawn({ vat, levels }: VATLODs, sources: readonly (readonly (readonly number[] | null)[])[]) {
  const batch = batchOf(levels.flat())
  const out: [number, number, number][] = []
  let id = 0
  levels.forEach((level, l) =>
    level.forEach((geometry, k) => {
      const { vertexStart } = batch.getGeometryRangeAt(id++)!
      const index = geometry.getIndex()!
      for (let i = 0; i < index.count; i++) {
        const source = l === 0 ? index.getX(i) : sources[l - 1]![k]![i]!
        out.push([k, source, (vertexStart + index.getX(i)) % vat.vertexCount])
      }
    }),
  )
  return out
}

describe('createVATLODs on a bake', () => {
  for (const encoding of ['rig', 'delta'] as const) {
    it(`draws each level from the source's own vertices with the index given, under the ${encoding} encoding`, () => {
      const vat = chainVAT(encoding)
      const { levels } = createVATLODs(vat, [HALF, THIRD])

      expect(levels.map((level) => level.length)).toEqual([1, 1, 1])
      expect(levels[0]![0]).toBe(vat.geometry)
      expect([...levels[1]![0]!.getIndex()!.array]).toEqual(HALF)
      expect([...levels[2]![0]!.getIndex()!.array]).toEqual(THIRD)
      // Every vertex, so the batch lays each level out as the source, and no attribute copied.
      for (const name of Object.keys(vat.geometry.attributes)) {
        expect(levels[1]![0]!.getAttribute(name)).toBe(vat.geometry.getAttribute(name))
      }
    })
  }

  it('gives the full level an index where the bake had none, so a batch can hold it beside the levels', () => {
    // three's batch holds indexed geometries or none, and every level has an index.
    const vat = chainVAT('delta')
    const unindexed = { ...vat, geometry: vat.geometry.clone().setIndex(null) }
    const [full] = createVATLODs(unindexed, [HALF]).levels[0]!

    expect([...full!.getIndex()!.array]).toEqual([0, 1, 2, 3])
    expect(full!.getAttribute('position')).toBe(unindexed.geometry.getAttribute('position'))
    expect(() => batchOf(createVATLODs(unindexed, [HALF]).levels.flat())).not.toThrow()
  })

  it('reads the source vertex’s column at every vertex a level draws, under the vertex encoding', () => {
    const vat = chainVAT('delta') as DeltaVAT
    const lods = createVATLODs(vat, [HALF, THIRD])

    for (const [, source, column] of drawn(lods, [[HALF], [THIRD]])) {
      expect(column).toBe(source)
      for (let row = 0; row < vat.totalFrames; row++) {
        expect(decodeDeltaPosition(vat, row, column).toArray()).toEqual(decodeDeltaPosition(vat, row, source).toArray())
        expect(decodeDeltaNormal(vat, row, column).toArray()).toEqual(decodeDeltaNormal(vat, row, source).toArray())
      }
    }
  })

  it('reads the bake’s own textures, and records how many levels it has', () => {
    const rig = chainVAT('rig') as RigVAT
    const delta = chainVAT('delta') as DeltaVAT

    expect(createVATLODs(rig, [HALF]).vat.rigTexture).toBe(rig.rigTexture)
    expect(createVATLODs(delta, [HALF]).vat.positionTexture).toBe(delta.positionTexture)
    expect(createVATLODs(delta, [HALF, THIRD]).vat.lods).toBe(3)
  })
})

describe('createVATLODs on an atlas', () => {
  const bakes = (encoding: 'rig' | 'delta') => {
    const chain = makeChainFixture()
    const quad = makeMultiMaterialFixture({ skinned: true })
    const rigid = makeRigidSubtreeFixture()
    return [
      bakeVAT(chain.root, chain.clips, { encoding, fps: 12 }),
      bakeVAT(quad.root, [quad.clip], { encoding, fps: 30, mergeFlatMaterials: true }),
      bakeVAT(rigid.root, [rigid.clip], { encoding, fps: 7 }),
    ]
  }
  /** A level: the chain at half, the quad at one triangle, the rigid pair kept whole. */
  const LEVEL = [HALF, [4, 5, 3], null]

  it('reads each character’s own columns at every vertex a level draws, under the vertex encoding', () => {
    const vats = bakes('delta') as DeltaVAT[]
    const atlas = composeVATAtlas(vats)
    const lods = createVATLODs(atlas.vat, [LEVEL])
    const full = (k: number) => [...atlas.characters[k]!.geometry.getIndex()!.array]

    for (const [k, source, column] of drawn(lods, [[HALF, [4, 5, 3], full(2)]])) {
      expect(column, `character ${k}, vertex ${source}`).toBe(atlas.characters[k]!.vertexStart + source)
    }
    expect(lods.levels.map((level) => level.length)).toEqual([3, 3])
  })

  it('keeps a character whole where its index is null, under the rig encoding', () => {
    const vats = bakes('rig') as RigVAT[]
    const atlas = composeVATAtlas(vats)
    const { vat, levels } = createVATLODs(atlas.vat, [LEVEL])

    expect([...levels[1]![2]!.getIndex()!.array]).toEqual([...levels[0]![2]!.getIndex()!.array])
    // The quad's level decodes to the quad's own vertices, its slots rebased.
    const level = levels[1]![1]!
    for (const v of [4, 5, 3]) {
      const expected = skinFromRig(vats[1]!, v, 0)
      const actual = skinFromRig({ ...vat, geometry: level } as RigVAT, v, 0)
      expect(actual.position.toArray()).toEqual(expected.position.toArray())
    }
  })
})

describe('createVATLODs refuses', () => {
  it('an index that is not whole triangles', () => {
    expect(() => createVATLODs(chainVAT('rig'), [[0, 1]])).toThrow(/level 1.*whole triangles/)
  })

  it('an empty index', () => {
    expect(() => createVATLODs(chainVAT('rig'), [[]])).toThrow(/level 1.*no triangles/)
  })

  it('an index naming a vertex the character does not have', () => {
    expect(() => createVATLODs(chainVAT('delta'), [HALF, [0, 1, 4]])).toThrow(/level 2.*vertex 4.*4 vertices/)
  })

  it('a level of a bake given as one index a character, which only an atlas takes', () => {
    expect(() => createVATLODs(chainVAT('rig'), [[HALF]])).toThrow(/level 1 of this bake.*one index/)
  })

  it('a level of an atlas that does not give one index a character', () => {
    const chain = chainVAT('rig') as RigVAT
    const atlas = composeVATAtlas([chain, chainVAT('rig') as RigVAT])

    expect(() => createVATLODs(atlas.vat, [[HALF]])).toThrow(/level 1.*1 index.*2 characters/)
    expect(() => createVATLODs(atlas.vat, [HALF])).toThrow(/level 1.*one index a character/)
  })

  it('a VAT that already has levels: every level is made in one call', () => {
    const lods = createVATLODs(chainVAT('rig'), [HALF])
    expect(() => createVATLODs(lods.vat, [HALF])).toThrow(/already has levels/)
  })

  it('an atlas of VATs that have levels: compose first, then make the levels', () => {
    const lods = createVATLODs(chainVAT('rig'), [HALF])
    expect(() => composeVATAtlas([lods.vat as RigVAT, chainVAT('rig') as RigVAT])).toThrow(/levels/)
  })
})

describe('assertVATCarrier, on a VAT with levels', () => {
  const levelsOf = (encoding: 'rig' | 'delta') => createVATLODs(chainVAT(encoding), [HALF, THIRD])

  for (const encoding of ['rig', 'delta'] as const) {
    it(`accepts every level, in the order createVATLODs gives, under the ${encoding} encoding`, () => {
      const { vat, levels } = levelsOf(encoding)
      expect(() => assertVATCarrier(batchOf(levels.flat()), vat)).not.toThrow()
    })

    it(`accepts the full geometry alone, under the ${encoding} encoding`, () => {
      const { vat, levels } = levelsOf(encoding)
      expect(() => assertVATCarrier(batchOf(levels[0]!), vat)).not.toThrow()
    })

    it(`refuses an empty batch, under the ${encoding} encoding`, () => {
      const { vat } = levelsOf(encoding)
      expect(() => assertVATCarrier(new BatchedMesh(1, 3, 3, new MeshStandardMaterial()), vat)).toThrow(/no geometry/)
    })
  }

  it('accepts the levels in any order under the rig encoding, which names slots, not columns', () => {
    const { vat, levels } = levelsOf('rig')
    expect(() => assertVATCarrier(batchOf(levels.flat().reverse()), vat)).not.toThrow()
  })

  it('refuses a vertex-encoded level the batch put off its columns, naming where it should start', () => {
    const { vat, levels } = levelsOf('delta')
    const [full, half] = levels.flat()
    // The full geometry after a level is at 4, then the level at 0: in step. A
    // geometry squeezed in front moves both off a multiple of the width.
    const batch = new BatchedMesh(4, 16, 32, new MeshStandardMaterial())
    batch.addGeometry(half!, 5)
    batch.addGeometry(full!)

    expect(() => assertVATCarrier(batch, vat)).toThrow(/vertex 5.*multiple of 4/)
  })

  it('accepts a vertex atlas’s levels added in order, and refuses one character’s level moved off its columns', () => {
    const chain = makeChainFixture()
    const quad = makeMultiMaterialFixture({ skinned: true })
    const atlas = composeVATAtlas([
      bakeVAT(chain.root, chain.clips, { encoding: 'delta' }) as DeltaVAT,
      bakeVAT(quad.root, [quad.clip], { encoding: 'delta' }) as DeltaVAT,
    ])
    const { vat, levels } = createVATLODs(atlas.vat, [[HALF, null]])
    const [chainFull, quadFull, chainHalf, quadLevel] = levels.flat()

    expect(() => assertVATCarrier(batchOf([chainFull!, quadFull!, chainHalf!, quadLevel!]), vat)).not.toThrow()
    // The chain's level where the quad's columns start: the right size, the wrong character.
    expect(() => assertVATCarrier(batchOf([chainFull!, chainHalf!]), vat)).toThrow(/geometry 1 spans 4 vertices.*has 6/)
  })

  it('refuses a geometry that is not the VAT’s own, by its vertex count', () => {
    const { vat } = levelsOf('delta')
    const quad = makeMultiMaterialFixture({ indexed: true })
    const stranger = bakeVAT(quad.root, [quad.clip], { encoding: 'delta' }).geometry

    expect(() => assertVATCarrier(batchOf([stranger]), vat as VAT)).toThrow(/6 vertices.*4/)
  })
})
