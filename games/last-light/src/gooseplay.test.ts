// The goose play on a route of its own (#187): walked on the keys, a sixtieth of
// a second a frame, as a player holding the keys toward each brazier in turn
// would, with no browser. What is checked is what the player would see: where
// the goose is, how much torch she has, which goslings are in the circle and
// where.
import { describe, expect, it } from 'vitest'
import { CAGE, CAGE_CAMPFIRE, CAGE_DOOR_OPENS, CAGE_DOOR_WIDTH, CAGE_DOOR_X, CAMPFIRE_OUTLINE, CORPSE_OUTLINE, FALL, FALL_CARRY, GOSLING_RADIUS, PIT_OUTLINE, PIT_PAD, RISE, SPAWN_TRUNK, TREE_FIRE_OUTLINE, TREE_OUTLINE, GOSLING_TOP, GoosePlay, HOP, TRUNK, WELL_BODIES, WELL_OUTLINE, WELL_RADIUS, WELL_REACH, cartMiddleOf, cartOf, turned, wellBodiesOf, type Cage, type GooseSettings } from './gooseplay'
import { HOLDER_RADIUS, within } from './walls'
import { type Brazier, type Point, type Route } from './plain'
import { STEP } from './swarm-remote'
import { FLICKER, shoreLight } from './swarm'

/** How near a brazier the walker stops, m: inside the torch's dip. */
const AT = 0.5
/** How near a fire pit's light, and the cage's campfire's, the walker stops, m: against its body, inside its dip. */
const AT_PIT = PIT_PAD + HOLDER_RADIUS + 0.1
const AT_CAMPFIRE = Math.max(...CAMPFIRE_OUTLINE.map((p) => Math.hypot(p.x, p.z))) + HOLDER_RADIUS + 0.1
/** How near the dead tree's trunk, and the brazier by it, the walker stops, m: against its roots, and its legs. */
const AT_TREE = Math.max(...TREE_OUTLINE.map((p) => Math.hypot(p.x, p.z))) + HOLDER_RADIUS + 0.1
const AT_TREE_FIRE = Math.max(...TREE_FIRE_OUTLINE.map((p) => Math.hypot(p.x, p.z))) + HOLDER_RADIUS + 0.1

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

/** How far `p` is off the nearest of `well`'s bodies, m: less than none inside one. */
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
/** Walk to brazier `b`'s place and play its scene as a player would: the torch filled there with the interact key, at the well's fire pit and the well winched up, at the tree its gosling called down and the torch filled at the brazier by it, at the cage its key fetched from beside the body and the cage opened. Whether she got there. */
function visit(play: GoosePlay, b: Brazier, each: (play: GoosePlay) => void = () => {}): boolean {
  if (!walkTo(play, b, b.scene === 'cage' ? AT_CAMPFIRE : b.scene === 'tree' ? AT_TREE : AT, 60, each)) return false
  if (b.scene === undefined) hold(play, play.settings.refillHold + STEP, each)
  if (b.scene === 'well') {
    if (!fillAtPit(play, b, each)) return false
    if (!walkTo(play, b.gosling!, AT_WELL, 60, each)) return false
    hold(play, play.settings.wellHold + STEP, each)
    if (!pastWell(play, b, each)) return false
  }
  if (b.scene === 'tree') {
    hold(play, play.settings.treeHold + STEP, each)
    stand(play, play.settings.treeJump + STEP, each)
    // The tree never burns: the torch is filled at the brazier by it.
    if (!fillAt(play, treeFire(play), each, AT_TREE_FIRE)) return false
  }
  if (b.scene === 'cage') {
    hold(play, play.settings.refillHold + STEP, each)
    if (!walkTo(play, cageOf(play).key, ON_KEY, 60, each)) return false
    hold(play, STEP, each)
    if (!walkTo(play, b.gosling!, AT_CAGE, 60, each)) return false
    unlock(play, each)
  }
  return true
}

/** Where the brazier by the dead tree stands. */
function treeFire(play: GoosePlay): Point {
  const tree = play.scenes.find((s) => s.kind === 'tree')
  if (tree?.kind !== 'tree') throw new Error('no tree')
  return tree.fire
}

/** At the fire at `at`, in its dip, `r` m off it: the torch filled with the interact key. Whether she got there. */
function fillAt(play: GoosePlay, at: Point, each: (play: GoosePlay) => void = () => {}, r = AT): boolean {
  if (!walkTo(play, at, r, 60, each)) return false
  hold(play, play.settings.refillHold + STEP, each)
  return true
}

/** At the well of brazier `b`, its light its fire pit's: the torch filled in the pit's dip with the interact key. Whether she got there. */
function fillAtPit(play: GoosePlay, b: Brazier, each: (play: GoosePlay) => void = () => {}): boolean {
  const k = play.plain.braziers.indexOf(b)
  const pit = play.wellFires.find((f) => f.brazier === k)
  const well = play.scenes.find((s) => s.brazier === k)
  if (pit === undefined || well === undefined) return false
  return toPit(play, well, play.level.lights[pit.light]!, each) && fillAt(play, play.level.lights[pit.light]!, each, AT_PIT)
}

/** To `pit`, the fire pit by `well`: round the well's end first if the pit is across it, past it up the plain. Whether she got there. */
function toPit(play: GoosePlay, well: Point, pit: Point, each: (play: GoosePlay) => void = () => {}): boolean {
  if (pit.z > well.z) return walkTo(play, pit, AT_PIT, 60, each)
  return walkTo(play, { x: well.x + ROUND_WELL, z: well.z + 1.3 }, AT, 60, each) && walkTo(play, { x: well.x + ROUND_WELL, z: pit.z }, AT, 60, each) && walkTo(play, pit, AT_PIT, 60, each)
}

/** From the well's brazier, on round the well's end, past its posts and crank, as a player would: it stands in the way up the plain. Whether she got there. */
function pastWell(play: GoosePlay, b: Brazier, each: (play: GoosePlay) => void = () => {}): boolean {
  return walkTo(play, { x: b.gosling!.x + ROUND_WELL, z: b.gosling!.z + 1.3 }, AT, 60, each) && walkTo(play, { x: b.gosling!.x + ROUND_WELL, z: b.gosling!.z }, AT, 60, each)
}

/** The goslings of `play`, every brazier of these routes having one. */
const goslingsOf = (play: GoosePlay) => play.goslings.map((g) => g!)
const circleOf = (play: GoosePlay) => goslingsOf(play).filter((g) => g.state === 'circle')

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

/** The route the walks are laid on: what seed 3 laid before the route was placed by hand, four scenes and the pond, its legs for a torch of 25 s. */
const ROUTE_THREE: Route = {
  start: { x: 3.3687400527264586, z: 53.29062770268293 },
  braziers: [
    { scene: 'well', x: -6.538965892135847, z: 30.81563333962167, reach: 3, gosling: { x: -5.338965892135848, z: 28.91563333962167 } },
    { scene: 'tree', x: 6.538965892135847, z: 9.730251511875863, reach: 3, gosling: { x: 6.538965892135847, z: 9.730251511875863 } },
    { scene: 'cage', x: -2.4052990058815134, z: -11.05996299046786, reach: 3, gosling: { x: -4.297032840210104, z: -11.709072457396552 }, skull: { x: 2.646987001774571, z: -13.233532887398376 } },
    { x: -4.256860621738649, z: -31.813460267843148, reach: 3, gosling: { x: -5.950135046014244, z: -31.662391660600782 } },
  ],
  pond: { x: -0.5001395349057045, z: -48.29062770268293, radius: 5, shore: 0.7937320580240339 },
}

