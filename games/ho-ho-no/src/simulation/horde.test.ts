import { describe, expect, it } from 'vitest'
import { createVATPlaybackTexture, resolveVATFrame, setVATInstance, type VATClip, type VATFrame } from 'three-vat'
import { AIM_HEIGHT, SKELETON_CAPACITY, spawnInterval, type Simulation, type Skeleton, type SimulationInput } from './simulation'
import { FPS, idle, run, simulate } from './test-crowds'

// The horde, held where a player sees it: which clip each skeleton shows,
// read through the library's own `resolveVATFrame` on what its row holds,
// where it stands, and what the run makes of it. Every skeleton here spawns at
// angle 0 on the ring — (17, 0) — unless a test says otherwise, so Santa at
// the centre has one line to aim down.

const AT_THE_SPAWN = () => 0
const SPAWN = { x: 17, z: 0 }
const FIRST_SPAWN = 0.9

/** Aim down the line to the spawn point, holding fire. */
const firing: SimulationInput = { ...idle, aim: { x: SPAWN.x, y: AIM_HEIGHT, z: SPAWN.z }, fire: true }

const seconds = (clip: VATClip) => clip.frames / clip.fps
const inBand = (frame: VATFrame, clip: VATClip) =>
  frame.row >= clip.startFrame && frame.row < clip.startFrame + clip.frames
const lastRow = (clip: VATClip) => clip.startFrame + clip.frames - 1

/** A simulation whose skeletons all spawn at (17, 0), started at 0. */
async function horde() {
  const { simulation, crowd } = await simulate({ random: AT_THE_SPAWN })
  simulation.start(0)
  return { sim: simulation, crowd, clips: crowd.clips }
}

/** Step until `done`, or fail after `limit` seconds; returns the time reached. */
function until(sim: Simulation, from: number, done: () => boolean, input: (t: number) => SimulationInput = () => idle, limit = 30) {
  let t = from
  while (!done()) {
    if (t - from > limit) throw new Error(`nothing happened in ${limit} s`)
    t = run(sim, t, 1 / FPS, input)
  }
  return t
}

