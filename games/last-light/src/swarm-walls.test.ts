// The swarm on a level's ground (#175), through its own calls only: walls no
// rat and not the holder crosses, light that stops at them, rats that do not
// notice a holder too far off, and rats that start wherever the level is
// dark. What is lit is worked out here on its own, a straight line from the
// light to the rat that no wall's box cuts, and never read from the swarm.
// And a fragile flame (#177), the run and the swarm stepped together as the
// page steps them: the rats overrun it, and once it is out they take its ground.
import { describe, expect, it } from 'vitest'
import { Run, defaultRunTuning, type Level } from './run'
import { defaultTuning, FLICKER, leastRadius, Swarm, type Bounds, type FixedLight, type Light, type StepReport, type Tuning } from './swarm'
import { STEP } from './swarm-remote'
import { HOLDER_RADIUS, WALL_THICKNESS, type Wall } from './walls'

const DT = 1 / 60
const SEED = 7
const HALF = WALL_THICKNESS / 2

const wall = (ax: number, az: number, bx: number, bz: number): Wall => ({ from: { x: ax, z: az }, to: { x: bx, z: bz } })

/** Whether the straight line from (ox, oz) to (x, z) touches wall `w`'s box anywhere, ends included. */
function touches(w: Wall, ox: number, oz: number, x: number, z: number): boolean {
  const dx = w.to.x - w.from.x
  const dz = w.to.z - w.from.z
  const length = Math.hypot(dx, dz)
  const ux = dx / length
  const uz = dz / length
  // Both ends in the wall's frame: along it, and across it.
  const u0 = (ox - w.from.x) * ux + (oz - w.from.z) * uz
  const v0 = (ox - w.from.x) * -uz + (oz - w.from.z) * ux
  const u1 = (x - w.from.x) * ux + (z - w.from.z) * uz
  const v1 = (x - w.from.x) * -uz + (z - w.from.z) * ux
  // Clipped to the box, a hair inside it.
  let enter = 0
  let leave = 1
  for (const [p, q0, lo, hi] of [
    [u1 - u0, u0, 1e-6, length - 1e-6],
    [v1 - v0, v0, -HALF + 1e-6, HALF - 1e-6],
  ] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q0 < lo || q0 > hi) return false
      continue
    }
    const a = (lo - q0) / p
    const b = (hi - q0) / p
    enter = Math.max(enter, Math.min(a, b))
    leave = Math.min(leave, Math.max(a, b))
  }
  return enter <= leave
}

/**
 * Whether (x, z) is lit by a light at (lx, lz) reaching `reach`: within it,
 * and no wall between, nor between the light and a point 5 cm either side
 * of it; a hair from a shadow's edge is neither.
 */
function litBy(walls: readonly Wall[], lx: number, lz: number, reach: number, x: number, z: number): boolean {
  const d = Math.hypot(x - lx, z - lz)
  if (d >= reach) return false
  const sx = (-(z - lz) / d) * 0.05
  const sz = ((x - lx) / d) * 0.05
  return !walls.some((w) => touches(w, lx, lz, x, z) || touches(w, lx, lz, x + sx, z + sz) || touches(w, lx, lz, x - sx, z - sz))
}

/** A swarm of `count` on `walls`, stepped `seconds` under `light` and `lights`, each step handed to `each` with where every rat was before it. */
function onGround(count: number, walls: Wall[], tuning: Tuning = defaultTuning(), bounds?: Bounds, start: FixedLight[] = []) {
  const swarm = new Swarm(count, SEED, 1, { walls, bounds, lights: start })
  swarm.reset(count)
  const step = (seconds: number, light: Light, lights: FixedLight[] = [], each?: (x: Float32Array, z: Float32Array) => void) => {
    let report!: StepReport
    for (let t = 0; t < seconds - 1e-9; t += DT) {
      const x = swarm.x.slice(0, swarm.count)
      const z = swarm.z.slice(0, swarm.count)
      report = swarm.step(DT, light, tuning, undefined, lights)
      each?.(x, z)
    }
    return report
  }
  return { swarm, step, tuning }
}

