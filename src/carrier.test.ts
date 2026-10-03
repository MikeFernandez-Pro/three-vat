import { BatchedMesh, BufferAttribute, BufferGeometry, InstancedMesh, MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { composeVATAtlas } from './atlas.js'
import { bakeVAT } from './bake.js'
import { assertVATCarrier, isBatchedCarrier } from './carrier.js'
import {
  makeBatchedCarrier,
  makeChainFixture,
  makeMultiMaterialFixture,
  makeRigidSubtreeFixture,
  makeRigVATFixture,
  makeVATFixture,
} from './test-utils.js'
import type { VATAtlas } from './atlas.js'
import type { DeltaVAT } from './types.js'

describe('isBatchedCarrier', () => {
  it('tells the two carriers apart by the flag three’s own class carries', () => {
    const vat = makeVATFixture()

    expect(isBatchedCarrier(makeBatchedCarrier(vat))).toBe(true)
    expect(isBatchedCarrier(new InstancedMesh(vat.geometry, vat.materials[0], 2))).toBe(false)
  })
})

describe('assertVATCarrier', () => {
  it('accepts one VAT geometry with any number of instances on it', () => {
    const vat = makeVATFixture()

    expect(() => assertVATCarrier(makeBatchedCarrier(vat, 17), vat)).not.toThrow()
  })

  it('has nothing to say about an InstancedMesh', () => {
    // Nothing can go wrong there: its vertex index is the geometry's own, and
    // a crowd only ever renders the bake's geometry.
    const vat = makeVATFixture()

    expect(() => assertVATCarrier(new InstancedMesh(vat.geometry, vat.materials[0], 2), vat)).not.toThrow()
  })

  it('refuses a second geometry, because its instances would read another character’s rows', () => {
    // The thing `BatchedMesh` is famous for and a VAT cannot use. Not a
    // limitation of this carrier so much as of the format: a second character
    // is a second VAT texture, and a sampler is a uniform per draw call.
    const vat = makeVATFixture()
    const batch = makeBatchedCarrier(vat)

    const second = new BufferGeometry()
    second.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    batch.setGeometrySize(vat.vertexCount * 2, vat.vertexCount * 4)
    batch.addGeometry(second)

    expect(() => assertVATCarrier(batch, vat)).toThrow(/exactly one geometry/)
  })

  it('refuses an empty batch rather than letting it draw nothing', () => {
    const vat = makeVATFixture()
    const batch = new BatchedMesh(2, vat.vertexCount, vat.vertexCount * 2, new MeshStandardMaterial())

    expect(() => assertVATCarrier(batch, vat)).toThrow(/holds no geometry/)
  })

  it('refuses a batch holding a geometry that is not this VAT’s', () => {
    // The vertex counts must agree, because the decode reads the VAT at the
    // batch's own vertex index and the texture is exactly `vertexCount` wide.
    const vat = makeVATFixture()
    const other = new BufferGeometry()
    other.setAttribute('position', new BufferAttribute(new Float32Array(9), 3))
    const batch = new BatchedMesh(2, 3, 6, vat.materials[0])
    batch.addInstance(batch.addGeometry(other))

    expect(() => assertVATCarrier(batch, vat)).toThrow(/spans 3 vertices from 0, and the VAT has 6/)
  })
})

/** A batch over an atlas, holding the geometries named, in that order, an instance of each. */
function atlasBatch(atlas: VATAtlas, order: number[]): BatchedMesh {
  const geometries = order.map((k) => atlas.characters[k]!.geometry)
  const vertices = geometries.reduce((n, g) => n + g.getAttribute('position').count, 0)
  const indices = geometries.reduce((n, g) => n + g.getIndex()!.count, 0)
  const batch = new BatchedMesh(order.length, vertices, indices, new MeshStandardMaterial())
  for (const geometry of geometries) batch.addInstance(batch.addGeometry(geometry))
  return batch
}

describe('assertVATCarrier, on a rig atlas', () => {
  const atlas = () => composeVATAtlas([makeRigVATFixture(), makeRigVATFixture(), makeRigVATFixture()])

  it('accepts a batch holding one geometry a character', () => {
    const composed = atlas()

    expect(() => assertVATCarrier(atlasBatch(composed, [0, 1, 2]), composed.vat)).not.toThrow()
  })

  it('accepts them in any order, because each rebased skinIndex carries its slots wherever its vertices go', () => {
    const composed = atlas()

    expect(() => assertVATCarrier(atlasBatch(composed, [2, 0, 1]), composed.vat)).not.toThrow()
  })

  it('refuses a batch holding fewer geometries than the atlas has characters', () => {
    const composed = atlas()

    expect(() => assertVATCarrier(atlasBatch(composed, [0, 1]), composed.vat)).toThrow(
      /holds 2 geometries, and the atlas has 3 characters/,
    )
  })

  it('refuses a batch holding more', () => {
    const composed = atlas()

    expect(() => assertVATCarrier(atlasBatch(composed, [0, 1, 2, 0]), composed.vat)).toThrow(
      /holds 4 geometries, and the atlas has 3 characters/,
    )
  })

  it('refuses an empty batch, in the words the one-geometry rule uses', () => {
    const composed = atlas()
    const batch = new BatchedMesh(2, 6, 12, new MeshStandardMaterial())

    expect(() => assertVATCarrier(batch, composed.vat)).toThrow(/holds no geometry/)
  })
})

describe('assertVATCarrier, on a vertex atlas', () => {
  /** Three vertex bakes of 4, 6 and 2 vertices: a character read at another's columns is another vertex. */
  const atlas = () => {
    const chain = makeChainFixture()
    const quad = makeMultiMaterialFixture({ indexed: false, morph: true })
    const rigid = makeRigidSubtreeFixture()
    return composeVATAtlas([
      bakeVAT(chain.root, chain.clips, { encoding: 'delta', fps: 12 }),
      bakeVAT(quad.root, [quad.clip], { encoding: 'delta', fps: 30 }),
      bakeVAT(rigid.root, [rigid.clip], { encoding: 'delta', fps: 7 }),
    ] as DeltaVAT[])
  }
  /** Room for every character twice over, so a test can move one without growing the batch. */
  const roomy = (composed: VATAtlas) => new BatchedMesh(8, composed.vat.vertexCount * 2, composed.vat.vertexCount * 6, new MeshStandardMaterial())

  it('accepts a batch whose ranges are the recorded ones, id by id', () => {
    const composed = atlas()

    expect(composed.vat.characters!.map((c) => c.vertexCount)).toEqual([4, 6, 2])
    expect(() => assertVATCarrier(atlasBatch(composed, [0, 1, 2]), composed.vat)).not.toThrow()
  })

  it('refuses a swapped order, naming the geometry and the range it should have', () => {
    const composed = atlas()

    expect(() => assertVATCarrier(atlasBatch(composed, [1, 0, 2]), composed.vat)).toThrow(
      /geometry 0 spans 6 vertices from 0, and the atlas’s character 0 has 4 vertices from 0/,
    )
  })

  it('refuses a gap, which reserving room past a geometry leaves', () => {
    const composed = atlas()
    const batch = roomy(composed)
    batch.addGeometry(composed.characters[0]!.geometry, 4 + 3)
    batch.addGeometry(composed.characters[1]!.geometry)
    batch.addGeometry(composed.characters[2]!.geometry)

    expect(() => assertVATCarrier(batch, composed.vat)).toThrow(/geometry 1 spans 6 vertices from 7, and the atlas’s character 1 has 6 vertices from 4/)
  })

  it('refuses a short span', () => {
    const composed = atlas()
    const batch = roomy(composed)
    const short = composed.characters[1]!.geometry.clone()
    for (const name of Object.keys(short.attributes)) {
      const { array, itemSize } = short.getAttribute(name) as BufferAttribute
      short.setAttribute(name, new BufferAttribute(array.slice(0, 5 * itemSize), itemSize))
    }
    short.setIndex([0, 1, 2, 2, 3, 4])
    for (const geometry of [composed.characters[0]!.geometry, short, composed.characters[2]!.geometry]) batch.addGeometry(geometry)

    expect(() => assertVATCarrier(batch, composed.vat)).toThrow(/geometry 1 spans 5 vertices from 4, and the atlas’s character 1 has 6 vertices from 4/)
  })

  it('refuses a range that deleteGeometry and optimize() moved, even with every character back in', () => {
    const composed = atlas()
    const batch = roomy(composed)
    for (const c of composed.characters) batch.addGeometry(c.geometry)
    batch.deleteGeometry(0)
    batch.optimize()
    // Id 0 comes back, at the end of the batch rather than at its columns.
    expect(batch.addGeometry(composed.characters[0]!.geometry)).toBe(0)

    expect(() => assertVATCarrier(batch, composed.vat)).toThrow(/geometry 0 spans 4 vertices from 8, and the atlas’s character 0 has 4 vertices from 0/)
  })

  it('refuses a character missing, and one too many', () => {
    const composed = atlas()
    const deleted = atlasBatch(composed, [0, 1, 2]).deleteGeometry(1)

    expect(() => assertVATCarrier(deleted, composed.vat)).toThrow(/holds no geometry 1, and the atlas’s character 1 has 6 vertices from 4/)
    expect(() => assertVATCarrier(atlasBatch(composed, [0, 1, 2, 2]), composed.vat)).toThrow(
      /holds 4 geometries, and the atlas has 3 characters/,
    )
  })

  it('refuses one too many past a deleted geometry, which the count does not stop at', () => {
    // Ids 3, 4 and 5 added past the characters, 3 and 4 deleted: the stranger
    // at 5 sits past a hole wider than the count's lookahead, and is still a
    // fourth geometry reading columns that are not its own.
    const composed = atlas()
    const batch = atlasBatch(composed, [0, 1, 2, 2, 2, 2]).deleteGeometry(3).deleteGeometry(4)

    expect(() => assertVATCarrier(batch, composed.vat)).toThrow(/holds 4 geometries, and the atlas has 3 characters/)
  })

  it('refuses an empty batch, in the words the one-geometry rule uses', () => {
    const composed = atlas()

    expect(() => assertVATCarrier(roomy(composed), composed.vat)).toThrow(/holds no geometry/)
  })
})
