// The way round the walls (ADR-0056), read as the swarm reads it: where the
// holder is in clear sight there is no answer, the rat's straight line is the
// way; behind a wall the answer is the way round it, and how far that is.
import { describe, expect, it } from 'vitest'
import { FLOW_CELL, FLOW_SIZE, FlowField } from './flowfield'
import { Walls, type Wall } from './walls'

const wall = (ax: number, az: number, bx: number, bz: number): Wall => ({ from: { x: ax, z: az }, to: { x: bx, z: bz } })

/** A field round `walls`, toward a holder at (x, z). */
function fieldOn(walls: Wall[], x: number, z: number): FlowField {
  const field = new FlowField()
  field.setWalls(new Walls(walls))
  field.update(x, z)
  return field
}

describe('the way round the walls', () => {
  it('gives no answer on open ground: every rat goes straight at the holder', () => {
    const field = fieldOn([], 0, 0)
    expect(field.active).toBe(false)
    expect(field.at(3, 4)).toBe(false)
  })

  it('gives no answer where the holder is in clear sight, past a wall beside the way', () => {
    const field = fieldOn([wall(-3, 2, 3, 2)], 0, 0)
    expect(field.at(1, -2)).toBe(false)
    expect(field.at(6, 2.5)).toBe(false)
  })

  it('leads a rat behind a wall to its nearer end, and says how far round it is', () => {
    const field = fieldOn([wall(-3, 2, 3, 2)], 0, 0)
    expect(field.at(1, 4)).toBe(true)
    // To the wall's east end, then straight at the holder: 2.83 m and 3.61 m, a little more for keeping off the wall,
    // and up to a fifth more for the wave the field is filled by, which reads long where it bends round a corner.
    expect(field.dx).toBeGreaterThan(0.5)
    expect(field.dz).toBeLessThan(-0.4)
    expect(field.d).toBeGreaterThan(6.4)
    expect(field.d).toBeLessThan(7.8)
    expect(field.at(-1, 4)).toBe(true)
    expect(field.dx).toBeLessThan(-0.5)
  })

  it('finds the way through a hole in a wall that is otherwise closed', () => {
    // A box round the holder, 8 m square, its only way in a metre-wide hole in the north wall.
    const walls = [wall(-4, -4, 4, -4), wall(4, -4, 4, 4), wall(-4, 4, -4, -4), wall(-4, 4, 1.5, 4), wall(2.5, 4, 4, 4)]
    const field = fieldOn(walls, 0, 0)
    expect(field.at(-2, 6)).toBe(true)
    // Toward the hole, east of it, and down.
    expect(field.dx).toBeGreaterThan(0.6)
    // Through the hole at (2, 4): 4.12 m to it, 4.47 m on to the holder.
    expect(field.d).toBeGreaterThan(8.5)
    expect(field.d).toBeLessThan(9.6)
  })

  it(`is read within ${(FLOW_SIZE * FLOW_CELL) / 2} m of the holder, and moves with it`, () => {
    const field = fieldOn([wall(-3, 2, 3, 2)], 0, 0)
    const far = (FLOW_SIZE * FLOW_CELL) / 2 + 1
    expect(field.at(0, far)).toBe(false)
    const version = field.version
    field.update(0.05, 0)
    expect(field.version).toBe(version)
    // The holder round to the wall's north side: the rat there sees it now.
    field.update(0, 6)
    expect(field.version).toBe(version + 1)
    expect(field.at(1, 4)).toBe(false)
  })
})
