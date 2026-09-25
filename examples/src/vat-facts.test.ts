// Guards the numbers the HUD states. The demo's argument is that two of them —
// draw calls and VAT size — refuse to move as the count rises, so "refuses to
// move" is asserted here rather than watched in the browser. The cursor rows
// are guarded for the opposite reason: they are the part that *must* move, and
// must land in the band belonging to the clip an instance actually plays.
import { describe, expect, it } from 'vitest'
import { BANDS, MAX_COUNT, layoutCrowd } from './crowd.js'
import {
  cursorsAt,
  formatBakeTime,
  formatBytes,
  formatClipCount,
  formatClipDuration,
  formatDimensions,
  vatFacts,
} from './vat-facts.js'

// A stand-in bake: 4 verts x 100 frames, in two textures of the widths the
// baker actually produces — eight bytes a position texel (#73), two a normal
// one (#29), and sixteen on the rig texture, which stays float. The panel
// measures `byteLength` and never asks what a texel holds, so the difference
// between the layers is the only thing worth standing in for.
const POSITION_TEXEL_BYTES = 4 * 2
const NORMAL_TEXEL_BYTES = 2
const RIG_TEXEL_BYTES = 4 * 4
const texture = (bytes: number) => ({ image: { data: { byteLength: bytes } } })

const VAT = {
  vertexCount: 4,
  totalFrames: 100,
  encoding: "delta" as const,
  positionTexture: texture(400 * POSITION_TEXEL_BYTES),
  normalTexture: texture(400 * NORMAL_TEXEL_BYTES),
  materials: [{}, {}, {}],
  fallback: null,
  clips: [
    { name: 'Idle', duration: 2, frames: 60 },
    { name: 'Walk', duration: 4 / 3, frames: 40 },
  ],
}

// The same character under the rig encoding (ADR-0018): 49 slots — Soldier's
// width — at two texels each, over the same 100 frames, in the one rig texture.
const RIG_VAT = {
  vertexCount: 4,
  totalFrames: 100,
  encoding: "rig" as const,
  slotCount: 49,
  rigTexture: texture(49 * 2 * 100 * RIG_TEXEL_BYTES),
  materials: [{}, {}],
  clips: VAT.clips,
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
    expect(vatFacts(VAT).bytes).toBe(400 * POSITION_TEXEL_BYTES + 400 * NORMAL_TEXEL_BYTES)
  })

  it('reports no figure rather than a wrong one when a texture keeps no data', () => {
    const facts = vatFacts({ ...VAT, normalTexture: { image: { data: null } } })
    expect(facts.bytes).toBeNull()
    expect(formatBytes(facts.bytes)).toBe('—')
  })

  it('drops the normal layer’s bytes for a VAT baked without normals', () => {
    // `bakeNormals: false` is a memory dial, so the HUD must actually show the
    // memory move — a panel still quoting two layers would hide the whole point.
    expect(vatFacts({ ...VAT, normalTexture: null }).bytes).toBe(400 * POSITION_TEXEL_BYTES)
  })

  it('costs one draw call per source material, never one per robot', () => {
    expect(vatFacts(VAT).drawCalls).toBe(3)
  })
})

describe('vatFacts on a rig VAT', () => {
  it('states slots across and frames down, not vertices', () => {
    // The rig texture is indexed by slot, so vertices say nothing about its
    // size; a rig VAT still knows its vertex count, and the HUD must not print it.
    expect(vatFacts(RIG_VAT)).toMatchObject({ encoding: 'rig', slotCount: 49, totalFrames: 100 })
    expect(vatFacts(RIG_VAT)).not.toHaveProperty('vertexCount')
  })

  it("measures memory from the rig texture's own bytes — two texels a slot", () => {
    expect(vatFacts(RIG_VAT).bytes).toBe(49 * 2 * 100 * RIG_TEXEL_BYTES)
  })

  it('reports no figure rather than a wrong one when the rig texture keeps no data', () => {
    expect(vatFacts({ ...RIG_VAT, rigTexture: { image: { data: null } } }).bytes).toBeNull()
  })

  it('costs one draw call per source material, as under the vertex encoding', () => {
    expect(vatFacts(RIG_VAT).drawCalls).toBe(2)
  })
})

