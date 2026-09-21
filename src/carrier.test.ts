import { BatchedMesh, BufferAttribute, BufferGeometry, InstancedMesh, MeshStandardMaterial } from 'three'
import { describe, expect, it } from 'vitest'
import { assertVATCarrier, isBatchedCarrier } from './carrier.js'
import { makeBatchedCarrier, makeVATFixture } from './test-utils.js'

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
