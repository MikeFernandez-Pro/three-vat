import { describe, expect, it } from 'vitest'
import { SewerPlay } from './sewerplay'
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
  it('wakes with the stick unlit, rats round the lantern, which lights it', () => {
    const play = new SewerPlay({ rats: 300 })
    expect(play.run.torch.lit).toBe(false)
    const { x, z } = play.holder
    let near = 0
    for (let i = 0; i < play.swarm.count; i++) if (Math.hypot(play.swarm.x[i]! - x, play.swarm.z[i]! - z) < 8) near++
    expect(near).toBeGreaterThan(40)
    expect(walkTo(play, { x: 1.4, z: 13.8 }, 5, 0.1)).toBe(true)
    play.frame(STEP, { heading: null })
    expect(play.lit).toBe(true)
    expect(play.left).toBeGreaterThan(25)
  })

  it('puts the torch out in a jet of gas from the wall', () => {
    const play = new SewerPlay({ rats: 100 })
    play.skipTo(1)
    walkTo(play, { x: -6, z: -9.7 }, 12, 0.2)
    expect(walkTo(play, { x: -14, z: -9.7 }, 12, 0.2)).toBe(true)
    while (!play.jetting(0)) play.frame(STEP, { heading: null })
    walkTo(play, { x: -16, z: -9.7 }, 2, 0.3)
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

  it('has the bats put the torch out before the first chandelier', () => {
    const play = new SewerPlay({ rats: 100 })
    play.skipTo(2)
    play.run.holder.x = 14.4
    play.run.holder.z = -8.1
    walkTo(play, { x: 17.4, z: -6.6 }, 3, 0.1)
    expect(play.run.torch.lit).toBe(false)
    expect(play.batsAt).toBeGreaterThan(0)
  })

  it('lights the torch again at a chandelier once they are down', () => {
    const play = new SewerPlay({ rats: 100 })
    play.skipTo(3)
    play.run.fuel = 0
    const c = play.map.chandeliers[2]!.pivot
    play.run.holder.x = c.x - 2
    play.run.holder.z = c.z
    walkTo(play, c, 3, 0.5)
    play.frame(STEP, { heading: null })
    expect(play.run.torch.lit).toBe(true)
  })

  it('keeps him on the beam, W taking him along it whichever way it runs', () => {
    const play = new SewerPlay({ rats: 100, everlasting: true, balance: false })
    play.skipTo(6)
    for (let t = 0; t < 2 && !play.onBeam; t += STEP) play.frame(STEP, { heading: { x: 0, z: -1 } })
    expect(play.onBeam).toBe(true)
    for (let t = 0; t < 14 && play.onBeam; t += STEP) play.frame(STEP, { heading: { x: 0, z: -1 } })
    expect(play.holder.z).toBeLessThan(-81)
    walkTo(play, play.map.ladder, 4, 0.5)
    expect(play.climbing).toBe(true)
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

  it('plays every skip point for a few seconds', () => {
    const play = new SewerPlay({ rats: 300 })
    for (let point = 0; point <= 6; point++) {
      play.skipTo(point)
      for (let t = 0; t < 2; t += STEP) play.frame(STEP, { heading: { x: 0, z: -1 } })
      expect(Number.isFinite(play.holder.x)).toBe(true)
    }
  })
})
