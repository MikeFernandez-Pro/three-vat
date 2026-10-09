// The level's walls (#175), as the swarm and the run read them: no renderer,
// no DOM, tested through the swarm and the run. A wall is a straight piece of
// the level, WALL_THICKNESS thick, standing on the ground from one point to
// another; drawn as a grey box (blockout.ts).
//
// Two things read walls. Bodies: a rat, or the holder, keeps its own radius
// off a wall's box, rounded at its ends, and never crosses one, however fast
// it goes or however hard it is pushed. A move is slid along the first face
// or end it meets on its way, so a body pressed into a wall runs along it;
// and a move that would still end inside a wall or across it is not made.
// Light: a ray from a light stops at the first wall's face it meets.
//
// The walls do not move; a gate opened or shut (#176) gives a new set of them.

/** A wall: from one point on the ground to another, m. */
export interface Wall {
  from: { x: number; z: number }
  to: { x: number; z: number }
}

/** How thick every wall is, m. */
export const WALL_THICKNESS = 0.3
/** How far off a wall the holder keeps, m: about half its body. */
export const HOLDER_RADIUS = 0.3
/** The most walls the GPU step reads: it hands them over as a uniform array this long. */
export const MAX_WALLS = 64

/** The grid a body finds the walls near it by: cells this wide, m, each listing every wall within CELL_REACH of it. */
const CELL = 2
/** Past the longest move a step makes and the widest body's reach off a wall, m. */
const CELL_REACH = 1
const HALF = WALL_THICKNESS / 2

/** The level's walls, as bodies and light read them: each one's line and box worked out once, and a grid to find the near ones by. */
export class Walls {
  /** How many walls. */
  readonly count: number
  /** Each wall's start, its way along, its length: (ax, az, ux, uz, length), five numbers a wall. */
  readonly lines: Float64Array
  /** Each wall's box on the ground, its thickness included: (minX, minZ, maxX, maxZ), four numbers a wall. */
  private readonly boxes: Float64Array
  /** The grid: its corner and size in cells, and each cell's walls, a run of `listed` from `starts[c]` to `starts[c + 1]`. */
  private readonly gridX: number
  private readonly gridZ: number
  private readonly sizeX: number
  private readonly sizeZ: number
  private readonly starts: Int32Array
  private readonly listed: Int32Array
  /** Where `move` and `slide` leave the place they work out. */
  private readonly out = { x: 0, z: 0 }
  /** The walls a light's rays are tested against: those near enough to it. */
  private near = new Int32Array(0)
  private nearCount = 0

  constructor(readonly walls: readonly Wall[]) {
    const count = (this.count = walls.length)
    this.lines = new Float64Array(count * 5)
    this.boxes = new Float64Array(count * 4)
    let minX = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxZ = -Infinity
    walls.forEach(({ from, to }, k) => {
      const dx = to.x - from.x
      const dz = to.z - from.z
      const length = Math.hypot(dx, dz) || 1e-6
      this.lines.set([from.x, from.z, dx / length, dz / length, length], k * 5)
      const box = [Math.min(from.x, to.x) - HALF, Math.min(from.z, to.z) - HALF, Math.max(from.x, to.x) + HALF, Math.max(from.z, to.z) + HALF]
      this.boxes.set(box, k * 4)
      minX = Math.min(minX, box[0]!)
      minZ = Math.min(minZ, box[1]!)
      maxX = Math.max(maxX, box[2]!)
      maxZ = Math.max(maxZ, box[3]!)
    })
    if (count === 0) minX = minZ = maxX = maxZ = 0
    this.gridX = minX - CELL_REACH
    this.gridZ = minZ - CELL_REACH
    this.sizeX = Math.ceil((maxX - minX + 2 * CELL_REACH) / CELL) || 1
    this.sizeZ = Math.ceil((maxZ - minZ + 2 * CELL_REACH) / CELL) || 1
    const cells: number[][] = Array.from({ length: this.sizeX * this.sizeZ }, () => [])
    for (let k = 0; k < count; k++) {
      const b = k * 4
      const x0 = Math.floor((this.boxes[b]! - CELL_REACH - this.gridX) / CELL)
      const z0 = Math.floor((this.boxes[b + 1]! - CELL_REACH - this.gridZ) / CELL)
      const x1 = Math.floor((this.boxes[b + 2]! + CELL_REACH - this.gridX) / CELL)
      const z1 = Math.floor((this.boxes[b + 3]! + CELL_REACH - this.gridZ) / CELL)
      for (let cz = Math.max(0, z0); cz <= Math.min(this.sizeZ - 1, z1); cz++) {
        for (let cx = Math.max(0, x0); cx <= Math.min(this.sizeX - 1, x1); cx++) cells[cz * this.sizeX + cx]!.push(k)
      }
    }
    this.starts = new Int32Array(cells.length + 1)
    cells.forEach((cell, c) => (this.starts[c + 1] = this.starts[c]! + cell.length))
    this.listed = Int32Array.from(cells.flat())
  }

