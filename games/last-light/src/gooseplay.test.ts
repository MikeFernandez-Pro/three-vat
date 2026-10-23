// The goose play on the seed's plain (#187): walked on the keys, a sixtieth of
// a second a frame, as a player holding the keys toward each brazier in turn
// would, with no browser. What is checked is what the player would see: where
// the goose is, how much torch she has, which goslings are in the circle and
// where, which were taken and when, and whether the run has ended, with what
// count.
import { describe, expect, it } from 'vitest'
import { CAGE_CAMPFIRE, GOSLING_RADIUS, GOSLING_TOP, GoosePlay, HOP, LOG_FOLLOW, LOG_THUNDER, TRUNK, WELL_BODIES, WELL_OUTLINE, WELL_RADIUS, WELL_REACH, cartOf, type Cage, type GooseSettings, type HollowLog } from './gooseplay'
import { HOLDER_RADIUS, within } from './walls'
import { WELL_LANTERN, type Brazier, type Point } from './plain'
import { STEP } from './swarm-remote'
import { FLICKER, shoreLight } from './swarm'

/** How near a brazier the walker stops, m: inside the torch's dip. */
const AT = 0.5

/** Walk the goose toward `to`, a frame at a time, until within `r` or `most` seconds on; whether she got there. `each` is told of every frame. */
function walkTo(play: GoosePlay, to: Point, r = AT, most = 60, each: (play: GoosePlay) => void = () => {}): boolean {
  for (let t = 0; t < most; t += STEP) {
    const h = play.holder
    const d = Math.hypot(to.x - h.x, to.z - h.z)
    if (d <= r) return true
    play.frame(STEP, { heading: { x: (to.x - h.x) / d, z: (to.z - h.z) / d } })
    each(play)
  }
  return false
}

/** How far `p` is off the outline of `well`'s body, m: less than none inside it. */
function offWell(well: Point, p: Point, outline: readonly Point[] = WELL_OUTLINE): number {
  const x = p.x - well.x
  const z = p.z - well.z
  let best = Infinity
  for (let k = 0, j = outline.length - 1; k < outline.length; j = k++) {
    const a = outline[j]!
    const ex = outline[k]!.x - a.x
    const ez = outline[k]!.z - a.z
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)))
    best = Math.min(best, Math.hypot(x - a.x - ex * t, z - a.z - ez * t))
  }
  return within(outline, x, z) ? -best : best
}

/** How far `p` is off the nearest of `well`'s bodies, the well and its lantern's foot, m: less than none inside one. */
const offBodies = (well: Point, p: Point) => Math.min(...WELL_BODIES.map(({ outline }) => offWell(well, p, outline)))

/** Stand still `seconds`, `each` told of every frame. */
function stand(play: GoosePlay, seconds: number, each: (play: GoosePlay) => void = () => {}): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    play.frame(STEP, { heading: null })
    each(play)
  }
}

/** Hold the interact key `seconds`, standing, `each` told of every frame. */
function hold(play: GoosePlay, seconds: number, each: (play: GoosePlay) => void = () => {}): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) {
    play.frame(STEP, { heading: null, interact: true })
    each(play)
  }
}

/** How near the well the walker stands to winch, m, inside its reach; and how far east of its middle it goes round it, m. */
const AT_WELL = 1.3
const ROUND_WELL = 2.4

/** How near the cage's middle the walker stands to open it, m; and how near its key to pick it up, m. */
const AT_CAGE = 0.8
const ON_KEY = 0.3

/** Hold the interact key at the cage, carrying its key, as long as it takes to unlock, `each` told of every frame. */
function unlock(play: GoosePlay, each: (play: GoosePlay) => void = () => {}): void {
  hold(play, play.settings.cageHold + STEP, each)
}

/** The cage's state. */
function cageOf(play: GoosePlay): Cage {
  const cage = play.scenes.find((s) => s.kind === 'cage')
  if (cage?.kind !== 'cage') throw new Error('no cage')
  return cage
}
/** Where the walker stands at the log's `end`, its middle `middle`: half a metre out past it, along its line, as a player stands at it. */
function offEnd(middle: Point, end: Point): Point {
  const ux = end.x - middle.x
  const uz = end.z - middle.z
  const d = Math.hypot(ux, uz)
  return { x: end.x + (ux / d) * 0.5, z: end.z + (uz / d) * 0.5 }
}

/** Walk to brazier `b`'s place and play its scene as a player would: the torch filled there with the interact key, at the well's lantern and the well winched up, at the tree its gosling called down and the torch filled at the brazier by it, at the cage its key fetched from beside the body and the cage opened, at the log struck coming near, the torch filled at its fire, its gosling called out at its near end and waited for. Whether she got there. */
function visit(play: GoosePlay, b: Brazier, each: (play: GoosePlay) => void = () => {}): boolean {
  if (!walkTo(play, b, AT, 60, each)) return false
  if (b.scene === undefined) hold(play, play.settings.refillHold + STEP, each)
  if (b.scene === 'well') {
    if (!fillAtLantern(play, b, each)) return false
    if (!walkTo(play, b.gosling, AT_WELL, 60, each)) return false
    hold(play, play.settings.wellHold + STEP, each)
    if (!pastWell(play, b, each)) return false
  }
  if (b.scene === 'tree') {
    hold(play, play.settings.treeHold + STEP, each)
    stand(play, play.settings.treeJump + STEP, each)
    // The tree never burns: the torch is filled at the brazier by it.
    if (!fillAt(play, treeFire(play), each)) return false
  }
  if (b.scene === 'cage') {
    hold(play, play.settings.refillHold + STEP, each)
    if (!walkTo(play, cageOf(play).key, ON_KEY, 60, each)) return false
    hold(play, STEP, each)
    if (!walkTo(play, b.gosling, AT_CAGE, 60, each)) return false
    unlock(play, each)
  }
  if (b.scene === 'log') {
    // It has no brazier: struck on the way to its place, the torch is filled at its fire, on its far end.
    if (!fillAt(play, offEnd(b.gosling, b.log!.far), each)) return false
    if (!walkTo(play, b, AT, 60, each)) return false
    if (!walkTo(play, offEnd(b.gosling, b.log!.near), AT, 60, each)) return false
    hold(play, play.settings.logHold + STEP, each)
    stand(play, LOG_FOLLOW + 2, each)
  }
  return true
}

/** Where the brazier by the dead tree stands. */
function treeFire(play: GoosePlay): Point {
  const tree = play.scenes.find((s) => s.kind === 'tree')
  if (tree?.kind !== 'tree') throw new Error('no tree')
  return tree.fire
}

/** At the fire at `at`, in its dip: the torch filled with the interact key. Whether she got there. */
function fillAt(play: GoosePlay, at: Point, each: (play: GoosePlay) => void = () => {}): boolean {
  if (!walkTo(play, at, AT, 60, each)) return false
  hold(play, play.settings.refillHold + STEP, each)
  return true
}

/** At the well of brazier `b`, its light its lantern's: the torch filled at the lantern's foot with the interact key. Whether she got there. */
function fillAtLantern(play: GoosePlay, b: Brazier, each: (play: GoosePlay) => void = () => {}): boolean {
  const zone = play.refillZoneOf(b.gosling)
  if (!walkTo(play, zone, Math.min(zone.rx, zone.rz) - 0.2, 60, each)) return false
  hold(play, play.settings.refillHold + STEP, each)
  return true
}

/** From the well's brazier, on round the well's end, past its posts and crank, as a player would: it stands in the way up the plain, its lantern's foot beside it. Whether she got there. */
function pastWell(play: GoosePlay, b: Brazier, each: (play: GoosePlay) => void = () => {}): boolean {
  return walkTo(play, { x: b.gosling.x + ROUND_WELL, z: b.gosling.z + 1.3 }, AT, 60, each) && walkTo(play, { x: b.gosling.x + ROUND_WELL, z: b.gosling.z }, AT, 60, each)
}

/** Walk her by the home point into the pond until the run ends, `most` seconds at most; whether it ended. */
function wadeHome(play: GoosePlay, most = 60): boolean {
  walkTo(play, play.plain.home, 0.05, most)
  walkTo(play, play.plain.pond, 0.05, 5)
  return play.ended
}

