// Guards the batched pages' bookkeeping: the field's layout, the clip a spawn
// takes, the churn a frame owes, and what the roster remembers about a row that
// has been used before. `spawning.ts` is free of three.js and the DOM for
// exactly this reason — the claims the page makes about row recycling are
// checkable here, in Node, rather than by watching a crowd.
import { describe, expect, it } from 'vitest'
import {
  CAPACITY,
  COLUMNS,
  FIELD_DEPTH,
  cellOf,
  churnTicks,
  clipOfSpawn,
  createRoster,
  populationLine,
  spawnLine,
  yawOf,
} from './spawning.js'

const PITCH = 2

describe('the field is the playback texture, laid on the ground', () => {
  it('is a square of the capacity the texture reserves', () => {
    expect(COLUMNS * FIELD_DEPTH).toBe(CAPACITY)
  })

  it('gives every reserved row a cell of its own', () => {
    const seen = new Set(
      Array.from({ length: CAPACITY }, (_, id) => {
        const { x, z } = cellOf(id, PITCH)
        return `${x},${z}`
      }),
    )

    expect(seen.size).toBe(CAPACITY)
  })

  it('keeps neighbours a pitch apart, so an instance never stands on another', () => {
    const a = cellOf(0, PITCH)
    const right = cellOf(1, PITCH)
    const behind = cellOf(COLUMNS, PITCH)

    expect(right.x - a.x).toBeCloseTo(PITCH)
    expect(right.z).toBeCloseTo(a.z)
    expect(behind.z - a.z).toBeCloseTo(PITCH)
    expect(behind.x).toBeCloseTo(a.x)
  })

  it('centres the field on the origin, so the camera opens looking at it', () => {
    const first = cellOf(0, PITCH)
    const last = cellOf(CAPACITY - 1, PITCH)

    expect(first.x).toBeCloseTo(-last.x)
    expect(first.z).toBeCloseTo(-last.z)
  })

  it('runs its ids left to right and back to front, as the ledger draws them', () => {
    // The ledger is a grid of the same rows in the same order, and the whole
    // point of it is that a cell found in one is found in the other.
    expect(cellOf(COLUMNS - 1, PITCH).z).toBeCloseTo(cellOf(0, PITCH).z)
    expect(cellOf(COLUMNS, PITCH).z).toBeGreaterThan(cellOf(0, PITCH).z)
  })
})

describe('what a spawn plays', () => {
  it('never gives a recycled row the clip its last occupant played', () => {
    // The page's whole evidence, and the reason this takes the previous
    // occupant rather than the spawn counter: a cell that comes back the colour
    // it went dim has to mean the row was not rewritten, so it must never
    // happen when it was.
    for (let previous = 0; previous < 3; previous++) {
      for (let n = 0; n < 12; n++) {
        expect(clipOfSpawn(n, 3, previous), `spawn ${n} after clip ${previous}`).not.toBe(previous)
      }
    }
  })

  it('takes the clip after its last occupant’s, whenever the row comes back', () => {
    expect(clipOfSpawn(0, 3, 0)).toBe(1)
    expect(clipOfSpawn(7, 3, 1)).toBe(2)
    expect(clipOfSpawn(99, 3, 2)).toBe(0)
  })

  it('rotates on a fresh row, so the field fills with every clip from the start', () => {
    const played = Array.from({ length: 12 }, (_, n) => clipOfSpawn(n, 3))

    for (let n = 1; n < played.length; n++) expect(played[n]).not.toBe(played[n - 1])
    expect(new Set(played).size).toBe(3)
  })

  it('stays inside the clip table', () => {
    for (let n = 0; n < 20; n++) {
      for (const previous of [null, 0, 1, 2]) {
        const index = clipOfSpawn(n, 3, previous)
        expect(index).toBeGreaterThanOrEqual(0)
        expect(index).toBeLessThan(3)
      }
    }
  })
})

describe('which way a cell faces', () => {
  it('belongs to the row, so a recycled instance changes only what it plays', () => {
    expect(yawOf(42)).toBe(yawOf(42))
  })

  it('stays a small spread either side of the camera', () => {
    for (let id = 0; id < CAPACITY; id++) {
      expect(Math.abs(yawOf(id))).toBeLessThanOrEqual(0.25)
    }
  })
})