  /**
   * Where a body `body` m round, moving from (ox, oz) to (nx, nz), ends up:
   * slid along whatever wall it meets, twice over for a corner, and back at
   * (ox, oz) should it still end inside a wall or across one. Into `out`;
   * true if the walls changed the move.
   */
  move(ox: number, oz: number, nx: number, nz: number, body: number, out: { x: number; z: number }): boolean {
    out.x = nx
    out.z = nz
    const cx = Math.floor((nx - this.gridX) / CELL)
    const cz = Math.floor((nz - this.gridZ) / CELL)
    if (cx < 0 || cz < 0 || cx >= this.sizeX || cz >= this.sizeZ) return false
    const c = cz * this.sizeX + cx
    const from = this.starts[c]!
    const to = this.starts[c + 1]!
    if (from === to) return false
    const reach = HALF + body
    let x = nx
    let z = nz
    for (let pass = 0; pass < 2; pass++) {
      for (let q = from; q < to; q++) {
        this.slide(this.listed[q]!, ox, oz, x, z, reach)
        x = this.out.x
        z = this.out.z
      }
    }
    for (let q = from; q < to; q++) {
      if (this.blocks(this.listed[q]!, ox, oz, x, z)) {
        x = ox
        z = oz
        break
      }
    }
    out.x = x
    out.z = z
    return x !== nx || z !== nz
  }

  /** Whether (x, z) is within `body` m of a wall's box, its ends rounded. */
  inside(x: number, z: number, body: number): boolean {
    const reach = HALF + body
    for (let k = 0; k < this.count; k++) {
      const b = k * 4
      if (x < this.boxes[b]! - body || x > this.boxes[b + 2]! + body || z < this.boxes[b + 1]! - body || z > this.boxes[b + 3]! + body) continue
      const l = k * 5
      const ax = this.lines[l]!
      const az = this.lines[l + 1]!
      const ux = this.lines[l + 2]!
      const uz = this.lines[l + 3]!
      const along = Math.max(0, Math.min(this.lines[l + 4]!, (x - ax) * ux + (z - az) * uz))
      if (Math.hypot(x - ax - ux * along, z - az - uz * along) < reach) return true
    }
    return false
  }

  /** Take the walls within `reach` m of (x, z) as the ones the next rays from there are tested against. */
  nearTo(x: number, z: number, reach: number): void {
    if (this.near.length < this.count) this.near = new Int32Array(this.count)
    let n = 0
    for (let k = 0; k < this.count; k++) {
      const b = k * 4
      const dx = Math.max(this.boxes[b]! - x, 0, x - this.boxes[b + 2]!)
      const dz = Math.max(this.boxes[b + 1]! - z, 0, z - this.boxes[b + 3]!)
      if (dx * dx + dz * dz < reach * reach) this.near[n++] = k
    }
    this.nearCount = n
  }

  /** How far a ray from (x, z), along the unit (dx, dz), goes before it meets a face of one of the walls `nearTo` took, `cap` at most; 0 from inside a wall. */
  ray(x: number, z: number, dx: number, dz: number, cap: number): number {
    let t = cap
    for (let n = 0; n < this.nearCount; n++) {
      const l = this.near[n]! * 5
      // The ray in the wall's own frame: along it from its start, and across it.
      const ax = x - this.lines[l]!
      const az = z - this.lines[l + 1]!
      const wx = this.lines[l + 2]!
      const wz = this.lines[l + 3]!
      const length = this.lines[l + 4]!
      const pu = ax * wx + az * wz
      const pv = ax * -wz + az * wx
      const du = dx * wx + dz * wz
      const dv = dx * -wz + dz * wx
      // The slabs: along, 0 to its length; across, its half-thickness either side.
      let enter = -Infinity
      let leave = Infinity
      if (Math.abs(du) < 1e-12) {
        if (pu < 0 || pu > length) continue
      } else {
        const a = -pu / du
        const b = (length - pu) / du
        enter = Math.max(enter, Math.min(a, b))
        leave = Math.min(leave, Math.max(a, b))
      }
      if (Math.abs(dv) < 1e-12) {
        if (pv < -HALF || pv > HALF) continue
      } else {
        const a = (-HALF - pv) / dv
        const b = (HALF - pv) / dv
        enter = Math.max(enter, Math.min(a, b))
        leave = Math.min(leave, Math.max(a, b))
      }
      if (enter > leave || leave < 0) continue
      const hit = Math.max(enter, 0)
      if (hit < t) t = hit
    }
    return t
  }