describe('a skeleton', () => {
  it('spawns on the ring and shows its own spawn from the first frame', async () => {
    const { sim, clips } = await horde()
    const t = until(sim, 0, () => sim.skeletons.length > 0)

    expect(t).toBeCloseTo(FIRST_SPAWN, 6)
    const [skeleton] = sim.skeletons
    expect(skeleton.state).toBe('rising')
    expect(Math.hypot(skeleton.position.x, skeleton.position.z)).toBeCloseTo(17, 2)
    const frame = resolveVATFrame(skeleton.playback, t)
    expect(frame.row).toBe(clips.spawn.startFrame)
    expect(frame.outgoing).toBeNull()
  })

  it('rises where it spawned, facing Santa, then blends into a walk at 2x', async () => {
    const { sim, clips } = await horde()
    const t0 = until(sim, 0, () => sim.skeletons.length > 0)
    const skeleton = sim.skeletons[0]
    // The spawn clip plays once, and the walk starts where it ends.
    const walkAt = t0 + seconds(clips.spawn)

    let t = run(sim, t0, walkAt - 0.1 - t0)
    expect(skeleton.state).toBe('rising')
    expect(inBand(resolveVATFrame(skeleton.playback, t), clips.spawn)).toBe(true)
    expect(skeleton.position.x).toBeCloseTo(SPAWN.x, 1)
    expect(skeleton.position.z).toBeCloseTo(SPAWN.z, 1)
    expect(skeleton.facing).toBeCloseTo(-Math.PI / 2, 2)

    // Halfway through the blend: walking, over the spawn's last pose, held.
    t = run(sim, t, 0.25)
    expect(skeleton.state).toBe('walking')
    const blending = resolveVATFrame(skeleton.playback, t)
    expect(inBand(blending, clips.walk)).toBe(true)
    expect(blending.outgoing?.row).toBe(lastRow(clips.spawn))
    expect(blending.outgoing?.finished).toBe(true)
    expect(blending.outgoing?.weight).toBeGreaterThan(0.3)
    expect(blending.outgoing?.weight).toBeLessThan(0.7)

    // Past it: the walk alone, twice as fast as the clip.
    t = run(sim, t, 0.5)
    const walking = resolveVATFrame(skeleton.playback, t)
    expect(walking.outgoing?.weight ?? 0).toBe(0)
    expect(walking.phase).toBeCloseTo((((t - walkAt) * 2) / seconds(clips.walk)) % 1, 6)
  })

  it('walks at Santa at the original speed, facing him', async () => {
    const { sim, clips } = await horde()
    const t0 = until(sim, 0, () => sim.skeletons.length > 0)
    const skeleton = sim.skeletons[0]
    let t = run(sim, t0, seconds(clips.spawn) + 0.1)
    const from = skeleton.position.clone()

    t = run(sim, t, 1)
    const santa = sim.santa.position
    const closed = from.distanceTo(santa) - skeleton.position.distanceTo(santa)
    expect(closed).toBeGreaterThan(3.3)
    expect(closed).toBeLessThan(3.6)
    expect(skeleton.facing).toBeCloseTo(Math.atan2(santa.x - skeleton.position.x, santa.z - skeleton.position.z), 1)
  })

  describe('hit by a snowball', () => {
    /** A walking skeleton, shot once: the moment it was hit, and it. */
    async function shot() {
      const { sim, crowd, clips } = await horde()
      const t0 = until(sim, 0, () => sim.skeletons.length > 0)
      const skeleton = sim.skeletons[0]
      let t = run(sim, t0, seconds(clips.spawn) + 0.4)
      expect(skeleton.state).toBe('walking')

      const kills: number[] = []
      sim.on('kill', ({ kills: count }) => kills.push(count))
      const aim = { x: skeleton.position.x, y: AIM_HEIGHT, z: skeleton.position.z }
      t = run(sim, t, 1 / FPS, () => ({ ...idle, aim, fire: true }))
      t = until(sim, t, () => skeleton.state !== 'walking', () => ({ ...idle, aim }), 1)
      return { sim, crowd, clips, skeleton, hitAt: t, kills }
    }

    it('counts a kill and blends out of its walk into its death', async () => {
      const { sim, clips, skeleton, hitAt, kills } = await shot()

      expect(sim.kills).toBe(1)
      expect(kills).toEqual([1])
      expect(skeleton.state).toBe('dying')
      const hit = resolveVATFrame(skeleton.playback, hitAt)
      expect(hit.row).toBe(clips.death.startFrame)
      expect(inBand(hit.outgoing!, clips.walk)).toBe(true)
      expect(hit.outgoing?.weight).toBe(1)
      expect(resolveVATFrame(skeleton.playback, hitAt + 0.1).outgoing?.weight).toBeCloseTo(0, 9)
    })

    it('finishes its death clamped on the last frame, and only then sinks', async () => {
      const { sim, clips, skeleton, hitAt } = await shot()
      const fallen = skeleton.position.clone()
      const deathEnds = hitAt + seconds(clips.death)

      let t = run(sim, hitAt, deathEnds - hitAt - 2 / FPS)
      expect(skeleton.state).toBe('dying')
      expect(resolveVATFrame(skeleton.playback, t).finished).toBe(false)
      expect(skeleton.position.y).toBe(fallen.y)

      t = run(sim, t, 3 / FPS)
      const ended = resolveVATFrame(skeleton.playback, t)
      expect(ended.finished).toBe(true)
      expect(ended.row).toBe(lastRow(clips.death))
      expect(ended.wraps).toBe(false)
      expect(skeleton.state).toBe('sinking')

      // At the original's rate, from the moment the clip ended.
      t = run(sim, t, 1)
      expect(skeleton.position.y).toBeCloseTo(fallen.y - (t - deathEnds), 6)
      expect(skeleton.position.x).toBe(fallen.x)
      expect(resolveVATFrame(skeleton.playback, t).row).toBe(lastRow(clips.death))
    })

    it('gives its row back once it is below the floor', async () => {
      const { sim, crowd, skeleton, hitAt } = await shot()

      // Shooting the risers meanwhile, or the next one ends the run first.
      const t = until(sim, hitAt, () => !sim.skeletons.includes(skeleton), () => firing)

      expect(skeleton.position.y).toBeLessThanOrEqual(-3)
      expect(skeleton.position.y).toBeGreaterThan(-3.1)
      // The carrier holds a row for each skeleton still in play and no more:
      // this one's was given back, whatever has spawned and sunk meanwhile.
      expect(crowd.carrier.instanceCount).toBe(sim.skeletons.length)
      const heir = sim.skeletons.find((other) => other.row === skeleton.row)
      if (heir) expect(heir.playback.startTime).toBeGreaterThan(hitAt)
      expect(t).toBeGreaterThan(hitAt)
    })
  })

  it('spawned into a recycled row shows its own spawn from the first frame, never the corpse', async () => {
    const { sim, crowd, clips } = await horde()
    // Every skeleton shot where it rises, so the horde never gets far.
    const t0 = until(sim, 0, () => sim.skeletons.length > 0, () => firing)
    const first = sim.skeletons[0]
    let t = until(sim, t0, () => !sim.skeletons.includes(first), () => firing)

    // The next spawn takes the lowest freed row: the first skeleton's.
    let heir: Skeleton | undefined
    t = until(sim, t, () => (heir = sim.skeletons.find((skeleton) => skeleton.row === first.row)) !== undefined, () => firing)
    expect(heir).not.toBe(first)
    expect(heir!.state).toBe('rising')

    const frame = resolveVATFrame(heir!.playback, t)
    expect(frame.row).toBe(clips.spawn.startFrame)
    expect(frame.outgoing).toBeNull()

    // And that is what the row itself holds, whole: its texels are a fresh
    // write of the spawn, with nothing of the corpse's pack left in them.
    const fresh = createVATPlaybackTexture([], { capacity: SKELETON_CAPACITY })
    setVATInstance(fresh, heir!.row, heir!.playback)
    const rowOf = (data: ArrayLike<number>) => {
      const width = data.length / SKELETON_CAPACITY
      return Array.from(data).slice(heir!.row * width, (heir!.row + 1) * width)
    }
    expect(rowOf(crowd.playback.texture.image.data as Float32Array)).toEqual(
      rowOf(fresh.texture.image.data as Float32Array),
    )
  })
})

