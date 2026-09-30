import { describe, expect, it } from 'vitest'
import { AIM_HEIGHT, type Arena } from './simulation'
import { FPS, SHOOT_CLIP, idle, run, simulate } from './test-crowds'

const create = async (options: Parameters<typeof simulate>[0] = {}) => (await simulate(options)).simulation

/** A square wall of two-sided quads, `half` from the centre, standing on the floor. */
function wall(half: number): Arena {
  const corners = [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half],
  ]
  const vertices: number[] = []
  const indices: number[] = []
  for (let side = 0; side < 4; side++) {
    const [ax, az] = corners[side]
    const [bx, bz] = corners[(side + 1) % 4]
    const base = vertices.length / 3
    vertices.push(ax, 0, az, bx, 0, bz, bx, 6, bz, ax, 6, az)
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    indices.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) }
}

describe('the simulation', () => {
  it('runs nothing before it is started', async () => {
    const sim = await create()
    const shots: number[] = []
    sim.on('shoot', () => shots.push(sim.elapsed))

    run(sim, 0, 1, () => ({ move: { x: 0, z: -1 }, aim: null, fire: true }))

    expect(sim.started).toBe(false)
    expect(sim.elapsed).toBe(0)
    expect(sim.santa.position.z).toBe(0)
    expect(shots).toEqual([])
  })

  it('counts elapsed time from the start', async () => {
    const sim = await create()
    sim.start(2)
    run(sim, 2, 1.5)
    expect(sim.elapsed).toBeCloseTo(1.5, 6)
  })

  describe('Santa moves', () => {
    it('forward, toward -z, at the original speed', async () => {
      const sim = await create()
      sim.start(0)
      run(sim, 0, 0.5) // let him land
      const before = sim.santa.position.clone()

      run(sim, 0.5, 1, () => ({ ...idle, move: { x: 0, z: -1 } }))

      const moved = sim.santa.position.clone().sub(before)
      expect(moved.x).toBeCloseTo(0, 3)
      expect(moved.z).toBeLessThan(-7.0)
      expect(moved.z).toBeGreaterThan(-7.6)
      expect(sim.santa.moving).toBe(true)
    })

    it('at the same speed on a diagonal', async () => {
      const sim = await create()
      sim.start(0)
      run(sim, 0, 0.5)
      const before = sim.santa.position.clone()

      run(sim, 0.5, 1, () => ({ ...idle, move: { x: 1, z: 1 } }))

      const moved = sim.santa.position.clone().sub(before)
      expect(moved.x).toBeCloseTo(moved.z, 3)
      expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(7.0)
      expect(Math.hypot(moved.x, moved.z)).toBeLessThan(7.6)
    })

    it('stops when the keys are released', async () => {
      const sim = await create()
      sim.start(0)
      const t = run(sim, 0, 0.5, () => ({ ...idle, move: { x: 1, z: 0 } }))
      run(sim, t, 1 / FPS) // the release lands one step late, as in the original
      const released = sim.santa.position.clone()

      run(sim, t + 1 / FPS, 1)

      expect(sim.santa.position.x).toBeCloseTo(released.x, 1)
      expect(sim.santa.moving).toBe(false)
    })
  })

  it('faces the aim point', async () => {
    const sim = await create()
    sim.start(0)

    const t = run(sim, 0, 0.1, () => ({ ...idle, aim: { x: 5, y: AIM_HEIGHT, z: 0 } }))
    expect(sim.santa.facing).toBeCloseTo(Math.PI / 2, 5)

    run(sim, t, 0.1, () => ({ ...idle, aim: { x: 0, y: AIM_HEIGHT, z: 5 } }))
    expect(sim.santa.facing).toBeCloseTo(0, 5)
  })

  it('keeps facing where it did when the cursor misses the aim plane', async () => {
    const sim = await create()
    sim.start(0)
    const t = run(sim, 0, 0.1, () => ({ ...idle, aim: { x: -5, y: AIM_HEIGHT, z: 0 } }))
    run(sim, t, 0.1)
    expect(sim.santa.facing).toBeCloseTo(-Math.PI / 2, 5)
  })

  describe('Santa throws', () => {
    /** Hold fire for `seconds` and return the gaps between shots, in frames. */
    async function cadence(shootClipDuration: number, seconds = 3) {
      const sim = await create({ shootClipDuration })
      const shots: number[] = []
      sim.on('shoot', () => shots.push(Math.round(sim.elapsed * FPS)))
      sim.start(0)
      run(sim, 0, seconds, () => ({ ...idle, fire: true }))
      return { shots, gaps: shots.slice(1).map((shot, i) => shot - shots[i]) }
    }

    it('on the first frame fire is held', async () => {
      const { shots } = await cadence(SHOOT_CLIP)
      expect(shots[0]).toBe(1)
    })

    it('again only once the shoot clip has played out, at 1.5x', async () => {
      // 0.6083 s at 1.5x is 0.4056 s, longer than the 0.39 s repeat delay, so
      // the clip sets the cadence: the first frame at or past it is frame 25.
      const { gaps } = await cadence(SHOOT_CLIP)
      expect(gaps.length).toBeGreaterThan(5)
      expect(new Set(gaps)).toEqual(new Set([25]))
    })

    it('no faster than the 0.39 s repeat delay, however short the clip', async () => {
      // 0.3 s at 1.5x is 0.2 s: the repeat delay rules, 24 frames (0.4 s).
      const { gaps } = await cadence(0.3)
      expect(new Set(gaps)).toEqual(new Set([24]))
    })

    it('once for a tap', async () => {
      const sim = await create()
      let shots = 0
      sim.on('shoot', () => shots++)
      sim.start(0)
      run(sim, 0, 1, (t) => ({ ...idle, fire: t <= 1 / FPS }))
      expect(shots).toBe(1)
    })

    it('from the muzzle, facing the way Santa does', async () => {
      const sim = await create()
      const seen: { x: number; y: number; z: number; facing: number }[] = []
      sim.on('shoot', ({ position, facing }) => seen.push({ ...position, facing }))
      sim.start(0)
      run(sim, 0, 1 / FPS, () => ({ ...idle, aim: { x: 0, y: AIM_HEIGHT, z: 10 }, fire: true }))

      expect(seen).toHaveLength(1)
      expect(seen[0].facing).toBeCloseTo(0, 5)
      expect(sim.snowballs).toHaveLength(1)
      // The muzzle is off Santa's right hand, at the aim plane's height.
      const ball = sim.snowballs[0].position
      expect(ball.x).toBeCloseTo(-0.253, 2)
      expect(ball.y).toBeCloseTo(AIM_HEIGHT, 2)
      expect(ball.z).toBeCloseTo(0.719, 2)
    })
  })

  describe('a snowball', () => {
    it('flies at the aim point, and bursts once it has flown its range', async () => {
      const sim = await create()
      const bursts: { cause: string; x: number; z: number; at: number }[] = []
      sim.on('burst', ({ cause, position }) => bursts.push({ cause, x: position.x, z: position.z, at: sim.elapsed }))
      sim.start(0)
      const aim = { x: 20, y: AIM_HEIGHT, z: 0 }
      const t = run(sim, 0, 1 / FPS, () => ({ ...idle, aim, fire: true }))

      run(sim, t, 0.5, () => ({ ...idle, aim }))
      const halfway = sim.snowballs[0].position
      expect(halfway.x).toBeGreaterThan(20)
      expect(Math.abs(halfway.z)).toBeLessThan(0.1)

      run(sim, t + 0.5, 1, () => ({ ...idle, aim }))
      expect(sim.snowballs).toHaveLength(0)
      expect(bursts).toHaveLength(1)
      expect(bursts[0].cause).toBe('range')
      expect(bursts[0].x).toBeGreaterThan(49)
      // 50 units at 50 units a second.
      expect(bursts[0].at).toBeGreaterThan(0.95)
      expect(bursts[0].at).toBeLessThan(1.1)
    })

    it('bursts on the arena', async () => {
      const sim = await create({ arena: wall(10) })
      const bursts: { cause: string; x: number }[] = []
      sim.on('burst', ({ cause, position }) => bursts.push({ cause, x: position.x }))
      sim.start(0)
      const aim = { x: 20, y: AIM_HEIGHT, z: 0 }
      const t = run(sim, 0, 1 / FPS, () => ({ ...idle, aim, fire: true }))

      run(sim, t, 1, () => ({ ...idle, aim }))

      expect(sim.snowballs).toHaveLength(0)
      expect(bursts).toHaveLength(1)
      expect(bursts[0].cause).toBe('arena')
      expect(bursts[0].x).toBeGreaterThan(8)
      expect(bursts[0].x).toBeLessThan(11)
    })
  })
})
