// The way round the walls (ADR-0056): what a rat that cannot see the holder
// runs along instead of its straight line. A rat that sees the holder clearly
// runs straight at it as it always has (ADR-0046); one behind a wall, or out
// of a pocket with a hole in it, takes the shortest way round, and counts how
// far the holder is along that way for its noticing distance. The field knows
// the walls and the holder's place, never the rats: nothing in it routes a rat
// round the crowd.
//
// The ground round the holder is a square of FLOW_SIZE cells a side, FLOW_CELL
// wide, its corner snapped to the cells so it slides with the holder in whole
// cells. The holder's clear sight is a star of ANGLES rays cast against the
// walls, as a lit area is (litareas.ts), but out to the square's corners.
// Cells it sees clearly, CLEAR off every wall's face, hold their straight
// distance; the rest are filled outward from them round the walls by a wave
// (fast marching: each cell from its nearer known neighbour each way, so the
// ways come out smooth and not in eighths of a turn, though a distance reads
// up to a fifth long where the wave bends round a corner), and each points
// down the slope of its neighbours'. Worked out again when the holder has
// moved half a cell.
//
// The CPU step reads it with `at`, the GPU step from `texels`, the same four
// numbers a cell (gpuswarm.ts): the way, how far, and whether the holder is in
// clear sight there.
import type { Walls } from './walls'

/** How wide a cell is, m. */
export const FLOW_CELL = 0.25
/** Cells a side: 24 m, the game's noticing distance each way and a margin. */
export const FLOW_SIZE = 96
/** How far a straight line to the holder keeps off a wall's face to be clear sight, m: a rat's width and a margin. */
const CLEAR = 0.25
/** Rays round the holder for its clear sight. */
const ANGLES = 512
/** How far off a wall's middle line a cell is a wall, m: its half thickness and a little, so no diagonal slips through one. */
const SOLID = 0.2
/** How far the holder moves before the field is worked out again, m. */
export const MOVED = FLOW_CELL / 2

const TAU = Math.PI * 2
const CELLS = FLOW_SIZE * FLOW_SIZE

/** The way round the walls to the holder, over the square round it. */
export class FlowField {
  /** Whether there are walls at all: with none, every rat's straight line is its way, and nothing is worked out. */
  active = false
  /** Each cell's (way x, way z, how far or -1 where no rat goes, 1 where the holder is in clear sight or 0), row by row from the square's corner. */
  readonly texels = new Float32Array(CELLS * 4)
  /** The square's corner, m. */
  cornerX = 0
  cornerZ = 0
  /** Counts up each time the field is worked out again: a texture of it that finds it unchanged needs no upload. */
  version = 0
  /** What `at` found: the way, a unit vector, and how far the holder is along it, m. */
  dx = 0
  dz = 0
  d = 0

  private walls: Walls | undefined
  private holderX = Number.NaN
  private holderZ = Number.NaN
  private readonly sight = new Float64Array(ANGLES)
  private readonly solid = new Uint8Array(CELLS)
  private readonly clear = new Uint8Array(CELLS)
  private readonly dist = new Float64Array(CELLS)
  /** The cells whose distance is settled. */
  private readonly done = new Uint8Array(CELLS)
  private readonly heapCell = new Int32Array(CELLS * 5)
  private readonly heapKey = new Float64Array(CELLS * 5)

  /** The level's walls as they now stand: worked out again at the next update. */
  setWalls(walls: Walls): void {
    this.walls = walls
    this.active = walls.count > 0
    this.holderX = this.holderZ = Number.NaN
  }

  /** The holder at (x, z): the field worked out again round it, if it has moved half a cell since. */
  update(x: number, z: number): void {
    if (!this.active) return
    if (Math.abs(x - this.holderX) < MOVED && Math.abs(z - this.holderZ) < MOVED) return
    this.holderX = x
    this.holderZ = z
    this.cornerX = (Math.round(x / FLOW_CELL) - FLOW_SIZE / 2) * FLOW_CELL
    this.cornerZ = (Math.round(z / FLOW_CELL) - FLOW_SIZE / 2) * FLOW_CELL
    this.see(x, z)
    this.markWalls()
    this.fill(x, z)
    this.slopes(x, z)
    this.version++
  }