describe('the horde', () => {
  it('spawns on the original ramp: 0.9 s apart at the start, closing to 0.35 s over 90 s', () => {
    expect(spawnInterval(0)).toBeCloseTo(0.9, 9)
    expect(spawnInterval(45)).toBeCloseTo(0.625, 9)
    expect(spawnInterval(90)).toBeCloseTo(0.35, 9)
    expect(spawnInterval(300)).toBeCloseTo(0.35, 9)
  })

  it('follows that ramp through a run', async () => {
    const { sim } = await horde()
    // Shot as they rise, so Santa lives long enough to watch the ramp close.
    const seen = new Set<Skeleton>()
    const spawns: number[] = []
    let t = 0
    while (t < 60) {
      t = run(sim, t, 1 / FPS, () => firing)
      for (const skeleton of sim.skeletons) {
        if (seen.has(skeleton)) continue
        seen.add(skeleton)
        spawns.push(t)
      }
    }

    expect(sim.over).toBe(false)
    expect(spawns[0]).toBeCloseTo(FIRST_SPAWN, 6)
    expect(spawns.length).toBeGreaterThan(80)
    // Each gap is the ramp's interval at the spawn before it, to the step.
    for (let i = 1; i < spawns.length; i++) {
      expect(Math.abs(spawns[i] - spawns[i - 1] - spawnInterval(spawns[i - 1]))).toBeLessThanOrEqual(1 / FPS + 1e-9)
    }
    expect(sim.kills).toBeGreaterThan(spawns.length - 3)
  })

  it('ends the run when a skeleton reaches Santa', async () => {
    const { sim } = await horde()
    const over: { kills: number; elapsed: number }[] = []
    sim.on('gameOver', (event) => over.push(event))

    const t = until(sim, 0, () => sim.over)

    // Risen by 4.5 s, then 15.7 units at 3.5 a second to touch him.
    expect(over).toHaveLength(1)
    expect(over[0].kills).toBe(0)
    expect(over[0].elapsed).toBeCloseTo(sim.elapsed, 9)
    expect(sim.elapsed).toBeGreaterThan(8.5)
    expect(sim.elapsed).toBeLessThan(9.5)

    // Nothing moves after, whatever the player does.
    const santa = sim.santa.position.clone()
    const skeletons = sim.skeletons.map((skeleton) => skeleton.position.clone())
    run(sim, t, 1, () => ({ move: { x: 1, z: 0 }, aim: null, fire: true }))
    expect(sim.elapsed).toBe(over[0].elapsed)
    expect(sim.santa.position).toEqual(santa)
    expect(sim.snowballs).toHaveLength(0)
    expect(sim.skeletons.map((skeleton) => skeleton.position)).toEqual(skeletons)
  })

  it('goes on past a skeleton reaching an invincible Santa, the debug panel\'s cheat', async () => {
    const { sim } = await horde()
    sim.invincible = true
    let over = 0
    sim.on('gameOver', () => over++)

    // Well past the 9 s the first skeleton takes to reach him.
    run(sim, 0, 12)

    expect(over).toBe(0)
    expect(sim.over).toBe(false)
    expect(sim.elapsed).toBeCloseTo(12, 9)
  })
})

describe('the physics colliders', () => {
  it('are drawn as line segments, a colour for each end, for the debug panel', async () => {
    const { sim } = await horde()
    run(sim, 0, 1)

    const { vertices, colors } = sim.colliderLines()
    // Santa's capsule and the ground at least, in xyz pairs and rgba pairs.
    expect(vertices.length).toBeGreaterThan(0)
    expect(vertices.length % 6).toBe(0)
    expect(colors.length / 4).toBe(vertices.length / 3)
  })
})
