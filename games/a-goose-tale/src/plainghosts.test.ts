import { describe, expect, it } from 'vitest'
import { createPlainGhosts } from './ghosts.prototype'

/** Two ghosts walking along x at 1 m/s, a metre apart on z. */
const walk = { count: 2, reach: 1.75, speed: 1, at: (g: number, t: number) => ({ x: t, z: g }) }
const level = () => 0

describe('the plain ghosts, where there is no cloth to draw', () => {
  it('has a light for each ghost, where its walk has it, that holds the rats off as the cloth ghosts do', () => {
    const ghosts = createPlainGhosts(level, walk)
    expect(ghosts.count).toBe(2)
    ghosts.update(0.5, 3)
    expect(ghosts.lights).toEqual([
      { x: 3, z: 0, reach: 1.75, on: true },
      { x: 3, z: 1, reach: 1.75, on: true },
    ])
    ghosts.update(0.5, 4)
    expect(ghosts.lights[0]).toMatchObject({ x: 4, z: 0 })
  })

  it('walks a drawn ghost along with its light', () => {
    const ghosts = createPlainGhosts(level, walk)
    ghosts.update(0.5, 2)
    const rig = ghosts.object.children[1]!
    expect(rig.position.x).toBeCloseTo(2)
    expect(rig.position.z).toBeCloseTo(1)
  })

  it('stands them on the ground', () => {
    const ghosts = createPlainGhosts(() => 5, walk)
    ghosts.update(0.5, 0)
    expect(ghosts.object.children[0]!.position.y).toBeGreaterThanOrEqual(4.9)
  })

  it('goes on at the play\'s time, not the frames\', and holds still when it does', () => {
    const ghosts = createPlainGhosts(level, walk)
    ghosts.update(0.5, 2)
    const { x } = ghosts.lights[0]!
    ghosts.update(0.5, 2)
    expect(ghosts.lights[0]!.x).toBe(x)
  })

  it('answers what the cloth ghosts do besides, with nothing to swallow', async () => {
    const ghosts = createPlainGhosts(level, walk)
    expect(() => ghosts.wear()).not.toThrow()
    expect(() => ghosts.suck(0, 0, 0, 0, 1, false, false)).not.toThrow()
    expect(await ghosts.swallowed()).toEqual([0, 0])
  })
})