/** A few rats, for the walks that are about the goslings. */
const FEW: Partial<GooseSettings> = { rats: 200, seed: 3, route: ROUTE_THREE, torch: 25 }

describe('the goose play', () => {
  it("lays the same plain for the same route, whatever the rats' seed", () => {
    expect(new GoosePlay({ ...FEW, seed: 9 }).plain).toEqual(new GoosePlay({ ...FEW, seed: 4 }).plain)
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

  it('burns the torch only from her first step', () => {
    const play = new GoosePlay(FEW)
    stand(play, 3)
    expect(play.run.fuel).toBe(1)
    expect(play.started).toBe(false)
    expect(walkTo(play, { x: play.holder.x, z: play.holder.z - 2 }, 0.05)).toBe(true)
    expect(play.started).toBe(true)
    expect(play.run.fuel).toBeLessThan(1)
    // Standing again, it burns on.
    const fuel = play.run.fuel
    stand(play, 1)
    expect(play.run.fuel).toBeLessThan(fuel - 0.03)
  })

  it("shrinks the torch's light with its fuel in a straight line, from full to nothing, and grows it back the same way as she fills it", () => {
    const play = new GoosePlay(FEW)
    const full = play.runTuning.torchReach
    const reachAt = (fuel: number) => {
      play.run.fuel = fuel
      stand(play, STEP)
      return play.run.torch.reach
    }
    for (const fuel of [1, 0.75, 0.5, 0.25, 0.05]) expect(reachAt(fuel) / full).toBeCloseTo(play.run.fuel, 6)
    expect(reachAt(0.001)).toBeLessThan(0.01)
  })

  it('starts her alone, with a full torch, every gosling waiting in its brazier\'s light', () => {
    const play = new GoosePlay(FEW)
    expect(play.run.torch.lit).toBe(true)
    expect(circleOf(play)).toHaveLength(0)
    goslingsOf(play).forEach((g, k) => {
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
      goslingsOf(p).forEach((g, k) => {
        // Climbing out of the well, it has not come over to her yet.
        if (g.state !== 'circle' || p.hopOf(k) !== null) return
        const d = Math.hypot(g.x - p.holder.x, g.z - p.holder.z)
        if (!came.has(k)) {
          if (d < p.run.torch.reach) came.add(k)
          return
        }
        // The light shrinks to nothing with the fuel: under a metre the huddle no longer fits in it.
        if (p.run.torch.reach < 1) return
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
    goslingsOf(play).forEach((g, k) => {
      if (k < 2) return expect(g.state).toBe('circle')
      expect(g.state).toBe('waiting')
      const { gosling } = play.plain.braziers[k]!
      expect(Math.hypot(g.x - gosling!.x, g.z - gosling!.z)).toBe(0)
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
    const at = goslingsOf(play).map((g) => ({ x: g.x, z: g.z }))
    stand(play, 3)
    goslingsOf(play).forEach((g, k) => expect(Math.hypot(g.x - at[k]!.x, g.z - at[k]!.z)).toBe(0))
    walkTo(play, { x: second!.x, z: second!.z - 3 }, 0.1)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - at[play.goslings.indexOf(g)]!.x, g.z - at[play.goslings.indexOf(g)]!.z)).toBeGreaterThan(1)
  })

  it('walks each gosling on its own legs, never faster than its top pace: running, she leaves them behind, and they catch up once she stops', () => {
    const play = new GoosePlay({ ...FEW, pace: 4 })
    const was = goslingsOf(play).map((g) => ({ x: g.x, z: g.z }))
    let fastest = 0
    let behind = 0
    const legs = (p: GoosePlay) => {
      goslingsOf(p).forEach((g, k) => {
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

  it('hands the swarm every gosling, waiting or in her circle; the rats close on the circle with the torch out, and leave it once she dips the torch in a flame', () => {
    // No bites: the goslings and she stay among the rats whatever they do.
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3, herBite: 0 })
    // A flame to dip the torch in: the cage's fire, the well's light being its fire pit's and the tree's beside it.
    const first = play.plain.braziers.find((b) => b.scene === 'cage')!
    play.giveGoslings(4)
    stand(play, 1)
    const all = () => goslingsOf(play).map(({ x, z }) => ({ x, z }))
    expect(play.targets).toEqual(all())
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
    play.started = true
    play.runTuning.burnRate = 1
    stand(play, 5)
    expect(play.run.torch.lit).toBe(false)
    expect(play.targets).toEqual(all())
    expect(atCircle()).toBeGreaterThan(10)
    // To the first flame and into it: the torch lit again, the circle in her light, and the rats off it.
    play.runTuning.burnRate = 1 / 25
    expect(fillAt(play, first, () => {}, AT_CAMPFIRE)).toBe(true)
    stand(play, 4)
    expect(play.run.torch.lit).toBe(true)
    expect(atCircle()).toBe(0)
  })

  it('never catches her and never starts the run again, the torch out among the rats', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3 })
    play.started = true
    play.runTuning.burnRate = 1
    let most = 0
    stand(play, 15, (p) => (most = Math.max(most, p.report?.reached ?? 0)))
    expect(most).toBeGreaterThan(play.runTuning.catchCount)
    expect(play.run.starts).toBe(0)
    expect(play.run.caught).toBe(0)
    expect(play.holder).toEqual(play.plain.start)
  })

  it('bites her life away among the rats with her torch out, and wakes her where she last filled it at a fire, whole, her circle round her', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3 })
    const well = play.plain.braziers.find((b) => b.scene === 'well')!
    expect(fillAtPit(play, well)).toBe(true)
    const filledAt = { ...play.holder }
    expect(play.restAt).toEqual(filledAt)
    // Out into the dark, the torch out, and among the rats.
    walkTo(play, { x: filledAt.x + 6, z: filledAt.z }, 0.3, 10)
    play.giveGoslings(2)
    play.runTuning.burnRate = 1
    // Standing there till her life runs out, and through her fall: she wakes where she filled the torch, her life full,
    // her goslings round her, alive, and her torch catches from the fire over her wake.
    for (let t = 0; t < 40 && play.deaths === 0; t += STEP) play.frame(STEP, { heading: null })
    expect(play.deaths).toBe(1)
    expect(play.holder.x).toBeCloseTo(filledAt.x, 5)
    expect(play.holder.z).toBeCloseTo(filledAt.z, 5)
    expect(play.life).toBe(1)
    expect(play.run.fuel).toBeLessThan(0.1)
    expect(circleOf(play)).toHaveLength(2)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - play.holder.x, g.z - play.holder.z)).toBeLessThan(1)
    stand(play, RISE - 0.1)
    expect(play.run.fuel).toBeGreaterThan(0.99)
    stand(play, 0.2)
    expect(play.down).toBe(false)
  })

  it('takes the keys from her as she falls and wakes, her torch dying and her circle huddling into her', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3 })
    play.giveGoslings(3)
    stand(play, 2)
    const near = () => Math.max(...circleOf(play).map((g) => Math.hypot(g.x - play.holder.x, g.z - play.holder.z)))
    const spread = near()
    // Her life gone where she stands, as if bitten away.
    play.life = 0
    play.bittenAt = play.t
    for (let t = 0; t < 1 && !play.down; t += STEP) play.frame(STEP, { heading: null })
    expect(Number.isNaN(play.fallen)).toBe(false)
    const fellAt = { ...play.holder }
    const fuel = play.run.fuel
    let east = 0
    for (let t = 0; t < FALL - 0.1; t += STEP) {
      play.frame(STEP, { heading: { x: 1, z: 0 }, interact: true })
      east = Math.max(east, play.holder.x - fellAt.x)
    }
    expect(east).toBe(0)
    expect(play.run.fuel).toBeLessThan(fuel)
    expect(play.run.torch.lit).toBe(false)
    expect(near()).toBeLessThan(spread)
    // Waking, the keys still do nothing till it is over.
    stand(play, 0.2)
    expect(play.deaths).toBe(1)
    const wokeAt = { ...play.holder }
    for (let t = 0; t < RISE - 0.3; t += STEP) play.frame(STEP, { heading: { x: 1, z: 0 } })
    expect(play.holder).toEqual(wokeAt)
    stand(play, 0.3)
    for (let t = 0; t < 1; t += STEP) play.frame(STEP, { heading: { x: 1, z: 0 } })
    expect(Math.hypot(play.holder.x - wokeAt.x, play.holder.z - wokeAt.z)).toBeGreaterThan(0.5)
  })

  it('carries him on the way he ran as he falls, slowing to a stop, whatever the keys say', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3 })
    stand(play, 0.5)
    for (let t = 0; t < 1; t += STEP) play.frame(STEP, { heading: { x: 1, z: 0 } })
    const pace = play.settings.pace
    play.life = 0
    play.bittenAt = play.t
    // Still running as his life runs out: he falls at the frame's end.
    play.frame(STEP, { heading: { x: 1, z: 0 } })
    expect(play.down).toBe(true)
    const fellAt = { ...play.holder }
    let was = { ...play.holder }
    let fastest = 0
    let slowedEach = true
    let prior = Number.POSITIVE_INFINITY
    for (let t = 0; t < FALL_CARRY + 0.2; t += STEP) {
      play.frame(STEP, { heading: { x: -1, z: 0 } })
      const moved = Math.hypot(play.holder.x - was.x, play.holder.z - was.z) / STEP
      if (moved > prior + 1e-9) slowedEach = false
      prior = moved
      fastest = Math.max(fastest, moved)
      was = { ...play.holder }
    }
    expect(Number.isNaN(play.fallen)).toBe(false)
    expect(fastest).toBeLessThanOrEqual(pace + 1e-6)
    expect(fastest).toBeGreaterThan(pace * 0.8)
    expect(slowedEach).toBe(true)
    expect(play.holder.x - fellAt.x).toBeGreaterThan(pace * FALL_CARRY * 0.2)
    expect(Math.abs(play.holder.z - fellAt.z)).toBeLessThan(0.05)
    const stopped = { ...play.holder }
    stand(play, 0.3)
    expect(play.holder).toEqual(stopped)
  })

  it('counts the rats biting him each frame, six at most, none while unbitten or down', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3 })
    expect(play.biters).toBe(0)
    walkTo(play, { x: play.holder.x + 6, z: play.holder.z }, 0.3, 10)
    play.runTuning.burnRate = 1
    let most = 0
    for (let t = 0; t < 40 && !play.down; t += STEP) {
      play.frame(STEP, { heading: null })
      if (play.bittenAt === play.t) expect(play.biters).toBeGreaterThan(0)
      else expect(play.biters).toBe(0)
      most = Math.max(most, play.biters)
      // Which way they bite him from: the way to the rats at him, on the ground, a unit vector; none, unbitten.
      const reach = play.tuning.holderReach
      let sx = 0
      let sz = 0
      for (let i = 0; i < play.swarm.count; i++) {
        const dx = play.swarm.x[i]! - play.holder.x
        const dz = play.swarm.z[i]! - play.holder.z
        if (dx * dx + dz * dz < reach * reach) {
          sx += dx
          sz += dz
        }
      }
      const d = Math.hypot(sx, sz)
      if (play.biters === 0 || d < 1e-9) expect(play.biteFrom).toEqual({ x: 0, z: 0 })
      else {
        expect(play.biteFrom.x).toBeCloseTo(sx / d, 6)
        expect(play.biteFrom.z).toBeCloseTo(sz / d, 6)
      }
    }
    expect(most).toBe(6)
    expect(play.down).toBe(true)
    play.frame(STEP, { heading: null })
    expect(play.biters).toBe(0)
  })

  it('heals her life only once no rat has bitten her for the set time', () => {
    const play = new GoosePlay({ ...FEW, healAfter: 2, heal: 0.25 })
    stand(play, 0.5)
    play.life = 0.5
    play.bittenAt = play.t
    stand(play, 1.5)
    expect(play.life).toBe(0.5)
    stand(play, 1)
    expect(play.life).toBeGreaterThan(0.5)
    stand(play, 3)
    expect(play.life).toBe(1)
  })

  it('never takes a gosling of her circle, however long the rats are on it', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3, herBite: 0 })
    play.giveGoslings(2)
    play.started = true
    play.runTuning.burnRate = 1
    stand(play, 15)
    expect(circleOf(play)).toHaveLength(2)
    expect(play.targets).toHaveLength(play.goslings.length)
    expect(play.deaths).toBe(0)
  })

  it('ends nothing at the pond: she wades into it, her goslings after her, and walks on out of it', () => {
    const play = new GoosePlay(FEW)
    for (const b of play.plain.braziers) expect(visit(play, b)).toBe(true)
    const { pond, braziers } = play.plain
    expect(walkTo(play, play.plain.home, 0.05)).toBe(true)
    expect(walkTo(play, pond, 0.05, 20)).toBe(true)
    stand(play, 4)
    expect(circleOf(play)).toHaveLength(play.goslings.length)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - pond.x, g.z - pond.z)).toBeLessThan(pond.radius)
    // Back out the way she came: she walks, and her goslings follow her.
    expect(walkTo(play, braziers.at(-1)!, AT, 40)).toBe(true)
    stand(play, 4)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - play.holder.x, g.z - play.holder.z)).toBeLessThan(1)
  })

  it('has a gosling waiting out in the pond come to her as soon as she is in its water', () => {
    const { pond, braziers } = ROUTE_THREE
    const last = braziers.length - 1
    const route: Route = { ...ROUTE_THREE, braziers: braziers.map((b, k) => (k === last ? { ...b, gosling: { x: pond.x, z: pond.z - 0.8 } } : b)) }
    const play = new GoosePlay({ ...FEW, route })
    play.giveGoslings(last)
    play.standByPond()
    stand(play, 0.5)
    expect(play.goslings[last]!.state).toBe('waiting')
    expect(walkTo(play, play.plain.home, 0.05)).toBe(true)
    expect(play.goslings[last]!.state).toBe('circle')
  })

  it('starts every rat round her, out of her light, none on the plain beyond', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 1000, seed: 3 })
    const { start } = play.plain
    for (let i = 0; i < play.swarm.count; i++) {
      const d = Math.hypot(play.swarm.x[i]! - start.x, play.swarm.z[i]! - start.z)
      expect(d).toBeGreaterThan(play.runTuning.torchReach)
      expect(d).toBeLessThan(12.01)
    }
  })

  it('keeps every rat out of the pond, held off it at its bank as off a light', () => {
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 1000, seed: 3 })
    for (const b of play.plain.braziers) expect(visit(play, b)).toBe(true)
    // In at its edge, and a moment for the rats that came after her to settle.
    expect(walkTo(play, play.plain.home, 0.05)).toBe(true)
    stand(play, 5)
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
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 1000, seed: 3 })
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
    const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 1000, seed: 3 })
    const near = (p: GoosePlay) => {
      let n = 0
      for (let i = 0; i < p.swarm.count; i++) if (Math.hypot(p.swarm.x[i]! - p.holder.x, p.swarm.z[i]! - p.holder.z) < 10) n++
      return n
    }
    for (const b of play.plain.braziers.slice(0, 4)) expect(visit(play, b)).toBe(true)
    expect(near(play)).toBeGreaterThan(100)
  })

  it('turns her, standing, to the way the camera looks, and walking, to the way she walks', () => {
    const play = new GoosePlay(FEW)
    const east = { x: 1, z: 0 }
    for (let t = 0; t < 2; t += STEP) play.frame(STEP, { heading: null, look: east })
    expect(play.facing.x).toBeCloseTo(1, 3)
    expect(Math.hypot(play.facing.x, play.facing.z)).toBeCloseTo(1, 6)
    const at = { ...play.holder }
    expect(play.holder).toEqual(at)
    for (let t = 0; t < 1; t += STEP) play.frame(STEP, { heading: { x: 0, z: 1 }, look: east })
    expect(play.facing.z).toBeCloseTo(1, 3)
  })

  describe('a piece turned on the route', () => {
    /** ROUTE_THREE with its well and its cage turned `turn` degrees. */
    const turnedRoute = (turn: number): Route => ({ ...ROUTE_THREE, braziers: ROUTE_THREE.braziers.map((b) => (b.scene === 'well' || b.scene === 'cage' ? { ...b, turn } : b)) })
    const wellOf = (play: GoosePlay) => play.scenes.find((s) => s.kind === 'well')!
    const close = (p: Point, q: Point) => {
      expect(p.x).toBeCloseTo(q.x, 6)
      expect(p.z).toBeCloseTo(q.z, 6)
    }

    it("turns the well's body with it, its brazier's place, unlit, still where the route stands it", () => {
      const play = new GoosePlay({ ...FEW, route: turnedRoute(90) })
      const well = wellOf(play)
      const turn = Math.PI / 2
      const [ring] = wellBodiesOf(well)
      ring!.outline.forEach((p, k) => close(p, turned(WELL_OUTLINE[k]!, turn)))
      const b = ROUTE_THREE.braziers[0]!
      close(play.level.lights[well.brazier]!, b)
      expect(play.level.lights[well.brazier]!.on).toBe(false)
    })

    it('turns an unturned well not at all', () => {
      const [ring] = wellBodiesOf(wellOf(new GoosePlay(FEW)))
      ring!.outline.forEach((p, k) => close(p, WELL_OUTLINE[k]!))
    })

    it("turns the cage's set as the route says, whatever way its campfire is", () => {
      const play = new GoosePlay({ ...FEW, route: turnedRoute(30) })
      const cage = play.scenes.find((s) => s.kind === 'cage')!
      expect(cage.kind === 'cage' && cage.turn).toBeCloseTo(Math.PI / 6, 9)
    })
  })

  describe('the well (#190)', () => {
    /** The play walked to the well's brazier, every scene before it played, standing at the well; and the well's gosling. */
    function atWell(settings: Partial<GooseSettings> = {}) {
      const play = new GoosePlay({ ...FEW, wellHold: 4, ...settings })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'well')
      const b = play.plain.braziers[k]!
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      expect(walkTo(play, b)).toBe(true)
      expect(walkTo(play, b.gosling!, AT_WELL)).toBe(true)
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
      // Round it.
      const round = [[2, 1], [2, -1], [0, -2], [-2, 0], [-2.9, 1], [-2.9, 2.6], [0, 2.5]] as const
      for (const to of round.map(([x, z]) => ({ x: well.x + x, z: well.z + z }))) {
        expect(walkTo(play, to, 0.1, 60, watch)).toBe(true)
      }
      stand(play, 2, watch)
      expect(closest).toBeGreaterThanOrEqual(GOSLING_RADIUS - 1e-6)
      expect(closest).toBeLessThan(0.5)
    })

    it("holds the rats off its fire pit as far as the settings say, the run and the swarm reading it live", () => {
      const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3 })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'well')
      const pit = play.wellFires.find((f) => f.brazier === k)!
      expect(play.level.lights[pit.light]!.reach).toBe(play.settings.wellFireReach)
      play.settings.wellFireReach = 5
      stand(play, STEP)
      const light = play.level.lights[pit.light]!
      expect(light.reach).toBe(5)
      expect(play.run.lights()[pit.light]!.reach).toBe(5)
      // Stood at it, the rats she draws press on its new edge and come no nearer, less a rat's size and the flame's lean.
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      expect(walkTo(play, light, AT_PIT)).toBe(true)
      let nearest = Infinity
      stand(play, 6, (p) => {
        for (let i = 0; i < p.swarm.count; i++) nearest = Math.min(nearest, Math.hypot(p.swarm.x[i]! - light.x, p.swarm.z[i]! - light.z))
      })
      expect(nearest).toBeGreaterThan(5 * (1 - FLICKER) - play.tuning.ratRadius)
      expect(nearest).toBeLessThan(5 + 1.5)
    })

    it('stops her at its outline from every side, its posts and the pumpkins at its foot as its wall', () => {
      // Never bitten down while she walks at it from every side.
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5, herBite: 0 })
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
      expect(tried).toBeGreaterThan(5)
    })

    it('holds the rats off it as off the water, drawn to its gosling down it', () => {
      const play = new GoosePlay({ route: ROUTE_THREE, torch: 25, rats: 2000, seed: 3, wellAhead: 8 })
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

    it('takes its fire pit with it, set ahead: its light lit, by the well; its brazier\'s place unlit', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
      const well = play.scenes.find((s) => s.kind === 'well')!
      expect(play.run.lights()[well.brazier]!.on).toBe(false)
      const pit = play.run.lights()[play.wellFires[0]!.light]!
      expect(pit.on).toBe(true)
      expect(Math.hypot(pit.x - well.x, pit.z - well.z)).toBeLessThan(pit.reach)
      expect(play.lights()).toContainEqual(pit)
    })

    it('fills the torch at its fire pit only while the interact key is held, over its set time, and lights it again if it was out', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5, refillHold: 2 })
      // In its dip.
      const pit = play.level.lights[play.wellFires[0]!.light]!
      expect(toPit(play, play.scenes.find((s) => s.kind === 'well')!, pit)).toBe(true)
      // Stood there, nothing.
      play.run.fuel = 0
      stand(play, 1)
      expect(play.run.torch.lit).toBe(false)
      expect(play.atRefill).toBe(true)
      // Held, it fills over the set time, out until full.
      hold(play, 1)
      expect(play.run.torch.lit).toBe(false)
      expect(play.kindled).toBeGreaterThan(0.45)
      expect(play.kindled).toBeLessThan(0.55)
      hold(play, 1.1)
      expect(play.run.torch.lit).toBe(true)
      expect(play.run.fuel).toBe(1)
      // Lit, held there, it tops up over the set time.
      play.run.fuel = 0.25
      hold(play, 1)
      expect(play.run.fuel).toBeGreaterThan(0.7)
      expect(play.run.fuel).toBeLessThan(0.8)
      hold(play, 0.6)
      // Full, there is nothing to do at it.
      expect(play.atRefill).toBe(false)
    })

    it('fills nothing held away from its fire pit', () => {
      const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
      // Under way, so the torch burns: it holds full until she first moves.
      play.started = true
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
      expect(walkTo(play, at, AT_TREE)).toBe(true)
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
      const at = { x: tree.place.x - 4, z: tree.place.z + 2.5 }
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
      expect(walkTo(play, b, AT_TREE)).toBe(true)
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

    it('lands its gosling where the page lands it, if it does, not where the settings land it', () => {
      const { play, k, tree } = atTree({ treeLanding: { x: 0.4, z: 0.9 } })
      play.landingOf = (t) => (t === tree ? { x: -0.7, z: 0.2 } : undefined)
      hold(play, play.settings.treeHold + STEP)
      stand(play, play.settings.treeJump + STEP)
      const g = play.goslings[k]!
      expect(g.x - tree.x).toBeCloseTo(-0.7, 1)
      expect(g.z - tree.z).toBeCloseTo(0.2, 1)
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
      expect(walkTo(play, tree, AT_TREE)).toBe(true)
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
      expect(walkTo(play, tree, AT_TREE)).toBe(true)
      stand(play, 1)
      expect(play.run.fuel).toBeLessThan(0.5)
    })

    it('takes a lit torch to call: with hers out, the interact key at its trunk does nothing', () => {
      const { play, k, tree } = atTree()
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
      // The torch filled at the campfire, then a step round it on the side away from the cart, as a player steps to go on
      // to the cage past it: the cart all but closes the way between them.
      expect(fillAt(play, b, () => {}, AT_CAMPFIRE)).toBe(true)
      const cage = play.scenes.find((s) => s.kind === 'cage')!
      if (cage.kind !== 'cage') throw new Error('no cage')
      const u = { x: cage.x - b.x, z: cage.z - b.z }
      const d = Math.hypot(u.x, u.z)
      const cart = cartMiddleOf(cage)
      const side = -Math.sign((cage.x + cart.x - b.x) * u.z - (cage.z + cart.z - b.z) * u.x) || 1
      expect(walkTo(play, { x: b.x + (u.z / d) * side * 1.5, z: b.z - (u.x / d) * side * 1.5 })).toBe(true)
      return { play, k, b, cage }
    }

    it("holds its gosling in it, in its brazier's light, its key beside the body out in the dark, off its skull", () => {
      const { play, k, b, cage } = atCage()
      expect(play.goslings[k]).toMatchObject({ ...b.gosling, state: 'waiting' })
      expect(cage).toMatchObject({ ...b.gosling, skull: b.skull, carried: false, open: false })
      const off = Math.hypot(cage.key.x - cage.skull.x, cage.key.z - cage.skull.z)
      expect(off).toBeGreaterThan(0.5)
      expect(off).toBeLessThan(1.3)
      for (const at of [cage.skull, cage.key]) for (const l of play.lights()) if (l.on && !l.shore) expect(Math.hypot(l.x - at.x, l.z - at.z)).toBeGreaterThan(l.reach * (1 + FLICKER))
    })

    it('lays its key where the settings set it by the body, and gives it up only in its zone as the settings move it', () => {
      const { play, cage } = atCage({ keyBeside: { x: 1, z: 0 }, keyZone: { x: 1, z: 0, scaleX: 0.5, scaleY: 0.5 } })
      stand(play, STEP)
      // Turned with its set: a metre from the skull.
      expect(Math.hypot(cage.key.x - cage.skull.x, cage.key.z - cage.skull.z)).toBeCloseTo(1, 6)
      expect(walkTo(play, cage.key, 0.05)).toBe(true)
      hold(play, 0.3)
      expect(cage.carried).toBe(false)
      expect(cage.takenAt).toBeNaN()
      expect(walkTo(play, { x: cage.key.x + 1, z: cage.key.z }, 0.05)).toBe(true)
      hold(play, STEP)
      expect(cage.carried).toBe(true)
      // Taken on the step just played.
      expect(cage.takenAt).toBeGreaterThan(play.t - STEP - 1e-9)
      expect(cage.takenAt).toBeLessThanOrEqual(play.t)
    })

    it('opens only in its zone as the settings move it', () => {
      const { play, b, cage } = atCage({ cageZone: { x: 0, z: 0, scaleX: 0.1, scaleY: 0.1 } })
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      expect(walkTo(play, b.gosling!, AT_CAGE)).toBe(true)
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

    it('stands its campfire, and its light, where the settings move it off its brazier, from the next frame, and fills the torch there', () => {
      const { play, b, cage } = atCage()
      play.settings.cageFire.x = 1.5
      play.settings.cageFire.z = -2
      stand(play, STEP)
      const at = { x: b.x + 1.5, z: b.z - 2 }
      expect(play.run.lights()[play.fireLightOf(cage)]).toMatchObject({ ...at, on: true })
      expect(play.lights()).toContainEqual(expect.objectContaining({ ...at, on: true }))
      const zone = play.fireZoneOf(cage)
      play.run.fuel = 0.5
      expect(walkTo(play, zone, AT_CAMPFIRE)).toBe(true)
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
      expect(walkTo(play, b.gosling!, AT_CAGE)).toBe(true)
      unlock(play)
      expect(cage.open).toBe(true)
      walkTo(play, middle, 0.05, 4, () => expect(off()).toBeGreaterThan(HOLDER_RADIUS - 0.01))
      expect(off()).toBeLessThan(HOLDER_RADIUS + 0.05)
    })

    it('opens to nothing but its key: the interact key at it with no key does nothing', () => {
      const { play, k, b, cage } = atCage()
      expect(walkTo(play, b.gosling!, AT_CAGE)).toBe(true)
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
      expect(walkTo(play, b.gosling!, AT_CAGE)).toBe(true)
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
      stand(play, CAGE_DOOR_OPENS + 1.5)
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
      expect(walkTo(play, b.gosling!, AT_CAGE)).toBe(true)
      stand(play, STEP)
      expect(cage.near).toBe(true)
      unlock(play)
      expect(cage.open).toBe(true)
      expect(cage.carried).toBe(false)
      expect(cage.near).toBe(false)
      // It waits for its door, walks out through it, and only then is with her.
      expect(play.goslings[k]!.state).toBe('waiting')
      stand(play, CAGE_DOOR_OPENS + 1.5)
      expect(play.goslings[k]!.state).toBe('circle')
      expect(play.circle).toBe(before + 1)
      stand(play, 2)
      expectArcBehind(play)
    })

    it('lets its gosling out only once its door is open, and only through the door', () => {
      const { play, k, b, cage } = atCage()
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      expect(walkTo(play, b.gosling!, AT_CAGE)).toBe(true)
      unlock(play)
      const g = play.goslings[k]!
      const caged = { x: g.x, z: g.z }
      // In the cage's own frame, unturned, from its middle.
      const local = () => turned({ x: g.x - cage.x, z: g.z - cage.z }, -cage.turn)
      stand(play, CAGE_DOOR_OPENS - 0.1)
      expect(Math.hypot(g.x - caged.x, g.z - caged.z)).toBeLessThan(1e-9)
      let wasIn = true
      stand(play, 3, () => {
        const p = local()
        const isIn = Math.abs(p.x) < CAGE && Math.abs(p.z) < CAGE
        // Out through the face its door is in, within the door's width.
        if (wasIn && !isIn) {
          expect(p.z).toBeGreaterThan(CAGE - 0.05)
          expect(Math.abs(p.x - CAGE_DOOR_X)).toBeLessThan(CAGE_DOOR_WIDTH / 2)
        }
        wasIn &&= isIn
      })
      expect(wasIn).toBe(false)
      expect(g.state).toBe('circle')
    })

    it('stops her at its bars while it is shut, and lets her goslings walk out of it once open', () => {
      const { play, b, cage } = atCage()
      // Walked at it from its far side, she stands off it.
      const away = { x: cage.x + (cage.x - b.x), z: cage.z + (cage.z - b.z) }
      walkTo(play, away, 0.05, 3)
      expect(Math.hypot(play.holder.x - cage.x, play.holder.z - cage.z)).toBeGreaterThan(0.45)
      expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
      hold(play, STEP)
      expect(walkTo(play, b.gosling!, AT_CAGE)).toBe(true)
      unlock(play)
      stand(play, 2)
      expectArcBehind(play)
    })
  })

  describe('a dying light', () => {
    /** One dying light up the plain from her, 10 m off: it starts dying once she is within 6 m, burns on 1 s, and goes out over 2 s. */
    const DYING: Route = {
      start: { x: 0, z: 20 },
      braziers: [{ x: 0, z: 10, reach: 3, gosling: { x: 0.5, z: 10 }, dying: { trigger: 6, after: 1, lasts: 2 } }],
      pond: { x: 0, z: -30, radius: 5, shore: 0.3 },
    }
    const lightOf = (play: GoosePlay) => play.level.lights[0]!

    it('burns full until she first comes near it, burns on its set time, then shrinks to nothing and is out', () => {
      const play = new GoosePlay({ ...FEW, route: DYING })
      stand(play, 3)
      expect(lightOf(play)).toMatchObject({ reach: 3, on: true })
      expect(play.dyingAt[0]).toBeNaN()
      expect(walkTo(play, { x: 0, z: 10 }, 5.9)).toBe(true)
      // Seen at the start of a frame, before she steps: within a frame or two of her coming in.
      expect(play.t - play.dyingAt[0]!).toBeLessThan(3 * STEP)
      stand(play, 1 - (play.t - play.dyingAt[0]!) - 0.05)
      expect(lightOf(play)).toMatchObject({ reach: 3, on: true })
      stand(play, 1.05)
      expect(lightOf(play).reach).toBeCloseTo(1.5, 1)
      expect(lightOf(play).on).toBe(true)
      stand(play, 1.05)
      expect(lightOf(play)).toMatchObject({ reach: 0, on: false })
      expect(play.lights()[0]!.on).toBe(false)
    })

    it('gives her its gosling as she walks into its light while it lasts', () => {
      // Burning long enough on that it is still whole as she gets there.
      const route = structuredClone(DYING)
      route.braziers[0]!.dying!.after = 10
      const play = new GoosePlay({ ...FEW, route })
      expect(walkTo(play, { x: 0, z: 10 }, 2.9)).toBe(true)
      stand(play, STEP)
      expect(play.goslings[0]!.state).toBe('circle')
    })

    it('leaves its gosling in the dark once it is out, found as her torch reaches it', () => {
      const play = new GoosePlay({ ...FEW, route: DYING })
      expect(walkTo(play, { x: 0, z: 10 }, 5.9)).toBe(true)
      stand(play, 3.1)
      expect(lightOf(play).on).toBe(false)
      const g = play.goslings[0]!
      expect(walkTo(play, g, play.run.torch.reach + 0.3)).toBe(true)
      stand(play, STEP)
      expect(g.state).toBe('waiting')
      expect(walkTo(play, g, play.run.torch.reach - 0.1)).toBe(true)
      stand(play, STEP)
      expect(g.state).toBe('circle')
    })
  })

  describe("a scene's pieces, each where the route has it", () => {
    /** ROUTE_THREE with the brazier of `scene` changed by `change`. */
    function moved(scene: string, change: (b: Brazier) => void): Route {
      const route = structuredClone(ROUTE_THREE)
      change(route.braziers.find((b) => b.scene === scene)!)
      return route
    }

    it("stands the dead tree's brazier, and its light, where the route has it, wherever the tree is", () => {
      const fire = { x: 9, z: 12 }
      const play = new GoosePlay({ ...FEW, route: moved('tree', (b) => (b.fire = fire)) })
      const tree = play.scenes.find((s) => s.kind === 'tree')!
      if (tree.kind !== 'tree') throw new Error('no tree')
      expect(tree.place).toEqual(fire)
      stand(play, STEP)
      expect(play.run.lights()[tree.fireLight]).toMatchObject({ ...fire, on: true })
      // The tree itself where it was.
      expect(tree).toMatchObject(ROUTE_THREE.braziers[1]!.gosling!)
    })

    it("moves its brazier's place, unlit, where the route has it, the well not", () => {
      const off = { x: -1.5, z: 2 }
      const before = new GoosePlay(FEW).scenes.find((s) => s.kind === 'well')!
      const play = new GoosePlay({ ...FEW, route: moved('well', (b) => ((b.x += off.x), (b.z += off.z))) })
      const well = play.scenes.find((s) => s.kind === 'well')!
      expect(well).toMatchObject({ x: before.x, z: before.z })
      const b = play.plain.braziers[well.brazier]!
      expect(play.run.lights()[well.brazier]).toMatchObject({ x: b.x, z: b.z, on: false })
    })

    it("stands the cage's cart where the route has it, a body there, the cage where it was", () => {
      const cart = { x: 4, z: -15 }
      const play = new GoosePlay({ ...FEW, route: moved('cage', (b) => (b.cart = cart)) })
      const cage = play.scenes.find((s) => s.kind === 'cage')!
      if (cage.kind !== 'cage') throw new Error('no cage')
      const middle = cartMiddleOf(cage)
      expect(cage.x + middle.x).toBeCloseTo(cart.x, 9)
      expect(cage.z + middle.z).toBeCloseTo(cart.z, 9)
      expect(cage).toMatchObject(ROUTE_THREE.braziers[2]!.gosling!)
      const outline = cartOf(cage)
      expect(within(outline, middle.x, middle.z)).toBe(true)
      expect(walkTo(play, cart, 0.05, 30)).toBe(false)
    })
  })
})

describe('the searching gosling', () => {
  /** ROUTE_THREE with a brazier at her start, its gosling at the edge of its light off to her right, her torch out. */
  const fire = { x: ROUTE_THREE.start.x, z: ROUTE_THREE.start.z - 0.7 }
  const home = { x: fire.x + 3.2, z: fire.z - 1 }
  const route: Route = {
    ...ROUTE_THREE,
    start: { ...ROUTE_THREE.start, unlit: true },
    braziers: [{ ...fire, reach: 4, gosling: home, searching: true }, ...ROUTE_THREE.braziers],
  }
  const first = () => new GoosePlay({ ...FEW, route })

  it('starts her with her torch out, lit at the brazier with the interact key held', () => {
    const play = first()
    expect(play.run.torch.lit).toBe(false)
    stand(play, 1)
    expect(play.run.torch.lit).toBe(false)
    expect(play.atRefill).toBe(true)
    hold(play, play.settings.refillHold * 0.9)
    expect(play.run.torch.lit).toBe(false)
    expect(play.kindled).toBeGreaterThan(0.85)
    hold(play, play.settings.refillHold * 0.2)
    expect(play.run.torch.lit).toBe(true)
    expect(play.run.fuel).toBeGreaterThan(0.99)
  })

  it("paces the edge of its light, looking out into the dark, and waits there though she starts in that light", () => {
    const play = first()
    const radius = Math.hypot(home.x - fire.x, home.z - fire.z)
    const seen: Point[] = []
    let looked = 0
    stand(play, 12, (p) => {
      const g = p.goslings[0]!
      seen.push({ x: g.x, z: g.z })
      expect(Math.hypot(g.x - fire.x, g.z - fire.z)).toBeCloseTo(radius, 5)
      expect(Math.hypot(g.x - home.x, g.z - home.z)).toBeLessThan(1.2)
      const look = p.lookOf(0)
      if (look === undefined) return
      looked++
      // Out from the fire, give or take a glance.
      const out = Math.atan2(g.x - fire.x, g.z - fire.z)
      expect(Math.abs(Math.atan2(Math.sin(look - out), Math.cos(look - out)))).toBeLessThan(0.6)
    })
    expect(play.goslings[0]!.state).toBe('waiting')
    expect(Math.max(...seen.map((p) => Math.hypot(p.x - home.x, p.z - home.z)))).toBeGreaterThan(0.5)
    expect(looked).toBeGreaterThan(0)
  })

  it('runs to her and joins her circle as she comes near it', () => {
    const play = first()
    hold(play, 2.5)
    const g = play.goslings[0]!
    expect(walkTo(play, g, 2.4, 10)).toBe(true)
    expect(g.state).toBe('circle')
  })
})

describe('a brazier with no gosling', () => {
  /** ROUTE_THREE with a fire alone at her start, her torch out. */
  const fire = { x: ROUTE_THREE.start.x, z: ROUTE_THREE.start.z - 0.7 }
  const route: Route = {
    ...ROUTE_THREE,
    start: { ...ROUTE_THREE.start, unlit: true },
    braziers: [{ ...fire, reach: 4 }, ...ROUTE_THREE.braziers],
  }
  const alone = () => new GoosePlay({ ...FEW, route })

  it('is a fire she lights her torch at, with nobody waiting in it', () => {
    const play = alone()
    expect(play.goslings[0]).toBeUndefined()
    expect(play.goslings.slice(1).every((g) => g?.state === 'waiting')).toBe(true)
    hold(play, 2.5)
    expect(play.run.fuel).toBeGreaterThan(0.99)
    stand(play, 2)
    expect(play.circle).toBe(0)
    expect(play.targets).toHaveLength(ROUTE_THREE.braziers.length)
  })

  it('loses what was filled, at a steady pace, the key let go before her torch is lit, the torch out all along', () => {
    const play = alone()
    hold(play, play.settings.refillHold / 2)
    expect(play.run.torch.lit).toBe(false)
    const half = play.kindled
    stand(play, play.settings.lightLetGo / 8)
    const first = half - play.kindled
    stand(play, play.settings.lightLetGo / 8)
    expect(half - play.kindled).toBeCloseTo(2 * first, 5)
    expect(first).toBeCloseTo(1 / 8, 1)
    stand(play, play.settings.lightLetGo)
    expect(play.kindled).toBe(0)
    expect(play.run.fuel).toBe(0)
    expect(play.run.torch.lit).toBe(false)
  })

  it('lights a torch burnt out the same way: out until filled full', () => {
    const play = alone()
    hold(play, play.settings.refillHold + STEP)
    play.run.fuel = 0
    hold(play, play.settings.refillHold / 2)
    expect(play.run.torch.lit).toBe(false)
    hold(play, play.settings.refillHold / 2 + STEP)
    expect(play.run.torch.lit).toBe(true)
  })

  it('marks when her torch catches full, lit from out, as filled from nothing', () => {
    const play = alone()
    expect(play.caughtAt).toBeNaN()
    hold(play, play.settings.refillHold * 0.9)
    expect(play.caughtAt).toBeNaN()
    let litAt = Number.NaN
    hold(play, play.settings.refillHold * 0.2, (p) => {
      if (Number.isNaN(litAt) && p.run.torch.lit) litAt = p.t
    })
    expect(play.caughtAt).toBe(litAt)
    expect(play.caughtFrom).toBe(0)
  })

  it('marks a top-up reaching full, from how low her torch was as the key went down', () => {
    const play = alone()
    hold(play, play.settings.refillHold + STEP)
    stand(play, 0.5)
    const first = play.caughtAt
    play.run.fuel = 0.4
    hold(play, play.settings.refillHold)
    expect(play.caughtAt).toBeGreaterThan(first)
    expect(play.caughtFrom).toBeCloseTo(0.4, 5)
  })

  it('marks nothing for a top-up let go short of full', () => {
    const play = alone()
    hold(play, play.settings.refillHold + STEP)
    const first = play.caughtAt
    play.run.fuel = 0.4
    hold(play, play.settings.refillHold * 0.2)
    stand(play, 0.5)
    hold(play, play.settings.refillHold * 0.2)
    expect(play.caughtAt).toBe(first)
  })

  it('keeps what a refill gave her, the key let go, once her torch has been lit', () => {
    const play = alone()
    hold(play, play.settings.refillHold + STEP)
    play.run.fuel = 0.5
    stand(play, 1)
    expect(play.run.fuel).toBe(0.5)
  })

  it('is passed over when a debug key gives her goslings', () => {
    const play = alone()
    play.giveGoslings(1)
    expect(play.circle).toBe(1)
    expect(play.goslings[1]!.state).toBe('circle')
  })
})

describe('the bodies on the ground', () => {
  /** ROUTE_THREE with the spawn's fire, its burning tree, ahead of her start. */
  const spawn = { x: ROUTE_THREE.start.x, z: ROUTE_THREE.start.z - 3 }
  const route: Route = { ...ROUTE_THREE, braziers: [{ ...spawn, reach: 4 }, ...ROUTE_THREE.braziers] }

  it("keeps her out of the burning tree's trunk, and fills the torch at it from round it", () => {
    const play = new GoosePlay({ ...FEW, route })
    walkTo(play, spawn, 0.05, 3, () => expect(offWell(spawn, play.holder, SPAWN_TRUNK)).toBeGreaterThan(HOLDER_RADIUS - 0.01))
    expect(offWell(spawn, play.holder, SPAWN_TRUNK)).toBeLessThan(HOLDER_RADIUS + 0.05)
    play.run.fuel = 0.5
    hold(play, 0.5)
    expect(play.run.fuel).toBeGreaterThan(0.6)
  })

  it("keeps her out of the well's fire pit, wherever the settings move it", () => {
    const play = new GoosePlay({ ...FEW, wellAhead: 3.5 })
    play.settings.wellFire.x = 1
    stand(play, STEP)
    const pit = play.level.lights[play.wellFires[0]!.light]!
    expect(toPit(play, play.scenes.find((s) => s.kind === 'well')!, pit)).toBe(true)
    walkTo(play, pit, 0.05, 2, () => expect(offWell(pit, play.holder, PIT_OUTLINE)).toBeGreaterThan(HOLDER_RADIUS - 0.01))
    expect(offWell(pit, play.holder, PIT_OUTLINE)).toBeLessThan(HOLDER_RADIUS + 0.05)
  })

  it('keeps her out of the dead tree and the brazier by it, wherever the settings move the brazier', () => {
    const play = new GoosePlay({ ...FEW, herBite: 0 })
    const k = play.plain.braziers.findIndex((b) => b.scene === 'tree')
    for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
    const tree = play.scenes.find((s) => s.kind === 'tree')!
    if (tree.kind !== 'tree') throw new Error('no tree')
    walkTo(play, tree, 0.05, 30, () => expect(offWell(tree, play.holder, TREE_OUTLINE)).toBeGreaterThan(HOLDER_RADIUS - 0.01))
    expect(offWell(tree, play.holder, TREE_OUTLINE)).toBeLessThan(HOLDER_RADIUS + 0.05)
    play.settings.treeFire.x = 0.5
    stand(play, STEP)
    const fire = { ...tree.fire }
    walkTo(play, fire, 0.05, 15, () => expect(offWell(fire, play.holder, TREE_FIRE_OUTLINE)).toBeGreaterThan(HOLDER_RADIUS - 0.01))
    expect(offWell(fire, play.holder, TREE_FIRE_OUTLINE)).toBeLessThan(HOLDER_RADIUS + 0.05)
  })

  it("keeps her out of the cage's campfire, turned with its set, and out of the dead body by its skull", () => {
    const play = new GoosePlay({ ...FEW })
    const k = play.plain.braziers.findIndex((b) => b.scene === 'cage')
    for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
    const cage = cageOf(play)
    const fire = play.level.lights[k]!
    const campfire = CAMPFIRE_OUTLINE.map((p) => turned(p, cage.turn))
    walkTo(play, fire, 0.05, 15, () => expect(offWell(fire, play.holder, campfire)).toBeGreaterThan(HOLDER_RADIUS - 0.01))
    expect(offWell(fire, play.holder, campfire)).toBeLessThan(HOLDER_RADIUS + 0.05)
    // At the key, then walked at the body's middle.
    expect(walkTo(play, cage.key, ON_KEY)).toBe(true)
    const corpse = CORPSE_OUTLINE.map((p) => turned(p, cage.turn))
    const middle = turned({ x: 0.07, z: 0.35 }, cage.turn)
    walkTo(play, { x: cage.skull.x + middle.x, z: cage.skull.z + middle.z }, 0.05, 3, () => expect(offWell(cage.skull, play.holder, corpse)).toBeGreaterThan(HOLDER_RADIUS - 0.01))
    expect(offWell(cage.skull, play.holder, corpse)).toBeLessThan(HOLDER_RADIUS + 0.05)
  })

  describe('the dead trees by the road', () => {
    /** The play, one trunk `radius` m round laid 2 m up the plain from her start; and that trunk. */
    function byTrunk(radius = 0.2) {
      const play = new GoosePlay(FEW)
      const trunk = { at: { x: play.holder.x, z: play.holder.z - 2 }, radius }
      play.setTrunks([trunk])
      return { play, trunk }
    }
    const offTrunk = (trunk: { at: Point; radius: number }, p: Point) => Math.hypot(p.x - trunk.at.x, p.z - trunk.at.z) - trunk.radius

    it('stops her at its trunk, walking at it, and lets her walk round it', () => {
      const { play, trunk } = byTrunk()
      walkTo(play, trunk.at, 0.05, 3, (p) => expect(offTrunk(trunk, p.holder)).toBeGreaterThan(HOLDER_RADIUS - 1e-6))
      expect(offTrunk(trunk, play.holder)).toBeCloseTo(HOLDER_RADIUS, 2)
      // Round it by its side to the far side.
      expect(walkTo(play, { x: trunk.at.x + 1, z: trunk.at.z }, 0.1)).toBe(true)
      expect(walkTo(play, { x: trunk.at.x, z: trunk.at.z - 1.5 }, 0.1)).toBe(true)
    })

    it('keeps her goslings out of it: walking after her past it, none goes through it', () => {
      const { play, trunk } = byTrunk()
      play.giveGoslings(play.goslings.length)
      stand(play, 2)
      let closest = Infinity
      const watch = (p: GoosePlay) => {
        for (const g of circleOf(p)) closest = Math.min(closest, offTrunk(trunk, g))
      }
      for (const to of [[0.6, 0], [0.6, -1.5], [0, -2.5], [-0.6, -1.5], [-0.6, 1]] as const) {
        expect(walkTo(play, { x: trunk.at.x + to[0], z: trunk.at.z + to[1] }, 0.1, 60, watch)).toBe(true)
      }
      stand(play, 2, watch)
      expect(closest).toBeGreaterThanOrEqual(GOSLING_RADIUS - 1e-6)
    })

    it('takes the trunks away as they are laid again with none', () => {
      const { play, trunk } = byTrunk()
      play.setTrunks([])
      expect(walkTo(play, trunk.at, 0.1, 3)).toBe(true)
    })
  })

  describe("the dead tree's pumpkins", () => {
    /** The play, one pumpkin `radius` m round laid 2 m up the plain from her start, the trunks laid too; and that pumpkin. */
    function byPumpkin(radius = 0.25) {
      const play = new GoosePlay(FEW)
      const pumpkin = { at: { x: play.holder.x, z: play.holder.z - 2 }, radius }
      play.setPumpkins([pumpkin])
      play.setTrunks([{ at: { x: play.holder.x + 6, z: play.holder.z }, radius: 0.2 }])
      return { play, pumpkin }
    }
    const offPumpkin = (pumpkin: { at: Point; radius: number }, p: Point) => Math.hypot(p.x - pumpkin.at.x, p.z - pumpkin.at.z) - pumpkin.radius

    it('stops her at a pumpkin, the trunks laid or not, and lets her walk round it', () => {
      const { play, pumpkin } = byPumpkin()
      walkTo(play, pumpkin.at, 0.05, 3, (p) => expect(offPumpkin(pumpkin, p.holder)).toBeGreaterThan(HOLDER_RADIUS - 1e-6))
      expect(offPumpkin(pumpkin, play.holder)).toBeCloseTo(HOLDER_RADIUS, 2)
      expect(walkTo(play, { x: pumpkin.at.x + 1, z: pumpkin.at.z }, 0.1)).toBe(true)
      expect(walkTo(play, { x: pumpkin.at.x, z: pumpkin.at.z - 1.5 }, 0.1)).toBe(true)
    })

    it('keeps her goslings out of it: walking after her past it, none goes through it', () => {
      const { play, pumpkin } = byPumpkin()
      play.giveGoslings(play.goslings.length)
      stand(play, 2)
      let closest = Infinity
      const watch = (p: GoosePlay) => {
        for (const g of circleOf(p)) closest = Math.min(closest, offPumpkin(pumpkin, g))
      }
      for (const to of [[0.6, 0], [0.6, -1.5], [0, -2.5], [-0.6, -1.5], [-0.6, 1]] as const) {
        expect(walkTo(play, { x: pumpkin.at.x + to[0], z: pumpkin.at.z + to[1] }, 0.1, 60, watch)).toBe(true)
      }
      stand(play, 2, watch)
      expect(closest).toBeGreaterThanOrEqual(GOSLING_RADIUS - 1e-6)
    })
  })

  describe('the last gosling leading her home', () => {
    it('goes on ahead of her, found, never into her circle, and waits there looking back at her', () => {
      const play = new GoosePlay({ ...FEW, lastGuides: true })
      const last = play.goslings.reduce((found, g, k) => (g && play.plain.braziers[k]!.scene === undefined ? k : found), -1)
      expect(play.guide).toBe(last)
      play.giveGoslings(play.goslings.length)
      expect(play.goslings[play.guide]!.state).toBe('guiding')
      expect(play.circle).toBe(play.goslings.filter(Boolean).length - 1)
      const ahead = { x: play.holder.x + 1, z: play.holder.z }
      play.guideTo = () => ahead
      stand(play, 4)
      const g = play.goslings[play.guide]!
      expect(Math.hypot(g.x - ahead.x, g.z - ahead.z)).toBeLessThan(0.05)
      expect(play.lookOf(play.guide)).toBeCloseTo(Math.atan2(play.holder.x - g.x, play.holder.z - g.z))
    })

    it('waits out in the water, found, never coming back to her, and goes on as soon as she comes up', () => {
      const play = new GoosePlay({ ...FEW, lastGuides: true })
      play.giveGoslings(play.goslings.length)
      play.guideTo = (holder) => ({ x: holder.x, z: holder.z - 3.5 })
      const g = play.goslings[play.guide]!
      const waits = { x: g.x, z: g.z }
      Object.assign(play.holder, { x: g.x, z: g.z + 6 })
      stand(play, 1)
      expect(Math.hypot(g.x - waits.x, g.z - waits.z)).toBeLessThan(1e-9)
      expect(play.guideWaits).toBeGreaterThan(0.9)
      Object.assign(play.holder, { x: g.x, z: g.z + 2 })
      stand(play, 0.2)
      expect(g.z).toBeLessThan(waits.z - 0.1)
      expect(play.guideWaits).toBe(0)
    })

    it('has none without lastGuides', () => {
      expect(new GoosePlay(FEW).guide).toBe(-1)
    })
  })
})
