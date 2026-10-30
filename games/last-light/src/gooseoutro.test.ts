import { describe, expect, it } from 'vitest'
import { OUTRO, SHAKE, actOf, aimOf, dawnOf, ganderAt, goslingOf, layOutro, legTimes, motherAt, outroDue, peepsOf, planAt, type Cast, type Island } from './gooseoutro'
import type { Point } from './plain'

/** A round island 4 m across its middle at the origin. */
const ISLAND: Island = { middle: { x: 0, z: 0 }, shoreAt: () => 4 }
const inland = (p: Point) => Math.hypot(p.x, p.z) < 4
const CAST: Cast = {
  gander: { x: 0, z: 7 },
  mother: { x: 0.5, z: -1 },
  door: { x: 0.8, z: 0.6 },
  motherYaw: 0,
  island: [
    { x: -1, z: 1 },
    { x: 1, z: 1.5 },
    { x: 2, z: -2 },
  ],
  brood: [
    { x: -0.3, z: 7.4 },
    { x: 0.3, z: 7.4 },
    { x: 0, z: 7.5 },
  ],
}
/** Long enough for any gosling to get on to the oval it runs round them on, s. */
const JOIN_TIME = 1.5
const gap = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z)

describe('the goose game ending', () => {
  it('starts once he swims within reach of the island', () => {
    expect(outroDue(ISLAND, { x: 0, z: 4 + OUTRO.near - 0.1 })).toBe(true)
    expect(outroDue(ISLAND, { x: 0, z: 4 + OUTRO.near + 0.1 })).toBe(false)
  })

  it('walks a plan leg by leg, waiting for each to leave', () => {
    const plan = { from: { x: 0, z: 0 }, legs: [{ to: { x: 2, z: 0 }, leave: 1, pace: 1 }, { to: { x: 2, z: 2 }, leave: 0, pace: 2 }] }
    expect(legTimes(plan)).toEqual([
      { start: 1, end: 3 },
      { start: 3, end: 4 },
    ])
    expect(planAt(plan, 0.5)).toEqual({ at: { x: 0, z: 0 } })
    expect(planAt(plan, 2).at.x).toBeCloseTo(1)
    expect(planAt(plan, 2).going).toEqual({ x: 1, z: 0 })
    expect(planAt(plan, 5).at).toEqual({ x: 2, z: 2 })
  })

  it('brings him onto the island from the side he comes, and her out of her door straight at him, face to face', () => {
    const stage = layOutro(ISLAND, CAST)
    expect(stage.way.z).toBeCloseTo(1)
    expect(ganderAt(stage, 0).at).toEqual(CAST.gander)
    const there = ganderAt(stage, OUTRO.landed + 1)
    expect(inland(there.at)).toBe(true)
    const her = motherAt(stage, OUTRO.met + 1)
    expect(inland(her.at)).toBe(true)
    expect(gap(her.at, there.at)).toBeGreaterThan(0.7)
    // Through the door on her way.
    const passes = Array.from({ length: 100 }, (_, k) => motherAt(stage, (k / 100) * OUTRO.met).at)
    expect(Math.min(...passes.map((p) => gap(p, CAST.door!)))).toBeLessThan(0.05)
    // From the door, running straight at him.
    const running = motherAt(stage, OUTRO.met - 0.2)
    expect(running.running).toBe(true)
    const toHim = Math.atan2(there.at.x - running.at.x, there.at.z - running.at.z)
    expect(Math.abs(Math.atan2(Math.sin(running.yaw - toHim), Math.cos(running.yaw - toHim)))).toBeLessThan(0.02)
    // Face to face.
    const herWay = Math.atan2(there.at.x - her.at.x, there.at.z - her.at.z)
    expect(her.yaw).toBeCloseTo(herWay)
    expect(there.facing.x * (her.at.x - there.at.x) + there.facing.z * (her.at.z - there.at.z)).toBeGreaterThan(0.85)
  })

  it('keeps every bird off every other once they stand: waiting for him round where they meet, and in the ring', () => {
    for (const door of [CAST.door, undefined]) {
      for (const gander of [{ x: 0, z: 7 }, { x: 7, z: 0 }, { x: -5, z: 5 }]) {
        const stage = layOutro(ISLAND, { ...CAST, door, gander, island: [...CAST.island, { x: 0, z: 0 }], brood: [...CAST.brood, ...CAST.brood, { x: gander.x, z: gander.z + 0.4 }] })
        // The island's waiting for him as he lands; all of them in the ring.
        for (const [t, plans] of [[OUTRO.landed, stage.island], [30, [...stage.brood, ...stage.island]]] as const) {
          const adults = [ganderAt(stage, t).at, motherAt(stage, t).at]
          const young = plans.map((plan) => planAt(plan, t).at)
          for (const p of young) for (const a of adults) expect(gap(p, a)).toBeGreaterThan(0.5)
          for (let a = 0; a < young.length; a++) for (let b = a + 1; b < young.length; b++) expect(gap(young[a]!, young[b]!)).toBeGreaterThan(0.25)
        }
      }
    }
  })

  it('has every gosling running round the two of them as they meet, all one way, on the island, none on another', () => {
    const stage = layOutro(ISLAND, CAST)
    const all = [...stage.brood, ...stage.island]
    for (let t = OUTRO.settle - 1; t < OUTRO.settle - 0.01; t += 0.1) {
      const adults = [ganderAt(stage, t).at, motherAt(stage, t).at]
      const young = all.map((plan) => planAt(plan, t))
      for (const { at, going } of young) {
        expect(inland(at)).toBe(true)
        for (const a of adults) expect(gap(at, a)).toBeGreaterThan(0.5)
        // Round them, never at them or away.
        const dx = at.x - stage.pair.x
        const dz = at.z - stage.pair.z
        const turn = (dx * going!.z - dz * going!.x) / Math.hypot(dx, dz)
        expect(Math.abs(turn)).toBeGreaterThan(0.5)
      }
      for (let a = 0; a < young.length; a++) for (let b = a + 1; b < young.length; b++) expect(gap(young[a]!.at, young[b]!.at)).toBeGreaterThan(0.25)
    }
    // The island's run from soon after the two of them meet.
    stage.island.forEach((plan) => expect(planAt(plan, OUTRO.met + OUTRO.stagger + JOIN_TIME).going).toBeDefined())
  })

  it("has the island's goslings running round the two of them from soon after they meet, even from across the island", () => {
    const stage = layOutro(ISLAND, { ...CAST, island: [{ x: -2, z: -3 }, { x: 1, z: -3.5 }, { x: 3, z: -1.5 }] })
    for (const plan of stage.island) {
      for (let t = OUTRO.met + OUTRO.stagger + JOIN_TIME; t < OUTRO.settle; t += 0.1) expect(planAt(plan, t).going).toBeDefined()
    }
  })

  it('has every gosling go round the two of them once he is ashore, never through them', () => {
    for (const gander of [{ x: 0, z: 7 }, { x: 7, z: 0 }, { x: -5, z: 5 }, { x: 0, z: -7 }]) {
      const stage = layOutro(ISLAND, { ...CAST, gander, island: [...CAST.island, { x: -gander.x * 0.4, z: -gander.z * 0.4 }, { x: gander.z * 0.4, z: -gander.x * 0.4 }] })
      for (let t = OUTRO.landed; t < 20; t += 0.05) {
        const adults = [ganderAt(stage, t).at, ...(t >= OUTRO.met ? [motherAt(stage, t).at] : [])]
        for (const plan of [...stage.brood, ...stage.island]) for (const a of adults) expect(gap(planAt(plan, t).at, a)).toBeGreaterThan(0.45)
      }
    }
  })

  it('turns the goslings to the two of them in the ring, each a little off', () => {
    const stage = layOutro(ISLAND, CAST)
    const { at, face } = goslingOf(stage, false, 0, 30)
    const off = face! - Math.atan2(stage.pair.x - at.x, stage.pair.z - at.z)
    expect(Math.abs(Math.atan2(Math.sin(off), Math.cos(off)))).toBeLessThanOrEqual(0.5)
  })

  it('gets her up off the nest before she runs, and there before the goslings gather', () => {
    const stage = layOutro(ISLAND, CAST)
    expect(motherAt(stage, 0)).toMatchObject({ at: CAST.mother, up: 0, running: false })
    expect(motherAt(stage, OUTRO.risen - 0.01).running).toBe(false)
    expect(motherAt(stage, (OUTRO.risen + OUTRO.met) / 2)).toMatchObject({ up: 1, running: true })
    expect(motherAt(stage, OUTRO.met).at.z).toBeCloseTo(stage.mother.to.z)
  })

  it('brings his goslings ashore after him, each shaking dry before it goes to the ring', () => {
    const stage = layOutro(ISLAND, CAST)
    stage.brood.forEach((plan, k) => {
      const ashore = stage.shakes[k]!
      expect(ashore).toBeGreaterThan(OUTRO.landed - 0.5)
      expect(inland(planAt(plan, ashore).at)).toBe(true)
      expect(actOf(stage, true, k, ashore + SHAKE / 2)?.clip).toBe('shake')
      expect(legTimes(plan)[2]!.start).toBeGreaterThanOrEqual(ashore + SHAKE)
    })
  })

  it('gathers every gosling, his and hers, in a ring round the two of them, none on another', () => {
    const stage = layOutro(ISLAND, CAST)
    const late = 30
    const ring = [...stage.brood, ...stage.island].map((plan) => planAt(plan, late).at)
    const him = ganderAt(stage, late).at
    const her = motherAt(stage, late).at
    for (const p of ring) {
      expect(inland(p)).toBe(true)
      expect(gap(p, him)).toBeGreaterThan(0.4)
      expect(gap(p, her)).toBeGreaterThan(0.4)
    }
    for (let a = 0; a < ring.length; a++) for (let b = a + 1; b < ring.length; b++) expect(gap(ring[a]!, ring[b]!)).toBeGreaterThan(0.3)
  })

  it('has every gosling hop in the ring, off the ground mid-hop', () => {
    const stage = layOutro(ISLAND, CAST)
    const hops = Array.from({ length: 200 }, (_, k) => actOf(stage, false, 0, OUTRO.settle + k * 0.05)).filter((act) => act?.clip === 'jump')
    expect(hops.length).toBeGreaterThan(0)
    expect(Math.max(...hops.map((act) => act!.lift))).toBeGreaterThan(0.05)
  })

  it('has every gosling peep a short run in the ring, each starting at its own time, before the night fades out', () => {
    const stage = layOutro(ISLAND, CAST)
    const runs = [...CAST.brood.map((_, k) => peepsOf(stage, true, k)), ...CAST.island.map((_, j) => peepsOf(stage, false, j))]
    for (const peeps of runs) {
      expect(peeps.length).toBeGreaterThanOrEqual(2)
      expect(peeps.length).toBeLessThanOrEqual(3)
      for (let p = 1; p < peeps.length; p++) expect(peeps[p]! - peeps[p - 1]!).toBeGreaterThan(0.1)
      expect(Math.max(...peeps)).toBeLessThan(OUTRO.fade[0])
    }
    const starts = runs.map((peeps) => peeps[0]!).sort((a, b) => a - b)
    for (let s = 1; s < starts.length; s++) expect(starts[s]! - starts[s - 1]!).toBeGreaterThan(0.02)
  })

  it('looks to the pair, brings the dawn up, and holds both at the end', () => {
    expect(aimOf(0)).toBe(0)
    expect(aimOf(OUTRO.landed)).toBe(1)
    expect(dawnOf(OUTRO.dawn[0])).toBe(0)
    expect(dawnOf(OUTRO.end)).toBe(1)
  })
})
