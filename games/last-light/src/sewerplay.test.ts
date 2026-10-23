import { describe, expect, it } from 'vitest'
import { SewerPlay } from './sewerplay'
import { cellAt, colliderPad, hubSide, inCanal, inCanalGallery } from './sewers'
import { STEP } from './swarm-remote'
import type { Point } from './sewers'

/** Walk the child toward `to` for at most `seconds`, a frame at a time; whether he got within `r`. */
function walkTo(play: SewerPlay, to: Point, seconds: number, r = 0.4, interact = false): boolean {
  for (let t = 0; t < seconds; t += STEP) {
    const h = play.holder
    const d = Math.hypot(to.x - h.x, to.z - h.z)
    if (d <= r) return true
    play.frame(STEP, { heading: { x: (to.x - h.x) / d, z: (to.z - h.z) / d }, interact })
  }
  return false
}

describe('the sewers play', () => {
  it('sets every rat down all round on the hub side of the huge door and the canal walkways, on the floor, none on him', () => {
    const play = new SewerPlay({ rats: 2000 })
    const { swarm, map } = play
    let off = 0
    let near = 0
    for (let i = 0; i < swarm.count; i++) {
      const x = swarm.x[i]!
      const z = swarm.z[i]!
      if (cellAt(map.grid, x, z) !== 1 || !hubSide(x, z) || inCanal(map, x, z)) off++
      if (Math.hypot(x - play.holder.x, z - play.holder.z) < 3.5) near++
    }
    expect(off).toBe(0)
    expect(near).toBe(0)
    // Both branches have their share.
    const west = Array.from({ length: swarm.count }, (_, i) => swarm.x[i]!).filter((x) => x < -12).length
    const east = Array.from({ length: swarm.count }, (_, i) => swarm.x[i]!).filter((x) => x > 12).length
    expect(west).toBeGreaterThan(100)
    expect(east).toBeGreaterThan(100)
    // And the canal's walkways have theirs, waiting behind the door.
    expect(Array.from({ length: swarm.count }, (_, i) => inCanalGallery(swarm.x[i]!, swarm.z[i]!)).filter(Boolean).length).toBeGreaterThan(50)
  })

  it('wakes with the stick unlit, rats round the lantern, which lights it at F', () => {
    const play = new SewerPlay({ rats: 2000 })
    expect(play.run.torch.lit).toBe(false)
    const { x, z } = play.holder
    let near = 0
    for (let i = 0; i < play.swarm.count; i++) if (Math.hypot(play.swarm.x[i]! - x, play.swarm.z[i]! - z) < 8) near++
    expect(near).toBeGreaterThan(40)
    expect(walkTo(play, { x: 1.4, z: 19.8 }, 5, 0.1)).toBe(true)
    play.frame(STEP, { heading: null })
    expect(play.lit).toBe(false)
    expect(play.prompt()?.what).toBe('light')
    play.frame(STEP, { heading: null, interact: true })
    expect(play.lit).toBe(true)
    expect(play.left).toBeGreaterThan(12)
  })

  it('walks him straight up the collector to the hub', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    expect(walkTo(play, { x: 0, z: -5.2 }, 20, 0.4)).toBe(true)
  })

  it('walks him the whole chandeliers gallery to its lever', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    play.skipTo(2)
    play.run.holder.x = 6.3
    play.run.holder.z = -11.2
    expect(walkTo(play, play.map.levers[1]!, 30, 0.5 + colliderPad(play.map.levers[1]!))).toBe(true)
  })

  it('drives the rats out of the fallen chandeliers\' light', () => {
    const play = new SewerPlay({ rats: 2000, everlasting: true })
    play.skipTo(2)
    const lever = play.map.levers[1]!
    play.run.holder.x = lever.x
    play.run.holder.z = lever.z
    const inLight = () => {
      let n = 0
      for (let i = 0; i < play.swarm.count; i++) {
        if (play.map.chandeliers.some((c) => Math.hypot(play.swarm.x[i]! - play.map.lights[c.light]!.x, play.swarm.z[i]! - play.map.lights[c.light]!.z) < 3.2)) n++
      }
      return n
    }
    for (let t = 0; t < 8; t += STEP) play.frame(STEP, { heading: null })
    expect(inLight()).toBeGreaterThan(50)
    for (let t = 0; !play.fallen && t < 5; t += STEP) play.frame(STEP, { heading: null, interact: true })
    expect(play.fallen).toBe(true)
    for (let t = 0; t < 3; t += STEP) play.frame(STEP, { heading: null })
    expect(inLight()).toBeLessThan(20)
  })

  it('sends the rats in the fallen chandeliers\' light into the escape holes between them', () => {
    const play = new SewerPlay({ rats: 2000, everlasting: true })
    play.skipTo(2)
    const lever = play.map.levers[1]!
    play.run.holder.x = lever.x
    play.run.holder.z = lever.z
    expect(play.map.escapes.length).toBe(6)
    for (let t = 0; t < 4; t += STEP) play.frame(STEP, { heading: null })
    for (let t = 0; !play.fallen && t < 5; t += STEP) play.frame(STEP, { heading: null, interact: true })
    expect(play.fallen).toBe(true)
    const before = play.escaped
    for (let t = 0; t < 3; t += STEP) play.frame(STEP, { heading: null })
    expect(play.escaped - before).toBeGreaterThan(20)
  })

  it('keeps a checkpoint at each branch\'s lever, and the hub again on coming back to it', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    play.skipTo(1)
    const zones = play.map.level.checkpoints!
    const gas = zones.findIndex((zone) => zone.at.x < -30)
    play.run.holder.x = zones[gas]!.at.x
    play.run.holder.z = zones[gas]!.at.z
    play.frame(STEP, { heading: null })
    expect(play.run.zone).toBe(gas)
    play.run.holder.x = zones[play.map.hubZone]!.at.x
    play.run.holder.z = zones[play.map.hubZone]!.at.z
    play.frame(STEP, { heading: null })
    expect(play.run.zone).toBe(play.map.hubZone)
  })

  it('starts him again at the gas branch mouth when caught after walking back out through it', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    play.skipTo(2)
    const zones = play.map.level.checkpoints!
    const lever = zones.findIndex((zone) => zone.at.x < -30)
    const mouth = zones.findIndex((zone) => zone.again && zone.at.x < -5)
    expect(mouth).toBeGreaterThan(0)
    // At the gas lever, then back out through the mouth toward the chandeliers.
    play.run.holder.x = zones[lever]!.at.x
    play.run.holder.z = zones[lever]!.at.z
    play.frame(STEP, { heading: null })
    expect(play.run.zone).toBe(lever)
    play.run.holder.x = zones[mouth]!.at.x
    play.run.holder.z = zones[mouth]!.at.z
    play.frame(STEP, { heading: null })
    expect(play.run.zone).toBe(mouth)
  })

  it('wears his hidden life down while rats touch him and lets it come back, catching him only at nothing', () => {
    const play = new SewerPlay({ rats: 2000 })
    play.skipTo(1)
    play.run.fuel = 0
    let touchedFor = 0
    for (let t = 0; t < 20 && play.caught === 0; t += STEP) {
      play.frame(STEP, { heading: null })
      if ((play.report?.reached ?? 0) > 0) touchedFor += STEP
    }
    expect(play.caught).toBe(1)
    expect(touchedFor).toBeGreaterThan(1)
    expect(play.life).toBe(1)
  })

  it('keeps every rat out of the canal as he wades up it in the dark, and gathers most of them in the cistern ahead', () => {
    const play = new SewerPlay({ rats: 2000, everlasting: true })
    play.skipTo(3)
    for (let t = 0; t < 6 && !play.pulled.hub; t += STEP) play.frame(STEP, { heading: null, interact: true })
    expect(play.pulled.hub).toBe(true)
    const { swarm, map } = play
    const inCistern = () => Array.from({ length: swarm.count }, (_, i) => Math.hypot(swarm.x[i]! - map.cistern.x, swarm.z[i]! - map.cistern.z) < map.cistern.r).filter(Boolean).length
    expect(inCistern()).toBe(0)
    play.settings.everlasting = false
    play.run.holder.x = 0
    play.run.holder.z = -21.8
    play.run.fuel = 0
    let wet = 0
    let walkways = 0
    for (const p of [{ x: 0, z: -26 }, { x: 0, z: -31 }, { x: 0, z: -36 }, { x: 0, z: -41 }]) {
      walkTo(play, p, 8, 0.3)
      for (let i = 0; i < swarm.count; i++) {
        const x = swarm.x[i]!
        const z = swarm.z[i]!
        if (inCanal(map, x, z)) wet++
        else if (z < -21.5 && z > -38.5 && Math.abs(x) < 2.3) walkways++
      }
    }
    expect(wet).toBe(0)
    expect(walkways).toBeGreaterThan(0)
    expect(play.caught).toBe(0)
    expect(play.canalAt).toBeGreaterThan(0)
    expect(inCistern()).toBeGreaterThan(swarm.count * 0.6)
  })

  it('puts the torch out in a jet of gas from the wall', () => {
    const play = new SewerPlay({ rats: 100 })
    play.skipTo(1)
    const jet = play.map.jets[0]!
    walkTo(play, { x: -5, z: -11.2 }, 12, 0.2)
    expect(walkTo(play, { x: jet.x + 2, z: -11.2 }, 12, 0.2)).toBe(true)
    while (!play.jetting(0)) play.frame(STEP, { heading: null })
    walkTo(play, { x: jet.x, z: -11.2 }, 2, 0.3)
    play.frame(STEP, { heading: null })
    expect(play.run.torch.lit).toBe(false)
  })

  it('shuts the gas off once the gas lever is pulled', () => {
    const play = new SewerPlay({ rats: 100 })
    play.skipTo(2)
    for (let t = 0; t < 5; t += STEP) {
      play.frame(STEP, { heading: null })
      expect(play.map.jets.some((_, k) => play.jetting(k))).toBe(false)
    }
  })

  it('walks him straight down the gas branch to its lever, four jets across the way', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    play.skipTo(1)
    expect(play.map.jets.length).toBe(4)
    expect(walkTo(play, { x: -8.5, z: -11.2 }, 12, 0.3)).toBe(true)
    expect(walkTo(play, play.map.levers[0]!, 20, 0.5 + colliderPad(play.map.levers[0]!))).toBe(true)
  })

  it('lights the torch again at a chandelier once they are down', () => {
    const play = new SewerPlay({ rats: 100 })
    play.skipTo(3)
    play.run.fuel = 0
    const c = play.map.chandeliers[2]!.pivot
    play.run.holder.x = c.x - 2
    play.run.holder.z = c.z
    walkTo(play, c, 3, 0.5)
    play.frame(STEP, { heading: null, interact: true })
    expect(play.run.torch.lit).toBe(true)
  })

  it('runs him from the cistern door straight up the rush to the ladder, which he climbs out', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    play.skipTo(5)
    for (let t = 0; t < 12 && !play.climbing; t += STEP) play.frame(STEP, { heading: { x: 0, z: -1 } })
    expect(play.climbing).toBe(true)
    for (let t = 0; t < 3.2; t += STEP) play.frame(STEP, { heading: null })
    expect(play.won).toBe(true)
  })

  it('keeps the hub lever still until both branch levers are pulled', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    play.skipTo(2)
    const lever = play.map.levers[2]!
    play.run.holder.x = lever.x
    play.run.holder.z = lever.z
    for (let t = 0; t < 6; t += STEP) play.frame(STEP, { heading: null, interact: true })
    expect(play.pulled.hub).toBe(false)
    play.skipTo(3)
    for (let t = 0; t < 5.5; t += STEP) play.frame(STEP, { heading: null, interact: true })
    expect(play.pulled.hub).toBe(true)
    expect(play.doorsOpen[play.map.doors.findIndex((door) => door.name === 'huge door')]).toBe(true)
  })

  it('opens the cistern door to the plates in order, and not otherwise', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true })
    play.skipTo(4)
    const press = (symbol: string) => {
      const button = play.map.buttons.find((b) => b.symbol === symbol)!
      play.run.holder.x = button.x
      play.run.holder.z = button.z
      play.frame(STEP, { heading: null, interact: false })
      play.frame(STEP, { heading: null, interact: true })
    }
    for (const symbol of ['key', 'fish', 'skull', 'wheel']) press(symbol)
    expect(play.symbolOpen).toBe(false)
    const order = [...play.map.plates].sort((a, b) => a.numeral - b.numeral)
    for (const plate of order) press(plate.symbol)
    expect(play.symbolOpen).toBe(true)
  })

  it('burns the torch for its duration, its light shrinking from its max radius to its min', () => {
    const play = new SewerPlay({ rats: 100 })
    play.skipTo(1)
    play.torchSeconds = 4
    play.runTuning.torchReach = 1.2
    play.runTuning.torchLeast = 0.4
    play.run.fuel = 1
    play.frame(STEP, { heading: null })
    expect(play.run.torch.reach).toBeCloseTo(1.2, 1)
    for (let t = 0; t < 2; t += STEP) play.frame(STEP, { heading: null })
    const half = play.run.torch.reach
    expect(half).toBeLessThan(1.2)
    expect(half).toBeGreaterThan(0.4)
    for (let t = 0; t < 2.2; t += STEP) play.frame(STEP, { heading: null })
    expect(play.run.torch.lit).toBe(false)
  })

  it('steps the far rats a group at a time, covering as much ground as when every rat steps', () => {
    const travel = (stagger: number) => {
      const play = new SewerPlay({ rats: 2000, everlasting: true })
      play.swarm.stagger = stagger
      play.skipTo(1)
      const { swarm } = play
      const h = play.holder
      const far = Array.from({ length: swarm.count }, (_, i) => i).filter((i) => Math.hypot(swarm.x[i]! - h.x, swarm.z[i]! - h.z) > 20)
      const from = far.map((i) => [swarm.x[i]!, swarm.z[i]!] as const)
      let stood = 0
      for (let t = 0; t < 2; t += STEP) {
        const before = far.map((i) => swarm.x[i]!)
        play.frame(STEP, { heading: null })
        stood += far.filter((i, k) => swarm.x[i] === before[k]).length / far.length
      }
      const moved = far.reduce((sum, i, k) => sum + Math.hypot(swarm.x[i]! - from[k]![0], swarm.z[i]! - from[k]![1]), 0) / far.length
      return { moved, stood: stood / Math.round(2 / STEP) }
    }
    const every = travel(1)
    const staggered = travel(4)
    // Three steps in four the far rats sit out; over two seconds they still go about as far.
    expect(staggered.stood).toBeGreaterThan(0.7)
    expect(every.stood).toBeLessThan(0.3)
    expect(staggered.moved).toBeGreaterThan(every.moved * 0.6)
    expect(staggered.moved).toBeLessThan(every.moved * 1.6)
  })

  it('plays every skip point for a few seconds', () => {
    const play = new SewerPlay({ rats: 300 })
    for (let point = 0; point <= 5; point++) {
      play.skipTo(point)
      for (let t = 0; t < 2; t += STEP) play.frame(STEP, { heading: { x: 0, z: -1 } })
      expect(Number.isFinite(play.holder.x)).toBe(true)
    }
  })
})
