// The horde's rows on an `InstancedMesh`. The simulation numbers skeletons by
// the rows its carrier hands out (`SkeletonRows`); these are handed out as
// three's `BatchedMesh` handed them out, lowest freed row first, so row
// recycling is what it was. What changes is the drawing: an `InstancedMesh`
// draws rows 0 to `count`, live or not, so a freed row is hidden at no size,
// and `count` shrinks back whenever the rows at the end come free.
import { Matrix4, type InstancedMesh } from 'three'
import type { SkeletonRows } from './simulation/horde'

const HIDDEN = new Matrix4().makeScale(0, 0, 0)

export class InstanceRows implements SkeletonRows {
  private readonly live: boolean[] = []

  constructor(private readonly mesh: InstancedMesh) {
    mesh.count = 0
  }

  /** How many rows are in use, as `BatchedMesh.instanceCount` counts them. */
  get instanceCount(): number {
    return this.live.filter(Boolean).length
  }

  addInstance(): number {
    const free = this.live.indexOf(false)
    const row = free === -1 ? this.live.length : free
    // The rows the mesh was built with; `count` is only how many it draws.
    const capacity = this.mesh.instanceMatrix.count
    if (row >= capacity) throw new Error(`every row of the carrier's capacity of ${capacity} is in use`)
    this.live[row] = true
    this.mesh.count = Math.max(this.mesh.count, row + 1)
    return row
  }

  deleteInstance(row: number): void {
    if (this.live[row] !== true) throw new Error(`row ${row} is not in use`)
    this.live[row] = false
    this.mesh.setMatrixAt(row, HIDDEN)
    this.mesh.instanceMatrix.needsUpdate = true
    while (this.live.length > 0 && this.live[this.live.length - 1] === false) this.live.pop()
    this.mesh.count = this.live.length
  }
}
