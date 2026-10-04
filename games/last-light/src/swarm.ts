// The swarm (CONTEXT.md): every rat within the spread running at the light's
// holder, kept off the light and off each other; the rest sitting about, now
// and then walking a few steps. Steering only, lifted from the prototype on branch
// prototype/last-light-swarm: no renderer and no DOM, so it is tested in Node
// and could move into a worker unchanged.
//
// Positions are metres on the ground (x, z), with the arena's centre at the
// origin; a heading is a yaw in radians, measured from +x toward +z.

const TAU = Math.PI * 2

/** The light, as the swarm reads it: where its holder stands, how strong it is, and whether it is lit. */
export interface Light {
  x: number
  z: number
  /** 0 to 1: scales the hard radius. */
  strength: number
  on: boolean
}

/** What the swarm is tuned by. */
export interface Tuning {
  /** The collision disc; a rat's body is about 0.25 m long. */
  ratRadius: number
  /** The light's hard radius at full strength: what a rat never enters. */
  ringMax: number
  /** The circling band, outside the hard radius. */
  band: number
  /** How strongly rats keep apart. */
  separation: number
  /** Each rat's own slow drift, so nobody runs in lanes. */
  wander: number
  /** Radians a second a rat's heading turns at most, and while fleeing. */
  turnRate: number
  fleeTurnRate: number
  /** The slowest and fastest rat, in m/s. */
  minSpeed: number
  maxSpeed: number
  /**
   * How far past the light's edge a rat still cares about it, in metres. Rats
   * within it hunt; rats beyond it, by a margin, sit about.
   */
  spread: number
}

export const defaultTuning = (): Tuning => ({
  ratRadius: 0.07,
  ringMax: 3,
  band: 0.9,
  separation: 1.6,
  wander: 0.35,
  turnRate: 7,
  fleeTurnRate: 14,
  minSpeed: 1.2,
  maxSpeed: 2.2,
  spread: 5,
})

/** What one step measured. */
export interface StepReport {
  /** Rats inside the light's hard radius: caught by a light that grew or relit over them. */
  inside: number
  /** Pairs of rats closer than touching, and how deep, as a share of a rat's width. */
  overlappingPairs: number
  meanOverlap: number
  /** How far the rats really moved, against how far they ran. */
  speedRatio: number
  /** The step's own time. */
  ms: number
}

/** The holder's walking pace, m/s. */
export const WALK_SPEED = 1.6

/** What a rat is about: running at the light, sitting, or walking a few steps. */
export const HUNTING = 0
export const SITTING = 1
export const STROLLING = 2

/** A strolling rat's pace, m/s. */
export const STROLL_SPEED = 0.3
/**
 * How far past the spread a hunting rat runs before it gives up, in metres: so
 * a rat on the line does not flip between the two every step.
 */
const SPREAD_MARGIN = 1
/** How long a rat sits, and how long it strolls, in seconds: from the first to the second. */
const SIT_TIME = [2, 6]
const STROLL_TIME = [0.6, 1.8]

/** The arena's radius: sized to the count, so the swarm is under the same pressure at any count. */
export const arenaRadiusFor = (count: number) => 7 + Math.sqrt(count / Math.PI) * 0.32

/** The light's hard radius: what a rat never enters. Out, it is zero, and the band closes on the holder. */
export const hardRadius = (light: Light, tuning: Tuning) => (light.on ? tuning.ringMax * light.strength : 0)

