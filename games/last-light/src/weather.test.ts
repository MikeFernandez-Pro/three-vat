// The weather as the page shows it (#185): how hard it rains as the play's rain
// starts and stops, when each lightning strike is due and when it came, and
// the flash it throws over the scene. What is checked is what the drawing is
// handed; the play's own timings are play.test.ts's.
import { describe, expect, it } from 'vitest'
import { Play } from './play'
import { FLASH, RainAmount, flashAt, strikesOf } from './weather'

describe('the rain', () => {
  it('is dry to start, comes in over a second or two once it rains, holds, and dies away once it stops', () => {
    const rain = new RainAmount()
    expect(rain.amount).toBe(0)
    rain.update(1 / 60, false)
    expect(rain.amount).toBe(0)
    let first = Number.NaN
    for (let t = 0; t < 4; t += 1 / 60) {
      rain.update(1 / 60, true)
      if (Number.isNaN(first) && rain.amount === 1) first = t
    }
    expect(first).toBeGreaterThan(0.5)
    expect(first).toBeLessThan(3)
    rain.update(1 / 60, false)
    expect(rain.amount).toBeLessThan(1)
    expect(rain.amount).toBeGreaterThan(0.9)
    for (let t = 0; t < 5; t += 1 / 60) rain.update(1 / 60, false)
    expect(rain.amount).toBe(0)
  })

  it('holds still while the play is paused', () => {
    const rain = new RainAmount()
    rain.update(0.5, true)
    const was = rain.amount
    rain.update(0, false)
    expect(rain.amount).toBe(was)
  })
})

describe('the strikes', () => {
  it("are the big tree's, at the script's time, and the cracked tree's, due once the stick has caught", () => {
    const play = new Play()
    const { woods: map } = play
    const [big, cracked] = strikesOf(play)
    const tree = map.level.lights[map.bigTree]!
    expect(big!.at).toEqual({ x: tree.x, z: tree.z })
    expect(big!.due).toBe(map.strike)
    expect(big!.time).toBeNaN()
    expect(cracked!.at).toEqual(map.trunk.root)
    expect(cracked!.due).toBeNaN()
    expect(cracked!.time).toBeNaN()
    for (let t = 0; t <= map.strike + 0.1; t += 1 / 60) play.frame(1 / 60, { heading: null })
    expect(strikesOf(play)[0]!.time).toBe(map.strike)
  })

  it("has the cracked tree's due the script's time after the stick caught, and its time when it came, sooner should he walk out first", () => {
    const play = new Play()
    const { woods: map } = play
    play.litAt = 7
    expect(strikesOf(play)[1]!.due).toBe(7 + map.afterLit)
    play.fellAt = 8.5
    expect(strikesOf(play)[1]).toMatchObject({ due: 8.5, time: 8.5 })
  })

  it('come again from the start when a catch before the stick caught starts the play over', () => {
    const play = new Play()
    play.t = 12
    play.begin()
    expect(strikesOf(play).map((strike) => strike.time)).toEqual([Number.NaN, Number.NaN])
  })
})

describe('the flash', () => {
  it('is nothing before a strike, full on it, flickers once more, and is gone after a moment', () => {
    expect(flashAt(-0.01)).toBe(0)
    expect(flashAt(0)).toBeCloseTo(1, 5)
    expect(flashAt(FLASH)).toBe(0)
    expect(flashAt(FLASH + 1)).toBe(0)
    // The second flicker: down, then up again.
    const samples = Array.from({ length: 40 }, (_, k) => flashAt((k / 40) * FLASH))
    const rises = samples.filter((f, k) => k > 0 && f > samples[k - 1]! + 1e-6)
    expect(rises.length).toBeGreaterThan(0)
    for (const f of samples) expect(f).toBeLessThanOrEqual(1)
  })
})
