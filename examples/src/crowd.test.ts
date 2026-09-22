// Guards the demo's crowd layout: the count slider is the whole demo, so the
// properties that make dragging it safe — no overlap at any count, and nothing
// already on screen moving or changing clip as it rises — are asserted here
// rather than eyeballed in the browser. `crowd.ts` is deliberately free of
// three.js and the DOM so it can be imported directly.
import { describe, expect, it } from 'vitest'
import { BANDS, MAX_COUNT, layoutCrowd, positionAt, type Robot } from './crowd.js'

// Mirrors the demo: RobotExpressive at TARGET_HEIGHT 1.8 with CLEARANCE 1.25.
const FOOTPRINT = 1.42
const CLIPS = BANDS.map((b, i) => ({
  name: b.clip,
  startFrame: i * 50,
  frames: 50,
  fps: 30,
  duration: 50 / 30,
  maxDelta: 1,
}))

function minPairDistance(robots: ReturnType<typeof layoutCrowd>, time: number) {
  const pts = robots.map((r) => positionAt(r, time))
  let min = Infinity
  let pair = [-1, -1]
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z)
      if (d < min) { min = d; pair = [i, j] }
    }
  }
  return { min, pair }
}

const crowdAt = (count: number, footprint = FOOTPRINT, gap?: number) =>
  layoutCrowd(CLIPS, count, footprint, gap)

const clipsAt = (count: number) => new Set(crowdAt(count).map((r) => r.clip.name))

// The count each band's first robot appears at, read off the table the demo
// reads — so a retuned threshold moves the test with it rather than breaking it.
const [idle, walkers, runners] = BANDS

