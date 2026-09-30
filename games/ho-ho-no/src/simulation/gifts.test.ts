import { describe, expect, it } from 'vitest'
import { AIM_HEIGHT, type BoostKind, type GiftDrop, type Simulation, type SimulationInput } from './simulation'
import { FPS, idle, run, simulate } from './test-crowds'

// The gifts and the boosts they grant, held where a player sees them: when a
// gift drops, blinks and goes, what collecting one does to Santa and his
// snowballs, and for how long. The horde spawns at (17, 0), where Santa at the
// centre shoots every skeleton as it rises, so he lives to see the gifts.

const SPAWN = { x: 17, z: 0 }
const holdTheLine: SimulationInput = { ...idle, aim: { x: SPAWN.x, y: AIM_HEIGHT, z: SPAWN.z }, fire: true }
/** Any tilt, so long as it is the same every run: the default is drawn at random. */
const TILT = 1
/** A gift that lands on Santa, so he collects it. */
const onSanta = (kind: BoostKind): GiftDrop => ({ kind, x: 0, z: 0, tilt: TILT })
/** A gift that lands clear of Santa and of the line he shoots down, so it is missed. */
const aside = (kind: BoostKind): GiftDrop => ({ kind, x: 0, z: 8, tilt: TILT })

async function camp(drop: GiftDrop) {
  const { simulation } = await simulate({ random: () => 0, gifts: () => drop })
  simulation.start(0)
  return simulation
}

/** Step until `done`, or fail after `limit` seconds; returns the time reached. */
function until(sim: Simulation, from: number, done: () => boolean, input: (t: number) => SimulationInput = () => holdTheLine, limit = 60) {
  let t = from
  while (!done()) {
    if (t - from > limit) throw new Error(`nothing happened in ${limit} s`)
    t = run(sim, t, 1 / FPS, input)
  }
  return t
}

/** A run whose first gift, of `kind`, Santa has just collected: the time it was, and the run. */
async function boosted(kind: BoostKind) {
  const sim = await camp(onSanta(kind))
  const t = until(sim, 0, () => sim.boost !== null)
  return { sim, t }
}

