// Every way the capture can fail to carry the demo's argument, one per test.
// The recording needs a browser; deciding what it means does not — so this is
// where the hero's checks are proven to still have teeth, the same way
// `release/parity/verdict.test.ts` does it for the gate.
import { describe, expect, it } from 'vitest'
import { HERO_BUDGET_BYTES } from './gif.mjs'
import { heroVerdict } from './verdict.mjs'

/** A recording that carries the argument: 1 → 340 robots, 7 draw calls throughout. */
function goodRecording(overrides = {}) {
  return {
    counts: [1, 1, 60, 150, 260, 340, 340],
    maxCount: 340,
    drawCalls: [7],
    pageErrors: [],
    panel: { canvases: 4, cursorLayers: 2, left: 628, right: 790, top: 38, bottom: 402 },
    readout: { left: 14, right: 120, top: 52, bottom: 78 },
    frame: { width: 800, height: 450 },
    bytes: 1_050_000,
    ...overrides,
  }
}

/** The named check, or a failure loud enough to read when the name has moved. */
function check(recording: ReturnType<typeof goodRecording>, name: string) {
  const found = heroVerdict(recording).checks.find((c) => c.name.includes(name))
  if (!found) throw new Error(`no check matching "${name}" in: ${heroVerdict(recording).checks.map((c) => c.name).join(', ')}`)
  return found
}

describe('a capture that carries the argument', () => {
  it('passes, as a whole and check by check', () => {
    const verdict = heroVerdict(goodRecording())
    expect(verdict.checks.every((c) => c.pass)).toBe(true)
    expect(verdict.pass).toBe(true)
  })

  it('says what it saw, not just that it was happy', () => {
    // A detail line is what a developer reads when they are deciding whether to
    // trust the image, so every check owes one whether it passed or failed.
    for (const { detail } of heroVerdict(goodRecording()).checks) {
      expect(detail.length).toBeGreaterThan(0)
    }
  })
})

describe('a capture that does not', () => {
  it('fails when the page threw', () => {
    const recording = goodRecording({ pageErrors: ['bakeVAT is not a function'] })
    expect(check(recording, 'ran clean').pass).toBe(false)
    expect(check(recording, 'ran clean').detail).toContain('bakeVAT')
    expect(heroVerdict(recording).pass).toBe(false)
  })

  it('fails when the recording did not open on a single robot', () => {
    expect(check(goodRecording({ counts: [40, 120, 340] }), 'starts on one robot').pass).toBe(false)
  })

  it('fails when the drag stopped short of the full crowd', () => {
    // The slider is dragged with a real mouse, so landing at 336 of 340 is a
    // drag that did not cross the range — and an image that undersells the claim.
    const recording = goodRecording({ counts: [1, 100, 336] })
    expect(check(recording, 'reaches the full crowd').pass).toBe(false)
    expect(check(recording, 'reaches the full crowd').detail).toContain('336')
  })

  it('fails when the count ever goes backwards', () => {
    expect(check(goodRecording({ counts: [1, 200, 150, 340] }), 'only ever climbs').pass).toBe(false)
  })

  it('fails when the draw calls moved', () => {
    // The claim itself. If this ever goes red the image is the least of it.
    const recording = goodRecording({ drawCalls: [7, 9] })
    expect(check(recording, 'draw calls never move').pass).toBe(false)
    expect(check(recording, 'draw calls never move').detail).toContain('9')
  })

  it('fails when there is no texture panel on the page', () => {
    const recording = goodRecording({ panel: null })
    expect(check(recording, 'texture panel is in frame').pass).toBe(false)
    expect(check(recording, 'cursors are drawn').pass).toBe(false)
  })

  it('fails when the panel is cropped out of the frame', () => {
    // The composition is the whole reason the panel is visible by default: the
    // mechanism and the result in one image (ADR-0012). Half a panel is neither.
    const cropped = { canvases: 4, cursorLayers: 2, left: 628, right: 812, top: 38, bottom: 402 }
    expect(check(goodRecording({ panel: cropped }), 'texture panel is in frame').pass).toBe(false)
  })

  it('fails when the panel is there but nothing is drawn on it', () => {
    const empty = { canvases: 4, cursorLayers: 0, left: 628, right: 790, top: 38, bottom: 402 }
    expect(check(goodRecording({ panel: empty }), 'cursors are drawn').pass).toBe(false)
  })

  it('fails when the draw-call readout is not in frame', () => {
    // The count and the draw calls are read off the DOM, which says nothing
    // about whether a reader can see them. The readout is the one number given
    // visual emphasis (ADR-0012); a HUD that reflowed it off the edge would
    // otherwise pass every other check in this file.
    const offscreen = { left: 14, right: 120, top: 470, bottom: 496 }
    expect(check(goodRecording({ readout: offscreen }), 'draw-call readout is in frame').pass).toBe(
      false,
    )
  })

  it('fails when the image is too heavy to be a first impression', () => {
    const recording = goodRecording({ bytes: HERO_BUDGET_BYTES + 1 })
    expect(check(recording, 'small enough').pass).toBe(false)
    expect(heroVerdict(recording).pass).toBe(false)
  })
})
