import { BatchedMesh, BufferAttribute, BufferGeometry, InstancedMesh, MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { composeVATAtlas } from './atlas.js'
import { assertVATCarrier, isBatchedCarrier } from './carrier.js'
import { makeBatchedCarrier, makeRigVATFixture, makeVATFixture } from './test-utils.js'
import type { VATAtlas } from './atlas.js'

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