describe('a gift', () => {
  it('drops at 15 s, then 20 s after each drop, one at a time, from above the camp', async () => {
    const sim = await camp(aside('ghost'))
    const drops: { at: number; y: number }[] = []
    sim.on('giftDropped', ({ position }) => drops.push({ at: sim.elapsed, y: position.y }))

    let t = until(sim, 0, () => sim.elapsed >= 15 - 1 / FPS)
    expect(sim.gift).toBeNull()
    t = until(sim, t, () => sim.elapsed >= 60)

    expect(sim.over).toBe(false)
    expect(drops.map(({ at }) => at)).toEqual([15, 35, 55].map((at) => expect.closeTo(at, 6)))
    expect(drops.every(({ y }) => y === 15)).toBe(true)
  })

  it('falls onto the snow where it was dropped', async () => {
    const sim = await camp(aside('speed'))
    const t = until(sim, 0, () => sim.gift !== null)
    expect(sim.gift!.position.y).toBeCloseTo(15, 3)

    until(sim, t, () => sim.elapsed >= 17)
    const { position } = sim.gift!
    expect(position.y).toBeLessThan(2)
    expect(position.x).toBeCloseTo(0, 0)
    expect(position.z).toBeCloseTo(8, 0)
  })

  it('blinks from 5 s after it drops, every 0.18 s', async () => {
    const sim = await camp(aside('shoot'))
    let t = 0
    const at = (elapsed: number) => {
      t = until(sim, t, () => sim.elapsed >= elapsed - 1e-9)
      return sim.gift!.visible
    }

    expect(at(15)).toBe(true)
    expect(at(19.95)).toBe(true)
    expect(at(20.05)).toBe(true)
    expect(at(20.25)).toBe(false)
    expect(at(20.4)).toBe(true)
    expect(at(20.6)).toBe(false)
    expect(at(21.75)).toBe(false)
    expect(at(21.85)).toBe(true)
  })

  it('is gone 7 s after it drops if nobody collects it, and says where', async () => {
    const sim = await camp(aside('ghost'))
    const missed: { at: number; kind: BoostKind; z: number }[] = []
    sim.on('giftMissed', ({ kind, position }) => missed.push({ at: sim.elapsed, kind, z: position.z }))
    let collected = 0
    sim.on('giftCollected', () => collected++)

    let t = until(sim, 0, () => sim.elapsed >= 22 - 2 / FPS)
    expect(sim.gift).not.toBeNull()
    t = until(sim, t, () => sim.gift === null)

    expect(sim.elapsed).toBeCloseTo(22, 6)
    expect(missed).toEqual([{ at: expect.closeTo(22, 6), kind: 'ghost', z: expect.closeTo(8, 0) }])
    expect(collected).toBe(0)
    expect(sim.boost).toBeNull()
  })

  it('goes and drops again in one step, when one step spans both', async () => {
    const sim = await camp(aside('speed'))
    const seen: string[] = []
    sim.on('giftMissed', () => seen.push('missed'))
    sim.on('giftDropped', () => seen.push('dropped'))
    const t = until(sim, 0, () => sim.gift !== null)
    seen.length = 0

    // A tab back from the background: the next frame is 20 s on.
    sim.step(t + 20, holdTheLine)

    expect(seen).toEqual(['missed', 'dropped'])
    expect(sim.gift).not.toBeNull()
  })

  it.each(['ghost', 'speed', 'shoot'] as const)('of %s, collected by Santa, is gone and grants its boost for 10 s', async (kind) => {
    const sim = await camp(onSanta(kind))
    const collected: BoostKind[] = []
    const started: { kind: BoostKind; duration: number }[] = []
    const ended: { kind: BoostKind; at: number }[] = []
    let missed = 0
    sim.on('giftCollected', (event) => collected.push(event.kind))
    sim.on('boostStarted', (event) => started.push(event))
    sim.on('boostEnded', (event) => ended.push({ kind: event.kind, at: sim.elapsed }))
    sim.on('giftMissed', () => missed++)

    let t = until(sim, 0, () => sim.boost !== null)
    const collectedAt = sim.elapsed
    // Dropped at 15 s from 15 units up, onto his head within the second.
    expect(collectedAt).toBeGreaterThan(15.5)
    expect(collectedAt).toBeLessThan(16.5)
    expect(collected).toEqual([kind])
    expect(started).toEqual([{ kind, duration: 10 }])
    expect(sim.gift).toBeNull()
    expect(sim.boost).toEqual({ kind, startedAt: collectedAt, endsAt: collectedAt + 10 })

    t = until(sim, t, () => sim.elapsed >= collectedAt + 10 - 2 / FPS)
    expect(sim.boost?.kind).toBe(kind)
    t = until(sim, t, () => sim.boost === null)
    expect(ended).toEqual([{ kind, at: expect.any(Number) }])
    // On the first step at or past its end.
    expect(ended[0].at).toBeGreaterThan(collectedAt + 10 - 1e-9)
    expect(ended[0].at).toBeLessThan(collectedAt + 10 + 1 / FPS + 1e-9)
    expect(missed).toBe(0)
  })
})