/** mulberry32: small, fast and seeded, so every run of a test is the same. */
function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Swarm {
  /** Rats alive: the first `count` of every array. */
  count = 0
  arena = arenaRadiusFor(0)
  readonly x: Float32Array
  readonly z: Float32Array
  readonly heading: Float32Array
  /** What each rat is about: HUNTING, SITTING or STROLLING. */
  readonly mood: Uint8Array

  private readonly random: () => number
  private time = 0
  /** Where each rat sits between the slowest and fastest speed: drawn once, at its spawn. */
  private readonly places: Float32Array
  /** Each rat's own phase of drift. */
  private readonly phase: Float32Array
  /** When a sitting or strolling rat next changes its mind, in swarm seconds; and where a strolling one heads. */
  private readonly until: Float32Array
  private readonly strollTo: Float32Array
  private readonly oldX: Float32Array
  private readonly oldZ: Float32Array
  private readonly nextX: Float32Array
  private readonly nextZ: Float32Array
  // The neighbour grid, rebuilt every step: each rat's cell, and the rats sorted by cell.
  private readonly cellOf: Int32Array
  private readonly sorted: Int32Array
  private gridN = 0
  private cellSize = 0
  private cellStart = new Int32Array(1)
  private cursor = new Int32Array(0)
  /** The light as the last step left it, to tell a light that walked from one that grew. */
  private readonly was = { x: 0, z: 0, radius: 0 }

  constructor(
    readonly capacity: number,
    seed: number,
  ) {
    const floats = () => new Float32Array(capacity)
    this.random = random(seed)
    this.x = floats()
    this.z = floats()
    this.heading = floats()
    this.mood = new Uint8Array(capacity)
    this.until = floats()
    this.strollTo = floats()
    this.places = floats()
    this.phase = floats()
    this.oldX = floats()
    this.oldZ = floats()
    this.nextX = floats()
    this.nextZ = floats()
    this.cellOf = new Int32Array(capacity)
    this.sorted = new Int32Array(capacity)
  }

  /** Where rat `i` sits between the slowest and fastest speed, 0 to 1. */
  place(i: number): number {
    return this.places[i]
  }

  /** Rat `i`'s running speed, m/s: always running, at its own speed. */
  speedOf(i: number, tuning: Tuning): number {
    return tuning.minSpeed + (tuning.maxSpeed - tuning.minSpeed) * this.places[i]
  }

  /** `count` rats scattered across the arena. */
  reset(count: number): void {
    this.count = this.checked(count)
    this.time = 0
    this.arena = arenaRadiusFor(count)
    for (let i = 0; i < count; i++) this.spawn(i, Math.sqrt(this.random()) * this.arena * 0.97, this.random() * TAU)
  }

  /** Grows at the arena's edge, so the rats already there never reshuffle; or truncates. */
  setCount(count: number): void {
    const was = this.count
    this.count = this.checked(count)
    this.arena = arenaRadiusFor(count)
    for (let i = was; i < count; i++) this.spawn(i, this.arena * (0.9 + 0.08 * this.random()), this.random() * TAU)
  }

  /** Walk the light's holder toward `target` at walking pace, staying inside the arena. */
  walkLight(light: Light, target: { x: number; z: number }, dt: number, speed = WALK_SPEED): void {
    const dx = target.x - light.x
    const dz = target.z - light.z
    const d = Math.hypot(dx, dz)
    if (d > 1e-4) {
      const step = Math.min(d, speed * dt)
      light.x += (dx / d) * step
      light.z += (dz / d) * step
    }
    const r = Math.hypot(light.x, light.z)
    const limit = this.arena - 1
    if (r > limit) {
      light.x *= limit / r
      light.z *= limit / r
    }
  }

  /** The scripted walk at time `t`: a figure of eight through the arena, the same on every run. */
  loopPoint(t: number): { x: number; z: number } {
    return { x: Math.sin(t * 0.12) * this.arena * 0.45, z: Math.sin(t * 0.24) * this.arena * 0.25 }
  }

  /** Step every rat by `dt` seconds, given the light and the tuning. */
  step(dt: number, light: Light, tuning: Tuning): StepReport {
    const t0 = performance.now()
    this.time += dt
    const { x: px, z: pz, heading, places, phase, sorted, cellOf, count, mood } = this
    const r = tuning.ratRadius
    const touch = 2 * r
    const keepApart = 2.5 * r
    const keepApart2 = keepApart * keepApart
    this.buildGrid(keepApart)
    const { cellStart, gridN: n } = this

    const inner = hardRadius(light, tuning)
    const band = tuning.band
    const mid = inner + band * 0.5
    const outer = inner + band
    const edge = this.arena - 1.5
    const span = tuning.maxSpeed - tuning.minSpeed
    let touching = 0
    let depth = 0
    let intended = 0

    for (let i = 0; i < count; i++) {
      const x = px[i]
      const z = pz[i]
      const dx = light.x - x
      const dz = light.z - z
      const D = Math.hypot(dx, dz) || 1e-6
      const ux = dx / D
      const uz = dz / D
      let h = heading[i]

      // Within the spread, the rat hunts; past it by the margin, it gives up and
      // sits about, strolling now and then. Inside the light is within it.
      const past = D - inner
      if (mood[i] !== HUNTING && past < tuning.spread) mood[i] = HUNTING
      else if (mood[i] === HUNTING && past > tuning.spread + SPREAD_MARGIN) this.stroll(i, h)
      else if (mood[i] !== HUNTING && this.time >= this.until[i]) {
        if (mood[i] === SITTING) this.stroll(i, this.random() * TAU)
        else this.sit(i)
      }
      const hunting = mood[i] === HUNTING

      // Goal: inside the light, flee; otherwise run at the holder, turning to
      // circle in the band outside the hard radius.
      let gx: number
      let gz: number
      const flee = D < inner
      if (!hunting) {
        gx = Math.cos(this.strollTo[i])
        gz = Math.sin(this.strollTo[i])
      } else if (flee) {
        gx = -ux
        gz = -uz
      } else {
        // The tangent closest to where the rat already runs, so it keeps its way round.
        let tx = -uz
        let tz = ux
        if (tx * Math.cos(h) + tz * Math.sin(h) < 0) {
          tx = -tx
          tz = -tz
        }
        const k = Math.max(-1, Math.min(1, (D - mid) / (band * 0.5))) // -1 inner edge, +1 outer
        const c = Math.max(0, Math.min(1, 1 - (D - outer) / band)) // 1 in the band, 0 a band beyond
        const pull = k * (0.8 + 0.2 * (1 - c))
        gx = tx * c + ux * pull
        gz = tz * c + uz * pull
      }

      // Soft collisions: every neighbour closer than 2.5 radii steers the rat
      // away, harder the closer. No pair is pushed apart, so nothing jams.
      let sx = 0
      let sz = 0
      const cell = cellOf[i]
      const cx = cell % n
      const cz = (cell / n) | 0
      for (let jz = cz - 1; jz <= cz + 1; jz++) {
        if (jz < 0 || jz >= n) continue
        for (let jx = cx - 1; jx <= cx + 1; jx++) {
          if (jx < 0 || jx >= n) continue
          const cc = jz * n + jx
          for (let q = cellStart[cc], e = cellStart[cc + 1]; q < e; q++) {
            const j = sorted[q]
            if (j === i) continue
            const ex = x - px[j]
            const ez = z - pz[j]
            const d2 = ex * ex + ez * ez
            if (d2 >= keepApart2 || d2 < 1e-12) continue
            const d = Math.sqrt(d2)
            const w = 1 - d / keepApart
            sx += (ex / d) * w
            sz += (ez / d) * w
            if (d < touch) {
              touching++
              depth += (touch - d) / touch
            }
          }
        }
      }

      // The arena's wall turns rats back before they reach it.
      const rr = Math.hypot(x, z)
      let ax = 0
      let az = 0
      if (rr > edge) {
        const f = ((rr - edge) / 1.5) * 2
        ax = (-x / rr) * f
        az = (-z / rr) * f
      }

      // Disorder: each rat's own slow drift.
      const wa = phase[i] * TAU + this.time * (0.6 + phase[i] * 0.8)
      const wx = Math.cos(wa) * tuning.wander
      const wz = Math.sin(wa) * tuning.wander

      if (mood[i] === SITTING) {
        this.nextX[i] = x
        this.nextZ[i] = z
        continue
      }

      // The heading turns toward the sum at a capped rate, doubled while fleeing.
      const sw = flee ? tuning.separation * 0.4 : tuning.separation
      const vx = gx + sx * sw + ax + wx
      const vz = gz + sz * sw + az + wz
      let diff = Math.atan2(vz, vx) - h
      diff -= TAU * Math.round(diff / TAU)
      const most = (flee ? tuning.fleeTurnRate : tuning.turnRate) * dt
      h += diff > most ? most : diff < -most ? -most : diff
      heading[i] = h

      // Hunting, at the rat's own running speed; strolling, at a walk.
      const v = hunting ? tuning.minSpeed + span * places[i] : STROLL_SPEED
      intended += v * dt
      this.nextX[i] = x + Math.cos(h) * v * dt
      this.nextZ[i] = z + Math.sin(h) * v * dt
    }
    this.oldX.set(px.subarray(0, count))
    this.oldZ.set(pz.subarray(0, count))
    px.set(this.nextX.subarray(0, count))
    pz.set(this.nextZ.subarray(0, count))

    // After the move: a walking light pushes rats ahead, a growing one catches them.
    const was = this.was
    const grew = inner > was.radius + 1e-6
    let inside = 0
    let moved = 0
    for (let i = 0; i < count; i++) {
      const rr = Math.hypot(px[i], pz[i])
      if (rr > this.arena) {
        px[i] *= this.arena / rr
        pz[i] *= this.arena / rr
      }
      const lx = px[i] - light.x
      const lz = pz[i] - light.z
      const D = Math.hypot(lx, lz)
      if (D < inner) {
        // A rat that was outside the light is set on its edge, ahead of it; one
        // the light grew or relit over is caught, and flees. The margins keep a
        // rat set on the edge outside it once stored as float32.
        const outside = Math.hypot(this.oldX[i] - was.x, this.oldZ[i] - was.z) >= was.radius - 1e-3
        if (outside && !grew) {
          const f = (inner + 1e-3) / (D || 1e-6)
          px[i] = light.x + lx * f
          pz[i] = light.z + lz * f
        } else inside++
      }
      moved += Math.hypot(px[i] - this.oldX[i], pz[i] - this.oldZ[i])
    }
    was.x = light.x
    was.z = light.z
    was.radius = inner

    return {
      inside,
      overlappingPairs: touching / 2,
      meanOverlap: touching ? depth / touching : 0,
      speedRatio: intended ? moved / intended : 1,
      ms: performance.now() - t0,
    }
  }

  private checked(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > this.capacity) {
      throw new Error(`last-light: a swarm of capacity ${this.capacity} cannot hold ${count} rats`)
    }
    return count
  }

  /** Rat `i` sits, for a while. */
  private sit(i: number): void {
    this.mood[i] = SITTING
    this.until[i] = this.time + SIT_TIME[0] + this.random() * (SIT_TIME[1] - SIT_TIME[0])
  }

  /** Rat `i` walks a few steps toward `heading`. */
  private stroll(i: number, heading: number): void {
    this.mood[i] = STROLLING
    this.strollTo[i] = heading
    this.until[i] = this.time + STROLL_TIME[0] + this.random() * (STROLL_TIME[1] - STROLL_TIME[0])
  }

  /** Rat `i` at `radius` from the centre, at `angle`, with its own speed, heading and drift. */
  private spawn(i: number, radius: number, angle: number): void {
    this.x[i] = Math.cos(angle) * radius
    this.z[i] = Math.sin(angle) * radius
    this.heading[i] = this.random() * TAU
    this.places[i] = this.random()
    this.phase[i] = this.random()
    this.mood[i] = HUNTING
  }

  /** Sort the rats into a uniform grid of `cellSize` cells, by counting. */
  private buildGrid(cellSize: number): void {
    const n = Math.ceil((2 * this.arena) / cellSize) + 3
    if (n !== this.gridN || cellSize !== this.cellSize) {
      this.gridN = n
      this.cellSize = cellSize
      this.cellStart = new Int32Array(n * n + 1)
      this.cursor = new Int32Array(n * n)
    }
    const { x: px, z: pz, cellOf, sorted, cellStart, cursor, count } = this
    cellStart.fill(0)
    const inv = 1 / cellSize
    const off = this.arena + cellSize
    const max = n - 1
    for (let i = 0; i < count; i++) {
      let cx = ((px[i] + off) * inv) | 0
      let cz = ((pz[i] + off) * inv) | 0
      if (cx < 0) cx = 0
      else if (cx > max) cx = max
      if (cz < 0) cz = 0
      else if (cz > max) cz = max
      const c = cz * n + cx
      cellOf[i] = c
      cellStart[c + 1]++
    }
    for (let c = 1; c <= n * n; c++) cellStart[c] += cellStart[c - 1]
    cursor.set(cellStart.subarray(0, n * n))
    for (let i = 0; i < count; i++) sorted[cursor[cellOf[i]]++] = i
  }
}