const circleOf = (play: GoosePlay) => play.goslings.filter((g) => g.state === 'circle')

/** Her circle stands close behind her, in an arc round her back: none more than a step ahead of her sides, none past a metre, and, three or more, spread round, not in a line. */
function expectArcBehind(play: GoosePlay): void {
  const { holder, facing } = play
  const circle = circleOf(play)
  for (const g of circle) {
    expect((g.x - holder.x) * facing.x + (g.z - holder.z) * facing.z).toBeLessThan(0.15)
    expect(Math.hypot(g.x - holder.x, g.z - holder.z)).toBeLessThan(1)
  }
  if (circle.length < 3) return
  const angles = circle.map((g) => Math.atan2(g.z - holder.z, g.x - holder.x))
  const back = Math.atan2(-facing.z, -facing.x)
  const off = angles.map((a) => Math.atan2(Math.sin(a - back), Math.cos(a - back)))
  expect(Math.max(...off) - Math.min(...off)).toBeGreaterThan(Math.PI / 3)
}

/** A few rats, for the walks that are about the goslings. */
const FEW: Partial<GooseSettings> = { rats: 200, seed: 3 }

describe('the goose play', () => {
  it('lays the same plain for the same seed', () => {
    expect(new GoosePlay({ ...FEW, seed: 9 }).plain).toEqual(new GoosePlay({ ...FEW, seed: 9 }).plain)
  })

  it('keeps every brazier within a full torch of the last at its walking pace', () => {
    const play = new GoosePlay(FEW)
    const full = play.settings.pace / play.runTuning.burnRate
    const { start, braziers } = play.plain
    ;[start, ...braziers].slice(1).forEach((b, k) => {
      const was = [start, ...braziers][k]!
      expect(Math.hypot(b.x - was.x, b.z - was.z)).toBeLessThan(full)
    })
  })

  it('starts her alone, with a full torch, every gosling waiting in its brazier\'s light', () => {
    const play = new GoosePlay(FEW)
    expect(play.run.torch.lit).toBe(true)
    expect(circleOf(play)).toHaveLength(0)
    play.goslings.forEach((g, k) => {
      expect(g.state).toBe('waiting')
      const b = play.plain.braziers[k]!
      expect(Math.hypot(g.x - b.x, g.z - b.z)).toBeLessThan(b.reach)
    })
  })

  it('refuels at each brazier walked into only while the interact key is held there, and gathers its gosling there, the scenes played on the way', () => {
    const play = new GoosePlay(FEW)
    play.plain.braziers.forEach((b, k) => {
      if (b.scene !== undefined) return expect(visit(play, b)).toBe(true)
      expect(walkTo(play, b)).toBe(true)
      expect(play.run.torch.lit).toBe(true)
      // In its dip, nothing fills the torch unheld: she is told to hold.
      const fuel = play.run.fuel
      stand(play, 0.5)
      expect(play.run.fuel).toBeLessThan(fuel)
      expect(play.atRefill).toBe(true)
      // Held, it fills over the set time, and there is nothing more to do there.
      hold(play, play.settings.refillHold + STEP)
      expect(play.run.fuel).toBeCloseTo(1, 2)
      expect(play.atRefill).toBe(false)
      expect(play.goslings[k]!.state).toBe('circle')
      expect(circleOf(play)).toHaveLength(k + 1)
    })
  })

  it('keeps each gosling of her circle in her light at a walk, once it has come over to her', () => {
    const play = new GoosePlay(FEW)
    const came = new Set<number>()
    let checked = 0
    const inside = (p: GoosePlay) => {
      p.goslings.forEach((g, k) => {
        // Climbing out of the well, it has not come over to her yet.
        if (g.state !== 'circle' || p.hopOf(k) !== null) return
        const d = Math.hypot(g.x - p.holder.x, g.z - p.holder.z)
        if (!came.has(k)) {
          if (d < p.run.torch.reach) came.add(k)
          return
        }
        expect(d).toBeLessThan(p.run.torch.reach)
        checked++
      })
    }
    for (const b of play.plain.braziers) expect(visit(play, b, inside)).toBe(true)
    expect(checked).toBeGreaterThan(1000)
    // Close behind her, in an arc round her back: none ahead of her, and not strung out in a line.
    stand(play, 2)
    expectArcBehind(play)
  })

  it('gives her as many goslings as the number key asks, the rest back at their braziers, and they take their places behind her', () => {
    const play = new GoosePlay(FEW)
    play.giveGoslings(4)
    expect(play.circle).toBe(4)
    stand(play, 2)
    expectArcBehind(play)
    play.giveGoslings(2)
    expect(play.circle).toBe(2)
    play.goslings.forEach((g, k) => {
      if (k < 2) return expect(g.state).toBe('circle')
      expect(g.state).toBe('waiting')
      const { gosling } = play.plain.braziers[k]!
      expect(Math.hypot(g.x - gosling.x, g.z - gosling.z)).toBe(0)
    })
    // More than there are: every one of them.
    play.giveGoslings(99)
    expect(play.circle).toBe(play.goslings.length)
  })

  it('brings each gosling to rest at its place while she stands, and sets it off again as she walks', () => {
    const play = new GoosePlay(FEW)
    const [first, second] = play.plain.braziers
    for (const b of [first!, second!]) expect(visit(play, b)).toBe(true)
    stand(play, 3)
    const at = play.goslings.map((g) => ({ x: g.x, z: g.z }))
    stand(play, 3)
    play.goslings.forEach((g, k) => expect(Math.hypot(g.x - at[k]!.x, g.z - at[k]!.z)).toBe(0))
    walkTo(play, { x: second!.x, z: second!.z - 3 }, 0.1)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - at[play.goslings.indexOf(g)]!.x, g.z - at[play.goslings.indexOf(g)]!.z)).toBeGreaterThan(1)
  })

  it('walks each gosling on its own legs, never faster than its top pace: running, she leaves them behind, and they catch up once she stops', () => {
    const play = new GoosePlay({ ...FEW, pace: 4 })
    const was = play.goslings.map((g) => ({ x: g.x, z: g.z }))
    let fastest = 0
    let behind = 0
    const legs = (p: GoosePlay) => {
      p.goslings.forEach((g, k) => {
        // Hopping out of the well or down from the tree, it is in the air, not on its legs.
        if (p.hopOf(k) === null) fastest = Math.max(fastest, Math.hypot(g.x - was[k]!.x, g.z - was[k]!.z) / STEP)
        was[k]!.x = g.x
        was[k]!.z = g.z
        if (g.state === 'circle') behind = Math.max(behind, Math.hypot(g.x - p.holder.x, g.z - p.holder.z))
      })
    }
    for (const b of play.plain.braziers.slice(0, 3)) expect(visit(play, b, legs)).toBe(true)
    expect(fastest).toBeLessThanOrEqual(GOSLING_TOP[1]! + 1e-6)
    expect(behind).toBeGreaterThan(play.run.torch.reach)
    // The well's gosling, gathered first, is left furthest behind: some 28 m at her run.
    stand(play, 30, legs)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - play.holder.x, g.z - play.holder.z)).toBeLessThan(1)
  })

  it('in the dark, after the grace, loses a gosling, then one each interval, until she dips the torch in a flame', () => {
    const play = new GoosePlay({ ...FEW, grace: 2, interval: 3 })
    const [first, second, third] = play.plain.braziers
    for (const b of [first!, second!, third!]) expect(visit(play, b)).toBe(true)
    expect(circleOf(play)).toHaveLength(3)
    // On out of the brazier's light into the dark, and the torch burnt down fast.
    expect(walkTo(play, { x: third!.x + 4, z: third!.z }, 0.1)).toBe(true)
    play.runTuning.burnRate = 1
    let outAt = Number.NaN
    stand(play, 20, (p) => {
      if (Number.isNaN(outAt) && !p.run.torch.lit) outAt = p.t
    })
    // All three taken, the first a grace after the torch went out, each next an interval after the last.
    expect(play.takings).toHaveLength(3)
    expect(play.takings[0]!.at - outAt).toBeCloseTo(2, 1)
    expect(play.takings[1]!.at - play.takings[0]!.at).toBeCloseTo(3, 1)
    expect(play.takings[2]!.at - play.takings[1]!.at).toBeCloseTo(3, 1)
    expect(circleOf(play)).toHaveLength(0)
  })

  it('stops the toll at a flame, never gives a taken gosling back, and counts her home without it', () => {
    const play = new GoosePlay({ ...FEW, grace: 2, interval: 3 })
    const [first, second, third, fourth] = play.plain.braziers
    for (const b of [first!, second!, third!]) expect(visit(play, b)).toBe(true)
    expect(walkTo(play, { x: third!.x + 4, z: third!.z }, 0.1)).toBe(true)
    play.runTuning.burnRate = 1
    stand(play, 3.5)
    expect(play.run.torch.lit).toBe(false)
    expect(play.takings).toHaveLength(1)
    const taken = play.takings[0]!
    expect(play.goslings[taken.gosling]!.state).toBe('taken')
    // Back into the flame, at the dead tree the brazier by it: the torch lit again, and the toll stops, however long she stays.
    play.runTuning.burnRate = 1 / 25
    if (third!.scene === 'well') expect(walkTo(play, third!) && fillAtLantern(play, third!)).toBe(true)
    else expect(fillAt(play, third!.scene === 'tree' ? treeFire(play) : third!)).toBe(true)
    stand(play, 10)
    expect(play.run.torch.lit).toBe(true)
    expect(play.takings).toHaveLength(1)
    expect(circleOf(play)).toHaveLength(2)
    // On to the next brazier and the one after: the taken one stays taken, where it was taken.
    if (third!.scene === 'well') expect(pastWell(play, third!)).toBe(true)
    expect(visit(play, fourth!)).toBe(true)
    for (const b of play.plain.braziers.slice(4)) expect(visit(play, b)).toBe(true)
    expect(play.goslings[taken.gosling]!.state).toBe('taken')
    expect(play.goslings[taken.gosling]).toMatchObject({ x: taken.x, z: taken.z })
    expect(circleOf(play)).toHaveLength(play.goslings.length - 1)
    // Home with one fewer.
    expect(wadeHome(play)).toBe(true)
    expect(play.cameHome).toBe(play.goslings.length - 1)
  })

  it('hands the swarm every gosling not taken, waiting or in her circle; the rats close on the circle with the torch out, and leave it once she dips the torch in a flame', () => {
    const play = new GoosePlay({ rats: 2000, seed: 3, grace: 60 })
    // The first brazier with a flame: the first of all is the well, its light its lantern's.
    const first = play.plain.braziers.find((b) => b.scene === undefined)!
    play.giveGoslings(4)
    stand(play, 1)
    const notTaken = () => play.goslings.filter((g) => g.state !== 'taken').map(({ x, z }) => ({ x, z }))
    expect(play.targets).toEqual(notTaken())
    expect(play.targets).toHaveLength(play.goslings.length)
    /** The rats within half a metre of a gosling of her circle. */
    const atCircle = () => {
      let n = 0
      for (let i = 0; i < play.swarm.count; i++) {
        if (circleOf(play).some((g) => Math.hypot(play.swarm.x[i]! - g.x, play.swarm.z[i]! - g.z) < 0.5)) n++
      }
      return n
    }
    expect(atCircle()).toBe(0)
    play.runTuning.burnRate = 1
    stand(play, 5)
    expect(play.run.torch.lit).toBe(false)
    expect(play.targets).toEqual(notTaken())
    expect(atCircle()).toBeGreaterThan(10)
    // To the first flame and into it: the torch lit again, the circle in her light, and the rats off it.
    play.runTuning.burnRate = 1 / 25
    expect(fillAt(play, first)).toBe(true)
    stand(play, 4)
    expect(play.run.torch.lit).toBe(true)
    expect(atCircle()).toBe(0)
  })

  it('never catches her and never starts the run again, the torch out among the rats', () => {
    const play = new GoosePlay({ rats: 2000, seed: 3, grace: 1, interval: 1 })
    play.runTuning.burnRate = 1
    let most = 0
    stand(play, 15, (p) => (most = Math.max(most, p.report?.reached ?? 0)))
    expect(most).toBeGreaterThan(play.runTuning.catchCount)
    expect(play.run.starts).toBe(0)
    expect(play.run.caught).toBe(0)
    expect(play.holder).toEqual(play.plain.start)
  })

  it('ends the run as she wades into the pond, with the circle\'s count, the goslings swimming out on the water, and nothing moves after', () => {
    const play = new GoosePlay(FEW)
    for (const b of play.plain.braziers) expect(visit(play, b)).toBe(true)
    expect(play.ended).toBe(false)
    const { pond } = play.plain
    expect(wadeHome(play)).toBe(true)
    expect(play.cameHome).toBe(play.goslings.length)
    // They swim out on their own legs.
    stand(play, 4)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - pond.x, g.z - pond.z)).toBeLessThan(pond.radius)
    const was = JSON.stringify({ holder: play.holder, fuel: play.run.fuel, takings: play.takings, home: play.cameHome })
    const afloat = play.goslings.map((g) => ({ x: g.x, z: g.z }))
    play.runTuning.burnRate = 1
    walkTo(play, play.plain.start, 0.1, 5)
    expect(JSON.stringify({ holder: play.holder, fuel: play.run.fuel, takings: play.takings, home: play.cameHome })).toBe(was)
    play.goslings.forEach((g, k) => expect(Math.hypot(g.x - afloat[k]!.x, g.z - afloat[k]!.z)).toBeLessThan(0.01))
  })

  it('starts every rat round her, out of her light, none on the plain beyond', () => {
    const play = new GoosePlay({ rats: 1000, seed: 3 })
    const { start } = play.plain
    for (let i = 0; i < play.swarm.count; i++) {
      const d = Math.hypot(play.swarm.x[i]! - start.x, play.swarm.z[i]! - start.z)
      expect(d).toBeGreaterThan(play.runTuning.torchReach)
      expect(d).toBeLessThan(12.01)
    }
  })

  it('keeps every rat out of the pond, held off it at its bank as off a light', () => {
    const play = new GoosePlay({ rats: 1000, seed: 3 })
    for (const b of play.plain.braziers) expect(visit(play, b)).toBe(true)
    expect(wadeHome(play)).toBe(true)
    const { pond } = play.plain
    let inPond = 0
    let atBank = 0
    stand(play, 5, (p) => {
      for (let i = 0; i < p.swarm.count; i++) {
        const d = Math.hypot(p.swarm.x[i]! - pond.x, p.swarm.z[i]! - pond.z)
        // Pressed up to its shore, as to a light's edge: never in past a rat's own size.
        if (d < pond.radius - p.tuning.ratRadius) inPond++
        if (d < pond.radius + 1.5) atBank++
      }
    })
    expect(inPond).toBe(0)
    expect(atBank).toBeGreaterThan(0)
  })

  it('holds the rats off the water the page hands over, every rat set down out of it before she starts', () => {
    const play = new GoosePlay({ rats: 1000, seed: 3 })
    const { start } = play.plain
    const water = shoreLight(start.x, start.z - 6, () => 3)
    play.setWater(water)
    const inWater = () => {
      let n = 0
      for (let i = 0; i < play.swarm.count; i++) if (Math.hypot(play.swarm.x[i]! - water.x, play.swarm.z[i]! - water.z) < 3 - play.tuning.ratRadius) n++
      return n
    }
    expect(inWater()).toBe(0)
    let most = 0
    stand(play, 5, () => (most = Math.max(most, inWater())))
    expect(most).toBe(0)
  })

  it('brings the rats left behind round ahead of her, so the plain is never empty', () => {
    const play = new GoosePlay({ rats: 1000, seed: 3 })
    const near = (p: GoosePlay) => {
      let n = 0
      for (let i = 0; i < p.swarm.count; i++) if (Math.hypot(p.swarm.x[i]! - p.holder.x, p.swarm.z[i]! - p.holder.z) < 10) n++
      return n
    }
    for (const b of play.plain.braziers.slice(0, 4)) expect(visit(play, b)).toBe(true)
    expect(near(play)).toBeGreaterThan(100)
  })

  describe('the well (#190)', () => {
    /** The play walked to the well's brazier, every scene before it played, standing at the well; and the well's gosling. */
    function atWell(settings: Partial<GooseSettings> = {}) {
      const play = new GoosePlay({ ...FEW, wellHold: 4, ...settings })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'well')
      const b = play.plain.braziers[k]!
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      expect(walkTo(play, b)).toBe(true)
      expect(walkTo(play, b.gosling, AT_WELL)).toBe(true)
      return { play, k, well: play.scenes.find((s) => s.kind === 'well')! }
    }

    it("keeps its gosling down it, however long she stands in its brazier's light", () => {
      const { play, k, well } = atWell()
      stand(play, 6)
      expect(play.goslings[k]!.state).toBe('waiting')
      expect(well.wound).toBe(0)
    })

    it('winches the gosling up on a hold of its set time, the torch burning the while, and the gosling joins her circle', () => {
      const { play, k, well } = atWell()
      const fuel = play.run.fuel
      hold(play, 3.9)
      expect(play.goslings[k]!.state).toBe('waiting')
      expect(well.wound).toBeCloseTo(3.9 / 4, 1)
      // Out of the brazier's dip: the torch burns down as she winches.
      expect(play.run.fuel).toBeCloseTo(fuel - 3.9 / 25, 2)
      hold(play, 0.2)
      expect(play.goslings[k]!.state).toBe('circle')
      expect(well.wound).toBe(1)
      stand(play, 2 * HOP + 2)
      expectArcBehind(play)
    })

    it('hops its gosling out of the bucket onto the rim on her side, then down to the ground beside the well, and walks it to her from there', () => {
      const { play, k, well } = atWell()
      hold(play, 4 + STEP)
      const g = play.goslings[k]!
      expect(g.state).toBe('circle')
      const her = { x: play.holder.x - well.x, z: play.holder.z - well.z }
      const toHer = (p: { x: number; z: number }) => ((p.x - well.x) * her.x + (p.z - well.z) * her.z) / Math.hypot(her.x, her.z) / Math.hypot(p.x - well.x, p.z - well.z)
      const off = () => Math.hypot(g.x - well.x, g.z - well.z)
      // Up in the bucket, in the well's middle; then on the rim.
      expect(play.hopOf(k)).toMatchObject({ hop: 0 })
      expect(off()).toBeLessThan(0.1)
      stand(play, HOP)
      expect(play.hopOf(k)).toMatchObject({ hop: 1 })
      expect(off()).toBeGreaterThan(WELL_RADIUS - 0.3)
      expect(off()).toBeLessThan(WELL_RADIUS)
      expect(toHer(g)).toBeGreaterThan(0.99)
      // Down on the ground outside it, still on her side; and from there on its own legs.
      stand(play, HOP)
      expect(play.hopOf(k)).toBeNull()
      expect(off()).toBeGreaterThan(WELL_RADIUS)
      expect(off()).toBeLessThan(WELL_RADIUS + 0.6)
      expect(toHer(g)).toBeGreaterThan(0.99)
      stand(play, 2)
      expectArcBehind(play)
    })

    it('stops her at its wall, walking at it, and lets her walk round it', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
      const well = play.scenes.find((s) => s.kind === 'well')!
      const off = () => Math.hypot(play.holder.x - well.x, play.holder.z - well.z)
      walkTo(play, well, 0.05, 3)
      expect(offWell(well, play.holder)).toBeCloseTo(HOLDER_RADIUS, 2)
      expect(off()).toBeGreaterThan(WELL_RADIUS)
      // Round it by its side to the far side.
      expect(walkTo(play, { x: well.x + 2, z: well.z }, 0.1)).toBe(true)
      expect(walkTo(play, { x: well.x, z: well.z - 2 }, 0.1)).toBe(true)
    })

    it('keeps her goslings out of it: walking after her round it, none goes through it', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
      const well = play.scenes.find((s) => s.kind === 'well')!
      play.giveGoslings(play.goslings.length)
      stand(play, 2)
      let closest = Infinity
      const watch = (p: GoosePlay) => {
        for (const g of circleOf(p)) closest = Math.min(closest, offBodies(well, g))
      }
      // Round it, and round its lantern's foot outside it.
      const round = [[2, 1], [2, -1], [0, -2], [-2, 0], [-2.9, 1], [-2.9, 2.6], [0, 2.5]] as const
      for (const to of round.map(([x, z]) => ({ x: well.x + x, z: well.z + z }))) {
        expect(walkTo(play, to, 0.1, 60, watch)).toBe(true)
      }
      stand(play, 2, watch)
      expect(closest).toBeGreaterThanOrEqual(GOSLING_RADIUS - 1e-6)
      expect(closest).toBeLessThan(0.5)
    })

    it("holds the rats off its light as far as its lantern's strength sets, the run and the swarm reading it live", () => {
      const play = new GoosePlay({ rats: 2000, seed: 3 })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'well')
      const b = play.plain.braziers[k]!
      const light = () => play.lights().find((l) => l.x === b.x && l.z === b.z)!
      expect(light().reach).toBe(b.reach)
      play.setWellLight(5)
      expect(light().reach).toBe(5)
      expect(play.run.lights()[k]!.reach).toBe(5)
      // Stood at it, the rats she draws press on its new edge and come no nearer, less a rat's size and the flame's lean.
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      expect(walkTo(play, b)).toBe(true)
      let nearest = Infinity
      stand(play, 6, (p) => {
        for (let i = 0; i < p.swarm.count; i++) nearest = Math.min(nearest, Math.hypot(p.swarm.x[i]! - b.x, p.swarm.z[i]! - b.z))
      })
      expect(nearest).toBeGreaterThan(5 * (1 - FLICKER) - play.tuning.ratRadius)
      expect(nearest).toBeLessThan(5 + 1.5)
    })

    it("stops her at its outline and its lantern's foot from every side, its posts and the pumpkins at its foot as its wall", () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
      const well = play.scenes.find((s) => s.kind === 'well')!
      let tried = 0
      for (const { outline, middle } of WELL_BODIES) {
        for (const p of outline) {
          // Set down out from a corner, away from its body's middle, clear of every body; and walked straight at it.
          const at = { x: well.x + p.x, z: well.z + p.z }
          const away = Math.hypot(p.x - middle.x, p.z - middle.z)
          const from = { x: at.x + ((p.x - middle.x) / away) * 1.2, z: at.z + ((p.z - middle.z) / away) * 1.2 }
          if (offBodies(well, from) < HOLDER_RADIUS + 0.1) continue
          play.run.holder.x = from.x
          play.run.holder.z = from.z
          walkTo(play, at, 0.05, 3)
          expect(offBodies(well, play.holder)).toBeGreaterThan(HOLDER_RADIUS - 0.01)
          expect(offBodies(well, play.holder)).toBeLessThan(HOLDER_RADIUS + 0.05)
          tried++
        }
      }
      expect(tried).toBeGreaterThan(10)
    })

    it("holds the rats off it and its lantern's foot as off the water, drawn to its gosling down it", () => {
      const play = new GoosePlay({ rats: 2000, seed: 3, wellAhead: 8 })
      const well = play.scenes.find((s) => s.kind === 'well')!
      let inWell = 0
      let atWell = 0
      stand(play, 8, (p) => {
        for (let i = 0; i < p.swarm.count; i++) {
          const off = offBodies(well, { x: p.swarm.x[i]!, z: p.swarm.z[i]! })
          // Pressed up to its outline, as to a light's edge: never in past a rat's own size.
          if (off < -p.tuning.ratRadius) inWell++
          if (off < 1) atWell++
        }
      })
      expect(inWell).toBe(0)
      expect(atWell).toBeGreaterThan(0)
    })

    it('lands its gosling clear of the body of the well, wherever round the well she winches from', () => {
      for (let a = 0; a < 12; a++) {
        const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
        const well = play.scenes.find((s) => s.kind === 'well')!
        const angle = (a / 12) * Math.PI * 2
        // Set down at the well, out of its body, and winching.
        play.run.holder.x = well.x + Math.cos(angle) * (WELL_REACH - 0.05)
        play.run.holder.z = well.z + Math.sin(angle) * (WELL_REACH - 0.05)
        hold(play, 4.1)
        if (play.goslings[well.brazier]!.state !== 'circle') continue
        stand(play, HOP)
        const land = play.hopOf(well.brazier)!.to
        expect(offBodies(well, land)).toBeGreaterThanOrEqual(GOSLING_RADIUS - 1e-9)
      }
    })

    it('drops the bucket on a hold let go early, gathering nothing, and the next hold starts from none', () => {
      const { play, k, well } = atWell()
      hold(play, 3)
      stand(play, STEP)
      expect(well.wound).toBe(0)
      expect(play.goslings[k]!.state).toBe('waiting')
      hold(play, 3)
      expect(play.goslings[k]!.state).toBe('waiting')
      hold(play, 1.1)
      expect(play.goslings[k]!.state).toBe('circle')
    })

    it("stands in its brazier's light, and she never winches from the brazier's dip", () => {
      const { play, k, well } = atWell()
      const b = play.plain.braziers[k]!
      const off = Math.hypot(well.x - b.x, well.z - b.z)
      expect(off).toBeLessThan(b.reach)
      expect(off - WELL_REACH).toBeGreaterThan(play.runTuning.dip)
    })

    it('says she is at it while its gosling is down it, and no more once it is out', () => {
      const { play, well } = atWell()
      stand(play, STEP)
      expect(well.near).toBe(true)
      hold(play, 4.1)
      expect(well.near).toBe(false)
    })

    it('stands as far ahead of her start as it is asked to, its gosling down it there, and winches up there', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 0.8 })
      const { start } = play.plain
      const at = { x: start.x, z: start.z - 0.8 }
      const well = play.scenes.find((s) => s.kind === 'well')!
      expect(well).toMatchObject(at)
      expect(play.goslings[well.brazier]).toMatchObject({ ...at, state: 'waiting' })
      hold(play, 4.1)
      expect(well.wound).toBe(1)
      expect(play.goslings[well.brazier]!.state).toBe('circle')
    })

    it('takes its light with it, set ahead: the rats held off its lantern', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
      const well = play.scenes.find((s) => s.kind === 'well')!
      const lantern = { x: well.x + WELL_LANTERN.x, z: well.z + WELL_LANTERN.z }
      expect(play.run.lights()[well.brazier]).toMatchObject({ ...lantern, on: true })
      expect(play.lights()).toContainEqual(expect.objectContaining({ ...lantern, on: true }))
    })

    it("fills the torch at its lantern's foot only while the interact key is held, over its set time, and lights it again if it was out", () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5, refillHold: 2 })
      const well = play.scenes.find((s) => s.kind === 'well')!
      // In its zone, by its stone foot.
      const zone = play.refillZoneOf(well)
      expect(walkTo(play, zone, Math.min(zone.rx, zone.rz) - 0.2)).toBe(true)
      // Stood under it, nothing: the lantern is not dipped into.
      play.run.fuel = 0
      stand(play, 1)
      expect(play.run.torch.lit).toBe(false)
      expect(play.atRefill).toBe(true)
      // Held, it fills at a full torch over the set time, lit from the first frame.
      hold(play, STEP)
      expect(play.run.torch.lit).toBe(true)
      hold(play, 1)
      expect(play.run.fuel).toBeGreaterThan(0.45)
      expect(play.run.fuel).toBeLessThan(0.55)
      hold(play, 1.1)
      expect(play.run.fuel).toBe(1)
      // Full, there is nothing to do at it.
      expect(play.atRefill).toBe(false)
    })

    it('fills nothing held away from its lantern', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
      play.run.fuel = 0.5
      hold(play, 1)
      expect(play.run.fuel).toBeLessThan(0.5)
      expect(play.atRefill).toBe(false)
    })

    it('winches nothing from out of its reach', () => {
      const { play, k, well } = atWell()
      // Straight out from the well, the way she stands from it.
      const off = Math.hypot(play.holder.x - well.x, play.holder.z - well.z)
      const out = (WELL_REACH + 0.5) / off
      expect(walkTo(play, { x: well.x + (play.holder.x - well.x) * out, z: well.z + (play.holder.z - well.z) * out }, 0.1)).toBe(true)
      hold(play, 5)
      expect(well.near).toBe(false)
      expect(well.wound).toBe(0)
      expect(play.goslings[k]!.state).toBe('waiting')
    })
  })

  describe('the dead tree (#190)', () => {
    it('stands as far ahead of her start as it is asked to, its gosling up it there, and calls it down there', () => {
      const play = new GoosePlay({ ...FEW, treeAhead: 3 })
      const { start } = play.plain
      const at = { x: start.x, z: start.z - 3 }
      const tree = play.scenes.find((s) => s.kind === 'tree')!
      expect(tree).toMatchObject(at)
      expect(play.goslings[tree.brazier]).toMatchObject({ ...at, state: 'waiting' })
      expect(walkTo(play, at, 0.1)).toBe(true)
      hold(play, play.settings.treeHold + STEP)
      expect(tree.kind === 'tree' && tree.calledAt).toBeGreaterThan(0)
      stand(play, play.settings.treeJump)
      expect(play.goslings[tree.brazier]!.state).toBe('circle')
    })

    it('has a lit brazier near it on its right, a little ahead, wherever it stands, whose light leaves its trunk in the dark', () => {
      for (const treeAhead of [null, 3]) {
        const play = new GoosePlay({ ...FEW, treeAhead })
        const tree = play.scenes.find((s) => s.kind === 'tree')!
        expect(tree.kind === 'tree' && tree.fireLight).toBe(play.plain.braziers.length)
        if (tree.kind !== 'tree') return
        const fire = play.level.lights[tree.fireLight]!
        expect(fire).toMatchObject({ ...tree.fire, flame: true, on: true })
        expect(play.lights()).toContainEqual(expect.objectContaining({ ...tree.fire, on: true }))
        // On its right, a little up the plain; its light at its furthest lean stops short of the trunk, and not by much: near it.
        expect(fire.x - tree.x).toBeGreaterThan(2 * Math.abs(fire.z - tree.z))
        expect(fire.z).toBeLessThan(tree.z)
        const gap = Math.hypot(fire.x - tree.x, fire.z - tree.z) - fire.reach * (1 + FLICKER) - TRUNK
        expect(gap).toBeGreaterThan(1)
        expect(gap).toBeLessThan(2)
      }
    })

    it("stands her by its zone on a debug key, and by the well's: just short of each, facing it", () => {
      const play = new GoosePlay({ ...FEW })
      for (const kind of ['tree', 'well'] as const) {
        const scene = play.scenes.find((s) => s.kind === kind)!
        const zone = kind === 'well' ? play.winchZoneOf(scene) : play.treeZoneOf(scene)
        play.standBy(kind)
        expect(play.holder.x).toBeCloseTo(zone.x, 6)
        expect(play.holder.z - zone.z - zone.rz).toBeCloseTo(0.3, 6)
        expect(play.facing).toEqual({ x: 0, z: -1 })
        // A step in, and she can work it.
        expect(walkTo(play, { x: zone.x, z: zone.z + zone.rz - 0.2 }, 0.05)).toBe(true)
        expect(scene.near).toBe(true)
      }
    })

    it('stands her back where she starts on a debug key, facing up the plain', () => {
      const play = new GoosePlay({ ...FEW })
      play.standBy('tree')
      play.standAtStart()
      expect(play.holder).toMatchObject(play.plain.start)
      expect(play.facing).toEqual({ x: 0, z: -1 })
    })

    it('stands its brazier, and its light, where the settings move it, from the next frame', () => {
      const play = new GoosePlay({ ...FEW, treeAhead: 3 })
      const tree = play.scenes.find((s) => s.kind === 'tree')!
      if (tree.kind !== 'tree') throw new Error('no tree')
      play.settings.treeFire.x = -4
      play.settings.treeFire.z = 2.5
      stand(play, STEP)
      const at = { x: tree.x - 4, z: tree.z + 2.5 }
      expect(tree.fire).toMatchObject(at)
      expect(play.run.lights()[tree.fireLight]).toMatchObject({ ...at, on: true })
      expect(play.lights()).toContainEqual(expect.objectContaining({ ...at, on: true }))
    })

    /** The play walked to the tree, every scene before it played; the tree's gosling, and its place's light as the swarm reads it. */
    function atTree(settings: Partial<GooseSettings> = {}) {
      const play = new GoosePlay({ ...FEW, ...settings })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'tree')
      const b = play.plain.braziers[k]!
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      expect(walkTo(play, b)).toBe(true)
      const tree = play.scenes.find((s) => s.kind === 'tree')!
      if (tree.kind !== 'tree') throw new Error('no tree')
      const light = () => play.lights().find((l) => l.x === b.x && l.z === b.z)!
      return { play, k, b, tree, light }
    }

    it('jumps its gosling down from it as it is called, in one hop, to where the settings land it, and only then joins her', () => {
      const { play, k, tree } = atTree({ treeLanding: { x: 0.4, z: 0.9 } })
      const before = play.circle
      hold(play, play.settings.treeHold + STEP)
      const g = play.goslings[k]!
      // Up the tree, over its trunk's middle, still waiting; in the air, still waiting.
      expect(play.hopOf(k)).toMatchObject({ hop: 0 })
      expect(Math.hypot(g.x - tree.x, g.z - tree.z)).toBeLessThan(0.1)
      expect(g.state).toBe('waiting')
      stand(play, play.settings.treeJump / 2)
      expect(g.state).toBe('waiting')
      expect(play.circle).toBe(before)
      // Down where it lands, it joins her, and walks to her from there.
      stand(play, play.settings.treeJump / 2 + STEP)
      expect(play.hopOf(k)).toBeNull()
      expect(g.state).toBe('circle')
      expect(g.gatheredAt).toBeGreaterThan(tree.calledAt + play.settings.treeJump - 2 * STEP)
      expect(g.x - tree.x).toBeCloseTo(0.4, 1)
      expect(g.z - tree.z).toBeCloseTo(0.9, 1)
      stand(play, 2)
      expectArcBehind(play)
    })

    it('takes the interact key held its set time to call: let go early, it starts again from none', () => {
      const { play, tree } = atTree({ treeHold: 1 })
      stand(play, STEP)
      expect(tree.near).toBe(true)
      hold(play, 0.5)
      expect(tree.catching).toBeGreaterThan(0.4)
      expect(tree.calledAt).toBeNaN()
      stand(play, STEP)
      expect(tree.catching).toBe(0)
      hold(play, 0.8)
      expect(tree.calledAt).toBeNaN()
      hold(play, 0.3)
      expect(tree.calledAt).toBeGreaterThan(0)
      expect(tree.near).toBe(false)
    })

    it('calls only in its zone, as the settings move it', () => {
      const play = new GoosePlay({ ...FEW, treeAhead: 3, treeZone: { x: 1.5, z: 0, scaleX: 0.5, scaleY: 0.5 } })
      const tree = play.scenes.find((s) => s.kind === 'tree')!
      if (tree.kind !== 'tree') throw new Error('no tree')
      expect(walkTo(play, tree, 0.1)).toBe(true)
      hold(play, play.settings.treeHold + STEP)
      expect(tree.calledAt).toBeNaN()
      expect(walkTo(play, { x: tree.x + 1.5, z: tree.z }, 0.05)).toBe(true)
      hold(play, play.settings.treeHold + STEP)
      expect(tree.calledAt).toBeGreaterThan(0)
    })

    it('never burns: dark with its gosling up it, and dark once it is down, filling no torch and holding no rat off', () => {
      const { play, k, tree, light } = atTree()
      stand(play, 1)
      expect(light().on).toBe(false)
      expect(play.goslings[k]!.state).toBe('waiting')
      hold(play, play.settings.treeHold + STEP)
      expect(tree.calledAt).toBeGreaterThan(play.t - 2 * STEP)
      stand(play, play.settings.treeJump + 1)
      expect(play.goslings[k]!.state).toBe('circle')
      expect(light().on).toBe(false)
      // No lit light reaches its trunk, the brazier by it's least of all.
      for (const l of play.lights()) if (l.on && l.reach > 0 && !l.shore) expect(Math.hypot(l.x - tree.x, l.z - tree.z) - l.reach * (1 + FLICKER)).toBeGreaterThan(TRUNK)
      play.run.fuel = 0.5
      expect(walkTo(play, tree, 0.1)).toBe(true)
      stand(play, 1)
      expect(play.run.fuel).toBeLessThan(0.5)
    })

    it('takes a lit torch to call: with hers out, the interact key at its trunk does nothing', () => {
      const { play, k, tree } = atTree({ grace: 60 })
      play.run.fuel = 0
      hold(play, play.settings.treeHold + 1)
      expect(tree.calledAt).toBeNaN()
      expect(tree.near).toBe(false)
      expect(play.goslings[k]!.state).toBe('waiting')
    })
  })

  describe('the cage and the skull (#191)', () => {
    /** The play walked to the cage's brazier, every scene before it played, the torch filled there; the cage's gosling, and the cage. */
    function atCage(settings: Partial<GooseSettings> = {}) {
      const play = new GoosePlay({ ...FEW, ...settings })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'cage')
      const b = play.plain.braziers[k]!
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      expect(fillAt(play, b)).toBe(true)
      const cage = play.scenes.find((s) => s.kind === 'cage')!
      if (cage.kind !== 'cage') throw new Error('no cage')
      return { play, k, b, cage }
    }

    it("holds its gosling in it, in its brazier's light, its key beside the body out in the dark, off its skull", () => {
      const { play, k, b, cage } = atCage()
      expect(play.goslings[k]).toMatchObject({ ...b.gosling, state: 'waiting' })
      expect(cage).toMatchObject({ ...b.gosling, skull: b.skull, carried: false, open: false })
      const off = Math.hypot(cage.key.x - cage.skull.x, cage.key.z - cage.skull.z)
      expect(off).toBeGreaterThan(0.5)
      expect(off).toBeLessThan(1.2)
      for (const at of [cage.skull, cage.key]) for (const l of play.lights()) if (l.on && !l.shore) expect(Math.hypot(l.x - at.x, l.z - at.z)).toBeGreaterThan(l.reach * (1 + FLICKER))
    })

    it('lays its key where the settings set it by the body, and gives it up only in its zone as the settings move it', () => {
      const { play, cage } = atCage({ keyBeside: { x: 0, z: 1 }, keyZone: { x: 1, z: 0, scaleX: 0.5, scaleY: 0.5 } })
      stand(play, STEP)
      // Turned with its set: a metre from the skull.
      expect(Math.hypot(cage.key.x - cage.skull.x, cage.key.z - cage.skull.z)).toBeCloseTo(1, 6)
      expect(walkTo(play, cage.key, 0.05)).toBe(true)
      hold(play, 0.3)
      expect(cage.carried).toBe(false)
      expect(walkTo(play, { x: cage.key.x + 1, z: cage.key.z }, 0.05)).toBe(true)
      hold(play, STEP)
      expect(cage.carried).toBe(true)
    })

    it('opens only in its zone as the settings move it', () => {
      const { play, b, cage } = atCage({ cageZone: { x: 0, z: 0, scaleX: 0.1, scaleY: 0.1 } })
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      expect(walkTo(play, b.gosling, AT_CAGE)).toBe(true)
      hold(play, 0.5)
      expect(cage.open).toBe(false)
      play.settings.cageZone.scaleX = play.settings.cageZone.scaleY = 1
      unlock(play)
      expect(cage.open).toBe(true)
    })

    it('fills the torch at its campfire only in its fire zone, as the settings move it', () => {
      const { play, b } = atCage()
      play.run.fuel = 0.5
      play.settings.fireZones.cage = { x: 2, z: 0, scaleX: 0.5, scaleY: 0.5 }
      hold(play, 1)
      expect(play.run.fuel).toBeLessThan(0.5)
      expect(walkTo(play, { x: b.x + 2, z: b.z }, 0.05)).toBe(true)
      const fuel = play.run.fuel
      hold(play, 0.5)
      expect(play.run.fuel).toBeGreaterThan(fuel + 0.1)
    })

    it('holds the rats off its campfire as far as the settings set its reach, from the next frame', () => {
      const { play, b } = atCage()
      play.settings.fireReach.cage = 4.5
      stand(play, STEP)
      expect(play.lights().find((l) => l.x === b.x && l.z === b.z)!.reach).toBe(4.5)
    })

    it('turns its set so its campfire stands toward its brazier', () => {
      const { b, cage } = atCage()
      const c = Math.cos(cage.turn)
      const s = Math.sin(cage.turn)
      const fire = { x: CAGE_CAMPFIRE.x * c + CAGE_CAMPFIRE.z * s, z: CAGE_CAMPFIRE.z * c - CAGE_CAMPFIRE.x * s }
      const way = { x: b.x - cage.x, z: b.z - cage.z }
      expect(fire.x * way.z - fire.z * way.x).toBeCloseTo(0, 6)
      expect(fire.x * way.x + fire.z * way.z).toBeGreaterThan(0)
    })

    it('keeps her out of its cart, shut or open', () => {
      const { play, b, cage } = atCage()
      const cart = cartOf(cage)
      const middle = cart.reduce((m, p) => ({ x: m.x + (cage.x + p.x) / cart.length, z: m.z + (cage.z + p.z) / cart.length }), { x: 0, z: 0 })
      const off = () => offWell(cage, play.holder, cart)
      // Walked at its middle, round the cage and then from the open cage, she stops at its side.
      walkTo(play, middle, 0.05, 4, () => expect(off()).toBeGreaterThan(HOLDER_RADIUS - 0.01))
      expect(off()).toBeLessThan(HOLDER_RADIUS + 0.05)
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      expect(walkTo(play, b.gosling, AT_CAGE)).toBe(true)
      unlock(play)
      expect(cage.open).toBe(true)
      walkTo(play, middle, 0.05, 4, () => expect(off()).toBeGreaterThan(HOLDER_RADIUS - 0.01))
      expect(off()).toBeLessThan(HOLDER_RADIUS + 0.05)
    })

    it('opens to nothing but its key: the interact key at it with no key does nothing', () => {
      const { play, k, b, cage } = atCage()
      expect(walkTo(play, b.gosling, AT_CAGE)).toBe(true)
      stand(play, STEP)
      expect(cage.near).toBe(false)
      hold(play, 2)
      expect(cage.open).toBe(false)
      expect(play.goslings[k]!.state).toBe('waiting')
    })

    it('gives her the key standing at it with the interact key, and only there', () => {
      const { play, cage } = atCage()
      expect(walkTo(play, cage.skull, 1.5)).toBe(true)
      hold(play, 0.5)
      expect(cage.carried).toBe(false)
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      stand(play, 0.5)
      expect(cage.carried).toBe(false)
      expect(cage.near).toBe(true)
      hold(play, STEP)
      expect(cage.carried).toBe(true)
      expect(cage.near).toBe(false)
    })

    it('takes the interact key held its set time at the cage to unlock: let go early, it starts again from none', () => {
      const { play, k, b, cage } = atCage({ cageHold: 2 })
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      expect(walkTo(play, b.gosling, AT_CAGE)).toBe(true)
      hold(play, 1)
      expect(cage.unlocking).toBeCloseTo(0.5, 1)
      expect(cage.open).toBe(false)
      expect(cage.carried).toBe(true)
      stand(play, STEP)
      expect(cage.unlocking).toBe(0)
      hold(play, 1.9)
      expect(cage.open).toBe(false)
      expect(play.goslings[k]!.state).toBe('waiting')
      hold(play, 0.2)
      expect(cage.open).toBe(true)
      expect(cage.unlockedAt).toBeGreaterThan(play.t - 0.2)
      expect(cage.unlocking).toBe(0)
      expect(play.goslings[k]!.state).toBe('circle')
    })

    it('opens back at the cage to the key she carries, and its gosling joins her circle', () => {
      const { play, k, b, cage } = atCage()
      const before = play.circle
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      // Carried, the key does nothing away from the cage.
      hold(play, 0.5)
      expect(cage.open).toBe(false)
      expect(walkTo(play, b.gosling, AT_CAGE)).toBe(true)
      stand(play, STEP)
      expect(cage.near).toBe(true)
      unlock(play)
      expect(cage.open).toBe(true)
      expect(cage.carried).toBe(false)
      expect(cage.near).toBe(false)
      expect(play.goslings[k]!.state).toBe('circle')
      expect(play.circle).toBe(before + 1)
      stand(play, 2)
      expectArcBehind(play)
    })

    it('stops her at its bars while it is shut, and lets her goslings walk out of it once open', () => {
      const { play, b, cage } = atCage()
      // Walked at it from its far side, she stands off it.
      const away = { x: cage.x + (cage.x - b.x), z: cage.z + (cage.z - b.z) }
      walkTo(play, away, 0.05, 3)
      expect(Math.hypot(play.holder.x - cage.x, play.holder.z - cage.z)).toBeGreaterThan(0.45)
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      expect(walkTo(play, b.gosling, AT_CAGE)).toBe(true)
      unlock(play)
      stand(play, 2)
      expectArcBehind(play)
    })
  })

  describe('the hollow log (#191)', () => {
    /** Its zones where its scene puts them, at their own reach, and its fire a brazier's, fresh each play: the panel's own are tested on the whole route. */
    const centred = (): Partial<GooseSettings> => ({
      logZone: { x: 0, z: 0, scaleX: 1, scaleY: 1 },
      strikeZone: { x: 0, z: 0, scaleX: 1, scaleY: 1 },
      fireZones: { tree: { x: 0, z: 0, scaleX: 1, scaleY: 1 }, cage: { x: 0, z: 0, scaleX: 1, scaleY: 1 }, log: { x: 0, z: 0, scaleX: 1, scaleY: 1 } },
      fireReach: { tree: 3, cage: 3, log: 3 },
    })
    /**
     * The play walked on past every scene before the log's, and on to the log's brazier's place unless `to` is false; the
     * log's gosling, its brazier's place, the one before, and the log. Its zones centred unless `settings` move them.
     */
    function atLog(settings: Partial<GooseSettings> = {}, to = true) {
      const play = new GoosePlay({ ...FEW, ...centred(), ...settings })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'log')
      const b = play.plain.braziers[k]!
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      if (to) expect(walkTo(play, b)).toBe(true)
      const log = play.scenes.find((s) => s.kind === 'log')!
      if (log.kind !== 'log') throw new Error('no log')
      return { play, k, b, prev: play.plain.braziers[k - 1]!, log }
    }
    /** A thunder circle too small to come into. */
    const noThunder = () => ({ strikeZone: { x: 0, z: 0, scaleX: 0.001, scaleY: 0.001 } })
    /** The log's fire, among the swarm's lights. */
    const fireOf = (play: GoosePlay, log: HollowLog) => play.lights().find((l) => l.x === log.ends.far.x && l.z === log.ends.far.z)!

    it('holds its gosling deep in it, in the dark until struck: no brazier burns at its place', () => {
      const { play, k, b, log } = atLog(noThunder())
      expect(play.goslings[k]).toMatchObject({ ...b.gosling, state: 'waiting' })
      expect(log).toMatchObject({ ...b.gosling, ends: b.log })
      expect(play.lights().some((l) => l.on && l.x === b.x && l.z === b.z)).toBe(false)
      expect(play.level.lights[k]).toMatchObject({ ...b.log!.far, on: false })
      stand(play, 3)
      expect(log.litAt).toBeNaN()
      expect(play.goslings[k]!.state).toBe('waiting')
    })

    it('is struck the moment she comes within its thunder circle, far off, and burns on its far end from then', () => {
      const { play, k, b, log } = atLog({}, false)
      expect(log.litAt).toBeNaN()
      let came = Number.NaN
      expect(
        walkTo(play, b, AT, 60, (p) => {
          if (Number.isNaN(came) && Math.hypot(p.holder.x - log.x, p.holder.z - log.z) <= LOG_THUNDER) came = p.t
        }),
      ).toBe(true)
      expect(log.litAt).toBe(came)
      expect(fireOf(play, log).on).toBe(true)
      expect(play.level.lights[k]!.flame).toBe(true)
      // Only the strike: its gosling stays in it till she calls it out at its near end.
      stand(play, LOG_FOLLOW + 2)
      expect(log.calledAt).toBeNaN()
      expect(play.goslings[k]!.state).toBe('waiting')
    })

    it('burns a flame the rats keep off as far as the settings set', () => {
      const { play, log } = atLog({ fireReach: { tree: 3, cage: 3, log: 1.5 } })
      expect(fireOf(play, log)).toMatchObject({ on: true, reach: 1.5 })
      play.settings.fireReach.log = 2
      // The rats its gosling drew round it in the dark run from its fire: none left in its reach a while after.
      stand(play, 3)
      expect(fireOf(play, log).reach).toBe(2)
      let inside = 0
      for (let i = 0; i < play.swarm.count; i++) if (Math.hypot(play.swarm.x[i]! - log.ends.far.x, play.swarm.z[i]! - log.ends.far.z) < 1.5) inside++
      expect(inside).toBe(0)
    })

    it('calls its gosling out on a hold of its set time at its near end, let go early starting again', () => {
      const { play, k, log } = atLog({ logHold: 1 })
      expect(walkTo(play, offEnd(log, log.ends.near), 0.1)).toBe(true)
      stand(play, 2)
      expect(log.near).toBe(true)
      expect(log.calledAt).toBeNaN()
      hold(play, 0.6)
      expect(log.calling).toBeGreaterThan(0.5)
      stand(play, STEP)
      expect(log.calling).toBe(0)
      hold(play, 0.6)
      expect(log.calledAt).toBeNaN()
      hold(play, 0.5)
      expect(log.calledAt).toBeGreaterThan(0)
      expect(log.near).toBe(false)
      stand(play, LOG_FOLLOW + 3)
      expect(play.goslings[k]!.state).toBe('circle')
    })

    it('runs its gosling along the trunk as it lies and out of its open end a moment after she calls it, and into her circle', () => {
      // Turned a quarter round off its line, its open end lies across the line from its middle, the far end's way turned.
      const { play, k, log } = atLog({ logTurn: 90 })
      const fx = log.ends.far.x - log.x
      const fz = log.ends.far.z - log.z
      const open = { x: log.x + fz, z: log.z - fx }
      expect(walkTo(play, offEnd(log, log.ends.near), 0.1)).toBe(true)
      hold(play, play.settings.logHold + STEP)
      const g = play.goslings[k]!
      let joined = Number.NaN
      let byOpen = Infinity
      let offTrunk = 0
      stand(play, LOG_FOLLOW + 3, (p) => {
        if (g.state === 'waiting') {
          byOpen = Math.min(byOpen, Math.hypot(g.x - open.x, g.z - open.z))
          // How far off the trunk's line it is: across it, or behind its middle.
          const along = ((g.x - log.x) * fz - (g.z - log.z) * fx) / Math.hypot(fx, fz)
          const across = ((g.x - log.x) * fx + (g.z - log.z) * fz) / Math.hypot(fx, fz)
          offTrunk = Math.max(offTrunk, Math.abs(across), -along)
        } else if (Number.isNaN(joined)) joined = p.t
      })
      expect(g.state).toBe('circle')
      expect(joined - log.calledAt).toBeGreaterThan(LOG_FOLLOW)
      expect(byOpen).toBeLessThan(0.2)
      expect(offTrunk).toBeLessThan(1e-9)
      stand(play, 2)
      expectArcBehind(play)
    })

    it('does nothing at its far end but burn', () => {
      const { play, k, log } = atLog()
      expect(walkTo(play, offEnd(log, log.ends.far), 0.1)).toBe(true)
      hold(play, 1)
      expect(log.near).toBe(false)
      stand(play, LOG_FOLLOW + 2)
      expect(log.calledAt).toBeNaN()
      expect(play.goslings[k]!.state).toBe('waiting')
    })

    it('is struck at its near end too, its thunder circle moved off, and only there as the settings move it', () => {
      const { play, log } = atLog({ ...noThunder(), logZone: { x: 0, z: 0, scaleX: 0.1, scaleY: 0.1 } })
      expect(walkTo(play, offEnd(log, log.ends.near), 0.1)).toBe(true)
      hold(play, 2)
      expect(log.litAt).toBeNaN()
      expect(log.calledAt).toBeNaN()
      play.settings.logZone.scaleX = play.settings.logZone.scaleY = 1
      stand(play, STEP)
      expect(log.litAt).toBeGreaterThan(0)
      hold(play, play.settings.logHold + STEP)
      expect(log.calledAt).toBeGreaterThan(0)
    })

    it('comes first where its zone overlaps its fire\'s: the key calls its gosling out and fills no torch, then fills it', () => {
      const { play, log } = atLog()
      const near = offEnd(log, log.ends.near)
      // Its fire's zone moved over its near end.
      play.settings.fireZones.log = { x: near.x - log.ends.far.x, z: near.z - log.ends.far.z, scaleX: 2, scaleY: 2 }
      expect(walkTo(play, near, 0.1)).toBe(true)
      play.run.fuel = 0.5
      stand(play, STEP)
      expect(log.near).toBe(true)
      expect(play.atRefill).toBe(false)
      hold(play, play.settings.logHold + STEP)
      expect(log.calledAt).toBeGreaterThan(0)
      expect(play.run.fuel).toBeLessThan(0.5)
      // Called, the key fills the torch there.
      const fuel = play.run.fuel
      hold(play, 0.5)
      expect(play.run.fuel).toBeGreaterThan(fuel + 0.1)
    })

    it('fills the torch at its fire, once struck, only in its fire zone', () => {
      const { play, b, log } = atLog(noThunder())
      const end = offEnd(log, log.ends.far)
      // Unlit, nothing fills it there.
      expect(walkTo(play, end, 0.05)).toBe(true)
      play.run.fuel = 0.5
      hold(play, 1)
      expect(play.run.fuel).toBeLessThan(0.5)
      play.settings.strikeZone.scaleX = play.settings.strikeZone.scaleY = 1
      stand(play, STEP)
      expect(log.litAt).toBeGreaterThan(0)
      // Its zone moved on out past its far end, along its line, clear of where she stood.
      const ux = log.ends.far.x - log.x
      const uz = log.ends.far.z - log.z
      const d = Math.hypot(ux, uz)
      play.settings.fireZones.log = { x: (ux / d) * 1.6, z: (uz / d) * 1.6, scaleX: 0.5, scaleY: 0.5 }
      expect(walkTo(play, b)).toBe(true)
      expect(walkTo(play, end, 0.05)).toBe(true)
      play.run.fuel = 0.5
      hold(play, 0.5)
      expect(play.run.fuel).toBeLessThan(0.5)
      const zone = play.fireZoneOf(log)
      expect(walkTo(play, zone, 0.05)).toBe(true)
      const fuel = play.run.fuel
      hold(play, 0.5)
      expect(play.run.fuel).toBeGreaterThan(fuel + 0.1)
    })

    it('is struck with her torch out too, no key pressed', () => {
      const { play, k, b, log } = atLog({ grace: 60 }, false)
      play.run.fuel = 0
      expect(walkTo(play, b)).toBe(true)
      expect(log.litAt).toBeGreaterThan(0)
      expect(walkTo(play, offEnd(log, log.ends.near), 0.1)).toBe(true)
      hold(play, play.settings.logHold + STEP)
      stand(play, LOG_FOLLOW + 3)
      expect(play.goslings[k]!.state).toBe('circle')
    })

    it('is struck once: walking out of its thunder circle and back calls no other strike', () => {
      const { play, b, prev, log } = atLog()
      const struck = log.litAt
      expect(struck).toBeGreaterThan(0)
      expect(walkTo(play, prev)).toBe(true)
      expect(Math.hypot(play.holder.x - log.x, play.holder.z - log.z)).toBeGreaterThan(LOG_THUNDER)
      expect(walkTo(play, b)).toBe(true)
      expect(log.litAt).toBe(struck)
    })

    it('stops her at its side', () => {
      const { play, b, log } = atLog()
      // Walked at its middle from the brazier, she stands off it.
      const across = { x: log.x + (log.x - b.x), z: log.z + (log.z - b.z) }
      walkTo(play, across, 0.05, 3)
      expect(Math.hypot(play.holder.x - log.x, play.holder.z - log.z)).toBeGreaterThan(0.6)
    })
  })
})
