// Guards the numbers the HUD states. The demo's argument is that two of them —
// draw calls and VAT size — refuse to move as the count rises, so "refuses to
// move" is asserted here rather than watched in the browser. The cursor rows
// are guarded for the opposite reason: they are the part that *must* move, and
// must land in the band belonging to the clip an instance actually plays.
import { describe, expect, it } from 'vitest'
import { BANDS, MAX_COUNT, layoutCrowd } from './crowd.js'
import { formatBytes, frameRowAt, vatFacts } from './vat-facts.js'

// A stand-in bake: 4 verts x 100 frames of RGBA float, in two textures.
const TEXEL_BYTES = 4 * 4
const texture = (texels: number) => ({ image: { data: { byteLength: texels * TEXEL_BYTES } } })

const VAT = {
  vertexCount: 4,
  totalFrames: 100,
  encoding: "delta" as const,
  positionTexture: texture(400),
  normalTexture: texture(400),
  materials: [{}, {}, {}],
}

const CLIPS = BANDS.map((b, i) => ({
  name: b.clip,
  startFrame: i * 50,
  frames: 50,
  fps: 30,
  duration: 50 / 30,
  maxDelta: 1,
}))

describe('vatFacts', () => {
  it('states the texture dimensions the bake produced', () => {
    expect(vatFacts(VAT)).toMatchObject({ vertexCount: 4, totalFrames: 100 })
  })

  it('measures memory from the textures own bytes, both of them', () => {
    expect(vatFacts(VAT).bytes).toBe(400 * TEXEL_BYTES * 2)
  })

  it('reports no figure rather than a wrong one when a texture keeps no data', () => {
    const facts = vatFacts({ ...VAT, normalTexture: { image: { data: null } } })
    expect(facts.bytes).toBeNull()
    expect(formatBytes(facts.bytes)).toBe('—')
  })

  it('halves the figure for a VAT baked without normals', () => {
    // `bakeNormals: false` is a memory dial, so the HUD must actually show the
    // memory move — a panel still quoting two layers would hide the whole point.
    expect(vatFacts({ ...VAT, normalTexture: null }).bytes).toBe(400 * TEXEL_BYTES)
  })

  it('costs one draw call per source material, never one per robot', () => {
    expect(vatFacts(VAT).drawCalls).toBe(3)
  })
})

describe('formatBytes', () => {
  it('reads in megabytes to one decimal', () => {
    expect(formatBytes(35.25 * 1024 * 1024)).toBe('35.3 MB')
  })

  it('reads in kilobytes below a megabyte', () => {
    expect(formatBytes(120 * 1024)).toBe('120 KB')
  })
})

describe('frameRowAt', () => {
  const [idle, walking] = CLIPS
  const play = (clip: (typeof CLIPS)[number], startTime: number, speed: number) => ({
    clip,
    startTime,
    speed,
  })

  it('stays inside its own clip band, however long the demo runs', () => {
    for (const time of [0, 0.3, 7, 1_000.5]) {
      const row = frameRowAt(play(walking!, -3.7, 1.2), time)
      expect(row).toBeGreaterThanOrEqual(walking!.startFrame)
      expect(row).toBeLessThan(walking!.startFrame + walking!.frames)
    }
  })

  it('advances at the instance playback rate, from its own phase', () => {
    const still = play(idle!, 0, 0)
    expect(frameRowAt(still, 0)).toBe(idle!.startFrame)
    expect(frameRowAt(still, 9)).toBe(idle!.startFrame)
    // Half a clip in, at 1x, is halfway down the band.
    expect(frameRowAt(play(idle!, 0, 1), idle!.duration / 2)).toBeCloseTo(
      idle!.startFrame + idle!.frames / 2,
    )
  })

  it('desyncs two instances of one clip onto different rows', () => {
    // Desync is a start time in the past: the robot that began earlier is
    // further into its clip.
    const a = frameRowAt(play(idle!, 0, 1), 0.4)
    const b = frameRowAt(play(idle!, -0.9, 1), 0.4)
    expect(a).not.toBeCloseTo(b)
  })
})

describe('the cursors a crowd produces', () => {
  const bandOf = (row: number) => CLIPS.find((c) => row >= c.startFrame && row < c.startFrame + c.frames)!.name
  const bandsAt = (count: number) =>
    new Set(layoutCrowd(CLIPS, count, 1.42).map((r) => bandOf(frameRowAt(r, 2.5))))

  it('sits in one band at count 1 and spreads across every band at the top', () => {
    expect(bandsAt(1)).toEqual(new Set(['Idle']))
    expect(bandsAt(MAX_COUNT)).toEqual(new Set(CLIPS.map((c) => c.name)))
  })
})