describe('walls', () => {
  it('let no rat and not the holder cross them, at any speed and density', () => {
    // A room open to the west, a long wall, and one on a slant: the light walks its loop through them, then goes out and the swarm packs on the holder.
    const walls = [wall(2, -2, 6, -2), wall(6, -2, 6, 2), wall(6, 2, 2, 2), wall(-8, -3, -1, -3), wall(-6, 4, -2, 8)]
    const tuning = { ...defaultTuning(), minSpeed: 4, maxSpeed: 12, agitation: 1 }
    const { swarm, step } = onGround(4000, walls, tuning)
    const light: Light = { x: 0, z: 0, strength: 0.5, on: true }
    let crossings = 0
    let holderCrossings = 0
    const watch = (x: Float32Array, z: Float32Array) => {
      for (let i = 0; i < swarm.count; i++) for (const w of walls) if (touches(w, x[i]!, z[i]!, swarm.x[i]!, swarm.z[i]!)) crossings++
    }
    for (let t = 0; t < 25; t += DT) {
      if (t > 18) light.on = false
      const hx = light.x
      const hz = light.z
      swarm.walkLight(light, swarm.loopPoint(t * 2), DT, 6)
      // The holder's own body keeps off the walls too: its path, widened by it, touches no wall.
      for (const w of walls) if (touches(w, hx, hz, light.x, light.z) || Math.hypot(...nearestOn(w, light.x, light.z)) < HALF + HOLDER_RADIUS - 1e-4) holderCrossings++
      step(DT, light, [], watch)
    }
    expect(crossings).toBe(0)
    expect(holderCrossings).toBe(0)
  })

  it("cast a shadow beside a light: rats stand in it inside the light's reach, and none stands in what the light sees", () => {
    // A light at the origin, a wall a metre east of it, and the holder, its torch out, four metres east: the swarm packs on the holder, round the wall.
    const walls = [wall(1, -1.5, 1, 1.5)]
    const lights: FixedLight[] = [{ x: 0, z: 0, reach: 2.5, on: true }]
    const { swarm, step } = onGround(3000, walls)
    const light: Light = { x: 4, z: 0, strength: 1, on: false }
    step(20, light, lights)
    const report = step(1, light, lights)
    expect(report.inside).toBe(0)
    let shaded = 0
    let lit = 0
    for (let i = 0; i < swarm.count; i++) {
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      const d = Math.hypot(x, z)
      if (d < 2.5 * (1 - FLICKER) && x > 1 && walls.some((w) => touches(w, 0, 0, x, z))) shaded++
      if (litBy(walls, 0, 0, 2.5 * (1 - FLICKER), x, z)) lit++
    }
    expect(shaded).toBeGreaterThan(20)
    expect(lit).toBe(0)
  })

  it("cut the torch's lit area as it walks along them: rats keep to the wall's far side right beside the holder", () => {
    const walls = [wall(1.2, -14, 1.2, 14)]
    const { swarm, step, tuning } = onGround(3000, walls)
    const light: Light = { x: 0, z: -6, strength: 1, on: true }
    step(10, light)
    for (let t = 0; t < 12; t += DT) {
      swarm.walkLight(light, { x: 0, z: 6 }, DT, 1)
      step(DT, light)
    }
    step(3, light)
    let beside = 0
    let lit = 0
    for (let i = 0; i < swarm.count; i++) {
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      if (x > 1.2 && Math.hypot(x - light.x, z - light.z) < 2.5) beside++
      if (litBy(walls, light.x, light.z, leastRadius(light, tuning), x, z)) lit++
    }
    expect(beside).toBeGreaterThan(15)
    expect(lit).toBe(0)
  })
})

describe('a rat far from the holder', () => {
  /** How far, on average, the rats that start more than nine metres off close on the holder over four seconds. */
  function closing(notice: number): number {
    const tuning = { ...defaultTuning(), notice }
    const swarm = new Swarm(2000, SEED)
    swarm.reset(2000)
    const light: Light = { x: 0, z: 0, strength: 1, on: true }
    const far: number[] = []
    const before: number[] = []
    for (let i = 0; i < swarm.count; i++) {
      const d = Math.hypot(swarm.x[i]!, swarm.z[i]!)
      if (d > 9) {
        far.push(i)
        before.push(d)
      }
    }
    for (let t = 0; t < 4; t += DT) swarm.step(DT, light, tuning)
    return far.reduce((sum, i, k) => sum + before[k]! - Math.hypot(swarm.x[i]!, swarm.z[i]!), 0) / far.length
  }

  it('does not run at it past the noticing distance: it seethes where it is', () => {
    expect(closing(Infinity)).toBeGreaterThan(3)
    expect(Math.abs(closing(6))).toBeLessThan(0.5)
  })
})