  /**
   * Slide a body moving from (ox, oz) to (x, z) along wall `k`, `reach` m off
   * its middle line, into `out`: the first of its face on the body's side and
   * its two rounded ends the move meets, if any, and the rest of the move
   * along it.
   */
  private slide(k: number, ox: number, oz: number, x: number, z: number, reach: number): void {
    const out = this.out
    out.x = x
    out.z = z
    const l = k * 5
    const ax = this.lines[l]!
    const az = this.lines[l + 1]!
    const ux = this.lines[l + 2]!
    const uz = this.lines[l + 3]!
    const length = this.lines[l + 4]!
    // Across the wall, + to its left; and along it.
    const nX = -uz
    const nZ = ux
    const so = (ox - ax) * nX + (oz - az) * nZ
    const side = so >= 0 ? 1 : -1
    const sn = (x - ax) * nX + (z - az) * nZ
    const tn = (x - ax) * ux + (z - az) * uz
    // Where along the move it meets the face, as a share of it, and where along the wall.
    // A body already a hair inside the face, rounded there by the last slide, meets it where it starts.
    let meetFace = Infinity
    if (side * sn < reach && side * sn < side * so) {
      const s = side * so > reach ? (side * so - reach) / (side * so - side * sn) : 0
      const to = (ox - ax) * ux + (oz - az) * uz
      const at = to + (tn - to) * s
      if (at >= 0 && at <= length) meetFace = s
    }
    // Where along the move it meets either end, as a share of it: the nearer root of the circle round it.
    let meetEnd = Infinity
    let end = 0
    const mx = x - ox
    const mz = z - oz
    const mm = mx * mx + mz * mz
    for (const e of [0, length]) {
      const fx = ox - ax - ux * e
      const fz = oz - az - uz * e
      const c = fx * fx + fz * fz - reach * reach
      if (c < 0) {
        // Already inside the end's circle, from a body set down there: out the way it already leans.
        const ex = x - ax - ux * e
        const ez = z - az - uz * e
        if (ex * ex + ez * ez < reach * reach && meetEnd > 0) {
          meetEnd = 0
          end = e
        }
        continue
      }
      if (mm < 1e-18) continue
      const b = fx * mx + fz * mz
      const disc = b * b - mm * c
      if (disc < 0) continue
      const s = (-b - Math.sqrt(disc)) / mm
      if (s >= 0 && s <= 1 && s < meetEnd) {
        meetEnd = s
        end = e
      }
    }
    if (meetFace <= meetEnd && meetFace !== Infinity) {
      // On the face, the rest of the move along it.
      const push = side * reach - sn
      out.x = x + push * nX
      out.z = z + push * nZ
    } else if (meetEnd !== Infinity) {
      // Round the end: out onto its circle from where the move would end.
      const ex = ax + ux * end
      const ez = az + uz * end
      let rx = x - ex
      let rz = z - ez
      let d = Math.hypot(rx, rz)
      if (d >= reach) return
      if (d < 1e-9) {
        rx = ox - ex
        rz = oz - ez
        d = Math.hypot(rx, rz) || 1
      }
      out.x = ex + (rx / d) * reach
      out.z = ez + (rz / d) * reach
    }
  }

  /**
   * Whether a move from (ox, oz) to (x, z) ends inside wall `k`'s box or
   * crosses its middle line. A body already inside the box, a gate shut on it
   * (#176), may move about in it on its own side, so it can work its way out.
   */
  private blocks(k: number, ox: number, oz: number, x: number, z: number): boolean {
    const l = k * 5
    const ax = this.lines[l]!
    const az = this.lines[l + 1]!
    const ux = this.lines[l + 2]!
    const uz = this.lines[l + 3]!
    const length = this.lines[l + 4]!
    const so = (ox - ax) * -uz + (oz - az) * ux
    const sn = (x - ax) * -uz + (z - az) * ux
    const tn = (x - ax) * ux + (z - az) * uz
    const to = (ox - ax) * ux + (oz - az) * uz
    const wasInside = to >= 0 && to <= length && Math.abs(so) < HALF
    if (!wasInside && tn >= 0 && tn <= length && Math.abs(sn) < HALF) return true
    if ((so < 0) === (sn < 0)) return false
    const at = to + ((tn - to) * so) / (so - sn)
    return at >= 0 && at <= length
  }
}
