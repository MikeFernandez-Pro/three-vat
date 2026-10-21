// The goose play on the seed's plain (#187): walked on the keys, a sixtieth of
// a second a frame, as a player holding the keys toward each brazier in turn
// would, with no browser. What is checked is what the player would see: where
// the goose is, how much torch she has, which goslings are in the circle and
// where, which were taken and when, and whether the run has ended, with what
// count.
import { describe, expect, it } from 'vitest'
import { GOSLING_TOP, GoosePlay, WELL_REACH, type GooseSettings } from './gooseplay'
import type { Brazier, Point } from './plain'
import { STEP } from './swarm-remote'
import { shoreLight } from './swarm'

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

/** How near the well the walker stands to winch, m, inside its reach. */
const AT_WELL = 0.9

/** Walk to brazier `b`'s place and play its scene as a player would: the well winched up, the tree lit. Whether she got there. */
function visit(play: GoosePlay, b: Brazier, each: (play: GoosePlay) => void = () => {}): boolean {
  if (!walkTo(play, b, AT, 60, each)) return false
  if (b.scene === 'well') {
    if (!walkTo(play, b.gosling, AT_WELL, 60, each)) return false
    hold(play, play.settings.wellHold + STEP, each)
  }
  if (b.scene === 'tree') hold(play, STEP, each)
  return true
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

  it('refuels at each brazier walked into, and gathers its gosling there, the scenes played on the way', () => {
    const play = new GoosePlay(FEW)
    play.plain.braziers.forEach((b, k) => {
      if (b.scene !== undefined) return expect(visit(play, b)).toBe(true)
      expect(walkTo(play, b)).toBe(true)
      expect(play.run.torch.lit).toBe(true)
      stand(play, STEP)
      expect(play.run.fuel).toBeCloseTo(1, 2)
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
        if (g.state !== 'circle') return
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
        fastest = Math.max(fastest, Math.hypot(g.x - was[k]!.x, g.z - was[k]!.z) / STEP)
        was[k]!.x = g.x
        was[k]!.z = g.z
        if (g.state === 'circle') behind = Math.max(behind, Math.hypot(g.x - p.holder.x, g.z - p.holder.z))
      })
    }
    for (const b of play.plain.braziers.slice(0, 3)) expect(visit(play, b, legs)).toBe(true)
    expect(fastest).toBeLessThanOrEqual(GOSLING_TOP[1]! + 1e-6)
    expect(behind).toBeGreaterThan(play.run.torch.reach)
    stand(play, 10, legs)
    for (const g of circleOf(play)) expect(Math.hypot(g.x - play.holder.x, g.z - play.holder.z)).toBeLessThan(1)
  })

  it('in the dark, after the grace, loses a gosling, then one each interval, until she dips the torch in a flame', () => {
    const play = new GoosePlay({ ...FEW, grace: 2, interval: 3 })
    const [first, second, third] = play.plain.braziers
    for (const b of [first!, second!, third!]) expect(visit(play, b)).toBe(true)
    expect(circleOf(play)).toHaveLength(3)
    // On out of the brazier's light into the dark, and the torch burnt down fast.
    expect(walkTo(play, { x: third!.x, z: third!.z - 4 }, 0.1)).toBe(true)
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
    expect(walkTo(play, { x: third!.x, z: third!.z - 4 }, 0.1)).toBe(true)
    play.runTuning.burnRate = 1
    stand(play, 3.5)
    expect(play.run.torch.lit).toBe(false)
    expect(play.takings).toHaveLength(1)
    const taken = play.takings[0]!
    expect(play.goslings[taken.gosling]!.state).toBe('taken')
    // Back into the flame: the torch lit again, and the toll stops, however long she stays.
    play.runTuning.burnRate = 1 / 25
    expect(walkTo(play, third!)).toBe(true)
    stand(play, 10)
    expect(play.run.torch.lit).toBe(true)
    expect(play.takings).toHaveLength(1)
    expect(circleOf(play)).toHaveLength(2)
    // On to the next brazier and the one after: the taken one stays taken, where it was taken.
    expect(visit(play, fourth!)).toBe(true)
    for (const b of play.plain.braziers.slice(4)) expect(visit(play, b)).toBe(true)
    expect(play.goslings[taken.gosling]!.state).toBe('taken')
    expect(play.goslings[taken.gosling]).toMatchObject({ x: taken.x, z: taken.z })
    expect(circleOf(play)).toHaveLength(play.goslings.length - 1)
    // Home with one fewer.
    expect(wadeHome(play)).toBe(true)
    expect(play.cameHome).toBe(play.goslings.length - 1)
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
      stand(play, 2)
      expectArcBehind(play)
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

    it("winches from inside its brazier's light, wherever round the well she stands, and never from its dip", () => {
      const { play, k, well } = atWell()
      const b = play.plain.braziers[k]!
      const reach = Math.hypot(well.x - b.x, well.z - b.z)
      expect(reach + WELL_REACH).toBeLessThan(b.reach)
      expect(reach - WELL_REACH).toBeGreaterThan(play.runTuning.dip)
    })

    it('winches nothing from out of its reach', () => {
      const { play, k, well } = atWell()
      expect(walkTo(play, { x: well.x, z: well.z + 3 }, 0.1)).toBe(true)
      hold(play, 5)
      expect(well.wound).toBe(0)
      expect(play.goslings[k]!.state).toBe('waiting')
    })
  })

  describe('the dead tree (#190)', () => {
    /** The play walked to the tree, every scene before it played; the tree's gosling, and its light as the swarm reads it. */
    function atTree(settings: Partial<GooseSettings> = {}) {
      const play = new GoosePlay({ ...FEW, treeBurn: 12, ...settings })
      const k = play.plain.braziers.findIndex((b) => b.scene === 'tree')
      const b = play.plain.braziers[k]!
      for (const before of play.plain.braziers.slice(0, k)) expect(visit(play, before)).toBe(true)
      expect(walkTo(play, b)).toBe(true)
      const light = () => play.lights().find((l) => l.x === b.x && l.z === b.z)!
      return { play, k, b, tree: play.scenes.find((s) => s.kind === 'tree')!, light }
    }

    it('stands dark with its gosling up it until the interact key at its trunk lights it; the gosling joins her circle as it catches', () => {
      const { play, k, tree, light } = atTree()
      stand(play, 1)
      expect(light().on).toBe(false)
      expect(play.goslings[k]!.state).toBe('waiting')
      expect(tree.burning).toBe(false)
      hold(play, STEP)
      expect(tree.burning).toBe(true)
      expect(tree.litAt).toBeCloseTo(play.t, 6)
      expect(light().on).toBe(true)
      expect(play.goslings[k]!.state).toBe('circle')
      expect(play.goslings[k]!.gatheredAt).toBeCloseTo(play.t, 6)
      stand(play, 2)
      expectArcBehind(play)
    })

    it('refuels the torch and holds the rats off while it burns', () => {
      const { play, b, light } = atTree({ rats: 2000 })
      hold(play, STEP)
      play.run.fuel = 0.3
      stand(play, STEP * 2)
      expect(play.run.fuel).toBeCloseTo(1, 2)
      // Off along the route, out of its light: no rat in it, while some press at its edge.
      expect(walkTo(play, { x: b.x + 6, z: b.z }, 0.1)).toBe(true)
      let inLight = 0
      let atEdge = 0
      stand(play, 4, (p) => {
        for (let i = 0; i < p.swarm.count; i++) {
          const d = Math.hypot(p.swarm.x[i]! - b.x, p.swarm.z[i]! - b.z)
          if (d < light().reach - p.tuning.ratRadius - 0.3) inLight++
          if (d < light().reach + 1.5) atEdge++
        }
      })
      expect(inLight).toBe(0)
      expect(atEdge).toBeGreaterThan(0)
    })

    it('burns its set time and dies for good: out, it refuels nothing and the interact key lights it no more', () => {
      const { play, k, tree, light } = atTree()
      hold(play, STEP)
      stand(play, 11.8)
      expect(tree.burning).toBe(true)
      stand(play, 0.3)
      expect(tree.burning).toBe(false)
      expect(light().on).toBe(false)
      play.run.fuel = 0.5
      hold(play, 1)
      expect(tree.burning).toBe(false)
      expect(light().on).toBe(false)
      expect(play.run.fuel).toBeLessThan(0.5)
      expect(play.goslings[k]!.state).toBe('circle')
    })

    it('takes a lit torch to light it: with hers out, the interact key at its trunk does nothing', () => {
      const { play, k, tree } = atTree({ grace: 60 })
      play.run.fuel = 0
      hold(play, 1)
      expect(tree.burning).toBe(false)
      expect(play.goslings[k]!.state).toBe('waiting')
    })
  })
})