  /**
   * The way from (x, z) to the holder, into `dx`, `dz` and `d`: false where
   * the holder is in clear sight, off the square, or nothing is known, and
   * the rat's straight line is its way. Blended over the four cells round it.
   */
  at(x: number, z: number): boolean {
    if (!this.active) return false
    const fx = (x - this.cornerX) / FLOW_CELL
    const fz = (z - this.cornerZ) / FLOW_CELL
    const cx = Math.floor(fx)
    const cz = Math.floor(fz)
    if (cx < 0 || cz < 0 || cx >= FLOW_SIZE || cz >= FLOW_SIZE) return false
    const t = this.texels
    if (t[(cz * FLOW_SIZE + cx) * 4 + 3] === 1) return false
    const bx = Math.floor(fx - 0.5)
    const bz = Math.floor(fz - 0.5)
    const tx = fx - 0.5 - bx
    const tz = fz - 0.5 - bz
    let wx = 0
    let wz = 0
    let wd = 0
    let sum = 0
    for (let j = 0; j < 2; j++) {
      const z2 = bz + j
      if (z2 < 0 || z2 >= FLOW_SIZE) continue
      for (let i = 0; i < 2; i++) {
        const x2 = bx + i
        if (x2 < 0 || x2 >= FLOW_SIZE) continue
        const o = (z2 * FLOW_SIZE + x2) * 4
        if (t[o + 2]! < 0) continue
        const w = (i ? tx : 1 - tx) * (j ? tz : 1 - tz)
        wx += t[o]! * w
        wz += t[o + 1]! * w
        wd += t[o + 2]! * w
        sum += w
      }
    }
    const l = Math.sqrt(wx * wx + wz * wz)
    if (sum === 0 || l < 1e-6) return false
    this.dx = wx / l
    this.dz = wz / l
    this.d = wd / sum
    return true
  }

  /** The holder's clear sight: how far it sees each way, to the first wall's face, out to the square's corners. */
  private see(x: number, z: number): void {
    const walls = this.walls!
    const reach = FLOW_SIZE * FLOW_CELL * 0.75
    walls.nearTo(x, z, reach)
    for (let b = 0; b < ANGLES; b++) {
      const theta = (b / ANGLES) * TAU - Math.PI
      this.sight[b] = walls.ray(x, z, Math.cos(theta), Math.sin(theta), reach)
    }
  }

  /** How far the holder sees toward angle `theta`: the nearer of the two rays either side, as a lit area is read. */
  private seen(theta: number): number {
    const fb = ((theta + Math.PI) / TAU) * ANGLES
    const b0 = ((Math.floor(fb) % ANGLES) + ANGLES) % ANGLES
    const b1 = b0 + 1 === ANGLES ? 0 : b0 + 1
    return Math.min(this.sight[b0]!, this.sight[b1]!)
  }

