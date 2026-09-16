// Guards the demo's "robots must never overlap" requirement. Lives here because
// the library suite is the only vitest runner in the repo; `examples/src/crowd.ts`
// is deliberately free of three.js and the DOM so it can be imported directly.
import { describe, expect, it } from 'vitest'
import { layoutCrowd, positionAt, ZONES } from '../examples/src/crowd.js'

// Mirrors the demo: RobotExpressive at TARGET_HEIGHT 1.8 with CLEARANCE 1.25.
const FOOTPRINT = 1.42
const COUNTS = { dancers: 60, walkers: 160, runners: 120 }
const CLIPS = ZONES.map((z, i) => ({
  name: z.clip,
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

describe('crowd layout never overlaps', () => {
  it('keeps every pair at least one footprint apart, across a long run', () => {
    const robots = layoutCrowd(CLIPS, COUNTS, FOOTPRINT)
    expect(robots).toHaveLength(340)

    let worst = Infinity
    let worstTime = 0
    // Sample densely early (phases separate fastest) and out to an hour.
    const times = [
      ...Array.from({ length: 200 }, (_, i) => i * 0.05),
      ...Array.from({ length: 200 }, (_, i) => i * 3),
      ...Array.from({ length: 60 }, (_, i) => i * 60),
    ]
    for (const t of times) {
      const { min } = minPairDistance(robots, t)
      if (min < worst) { worst = min; worstTime = t }
    }
    console.log({
      robots: robots.length,
      footprint: FOOTPRINT,
      worstSeparation: +worst.toFixed(4),
      atTime: worstTime,
      margin: +(worst - FOOTPRINT).toFixed(4),
    })
    // Rings sit exactly one footprint apart by construction, so the worst
    // case *is* the footprint — allow float slop, reject any real overlap.
    expect(worst).toBeGreaterThan(FOOTPRINT - 1e-9)
  })

  it('separates the three zones into disjoint radial bands', () => {
    const robots = layoutCrowd(CLIPS, COUNTS, FOOTPRINT)
    const band = (name: string) => {
      const rs = robots.filter((r) => r.clip.name === name).map((r) => r.radius)
      return { min: Math.min(...rs), max: Math.max(...rs) }
    }
    const d = band('Dance'), w = band('Walking'), r = band('Running')
    console.log({ dancers: d, walkers: w, runners: r })

    expect(w.min).toBeGreaterThan(d.max + FOOTPRINT)
    expect(r.min).toBeGreaterThan(w.max + FOOTPRINT)
  })

  it('gives every robot on a ring the same angular velocity (rigid rotation)', () => {
    const robots = layoutCrowd(CLIPS, COUNTS, FOOTPRINT)
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

  it('leaves dancers stationary and movers moving', () => {
    const robots = layoutCrowd(CLIPS, COUNTS, FOOTPRINT)
    for (const r of robots) {
      // `-0` is a legitimate product of direction * 0; it compares equal to 0.
      if (r.clip.name === 'Dance') expect(Math.abs(r.omega)).toBe(0)
      else if (r.radius > 0) expect(Math.abs(r.omega)).toBeGreaterThan(0)
    }
  })

  it('holds the guarantee across the whole range of the spacing sliders', () => {
    // The GUI exposes clearance (>= 1) and zoneGap (>= 0). Both feed the
    // layout, so both have to be swept — a slider that can produce overlap is
    // the same bug as a layout that does.
    const baseWidth = 1.136 // robot's real width at TARGET_HEIGHT 1.8
    for (const clearance of [1, 1.25, 2, 4]) {
      for (const zoneGap of [0, 2, 10]) {
        const footprint = baseWidth * clearance
        const robots = layoutCrowd(CLIPS, COUNTS, footprint, zoneGap)
        let worst = Infinity
        for (let t = 0; t < 60; t += 0.73) {
          worst = Math.min(worst, minPairDistance(robots, t).min)
        }
        expect(
          worst,
          `clearance=${clearance} zoneGap=${zoneGap} -> ${worst.toFixed(3)}`,
        ).toBeGreaterThan(footprint - 1e-9)
      }
    }
  })

  it('never lets a zone gap of 0 collapse the bands into each other', () => {
    const robots = layoutCrowd(CLIPS, COUNTS, FOOTPRINT, 0)
    let worst = Infinity
    for (let t = 0; t < 120; t += 0.37) {
      worst = Math.min(worst, minPairDistance(robots, t).min)
    }
    // Even with no extra gap, the ring step alone keeps a full footprint.
    expect(worst).toBeGreaterThan(FOOTPRINT - 1e-9)
  })
})