describe('a boost', () => {
  it('granted by the debug panel runs as a collected gift\'s does, over any running', async () => {
    // Invincible, so the horde cannot end the run before the boost does; the
    // first gift drops at 15 s, after it.
    const sim = (await simulate()).simulation
    sim.invincible = true
    sim.start(0)
    const started: { kind: BoostKind; duration: number }[] = []
    const ended: BoostKind[] = []
    sim.on('boostStarted', (event) => started.push(event))
    sim.on('boostEnded', (event) => ended.push(event.kind))

    let t = run(sim, 0, 1)
    sim.grantBoost('ghost')
    expect(sim.boost).toEqual({ kind: 'ghost', startedAt: sim.elapsed, endsAt: sim.elapsed + 10 })
    t = run(sim, t, 2)
    sim.grantBoost('shoot')
    const at = sim.elapsed
    expect(sim.boost).toEqual({ kind: 'shoot', startedAt: at, endsAt: at + 10 })
    expect(started).toEqual([
      { kind: 'ghost', duration: 10 },
      { kind: 'shoot', duration: 10 },
    ])

    run(sim, t, 10 + 1 / FPS)
    expect(sim.boost).toBeNull()
    expect(ended).toEqual(['shoot'])
  })

  /** How far Santa walks toward -z in one second, shooting down the line as he goes. */
  function walk(sim: Simulation, from: number) {
    const before = sim.santa.position.clone()
    const t = run(sim, from, 1, () => ({ ...holdTheLine, move: { x: 0, z: -1 } }))
    return { t, distance: before.distanceTo(sim.santa.position) }
  }

  it('of speed moves Santa 1.5x as fast, until it ends', async () => {
    const { sim, t } = await boosted('speed')

    // A second from a standstill: the first step or two go to starting off.
    const fast = walk(sim, t)
    expect(fast.distance).toBeGreaterThan(7.5 * 1.5 - 0.5)
    expect(fast.distance).toBeLessThan(7.5 * 1.5 + 0.1)

    const after = until(sim, fast.t, () => sim.boost === null)
    const slow = walk(sim, after)
    expect(slow.distance).toBeGreaterThan(7.5 - 0.5)
    expect(slow.distance).toBeLessThan(7.5 + 0.1)
  })

  it('of shoot throws twice as often, the shoot clip twice as fast, until it ends', async () => {
    const { sim, t } = await boosted('shoot')
    const { endsAt } = sim.boost!
    const shots: { frame: number; timeScale: number }[] = []
    sim.on('shoot', ({ timeScale }) => shots.push({ frame: Math.round(sim.elapsed * FPS), timeScale }))

    until(sim, t, () => sim.elapsed >= endsAt + 3)

    const during = shots.filter(({ frame }) => frame / FPS < endsAt - 0.5)
    const after = shots.filter(({ frame }) => frame / FPS > endsAt + 0.5)
    const gaps = (list: typeof shots) => new Set(list.slice(1).map(({ frame }, i) => frame - list[i].frame))
    // 0.6083 s of clip at 3x is 0.2028 s, past the halved 0.195 s delay: 13 frames.
    expect(gaps(during)).toEqual(new Set([13]))
    expect(new Set(during.map(({ timeScale }) => timeScale))).toEqual(new Set([3]))
    expect(gaps(after)).toEqual(new Set([25]))
    expect(new Set(after.map(({ timeScale }) => timeScale))).toEqual(new Set([1.5]))
  })

  describe('of ghost', () => {
    /**
     * Hold fire for 2.5 s, so the skeletons rising meanwhile stand at the
     * spawn point, then throw one snowball down the line through them: those
     * that stood, how many of them it killed, and how often it burst on one.
     */
    function oneThrowThroughTheRisers(sim: Simulation, from: number) {
      let t = run(sim, from, 2.5, () => ({ ...holdTheLine, fire: false }))
      const standing = sim.skeletons.filter(({ state }) => state === 'rising' || state === 'walking')
      let bursts = 0
      sim.on('burst', ({ cause }) => cause === 'skeleton' && bursts++)
      t = run(sim, t, 1 / FPS, () => holdTheLine)
      run(sim, t, 0.6, () => ({ ...holdTheLine, fire: false }))
      const killed = standing.filter(({ state }) => state === 'dying' || state === 'sinking').length
      return { standing: standing.length, killed, bursts }
    }

    it('lets a snowball through every skeleton it crosses, killing each one', async () => {
      const { sim, t } = await boosted('ghost')
      const { standing, killed, bursts } = oneThrowThroughTheRisers(sim, t)
      expect(standing).toBeGreaterThanOrEqual(2)
      expect(killed).toBe(standing)
      expect(bursts).toBe(0)
    })

    it('and without it, a snowball stops in the first it hits', async () => {
      const sim = await camp(aside('ghost'))
      const t = until(sim, 0, () => sim.elapsed >= 16)
      const { standing, killed, bursts } = oneThrowThroughTheRisers(sim, t)
      expect(standing).toBeGreaterThanOrEqual(2)
      expect(killed).toBe(1)
      expect(bursts).toBe(1)
    })

    it('ends after 10 s, and a snowball stops in the first it hits again', async () => {
      const { sim, t } = await boosted('ghost')
      const after = until(sim, t, () => sim.boost === null)
      const { killed, bursts } = oneThrowThroughTheRisers(sim, after)
      expect(killed).toBe(1)
      expect(bursts).toBe(1)
    })
  })
})
