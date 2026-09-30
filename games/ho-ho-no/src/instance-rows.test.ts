// The horde's rows on an `InstancedMesh`: numbered as three's `BatchedMesh`
// numbered them, so the simulation's row recycling is the same, and drawn as
// an `InstancedMesh` draws, rows 0 to `count`, so a dead row has to be hidden.
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { InstanceRows } from './instance-rows'

const carrierOf = (capacity = 8) => new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), capacity)

/** The scale of the matrix at `row`: zero is hidden. */
function scaleAt(mesh: InstancedMesh, row: number): number {
  const matrix = new Matrix4()
  mesh.getMatrixAt(row, matrix)
  return new Vector3().setFromMatrixScale(matrix).length()
}

describe('numbering', () => {
  it('draws nothing until a row is taken', () => {
    const carrier = carrierOf()
    const rows = new InstanceRows(carrier)
    expect(carrier.count).toBe(0)
    expect(rows.instanceCount).toBe(0)
  })

  it('hands out rows from 0 up, and draws as far as the last one', () => {
    const carrier = carrierOf()
    const rows = new InstanceRows(carrier)
    expect([rows.addInstance(), rows.addInstance(), rows.addInstance()]).toEqual([0, 1, 2])
    expect(carrier.count).toBe(3)
    expect(rows.instanceCount).toBe(3)
  })

  it('reissues the lowest freed row first, as a BatchedMesh does', () => {
    const rows = new InstanceRows(carrierOf())
    for (let i = 0; i < 4; i++) rows.addInstance()
    rows.deleteInstance(2)
    rows.deleteInstance(0)
    expect(rows.addInstance()).toBe(0)
    expect(rows.addInstance()).toBe(2)
    expect(rows.addInstance()).toBe(4)
  })
})

describe('a deleted row', () => {
  it('is hidden: drawn at no size until it is taken again', () => {
    const carrier = carrierOf()
    const rows = new InstanceRows(carrier)
    rows.addInstance()
    rows.addInstance()
    carrier.setMatrixAt(0, new Matrix4())
    rows.deleteInstance(0)
    expect(scaleAt(carrier, 0)).toBe(0)
    expect(carrier.instanceMatrix.version).toBeGreaterThan(0)
    expect(rows.instanceCount).toBe(1)
  })

  it('in the middle leaves the drawn range as it was', () => {
    const carrier = carrierOf()
    const rows = new InstanceRows(carrier)
    for (let i = 0; i < 3; i++) rows.addInstance()
    rows.deleteInstance(1)
    expect(carrier.count).toBe(3)
  })

  it('at the end shrinks the drawn range past every free row below it', () => {
    const carrier = carrierOf()
    const rows = new InstanceRows(carrier)
    for (let i = 0; i < 4; i++) rows.addInstance()
    rows.deleteInstance(1)
    rows.deleteInstance(2)
    expect(carrier.count).toBe(4)
    rows.deleteInstance(3)
    expect(carrier.count).toBe(1)
    rows.deleteInstance(0)
    expect(carrier.count).toBe(0)
  })
})

describe('what is refused', () => {
  it('a row past the mesh’s capacity', () => {
    const rows = new InstanceRows(carrierOf(2))
    rows.addInstance()
    rows.addInstance()
    expect(() => rows.addInstance()).toThrow(/capacity/)
  })

  it('deleting a row nobody holds', () => {
    const rows = new InstanceRows(carrierOf())
    rows.addInstance()
    expect(() => rows.deleteInstance(1)).toThrow(/not in use/)
    rows.deleteInstance(0)
    expect(() => rows.deleteInstance(0)).toThrow(/not in use/)
  })
})