describe('the fallback', () => {
  // ADR-0029: an 'auto' bake that fell back says why on the VAT, and the HUD
  // reads it there rather than guessing at it.
  const REASON = 'three-vat: the rig encoding cannot store the morph target "smile" that "Wave" animates'

  it("carries the VAT's own reason for a bake that fell back", () => {
    expect(vatFacts({ ...VAT, fallback: REASON }).fallback).toBe(REASON)
  })

  it('has none for a vertex encoding asked for by name', () => {
    expect(vatFacts(VAT).fallback).toBeNull()
  })

  it('has none under the rig encoding, which never fell back', () => {
    expect(vatFacts(RIG_VAT).fallback).toBeNull()
  })
})

describe('the clip table', () => {
  it('lists every baked clip with its name, duration and frames, in band order', () => {
    const table = [{ name: 'Idle', duration: 2, frames: 60 }, { name: 'Walk', duration: 4 / 3, frames: 40 }]
    expect(vatFacts(VAT).clips).toEqual(table)
    expect(vatFacts(RIG_VAT).clips).toEqual(table)
  })

  it('counts the clips, and says a bake of none animates nothing', () => {
    // A static asset is reported honestly, not as an error.
    expect(formatClipCount(vatFacts({ ...VAT, clips: [] }))).toBe('0 clips: nothing animates')
    expect(formatClipCount(vatFacts({ ...VAT, clips: VAT.clips.slice(0, 1) }))).toBe('1 clip')
    expect(formatClipCount(vatFacts(VAT))).toBe('2 clips')
  })

  it('reads a duration in seconds to two decimals', () => {
    expect(formatClipDuration(4 / 3)).toBe('1.33 s')
    expect(formatClipDuration(0)).toBe('0.00 s')
  })
})

describe('formatDimensions', () => {
  it('reads vertices × frames for the vertex encoding', () => {
    expect(formatDimensions(vatFacts(VAT))).toBe('4 verts × 100 frames')
  })

  it('reads slots × frames for the rig encoding', () => {
    expect(formatDimensions(vatFacts(RIG_VAT))).toBe('49 slots × 100 frames')
  })
})