describe('the count drives the crowd', () => {
  it('opens on one robot, centred, on the idle clip', () => {
    const robots = crowdAt(1)
    expect(robots).toHaveLength(1)
    expect(robots[0]!.clip.name).toBe(idle!.clip)
    expect(robots[0]!.radius).toBe(0)
    expect(positionAt(robots[0]!, 12.5)).toEqual({ x: 0, z: 0 })
  })

  it('reaches the full crowd at the top of the range', () => {
    expect(crowdAt(MAX_COUNT)).toHaveLength(MAX_COUNT)
    expect(MAX_COUNT).toBe(340)
  })

  it('holds each band back until its threshold, then shows it', () => {
    for (const band of [walkers!, runners!]) {
      expect(clipsAt(band.from - 1), `below ${band.clip}`).not.toContain(band.clip)
      expect(clipsAt(band.from), `at ${band.clip}`).toContain(band.clip)
      expect(clipsAt(MAX_COUNT), `at the top`).toContain(band.clip)
    }
  })

  it('never unplaces or reclips a robot as the count rises', () => {
    // The demo relies on this outright: it lays the full crowd out once and
    // lets the slider draw a prefix of it. A layout that reshuffled would make
    // dragging look like a rebuild rather than a crowd growing.
    let previous = crowdAt(1)
    for (let count = 2; count <= MAX_COUNT; count++) {
      const robots = crowdAt(count)
      expect(robots).toHaveLength(count)
      for (let i = 0; i < previous.length; i++) {
        const was = previous[i]!
        const now = robots[i]!
        expect(now.clip.name, `robot ${i} at count ${count}`).toBe(was.clip.name)
        expect(now.radius).toBe(was.radius)
        expect(now.angle0).toBe(was.angle0)
        expect(now.omega).toBe(was.omega)
        // The GPU-side half of the robot too: these are written into instanced
        // attributes once, so a robot whose phase changed under the slider
        // would visibly snap mid-stride even though it never moved.
        expect(now.startTime).toBe(was.startTime)
        expect(now.speed).toBe(was.speed)
        expect(now.heading).toBe(was.heading)
      }
      previous = robots
    }
  })

  it('keeps every pair at least one footprint apart, at every count', () => {
    // The old suite swept one fixed crowd of 340 across time. The slider makes
    // the count a free variable too, so it is swept as well: a partly filled
    // ring is a different arrangement from a full one, and only a sweep sees it.
    // Every count gets a handful of times; the counts that matter most — the
    // thresholds, and the full crowd — get a long run out to an hour, where
    // rings that turn at different rates have had time to drift apart.
    const quick = [0, 0.37, 1.1, 4.3, 17, 53]
    const dense = [
      ...Array.from({ length: 120 }, (_, i) => i * 0.05),
      ...Array.from({ length: 80 }, (_, i) => i * 3),
      ...Array.from({ length: 40 }, (_, i) => i * 90),
    ]
    const longRun = new Set([1, 2, walkers!.from - 1, walkers!.from, runners!.from - 1, runners!.from, MAX_COUNT])

    let worst = Infinity
    let worstAt = { count: 0, time: 0 }
    for (let count = 1; count <= MAX_COUNT; count++) {
      const robots = crowdAt(count)
      for (const t of longRun.has(count) ? dense : quick) {
        const { min } = minPairDistance(robots, t)
        if (min < worst) { worst = min; worstAt = { count, time: t } }
      }
    }
    console.log({ footprint: FOOTPRINT, worstSeparation: +worst.toFixed(4), ...worstAt })
    // Rings sit exactly one footprint apart by construction, so the worst
    // case *is* the footprint — allow float slop, reject any real overlap.
    expect(worst).toBeGreaterThan(FOOTPRINT - 1e-9)
  })

  it('keeps the guarantee across the spacing the demo could be tuned to', () => {
    const baseWidth = 1.136 // robot's real width at TARGET_HEIGHT 1.8
    for (const clearance of [1, 1.25, 2, 4]) {
      for (const gap of [0, 2, 10]) {
        const footprint = baseWidth * clearance
        for (const count of [1, 2, 60, 61, 200, 221, 339, MAX_COUNT]) {
          const robots = crowdAt(count, footprint, gap)
          let worst = Infinity
          for (let t = 0; t < 60; t += 0.73) {
            worst = Math.min(worst, minPairDistance(robots, t).min)
          }
          expect(
            worst,
            `clearance=${clearance} gap=${gap} count=${count} -> ${worst.toFixed(3)}`,
          ).toBeGreaterThan(footprint - 1e-9)
        }
      }
    }
  })

  it('keeps the bands in disjoint radial bands', () => {
    const robots = crowdAt(MAX_COUNT)
    const extent = (name: string) => {
      const rs = robots.filter((r) => r.clip.name === name).map((r) => r.radius)
      return { min: Math.min(...rs), max: Math.max(...rs) }
    }
    const i = extent(idle!.clip), w = extent(walkers!.clip), r = extent(runners!.clip)
    console.log({ idling: i, walking: w, running: r })

    expect(w.min).toBeGreaterThan(i.max + FOOTPRINT)
    expect(r.min).toBeGreaterThan(w.max + FOOTPRINT)
  })

  it('gives every robot on a ring the same angular velocity (rigid rotation)', () => {
    const robots = crowdAt(MAX_COUNT)
    const byRing = new Map<number, Set<number>>()
    for (const r of robots) {
      if (!byRing.has(r.radius)) byRing.set(r.radius, new Set())
      byRing.get(r.radius)!.add(r.omega)
    }
    // Any ring with two distinct omegas would eventually collide.
    for (const [radius, omegas] of byRing) {
      expect(omegas.size, `ring r=${radius} has ${omegas.size} speeds`).toBe(1)
    }
  })

  it('leaves idlers stationary and movers moving', () => {
    for (const r of crowdAt(MAX_COUNT)) {
      // `-0` is a legitimate product of direction * 0; it compares equal to 0.
      if (r.clip.name === idle!.clip) expect(Math.abs(r.omega)).toBe(0)
      else if (r.radius > 0) expect(Math.abs(r.omega)).toBeGreaterThan(0)
    }
  })

  it('refuses a clip set it cannot lay out, rather than silently thinning the crowd', () => {
    expect(() => layoutCrowd(CLIPS.slice(0, 1), MAX_COUNT, FOOTPRINT)).toThrow(/Walking/)
  })

  it('treats a count below 1 as an empty crowd', () => {
    expect(crowdAt(0)).toHaveLength(0)
    expect(crowdAt(-5)).toHaveLength(0)
  })
})

// The bands are named for the demo's robot, whose clips are `Idle`, `Walking`
// and `Running`. An example's asset need not agree: Soldier's are `Idle`, `Walk`
// and `Run`, so the layout is told which of its clips plays each band.
describe('an asset that names its clips differently', () => {
  const soldierNames = { Idle: 'Idle', Walking: 'Walk', Running: 'Run' } as const
  const SOLDIER_CLIPS = CLIPS.map((c) => ({ ...c, name: soldierNames[c.name as keyof typeof soldierNames] as string }))

  it("lays out the same crowd, band for band, under the asset's own clip names", () => {
    const soldiers = layoutCrowd(SOLDIER_CLIPS, MAX_COUNT, FOOTPRINT, undefined, soldierNames)
    const robots = crowdAt(MAX_COUNT)

    expect(soldiers.map((r) => r.clip.name)).toEqual(
      robots.map((r) => soldierNames[r.clip.name as keyof typeof soldierNames]),
    )
    // Nothing but the clip differs: same rings, same phases, same rates.
    const placement = ({ clip: _clip, ...rest }: Robot) => rest
    expect(soldiers.map(placement)).toEqual(robots.map(placement))
  })

  it('names the clip it was told to look for when the asset lacks it', () => {
    expect(() => layoutCrowd(SOLDIER_CLIPS.slice(0, 2), 1, FOOTPRINT, undefined, soldierNames)).toThrow(/"Run"/)
  })
})
