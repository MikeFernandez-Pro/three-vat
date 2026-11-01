import { describe, expect, it } from 'vitest'
import { LIGHT_SPEED } from './gameplay'
import { gaitAt } from './goosegait'

const SETTINGS = { threshold: 1.2, blend: 0.4 }

describe("the goose's gait", () => {
  it('stands him all idle when still, and walks him out of it as he starts', () => {
    expect(gaitAt(0, SETTINGS)).toMatchObject({ idle: 1, walk: 0, run: 0 })
    const starting = gaitAt(0.1, SETTINGS)
    expect(starting.idle).toBeGreaterThan(0)
    expect(starting.idle).toBeLessThan(1)
    expect(starting.idle + starting.walk).toBeCloseTo(1)
    expect(starting.run).toBe(0)
  })

  it('walks him all walk on a light push', () => {
    const gait = gaitAt(0.6, SETTINGS)
    expect(gait.idle).toBe(0)
    expect(gait.walk).toBe(1)
    expect(gait.run).toBe(0)
  })

  it('runs him all run on a strong push', () => {
    const gait = gaitAt(2, SETTINGS)
    expect(gait.idle).toBe(0)
    expect(gait.walk).toBe(0)
    expect(gait.run).toBe(1)
  })

  it('blends the walk into the run across the blend, with no step, half each at the threshold', () => {
    expect(gaitAt(1.2, SETTINGS).run).toBeCloseTo(0.5)
    expect(gaitAt(1, SETTINGS).run).toBeCloseTo(0)
    expect(gaitAt(1.4, SETTINGS).run).toBeCloseTo(1)
    let was = gaitAt(0.9, SETTINGS)
    for (let speed = 0.9; speed <= 1.5; speed += 0.005) {
      const gait = gaitAt(speed, SETTINGS)
      expect(gait.walk + gait.run).toBeCloseTo(1)
      expect(gait.run).toBeGreaterThanOrEqual(was.run)
      expect(Math.abs(gait.run - was.run)).toBeLessThan(0.05)
      was = gait
    }
  })

  it('plays his walk at its authored pace, 0.6 m/s, as authored, and faster or slower as he goes', () => {
    expect(gaitAt(0.6, SETTINGS).walkSpeed).toBeCloseTo(1)
    expect(gaitAt(0.3, SETTINGS).walkSpeed).toBeCloseTo(0.5)
    expect(gaitAt(0.9, SETTINGS).walkSpeed).toBeCloseTo(1.5)
  })

  it("plays his run as authored at the keyboard's full pace, as it played before, and faster or slower as he goes", () => {
    expect(LIGHT_SPEED).toBe(2)
    expect(gaitAt(LIGHT_SPEED, SETTINGS)).toMatchObject({ run: 1, runSpeed: 1 })
    expect(gaitAt(1.5, SETTINGS).runSpeed).toBeCloseTo(0.75)
    expect(gaitAt(3, SETTINGS).runSpeed).toBeCloseTo(1.5)
  })

  it('steps from the walk to the run at the threshold with no blend', () => {
    expect(gaitAt(1.19, { threshold: 1.2, blend: 0 }).run).toBe(0)
    expect(gaitAt(1.21, { threshold: 1.2, blend: 0 }).run).toBe(1)
  })
})
