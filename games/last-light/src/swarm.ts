// The swarm (CONTEXT.md, ADR-0045): every rat running for the light's holder,
// steered the way crowds are simulated, with no moods and no timers. Lifted
// from the prototype on branch prototype/last-light-crowd: no renderer and no
// DOM, so it is tested in Node and could move into a worker unchanged.
//
// Two layers. Where to go: a route map, a continuum crowd (Treuille, Cooper and
// Popovic 2006). The ground is a grid; each cell knows how packed it is and how
// its rats move. Ten times a second, the time to reach the ring from every cell
// is drawn outward from the ring, packed cells and fuller stretches of the ring
// dearer, so each rat's route leads round the mass to wherever the ring has
// room. How to move: bodies, social forces (Helbing, Farkas and Vicsek 2000). A
// rat accelerates toward the pace its route allows, is pushed off the bodies
// near it, and overlapping bodies part. A rat stands because the bodies in
// front of it stand, and goes when they go.
//
// The light moves no rat. Its disc is a hole in the map, and so is the strip a
// walking light is about to cross; a rat inside it runs out on its own.
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
  /** The collision disc; a rat's body is about 0.25 m long. The route map's cells follow it. */
  ratRadius: number
  /** The light's hard radius at full strength. */
  ringMax: number
  /** The ring's width, outside the gap off the light's edge: where routes end, and rats run round. */
  band: number
  /** Metres a rat keeps off the light's edge, when it can. */
  gap: number
  /** The slowest and fastest rat, in m/s. */
  minSpeed: number
  maxSpeed: number
  /** Radians a second a rat's facing turns at most toward where it really goes. */
  turnRate: number
  /** Seconds a rat takes to reach the pace it wants: how quickly it reacts. */
  reaction: number
  /** How hard a rat shoves for space, m/s², and over what gap it feels a body, m. */
  push: number
  pushReach: number
  /** The share of shoulder to shoulder at which a rat goes only as fast as the rats around it. */
  packed: number
  /** The share of shoulder to shoulder from which crowding slows a rat at all. */
  slowFrom: number
  /** Seconds a metre a packed stretch of route counts on top of its slowness: how much rats go round packed ground. */
  discomfort: number
  /** Seconds ahead a rat reads a walking light's path. */
  lookAhead: number
  /** Times a second the route map is redrawn. */
  mapRate: number
}

export const defaultTuning = (): Tuning => ({
  ratRadius: 0.07,
  ringMax: 3,
  band: 0.9,
  gap: 0.2,
  minSpeed: 1.2,
  maxSpeed: 2.2,
  turnRate: 10,
  reaction: 0.25,
  push: 2.5,
  pushReach: 0.05,
  packed: 0.5,
  slowFrom: 0.3,
  discomfort: 1.5,
  lookAhead: 0.8,
  mapRate: 10,
})

/** What one step measured. */
export interface StepReport {
  /** Rats inside the light's hard radius: overtaken by it, or caught by a light that grew or relit over them. */
  inside: number
  /** Pairs of rats closer than touching before they part, and how deep, as a share of a rat's width. */
  overlappingPairs: number
  meanOverlap: number
  /** The step's own time. */
  ms: number
}

/** The holder's walking pace, m/s. */
export const WALK_SPEED = 1.6

/** A rat's gait: what its feet play, read from how fast it really moves. */
export const RUN = 0
export const WALK = 1
export const IDLE = 2

/**
 * The gait's thresholds, m/s, with hysteresis: Run from RUN_IN and back to Walk
 * under RUN_OUT; Walk from WALK_IN and back to Idle under WALK_OUT.
 */
const RUN_IN = 0.75
const RUN_OUT = 0.6
const WALK_IN = 0.14
const WALK_OUT = 0.06
/** Seconds a gait holds at least, but Idle: a rat that moves shows it at once. */
const GAIT_DWELL = 0.3
/** Seconds the real speed is smoothed over, so jostling back and forth cancels out. */
const SEEN = 0.3
/** The real speed under which a rat's facing holds: a jostle does not spin it. */
const TURN_FROM = 0.08
/** The light's own walk is read smoothed over this many seconds, and counts as walking from this pace, m/s. */
const LIGHT_SMOOTHING = 0.2
const LIGHT_WALKING = 0.2
/** Seconds a metre the strip a walking light is about to cross counts on top. */
const PATH_COST = 4
/** The slowest pace the map or a packed spot gives a rat, m/s: never quite nothing, so a route never ends in a wall. */
export const CREEP = 0.05
/** A ring rat really moving slower than this share of its running speed is stalled. */
const STALLED = 0.33
/** A rat's velocity is capped at this much over its own running speed. */
const TOP = 1.2

