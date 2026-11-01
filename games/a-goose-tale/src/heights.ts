// The ground's height read off a grid, for the GPU's rats to stand on as the
// goose game's rolling plain has it (rolling.ts).
import type { Bounds } from './swarm'

/**
 * The ground's height read off a grid `cell` m a side over `bounds`, for a
 * shader to read as the GPU's rats are stood: row by row along x, from the
 * box's corner, and between the grid's points as the shader reads it.
 */
export class HeightGrid {
  /** Where the grid's first point stands, its corner. */
  readonly minX: number
  readonly minZ: number
  /** Points along x and along z. */
  readonly nx: number
  readonly nz: number
  /** The height at each point, m: along x, a row at a time. */
  readonly heights: Float32Array

  constructor(
    at: (x: number, z: number) => number,
    bounds: Bounds,
    readonly cell: number,
  ) {
    this.minX = bounds.minX
    this.minZ = bounds.minZ
    this.nx = Math.ceil((bounds.maxX - bounds.minX) / cell) + 1
    this.nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1
    this.heights = new Float32Array(this.nx * this.nz)
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) this.heights[j * this.nx + i] = at(this.minX + i * cell, this.minZ + j * cell)
  }

  /** The height at (x, z), m: between the four grid points round it, held at the grid's edge. */
  at(x: number, z: number): number {
    const fx = Math.min(this.nx - 1, Math.max(0, (x - this.minX) / this.cell))
    const fz = Math.min(this.nz - 1, Math.max(0, (z - this.minZ) / this.cell))
    const i = Math.min(this.nx - 2, Math.floor(fx))
    const j = Math.min(this.nz - 2, Math.floor(fz))
    const tx = fx - i
    const tz = fz - j
    const h = this.heights
    const row = j * this.nx + i
    const a = h[row]! + (h[row + 1]! - h[row]!) * tx
    const b = h[row + this.nx]! + (h[row + this.nx + 1]! - h[row + this.nx]!) * tx
    return a + (b - a) * tz
  }
}