describe("the level's rats", () => {
  it('start everywhere its box is dark: in it, out of every wall, and out of every light', () => {
    const walls = [wall(-4, -4, 4, -4), wall(4, -4, 4, 4), wall(0, 2, 0, 9)]
    const start: FixedLight[] = [
      { x: 2, z: 0, reach: 2, on: true },
      { x: -6, z: 6, reach: 1.5, on: true },
    ]
    const bounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
    const { swarm } = onGround(3000, walls, defaultTuning(), bounds, start)
    let outside = 0
    let walled = 0
    let lit = 0
    const quarters = [0, 0, 0, 0]
    for (let i = 0; i < swarm.count; i++) {
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) outside++
      if (walls.some((w) => Math.hypot(...nearestOn(w, x, z)) < HALF)) walled++
      if (start.some((l) => litBy(walls, l.x, l.z, l.reach * (1 + FLICKER), x, z))) lit++
      quarters[(x > 0 ? 1 : 0) + (z > 0 ? 2 : 0)]!++
    }
    expect(outside).toBe(0)
    expect(walled).toBe(0)
    expect(lit).toBe(0)
    for (const q of quarters) expect(q).toBeGreaterThan(swarm.count * 0.15)
  })
})

describe('a fragile flame', () => {
  it('is overrun by the rats the holder draws on to it, goes out, and keeps no rats out from then on', () => {
    // The holder, its torch burning steady, and a fragile flame a metre and a half off its edge, in the mass.
    const level: Level = {
      start: { x: 0, z: 0 },
      lights: [{ x: 2.4, z: 0, reach: 1, flame: true, on: true, fragile: true }],
      walls: [],
      wind: [],
      bounds: { minX: -16, maxX: 16, minZ: -16, maxZ: 16 },
    }
    const run = new Run(level, { ...defaultRunTuning(), burnRate: 0 })
    // The game's crowd, as the page tunes it: what the run's overrun is set against.
    const game = { ...defaultTuning(), gap: 0.2, agitation: 1, pile: 2, pileRamp: 5.5, ratRadius: 0.07 * 1.75 }
    const { swarm, tuning } = onGround(3000, [], game, level.bounds, run.lights())
    const torch: Light = { x: 0, z: 0, strength: run.torch.reach / tuning.ringMax, on: true }
    const flame = level.lights[0]!
    const near = (radius: number) => {
      let n = 0
      for (let i = 0; i < swarm.count; i++) if (Math.hypot(swarm.x[i] - flame.x, swarm.z[i] - flame.z) < radius) n++
      return n
    }
    /** Step the swarm and the run together for `seconds`, the run reading what each step counted; how long until the flame went out. */
    const play = (seconds: number) => {
      let out = Infinity
      for (let t = 0; t < seconds - 1e-9; t += DT) {
        const report = swarm.step(DT, torch, tuning, undefined, run.lights())
        run.step({ dt: DT, toward: null, speed: 0, arena: swarm.arena, interact: false, reached: report.reached, atLights: report.atLights })
        if (!run.lights()[0]!.on) out = Math.min(out, t)
      }
      return out
    }
    // Lit, it holds them off as any light does, until enough press on it.
    const out = play(20)
    expect(out).toBeGreaterThan(0.5)
    expect(out).toBeLessThan(20)
    // Out, it stays out, and the rats move into the ground it lit.
    play(6)
    expect(run.lights()[0]!.on).toBe(false)
    expect(near(flame.reach * 0.8)).toBeGreaterThan(20)
  })
})

describe('the step on a level', () => {
  it('keeps within its budget, a step every sixtieth of a second, with two dozen walls and eight lights', () => {
    const count = 8192
    // A maze of short walls over the arena.
    const walls: Wall[] = []
    for (let k = 0; k < 24; k++) {
      const x = ((k % 6) - 2.5) * 6
      const z = (Math.floor(k / 6) - 1.5) * 7
      walls.push(k % 2 ? wall(x - 2, z, x + 2, z) : wall(x, z - 2, x, z + 2))
    }
    const lights: FixedLight[] = Array.from({ length: 8 }, (_, k) => ({ x: Math.cos(k) * 5, z: Math.sin(k) * 5, reach: 1.5, on: true }))
    const { swarm, step } = onGround(count, walls)
    const light: Light = { x: 0, z: 0, strength: 1, on: true }
    step(3, light, lights)
    let ms = 0
    const steps = 60
    for (let s = 0; s < steps; s++) {
      swarm.walkLight(light, { x: 10, z: 0 }, DT)
      ms += step(DT, light, lights).ms
    }
    expect(ms / steps).toBeLessThan(STEP * 1000)
  })
})

/** From (x, z) to the nearest point of wall `w`'s middle line, as (dx, dz). */
function nearestOn(w: Wall, x: number, z: number): [number, number] {
  const dx = w.to.x - w.from.x
  const dz = w.to.z - w.from.z
  const length2 = dx * dx + dz * dz
  const t = Math.max(0, Math.min(1, ((x - w.from.x) * dx + (z - w.from.z) * dz) / length2))
  return [x - w.from.x - dx * t, z - w.from.z - dz * t]
}