  /** The cells a wall stands in. */
  private markWalls(): void {
    const { solid } = this
    solid.fill(0)
    const { lines, count } = this.walls!
    for (let k = 0; k < count; k++) {
      const l = k * 5
      const ax = lines[l]!
      const az = lines[l + 1]!
      const ux = lines[l + 2]!
      const uz = lines[l + 3]!
      const length = lines[l + 4]!
      const bx = ax + ux * length
      const bz = az + uz * length
      const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - SOLID - this.cornerX) / FLOW_CELL))
      const x1 = Math.min(FLOW_SIZE - 1, Math.floor((Math.max(ax, bx) + SOLID - this.cornerX) / FLOW_CELL))
      const z0 = Math.max(0, Math.floor((Math.min(az, bz) - SOLID - this.cornerZ) / FLOW_CELL))
      const z1 = Math.min(FLOW_SIZE - 1, Math.floor((Math.max(az, bz) + SOLID - this.cornerZ) / FLOW_CELL))
      for (let cz = z0; cz <= z1; cz++) {
        const pz = this.cornerZ + (cz + 0.5) * FLOW_CELL
        for (let cx = x0; cx <= x1; cx++) {
          const px = this.cornerX + (cx + 0.5) * FLOW_CELL
          const along = Math.max(0, Math.min(length, (px - ax) * ux + (pz - az) * uz))
          const ex = px - ax - ux * along
          const ez = pz - az - uz * along
          if (ex * ex + ez * ez < SOLID * SOLID) solid[cz * FLOW_SIZE + cx] = 1
        }
      }
    }
  }

  /** How far each cell is from the holder: straight where it sees it clearly, and round the walls from there. */
  private fill(x: number, z: number): void {
    const { solid, clear, dist, heapCell, heapKey } = this
    dist.fill(Infinity)
    let size = 0
    const push = (cell: number, key: number) => {
      let i = size++
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heapKey[p]! <= key) break
        heapCell[i] = heapCell[p]!
        heapKey[i] = heapKey[p]!
        i = p
      }
      heapCell[i] = cell
      heapKey[i] = key
    }
    for (let c = 0; c < CELLS; c++) {
      clear[c] = 0
      if (solid[c]) continue
      const ex = this.cornerX + ((c % FLOW_SIZE) + 0.5) * FLOW_CELL - x
      const ez = this.cornerZ + (Math.floor(c / FLOW_SIZE) + 0.5) * FLOW_CELL - z
      const d = Math.sqrt(ex * ex + ez * ez)
      // Clear sight: short of the first wall that way by CLEAR, and either side of it by as much.
      const theta = Math.atan2(ez, ex)
      const spread = d > CLEAR ? Math.asin(CLEAR / d) : Math.PI / 2
      const sees = Math.min(this.seen(theta), this.seen(theta - spread), this.seen(theta + spread))
      if (d >= sees - CLEAR) continue
      clear[c] = 1
      dist[c] = d
      push(c, d)
    }
    const { done } = this
    done.set(clear)
    const h = FLOW_CELL
    /** A cell's distance where it is known, else none. */
    const known = (cx: number, cz: number) => {
      if (cx < 0 || cz < 0 || cx >= FLOW_SIZE || cz >= FLOW_SIZE) return Infinity
      const q = cz * FLOW_SIZE + cx
      return done[q] ? dist[q]! : Infinity
    }
    while (size > 0) {
      const c = heapCell[0]!
      const d0 = heapKey[0]!
      const lastCell = heapCell[--size]!
      const lastKey = heapKey[size]!
      let i = 0
      for (;;) {
        let k = 2 * i + 1
        if (k >= size) break
        if (k + 1 < size && heapKey[k + 1]! < heapKey[k]!) k++
        if (heapKey[k]! >= lastKey) break
        heapCell[i] = heapCell[k]!
        heapKey[i] = heapKey[k]!
        i = k
      }
      heapCell[i] = lastCell
      heapKey[i] = lastKey
      if (d0 > dist[c]!) continue
      done[c] = 1
      const cx = c % FLOW_SIZE
      const cz = (c / FLOW_SIZE) | 0
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? -1 : k === 1 ? 1 : 0)
        const nz = cz + (k === 2 ? -1 : k === 3 ? 1 : 0)
        if (nx < 0 || nz < 0 || nx >= FLOW_SIZE || nz >= FLOW_SIZE) continue
        const q = nz * FLOW_SIZE + nx
        if (solid[q] || done[q]) continue
        // The distance a wave from the known cells reaches it at: from the nearer known neighbour each way, along the grid or across it.
        const a = Math.min(known(nx - 1, nz), known(nx + 1, nz))
        const b = Math.min(known(nx, nz - 1), known(nx, nz + 1))
        const d = Math.abs(a - b) >= h ? Math.min(a, b) + h : (a + b + Math.sqrt(2 * h * h - (a - b) * (a - b))) / 2
        if (d < dist[q]!) {
          dist[q] = d
          push(q, d)
        }
      }
    }
  }

  /** Each cell's way: straight at the holder where it sees it clearly, else down the slope of its neighbours, a wall or a cell no rat reaches read as the cell itself. */
  private slopes(x: number, z: number): void {
    const { solid, clear, dist, texels } = this
    const read = (cx: number, cz: number, own: number) => {
      if (cx < 0 || cz < 0 || cx >= FLOW_SIZE || cz >= FLOW_SIZE) return own
      const q = cz * FLOW_SIZE + cx
      return solid[q] || dist[q] === Infinity ? own : dist[q]!
    }
    for (let c = 0; c < CELLS; c++) {
      const o = c * 4
      const own = dist[c]!
      const cx = c % FLOW_SIZE
      const cz = (c / FLOW_SIZE) | 0
      if (solid[c] || own === Infinity) {
        texels[o] = texels[o + 1] = texels[o + 3] = 0
        texels[o + 2] = -1
        continue
      }
      let wx: number
      let wz: number
      if (clear[c]) {
        wx = x - (this.cornerX + (cx + 0.5) * FLOW_CELL)
        wz = z - (this.cornerZ + (cz + 0.5) * FLOW_CELL)
      } else {
        wx = read(cx - 1, cz, own) - read(cx + 1, cz, own)
        wz = read(cx, cz - 1, own) - read(cx, cz + 1, own)
      }
      const l = Math.sqrt(wx * wx + wz * wz) || 1
      texels[o] = wx / l
      texels[o + 1] = wz / l
      texels[o + 2] = own
      texels[o + 3] = clear[c]
    }
  }
}