/** Rats shoulder to shoulder, per m², for a rat of radius `r`: hexagonal packing. */
const packedPerM2 = (r: number) => Math.PI / (2 * Math.sqrt(3)) / (Math.PI * r * r)

/** The eight neighbours of a cell: x, z, and how far. */
const DX = [1, -1, 0, 0, 1, 1, -1, -1]
const DZ = [0, 0, 1, -1, 1, -1, 1, -1]
const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2]

/** The arena's radius: sized to the count, so the swarm is under the same pressure at any count. */
export const arenaRadiusFor = (count: number) => 7 + Math.sqrt(count / Math.PI) * 0.32

/** The light's hard radius. Out, it is zero, and the ring closes on the holder. */
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

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export class Swarm {
  /** Rats alive: the first `count` of every array. */
  count = 0
  arena = arenaRadiusFor(0)
  readonly x: Float32Array
  readonly z: Float32Array
  /** Each rat's facing: toward where it really goes, at a capped turn rate. */
  readonly heading: Float32Array
  /** What each rat's feet play: RUN, WALK or IDLE. */
  readonly gait: Uint8Array
  /** How fast each rat really moves, m/s, smoothed over about a third of a second. */
  readonly realSpeed: Float32Array

  private readonly random: () => number
  private time = 0
  /** Where each rat sits between the slowest and fastest speed: drawn once, at its spawn. */
  private readonly places: Float32Array
  /** Its velocity, m/s: what the bodies push on. */
  private readonly vx: Float32Array
  private readonly vz: Float32Array
  /** Its real velocity, smoothed: what the facing and the gait read. */
  private readonly sx: Float32Array
  private readonly sz: Float32Array
  private readonly gaitSince: Float32Array
  /** 1 for a rat in the ring: it leaves only a half-width further out than it entered. */
  private readonly ringed: Uint8Array
  /** Which way round the ring it runs: 1 or -1. */
  private readonly spin: Int8Array
  private readonly oldX: Float32Array
  private readonly oldZ: Float32Array
  // The grid both layers share, rebuilt as the arena or the rat size changes:
  // the route map's cells, and the neighbour lookup.
  private readonly cellOf: Int32Array
  private readonly sorted: Int32Array
  private n = 0
  private h = 0
  private origin = 0
  /** Rats a m², and their mean velocity, read over about three cells. */
  private rho = new Float32Array(0)
  private flowX = new Float32Array(0)
  private flowZ = new Float32Array(0)
  /** Seconds to the ring from each cell. */
  private cost = new Float64Array(0)
  /** A walking light's path: seconds a metre on top. */
  private extra = new Float32Array(0)
  /** 0 open, 1 the ring, 2 the light. */
  private cellKind = new Uint8Array(0)
  private blurred = new Float32Array(0)
  private done = new Uint8Array(0)
  private cellStart = new Int32Array(1)
  private cursor = new Int32Array(0)
  private heapCost = new Float64Array(0)
  private heapCell = new Int32Array(0)
  /** The ring's spins summed, last step: which way most of it runs. */
  private turning = 0
  /** Swarm time the route map is next redrawn at. */
  private mapDue = 0
  /** The light as the last step left it, and its walk, smoothed: read, never acted on. */
  private readonly was = { x: 0, z: 0, vx: 0, vz: 0, fresh: true }

  constructor(
    readonly capacity: number,
    seed: number,
  ) {
    const floats = () => new Float32Array(capacity)
    this.random = random(seed)
    this.x = floats()
    this.z = floats()
    this.heading = floats()
    this.gait = new Uint8Array(capacity)
    this.realSpeed = floats()
    this.places = floats()
    this.vx = floats()
    this.vz = floats()
    this.sx = floats()
    this.sz = floats()
    this.gaitSince = floats()
    this.ringed = new Uint8Array(capacity)
    this.spin = new Int8Array(capacity)
    this.oldX = floats()
    this.oldZ = floats()
    this.cellOf = new Int32Array(capacity)
    this.sorted = new Int32Array(capacity)
  }

  /** Where rat `i` sits between the slowest and fastest speed, 0 to 1. */
  place(i: number): number {
    return this.places[i]
  }

  /** Rat `i`'s running speed, m/s: how fast it goes where nothing holds it back. */
  speedOf(i: number, tuning: Tuning): number {
    return tuning.minSpeed + (tuning.maxSpeed - tuning.minSpeed) * this.places[i]
  }

  /** `count` rats scattered across the arena. */
  reset(count: number): void {
    this.count = this.checked(count)
    this.time = 0
    this.mapDue = 0
    this.turning = 0
    this.was.fresh = true
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
    const now = this.time
    this.layout(tuning)
    const { x: px, z: pz, vx, vz, ringed, spin, count, n, h } = this
    const r = tuning.ratRadius
    const touch = 2 * r

    // The light's walk, smoothed: read, never acted on.
    const was = this.was
    if (was.fresh) {
      was.x = light.x
      was.z = light.z
      was.vx = was.vz = 0
      was.fresh = false
    }
    const k = Math.min(1, dt / LIGHT_SMOOTHING)
    was.vx += ((light.x - was.x) / dt - was.vx) * k
    was.vz += ((light.z - was.z) / dt - was.vz) * k
    was.x = light.x
    was.z = light.z
    const walking = Math.hypot(was.vx, was.vz) > LIGHT_WALKING

    const inner = hardRadius(light, tuning)
    const ringIn = inner + tuning.gap
    const ringOut = ringIn + tuning.band
    const mid = ringIn + tuning.band * 0.5

    this.splat()
    if (now >= this.mapDue) {
      this.drawMap(light, tuning, inner, ringIn, ringOut, walking)
      this.mapDue = now + 1 / tuning.mapRate
    }
    this.buildGrid()
    const { cellStart, sorted, cellOf, cost, extra, flowX, flowZ } = this
    // A body further than a cell off is past the 3×3 cells looked in.
    const reach = Math.min(h, touch + 4 * tuning.pushReach)
    const reach2 = reach * reach
    let inside = 0
    /** Which way most of the ring ran last step, 1 or -1, or 0 for neither; and the tally for this one. */
    const majority = Math.sign(this.turning)
    let turning = 0

    for (let i = 0; i < count; i++) {
      const x = px[i]
      const z = pz[i]
      const v0 = this.speedOf(i, tuning)
      const dx = x - light.x
      const dz = z - light.z
      const D = Math.hypot(dx, dz) || 1e-6
      // Away from the light.
      const ox = dx / D
      const oz = dz / D

      // Where it wants to go, and how fast: out of the light, round the ring, or down the map.
      let wx: number
      let wz: number
      let want: number
      const c = cellOf[i]
      const inPath = walking && extra[c] > 0
      if (D < inner) {
        ringed[i] = 0
        inside++
        wx = ox
        wz = oz
        want = v0
      } else if (!inPath && (D < ringOut || (ringed[i] && D < ringOut + tuning.band * 0.5))) {
        // The ring: it has arrived, and runs round the light flat out, held to
        // the ring's middle. It joins the way the rats beside it run, or the
        // way most of the ring runs where they run neither way. Running the
        // other way from most of the ring, it turns round when the rats a
        // little ahead of it come at it head on, or when it is stalled: where
        // two ways meet, the fewer give way, so no jam lasts and the ring turns
        // as one. (Its own cell cannot tell: where two ways meet, the rats
        // there stand, and a jam soon outgrows the look ahead.)
        if (!ringed[i]) {
          const along = flowX[c] * -oz + flowZ[c] * ox
          spin[i] = along > 0.1 ? 1 : along < -0.1 ? -1 : majority !== 0 ? majority : vx[i] * -oz + vz[i] * ox >= 0 ? 1 : -1
        } else if (spin[i] !== majority) {
          const ahead = this.cellAt(x - oz * spin[i] * h * 2, z + ox * spin[i] * h * 2)
          const headOn = (flowX[ahead] * -oz + flowZ[ahead] * ox) * spin[i] < -0.25
          if (headOn || this.realSpeed[i] < v0 * STALLED) spin[i] = -spin[i]
        }
        ringed[i] = 1
        turning += spin[i]
        const s = spin[i]
        const pull = Math.max(-1, Math.min(1, (D - mid) / (tuning.band * 0.5)))
        wx = -oz * s - ox * pull
        wz = ox * s - oz * pull
        const l = Math.hypot(wx, wz)
        wx /= l
        wz /= l
        want = v0
      } else {
        // The map: down the slope of the time to the ring, straight from the
        // map as it is now. At the pace the spot half a metre ahead allows.
        ringed[i] = 0
        const gx = this.sample(cost, x + h * 0.5, z) - this.sample(cost, x - h * 0.5, z)
        const gz = this.sample(cost, x, z + h * 0.5) - this.sample(cost, x, z - h * 0.5)
        const gl = Math.hypot(gx, gz)
        if (gl > 1e-9) {
          wx = -gx / gl
          wz = -gz / gl
        } else {
          wx = -ox
          wz = -oz
        }
        want = this.paceAt(this.cellAt(x + wx * h * 2, z + wz * h * 2), wx, wz, v0, tuning)
      }

      // Social forces: toward the pace it wants, and off the bodies near it, a
      // body ahead counting fully and one behind a third as much.
      let ax = (wx * want - vx[i]) / tuning.reaction
      let az = (wz * want - vz[i]) / tuning.reaction
      const cx = c % n
      const cz = (c / n) | 0
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
            if (d2 >= reach2 || d2 < 1e-12) continue
            const d = Math.sqrt(d2)
            const nx = ex / d
            const nz = ez / d
            const ahead = -(nx * wx + nz * wz)
            const f = tuning.push * Math.exp((touch - d) / tuning.pushReach) * (0.33 + 0.335 * (1 + ahead))
            ax += nx * f
            az += nz * f
          }
        }
      }
      let nvx = vx[i] + ax * dt
      let nvz = vz[i] + az * dt
      const sp = Math.hypot(nvx, nvz)
      const top = v0 * TOP
      if (sp > top) {
        nvx *= top / sp
        nvz *= top / sp
      }
      vx[i] = nvx
      vz[i] = nvz
      this.oldX[i] = x
      this.oldZ[i] = z
      px[i] = x + nvx * dt
      pz[i] = z + nvz * dt
    }

    // Bodies do not pass through each other: overlapping pairs part, half each,
    // and lose the speed that drove them together, so a pressed mass stands
    // instead of bouncing. The light takes no part.
    this.buildGrid()
    let touching = 0
    let depth = 0
    const touch2 = touch * touch
    for (let i = 0; i < count; i++) {
      const c = cellOf[i]
      const cx = c % n
      const cz = (c / n) | 0
      for (let jz = cz - 1; jz <= cz + 1; jz++) {
        if (jz < 0 || jz >= n) continue
        for (let jx = cx - 1; jx <= cx + 1; jx++) {
          if (jx < 0 || jx >= n) continue
          const cc = jz * n + jx
          for (let q = cellStart[cc], e = cellStart[cc + 1]; q < e; q++) {
            const j = sorted[q]
            if (j <= i) continue
            const ex = px[i] - px[j]
            const ez = pz[i] - pz[j]
            const d2 = ex * ex + ez * ez
            if (d2 >= touch2 || d2 < 1e-12) continue
            const d = Math.sqrt(d2)
            touching++
            depth += (touch - d) / touch
            const o = ((touch - d) * 0.5) / d
            px[i] += ex * o
            pz[i] += ez * o
            px[j] -= ex * o
            pz[j] -= ez * o
            const nx = ex / d
            const nz = ez / d
            const closing = (vx[i] - vx[j]) * nx + (vz[i] - vz[j]) * nz
            if (closing < 0) {
              vx[i] -= nx * closing * 0.5
              vz[i] -= nz * closing * 0.5
              vx[j] += nx * closing * 0.5
              vz[j] += nz * closing * 0.5
            }
          }
        }
      }
    }

    this.turning = turning

    // The arena's wall; where each rat really went; its facing; its gait.
    const { heading, gait, gaitSince, realSpeed, sx, sz } = this
    const a = Math.min(1, dt / SEEN)
    const most = tuning.turnRate * dt
    for (let i = 0; i < count; i++) {
      const rr = Math.hypot(px[i], pz[i])
      if (rr > this.arena) {
        px[i] *= this.arena / rr
        pz[i] *= this.arena / rr
      }
      const mx = (sx[i] += ((px[i] - this.oldX[i]) / dt - sx[i]) * a)
      const mz = (sz[i] += ((pz[i] - this.oldZ[i]) / dt - sz[i]) * a)
      const seen = (realSpeed[i] = Math.hypot(mx, mz))
      if (seen > TURN_FROM) {
        let diff = Math.atan2(mz, mx) - heading[i]
        diff -= TAU * Math.round(diff / TAU)
        heading[i] += diff > most ? most : diff < -most ? -most : diff
      }
      const g = gait[i]
      let next = g
      if (g === RUN) {
        if (seen < RUN_OUT) next = seen < WALK_OUT ? IDLE : WALK
      } else if (g === WALK) {
        if (seen > RUN_IN) next = RUN
        else if (seen < WALK_OUT) next = IDLE
      } else if (seen > WALK_IN) next = seen > RUN_IN ? RUN : WALK
      if (next !== g && (g === IDLE || now - gaitSince[i] > GAIT_DWELL)) {
        gait[i] = next
        gaitSince[i] = now
      }
    }

    return {
      inside,
      overlappingPairs: touching,
      meanOverlap: touching ? depth / touching : 0,
      ms: performance.now() - t0,
    }
  }

  private checked(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > this.capacity) {
      throw new Error(`last-light: a swarm of capacity ${this.capacity} cannot hold ${count} rats`)
    }
    return count
  }

  /** Rat `i` at `radius` from the centre, at `angle`, standing, with its own speed and facing. */
  private spawn(i: number, radius: number, angle: number): void {
    this.x[i] = Math.cos(angle) * radius
    this.z[i] = Math.sin(angle) * radius
    this.heading[i] = this.random() * TAU
    this.places[i] = this.random()
    this.vx[i] = this.vz[i] = this.sx[i] = this.sz[i] = this.realSpeed[i] = 0
    this.ringed[i] = 0
    this.gait[i] = IDLE
    this.gaitSince[i] = this.time
    this.spin[i] = this.random() < 0.5 ? 1 : -1
  }

  /** The grid both layers share, its cells about 3.5 rat radii: reallocated, and the map redrawn, when its shape changes. */
  private layout(tuning: Tuning): void {
    const h = Math.max(0.2, 3.5 * tuning.ratRadius)
    const n = Math.ceil((2 * this.arena) / h) + 2
    if (n !== this.n || h !== this.h) {
      this.n = n
      this.h = h
      const cells = n * n
      this.rho = new Float32Array(cells)
      this.flowX = new Float32Array(cells)
      this.flowZ = new Float32Array(cells)
      this.cost = new Float64Array(cells)
      this.extra = new Float32Array(cells)
      this.cellKind = new Uint8Array(cells)
      this.blurred = new Float32Array(cells)
      this.done = new Uint8Array(cells)
      this.cellStart = new Int32Array(cells + 1)
      this.cursor = new Int32Array(cells)
      // A lazy heap: a cell may be in it once for each neighbour that lowered it.
      this.heapCost = new Float64Array(cells * 8 + 16)
      this.heapCell = new Int32Array(cells * 8 + 16)
      this.mapDue = 0
    }
    this.origin = -(n * h) / 2
  }

  /** The cell holding the point (x, z), clamped to the grid. */
  private cellAt(x: number, z: number): number {
    const { n, h, origin } = this
    let cx = ((x - origin) / h) | 0
    let cz = ((z - origin) / h) | 0
    cx = cx < 0 ? 0 : cx >= n ? n - 1 : cx
    cz = cz < 0 ? 0 : cz >= n ? n - 1 : cz
    return cz * n + cx
  }

  /** A per-cell field read at a point, bilinearly between cell centres. */
  private sample(field: Float64Array, x: number, z: number): number {
    const { n, h, origin } = this
    let fx = (x - origin) / h - 0.5
    let fz = (z - origin) / h - 0.5
    fx = fx < 0 ? 0 : fx > n - 1.001 ? n - 1.001 : fx
    fz = fz < 0 ? 0 : fz > n - 1.001 ? n - 1.001 : fz
    const ix = fx | 0
    const iz = fz | 0
    const ax = fx - ix
    const az = fz - iz
    const c = iz * n + ix
    return (field[c] * (1 - ax) + field[c + 1] * ax) * (1 - az) + (field[c + n] * (1 - ax) + field[c + n + 1] * ax) * az
  }

  /** How far from open to packed ground is, 0 to 1, by the tuning's two shares, given its `share` of shoulder to shoulder. */
  private crowding(share: number, tuning: Tuning): number {
    return clamp01((share - tuning.slowFrom) / Math.max(0.01, tuning.packed - tuning.slowFrom))
  }

  /**
   * How fast a rat of running speed `v0` can cross cell `c` heading (dx, dz):
   * flat out where it is open, the cell's own flow that way where it is packed,
   * and between the two in between. Never quite nothing.
   */
  private paceAt(c: number, dx: number, dz: number, v0: number, tuning: Tuning): number {
    const s = this.crowding(this.rho[c] / packedPerM2(tuning.ratRadius), tuning)
    const flow = Math.max(0, Math.min(v0, this.flowX[c] * dx + this.flowZ[c] * dz))
    return Math.max(CREEP, v0 * (1 - s) + flow * s)
  }

  /** How packed each cell is and how its rats move: each rat spread over the four nearest cell centres, then blurred. */
  private splat(): void {
    const { rho, flowX, flowZ, n, h, origin, x: px, z: pz, vx, vz, count } = this
    rho.fill(0)
    flowX.fill(0)
    flowZ.fill(0)
    for (let i = 0; i < count; i++) {
      let fx = (px[i] - origin) / h - 0.5
      let fz = (pz[i] - origin) / h - 0.5
      fx = fx < 0 ? 0 : fx > n - 1.001 ? n - 1.001 : fx
      fz = fz < 0 ? 0 : fz > n - 1.001 ? n - 1.001 : fz
      const ix = fx | 0
      const iz = fz | 0
      const ax = fx - ix
      const az = fz - iz
      const c = iz * n + ix
      const w00 = (1 - ax) * (1 - az)
      const w10 = ax * (1 - az)
      const w01 = (1 - ax) * az
      const w11 = ax * az
      rho[c] += w00
      rho[c + 1] += w10
      rho[c + n] += w01
      rho[c + n + 1] += w11
      flowX[c] += w00 * vx[i]
      flowX[c + 1] += w10 * vx[i]
      flowX[c + n] += w01 * vx[i]
      flowX[c + n + 1] += w11 * vx[i]
      flowZ[c] += w00 * vz[i]
      flowZ[c + 1] += w10 * vz[i]
      flowZ[c + n] += w01 * vz[i]
      flowZ[c + n + 1] += w11 * vz[i]
    }
    // Crowding is read over a few bodies, not one cell: a cell holds a rat or
    // two, and a map drawn from its count alone flips a route between redraws.
    for (const field of [rho, flowX, flowZ]) {
      this.smooth(field)
      this.smooth(field)
    }
    const area = 1 / (h * h)
    for (let c = 0; c < n * n; c++) {
      if (rho[c] > 1e-6) {
        flowX[c] /= rho[c]
        flowZ[c] /= rho[c]
      }
      rho[c] *= area
    }
  }

  /** A 3×3 box blur of a per-cell field, in place: twice is about three cells (75 cm) across. */
  private smooth(field: Float32Array): void {
    const { n, blurred } = this
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        let s = 0
        let w = 0
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz
          if (zz < 0 || zz >= n) continue
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx
            if (xx < 0 || xx >= n) continue
            s += field[zz * n + xx]
            w++
          }
        }
        blurred[z * n + x] = s / w
      }
    }
    field.set(blurred)
  }

  /**
   * The route map: seconds to the ring from every cell (Dijkstra over the eight
   * neighbours, outward from the ring), round the mass, round the light and
   * the strip a walking light is about to cross. It reads only how packed a
   * cell is, never which way its rats move: a map that read the flow led the
   * waiting rats round and round a ring they could not enter.
   */
  private drawMap(light: Light, tuning: Tuning, inner: number, ringIn: number, ringOut: number, walking: boolean): void {
    const { n, h, origin, rho, cost, extra, cellKind, done, heapCost, heapCell } = this
    const cells = n * n
    const packed = packedPerM2(tuning.ratRadius)
    const top = tuning.maxSpeed
    // The strip a walking light is about to cross: as wide as the ring's inner
    // edge, as long as it walks in the look-ahead.
    const lv = Math.hypot(this.was.vx, this.was.vz)
    const ux = walking ? this.was.vx / lv : 0
    const uz = walking ? this.was.vz / lv : 0
    const ahead = lv * tuning.lookAhead
    let size = 0
    const push = (c: number, v: number) => {
      let i = size++
      while (i > 0) {
        const p = (i - 1) >> 1
        if (heapCost[p] <= v) break
        heapCost[i] = heapCost[p]
        heapCell[i] = heapCell[p]
        i = p
      }
      heapCost[i] = v
      heapCell[i] = c
    }
    const pop = () => {
      const c = heapCell[0]
      const v = heapCost[--size]
      const vc = heapCell[size]
      let i = 0
      for (;;) {
        let m = 2 * i + 1
        if (m >= size) break
        if (m + 1 < size && heapCost[m + 1] < heapCost[m]) m++
        if (heapCost[m] >= v) break
        heapCost[i] = heapCost[m]
        heapCell[i] = heapCell[m]
        i = m
      }
      heapCost[i] = v
      heapCell[i] = vc
      return c
    }
    for (let cz = 0; cz < n; cz++) {
      for (let cx = 0; cx < n; cx++) {
        const c = cz * n + cx
        const dx = origin + (cx + 0.5) * h - light.x
        const dz = origin + (cz + 0.5) * h - light.z
        const D = Math.hypot(dx, dz)
        let e = 0
        if (walking && inner > 0) {
          const along = dx * ux + dz * uz
          const across = Math.abs(-dx * uz + dz * ux)
          if (along > 0 && along < ahead + ringIn && across < ringIn + tuning.ratRadius) e = PATH_COST
        }
        extra[c] = e
        cellKind[c] = D < inner ? 2 : D >= ringIn && D < ringOut && e === 0 ? 1 : 0
        done[c] = 0
        cost[c] = Infinity
        // The ring is where routes end, its fuller stretches dearer: rats make for where it has room.
        if (cellKind[c] === 1) {
          const v = tuning.discomfort * Math.min(1.5, rho[c] / packed) * tuning.band
          cost[c] = v
          push(c, v)
        }
      }
    }
    while (size > 0) {
      const c = pop()
      if (done[c]) continue
      done[c] = 1
      const cx = c % n
      const cz = (c / n) | 0
      const base = cost[c]
      for (let d = 0; d < 8; d++) {
        const bx = cx + DX[d]
        const bz = cz + DZ[d]
        if (bx < 0 || bx >= n || bz < 0 || bz >= n) continue
        const b = bz * n + bx
        if (done[b] || cellKind[b] === 2) continue
        // Crossing b costs the time to cross it at the pace its crowding allows, and its discomfort.
        const share = rho[b] / packed
        const speed = Math.max(CREEP, top * (1 - this.crowding(share, tuning)))
        const v = base + LEN[d] * h * (1 / speed + tuning.discomfort * share + extra[b])
        if (v < cost[b]) {
          cost[b] = v
          push(b, v)
        }
      }
    }
    // The light's disc and anything unreached sit above the rest, so the slope leads off them.
    let most = 0
    for (let c = 0; c < cells; c++) if (cost[c] < Infinity && cost[c] > most) most = cost[c]
    for (let c = 0; c < cells; c++) if (cost[c] === Infinity) cost[c] = most + 5
  }

  /** Sort the rats into the shared grid, by counting. */
  private buildGrid(): void {
    const { x: px, z: pz, cellOf, sorted, cellStart, cursor, count, n } = this
    cellStart.fill(0)
    for (let i = 0; i < count; i++) {
      const c = this.cellAt(px[i], pz[i])
      cellOf[i] = c
      cellStart[c + 1]++
    }
    for (let c = 1; c <= n * n; c++) cellStart[c] += cellStart[c - 1]
    cursor.set(cellStart.subarray(0, n * n))
    for (let i = 0; i < count; i++) sorted[cursor[cellOf[i]]++] = i
  }
}