describe('formatBakeTime', () => {
  // The two bake times the example sets side by side are three orders of
  // magnitude apart, so one unit would print one of them as noise.
  it('keeps a decimal under ten milliseconds, where the rig bake lands', () => {
    expect(formatBakeTime(4.63)).toBe('4.6 ms')
  })

  it('reads whole milliseconds under a second', () => {
    expect(formatBakeTime(286.4)).toBe('286 ms')
  })

  it('reads in seconds to one decimal from a second up, where the vertex bake lands', () => {
    expect(formatBakeTime(1412)).toBe('1.4 s')
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

describe('cursorsAt', () => {
  const [idle, walking] = CLIPS
  const play = (clip: (typeof CLIPS)[number], startTime: number, speed: number) => ({
    clip,
    startTime,
    speed,
  })
  /** The live band's cursor — the one every instance always has. */
  const rowAt = (instance: Parameters<typeof cursorsAt>[0], time: number) => cursorsAt(instance, time)[0]!.row

  it('stays inside its own clip band, however long the demo runs', () => {
    for (const time of [0, 0.3, 7, 1_000.5]) {
      const row = rowAt(play(walking!, -3.7, 1.2), time)
      expect(row).toBeGreaterThanOrEqual(walking!.startFrame)
      expect(row).toBeLessThan(walking!.startFrame + walking!.frames)
    }
  })

  it('advances at the instance playback rate, from its own phase', () => {
    const still = play(idle!, 0, 0)
    expect(rowAt(still, 0)).toBe(idle!.startFrame)
    expect(rowAt(still, 9)).toBe(idle!.startFrame)
    // Half a clip in, at 1x, is halfway down the band.
    expect(rowAt(play(idle!, 0, 1), idle!.duration / 2)).toBeCloseTo(idle!.startFrame + idle!.frames / 2)
  })

  it('desyncs two instances of one clip onto different rows', () => {
    // Desync is a start time in the past: the robot that began earlier is
    // further into its clip.
    const a = rowAt(play(idle!, 0, 1), 0.4)
    const b = rowAt(play(idle!, -0.9, 1), 0.4)
    expect(a).not.toBeCloseTo(b)
  })

  // The crossfade pages' evidence (#71): "both clips still playing" is a thing
  // a visitor watches rather than reads, and what they watch is a second cursor
  // moving down a second band. So the panel is asked for one cursor per band
  // the instance is sampling, and the library is what answers.
  it('draws one cursor for an instance that is not transitioning', () => {
    expect(cursorsAt(play(idle!, 0, 1), 1.2)).toHaveLength(1)
    expect(cursorsAt(play(idle!, 0, 1), 1.2)[0]!.weight).toBe(1)
  })

  it('draws a second cursor, in the outgoing clip’s band, while an instance crossfades', () => {
    const transitioning = { ...play(walking!, 4, 1), fadeDuration: 0.5, from: play(idle!, 0, 1) }

    const cursors = cursorsAt(transitioning, 4.2)
    expect(cursors).toHaveLength(2)
    const [live, outgoing] = cursors
    expect(live!.row).toBeGreaterThanOrEqual(walking!.startFrame)
    expect(outgoing!.row).toBeGreaterThanOrEqual(idle!.startFrame)
    expect(outgoing!.row).toBeLessThan(idle!.startFrame + idle!.frames)
    // Fading, so the cursor fades with it — and it is still a real weight.
    expect(outgoing!.weight).toBeGreaterThan(0)
    expect(outgoing!.weight).toBeLessThan(1)
    // The two are the shares the shader mixes by, so they sum to one: each
    // cursor is drawn at exactly the strength its pose is showing at, and the
    // pair hands over across the blend.
    expect(live!.weight + outgoing!.weight).toBeCloseTo(1)
    expect(live!.weight).toBeCloseTo(1 - outgoing!.weight)
  })

  it('gives the outgoing band the whole pose at the moment of the write', () => {
    // Where the transition begins the instance is still showing the clip it is
    // leaving, entire — so that band's cursor is the bright one and the
    // incoming one has yet to appear at all.
    const transitioning = { ...play(walking!, 4, 1), fadeDuration: 0.5, from: play(idle!, 0, 1) }

    const [live, outgoing] = cursorsAt(transitioning, 4)
    expect(outgoing!.weight).toBeCloseTo(1)
    expect(live!.weight).toBeCloseTo(0)
  })

  it('keeps the outgoing cursor moving, which is what “still playing” means', () => {
    const transitioning = { ...play(walking!, 4, 1), fadeDuration: 0.5, from: play(idle!, 0, 1) }

    expect(cursorsAt(transitioning, 4.1)[1]!.row).not.toBeCloseTo(cursorsAt(transitioning, 4.3)[1]!.row)
  })

  it('drops the second cursor once the transition is over', () => {
    // The pack still names the band it left — nothing rewrites a row to say
    // "finished" — so it is the weight that decides, exactly as in the shader.
    const transitioning = { ...play(walking!, 4, 1), fadeDuration: 0.5, from: play(idle!, 0, 1) }

    expect(cursorsAt(transitioning, 4.5)).toHaveLength(1)
    expect(cursorsAt(transitioning, 90)).toHaveLength(1)
  })
})

describe('the cursors a crowd produces', () => {
  const bandOf = (row: number) => CLIPS.find((c) => row >= c.startFrame && row < c.startFrame + c.frames)!.name
  const bandsAt = (count: number) =>
    new Set(layoutCrowd(CLIPS, count, 1.42).map((r) => bandOf(cursorsAt(r, 2.5)[0]!.row)))

  it('sits in one band at count 1 and spreads across every band at the top', () => {
    expect(bandsAt(1)).toEqual(new Set(['Idle']))
    expect(bandsAt(MAX_COUNT)).toEqual(new Set(CLIPS.map((c) => c.name)))
  })
})