describe('the readouts the pair has to agree on', () => {
  it('counts the live crowd against the rows reserved for it', () => {
    const roster = createRoster(4)
    roster.fill(0, 'Idle')
    roster.fill(1, 'Walking')
    roster.free(1)

    expect(populationLine(roster)).toBe(
      '1 alive in 4 reserved rows — 2 spawned, 0 of them onto a row that had been used before',
    )
  })

  it('names the row, what it held and what moved in', () => {
    const roster = createRoster(4)
    roster.fill(2, 'Running')
    roster.free(2)

    expect(spawnLine(roster.fill(2, 'Idle'))).toBe('row 2 held Running — Idle spawned into it, its 2nd occupant')
  })

  it('says a fresh row was fresh, rather than naming an occupant it never had', () => {
    expect(spawnLine(createRoster(4).fill(3, 'Idle'))).toBe('row 3 was fresh — Idle spawned into it')
  })

  it('ordinals the eleventh occupant as the eleventh', () => {
    const roster = createRoster(1)
    for (let i = 0; i < 11; i++) roster.fill(0, 'Idle')

    expect(spawnLine(roster.fill(0, 'Walking'))).toContain('12th occupant')
  })
})

describe('the churn a frame owes', () => {
  it('carries the fraction a frame cannot pay, rather than flooring it away', () => {
    // Four a second at eight frames a second is half an event per frame: floored
    // where it falls it is nothing at all, which is a page where nothing ever
    // spawns. An eighth of a second rather than a sixtieth so the arithmetic is
    // exact in binary and the test is about the carry and not about rounding.
    let carry = 0
    let total = 0
    for (let frame = 0; frame < 8; frame++) {
      expect(churnTicks(0, 1 / 8, 4).ticks, 'a frame owes less than one on its own').toBe(0)
      const owed = churnTicks(carry, 1 / 8, 4)
      carry = owed.carry
      total += owed.ticks
    }

    expect(total).toBe(4)
  })

  it('owes nothing at rest, and forgets what it was owed', () => {
    expect(churnTicks(0.9, 1 / 60, 0)).toEqual({ ticks: 0, carry: 0 })
  })

  it('pays a long frame in full rather than one event at a time', () => {
    expect(churnTicks(0, 1, 5).ticks).toBe(5)
  })
})

describe('the roster, which is what owning the index costs', () => {
  it('starts with every row reserved and nothing alive', () => {
    const roster = createRoster(4)

    expect(roster.live).toBe(0)
    expect(roster.rows).toEqual([null, null, null, null])
  })

  it('records a spawn against the row the carrier handed out', () => {
    const roster = createRoster(4)

    const event = roster.fill(2, 'Walking')

    expect(event).toEqual({ id: 2, clip: 'Walking', previous: null, spawns: 1 })
    expect(roster.live).toBe(1)
    expect(roster.rows[2]).toEqual({ clip: 'Walking', live: true, spawns: 1 })
  })

  it('keeps what a dead instance played, because it is what the next one must not play', () => {
    const roster = createRoster(4)
    roster.fill(2, 'Running')

    roster.free(2)

    expect(roster.live).toBe(0)
    expect(roster.rows[2]).toEqual({ clip: 'Running', live: false, spawns: 1 })
  })

  it('names the previous occupant when a row comes back — which is row recycling', () => {
    const roster = createRoster(4)
    roster.fill(2, 'Running')
    roster.free(2)

    const event = roster.fill(2, 'Idle')

    expect(event).toEqual({ id: 2, clip: 'Idle', previous: 'Running', spawns: 2 })
    expect(roster.recycled).toBe(1)
  })

  it('counts a fresh row as no recycle at all', () => {
    const roster = createRoster(4)

    roster.fill(0, 'Idle')
    roster.fill(1, 'Walking')

    expect(roster.spawns).toBe(2)
    expect(roster.recycled).toBe(0)
  })

  it('picks a live row to kill, and nothing when nothing is alive', () => {
    const roster = createRoster(4)

    expect(roster.pick(0.5)).toBeNull()

    roster.fill(1, 'Idle')
    roster.fill(3, 'Idle')

    expect([1, 3]).toContain(roster.pick(0))
    expect([1, 3]).toContain(roster.pick(0.99))
    expect(roster.pick(1)).not.toBeNull() // a pick of exactly 1 is still a row
  })

  it('never picks a row whose instance has died', () => {
    const roster = createRoster(4)
    roster.fill(1, 'Idle')
    roster.fill(3, 'Idle')
    roster.free(3)

    for (const pick of [0, 0.25, 0.5, 0.75, 0.99]) expect(roster.pick(pick)).toBe(1)
  })
})
