// Lit areas (#175, ADR-0054): the ground each light can see, against the
// walls. A light sees round itself as far as the first wall each way, so its
// lit area is a star round it: one distance a direction. Each is kept as a
// table of ANGLES directions, -pi to pi, worked out by casting a ray each way
// from the light, and read at a direction between two of them as the nearer
// of the two, so a wall's shadow is never lit by a ray slipping past its
// corner. A light's lit area is the ground it sees within its reach: within
// both the table's distance and the reach that way.
//
// The swarm keeps rats out of what the tables say is lit, and the drawing
// lights the ground from the same tables, read the same way (lights.ts): what
// looks lit is what the rats avoid. Row 0 is the torch's, seen again wherever
// it moves; the rest are the lit lights the level places, in the swarm's
// order, each seen again only when it moves, or when the walls change.
import type { FixedLight } from './swarm'
import type { Walls } from './walls'

/** The most lights the level places a step reads at once: the first lit ones. The GPU step hands them over as a uniform array this long. */
export const MAX_LIGHTS = 16
/** Directions a table holds round its light. */
export const ANGLES = 512
/** How far a table reads, m: past every reach a light is given and the torch's lamp at full strength. */
export const SEEN_CAP = 8
/** The torch's row, then one a light the level places. */
export const LIT_ROWS = 1 + MAX_LIGHTS

const TAU = Math.PI * 2

/** Every light's lit area as a table of how far it sees, each direction: the torch's row 0, the lit placed lights' from 1. */
export class LitAreas {
  /** Every row's distances, ANGLES a row: what the GPU step and the drawing upload as a texture. */
  readonly table = new Float32Array(LIT_ROWS * ANGLES).fill(SEEN_CAP)
  /** Counts up each time a row is worked out again: a texture of the table that finds it unchanged needs no upload. */
  version = 0
  /** Where each row was last seen from. */
  private readonly from = new Float64Array(LIT_ROWS * 2).fill(Number.NaN)

  constructor(private walls: Walls) {}

  /** The walls as they now stand, a gate opened or shut (#176): every row is worked out again at its next update. */
  setWalls(walls: Walls): void {
    this.walls = walls
    this.from.fill(Number.NaN)
  }

  /**
   * The torch at (x, z), and the lit lights of `lights` in order, MAX_LIGHTS at
   * most, each a row from 1 on: as the swarm's step takes them. Rows whose
   * light has not moved are kept.
   */
  update(torch: { x: number; z: number }, lights: readonly FixedLight[]): void {
    this.see(0, torch.x, torch.z)
    let row = 1
    for (const light of lights) {
      if (row === LIT_ROWS) break
      if (!light.on || !(light.reach > 0)) continue
      this.see(row++, light.x, light.z)
    }
  }

  /** How far row `row`'s light sees toward (dx, dz), m: the nearer of the two directions either side. */
  seen(row: number, dx: number, dz: number): number {
    const fb = ((Math.atan2(dz, dx) + Math.PI) / TAU) * ANGLES
    const b0 = fb < ANGLES - 1 ? fb | 0 : ANGLES - 1
    const b1 = b0 + 1 === ANGLES ? 0 : b0 + 1
    const t = this.table
    const o = row * ANGLES
    return Math.min(t[o + b0]!, t[o + b1]!)
  }

  /** Work row `row` out from (x, z), unless it was already. */
  private see(row: number, x: number, z: number): void {
    if (this.from[row * 2] === x && this.from[row * 2 + 1] === z) return
    this.from[row * 2] = x
    this.from[row * 2 + 1] = z
    const o = row * ANGLES
    if (this.walls.count === 0) {
      this.table.fill(SEEN_CAP, o, o + ANGLES)
    } else {
      this.walls.nearTo(x, z, SEEN_CAP)
      for (let b = 0; b < ANGLES; b++) {
        const theta = (b / ANGLES) * TAU - Math.PI
        this.table[o + b] = this.walls.ray(x, z, Math.cos(theta), Math.sin(theta), SEEN_CAP)
      }
    }
    this.version++
  }
}
