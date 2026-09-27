// The scene the gate renders is spelled once as data, and imports nothing — not
// three.js, not three-vat. That is the property that makes it safe to share
// between the two frame modules: a difference in camera, light or clock between
// the two renders would be indistinguishable from a decode divergence, and a
// scene file that reached into either library would be a place for one to
// creep in. That first claim is read as text rather than imported, because it is
// about the file's imports and not its values.
//
// The rest of this file is about one value in it: the gate compares a frame
// mid-transition, and where in a transition `TIME` falls decides whether the
// crossfade is in the comparison at all. That is arithmetic — `resolveVATFrame`
// is the one definition both decode paths transcribe — so it is asserted here
// rather than eyeballed on a release machine.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Box3, BufferGeometry } from 'three'
import { resolveVATFrame, type VAT } from 'three-vat'
import { here } from '../paths.js'
import { instancesOf } from './stage.js'
import { CROSSFADE, INSTANCES, RIG_CASE, TIME, TURN } from './scene.js'

const source = readFileSync(here('parity/scene.ts'), 'utf8')

describe('the gate’s scene data', () => {
  it('imports nothing at all, three.js and three-vat included', () => {
    expect(source).not.toMatch(/^\s*import\b/m)
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  it('names the rig case’s clips once each, so the three instances play three clips', () => {
    expect(new Set(RIG_CASE.clips).size).toBe(RIG_CASE.clips.length)
    expect(RIG_CASE.clips.length).toBeGreaterThanOrEqual(3)
  })
})

/**
 * A clip table shaped like a bake's, and nothing else of a VAT — `instancesOf`
 * reads `vat.clips` and no other field.
 *
 * Three bands of arithmetic rather than a real bake, because the question below
 * is about the *table*, not about the robot: the crossfade weight is wall clock
 * over `fadeDuration`, so it is the same number whatever the bands are, and a
 * test that needed a GPU to ask it could not run in CI.
 */
const clipsOnly = {
  clips: [0, 1, 2].map((i) => ({ name: `Clip${i}`, startFrame: i * 40, frames: 40, fps: 30 })),
  geometry: new BufferGeometry(),
  materials: [],
  bounds: new Box3(),
} as unknown as VAT

/** The gate's crowd, resolved against that table. */
const crowd = () => instancesOf(clipsOnly)

describe('the gate’s crossfade', () => {
  // The frame the gate compares has to be caught *mid*-transition, or the
  // crossfade is not in the comparison at all: at a weight of 1 the live band is
  // all there is, at 0 the outgoing band is gone, and a path that dropped the
  // blend entirely renders both of those correctly. Asserted through the
  // resolver rather than by reading the two numbers off the table, because the
  // resolver is what the two decode paths transcribe.
  it('holds the gate’s time well inside one instance’s transition', () => {
    const transitioning = crowd().filter((instance) => instance.from)
    expect(transitioning).toHaveLength(1)

    const { outgoing } = resolveVATFrame(transitioning[0]!, TIME)

    expect(outgoing).not.toBeNull()
    expect(outgoing!.weight).toBeGreaterThan(0)
    expect(outgoing!.weight).toBeLessThan(1)
    // And not merely inside it: near enough a half that no plausible mistake in
    // the weight lands back on the right answer.
    expect(outgoing!.weight).toBeGreaterThan(0.25)
    expect(outgoing!.weight).toBeLessThan(0.75)
  })

  it('places the blend’s start by hand, far from the live start time', () => {
    // A blend start the pack carries apart from `startTime` (ADR-0036), so a
    // path that measured the weight from the live start time instead would
    // draw a different mix, not the same one by coincidence.
    const [transitioning] = crowd().filter((instance) => instance.from)

    expect(transitioning!.fadeStart).toBe(CROSSFADE.fadeStart)
    const placed = resolveVATFrame(transitioning!, TIME).outgoing!.weight
    const { fadeStart: _fadeStart, ...unplaced } = transitioning!
    const misread = resolveVATFrame(unplaced, TIME).outgoing!.weight

    expect(Math.abs(placed - misread)).toBeGreaterThan(0.25)
  })

  it('blends between two genuinely different clips, not a clip and itself', () => {
    // A transition whose outgoing band is the live band is a frame the live
    // band alone renders correctly, whatever the weight — so the mix would have
    // nothing to get wrong and the fault below nothing to move.
    const [transitioning] = INSTANCES.filter((instance) => instance.from)

    expect(transitioning!.from!.clipIndex).not.toBe(transitioning!.clipIndex)
    expect(transitioning!.from).toBe(CROSSFADE.from)
  })
})

describe('the gate’s reversed instance', () => {
  // Reverse playback is a flip each decode path transcribes (ADR-0033), so the
  // gate's crowd has to carry one, caught where the flip changes the pose: not
  // on the phase's midpoint, where a band and its mirror sit on the same row.
  it('plays one instance backwards, mid-clip, on a pose forward playback would not show', () => {
    const reversed = crowd().filter((instance, i) => (instance.speed ?? 1) < 0 && INSTANCES[i]!.turnAt === undefined)
    expect(reversed).toHaveLength(1)

    const backwards = resolveVATFrame(reversed[0]!, TIME)
    const forwards = resolveVATFrame({ ...reversed[0]!, speed: -reversed[0]!.speed! }, TIME)

    expect(backwards.finished).toBe(false)
    expect(backwards.row).not.toBe(forwards.row)
  })
})

describe('the gate’s turned instance', () => {
  // A turn is a write (ADR-0036): what it leaves in the pack is a playback state
  // both paths decode like any other. The gate has to catch it retracing, on a
  // pose the unturned instance would not show, or it proves nothing the rest
  // of the crowd does not.
  it('turns one instance before the gate’s time, and catches it retracing', () => {
    const turned = INSTANCES.flatMap((instance, i) => (instance.turnAt === undefined ? [] : [i]))
    expect(turned).toHaveLength(1)
    expect(INSTANCES[turned[0]!]!.turnAt).toBe(TURN.turnAt)
    expect(TURN.turnAt).toBeLessThan(TIME)

    const i = turned[0]!
    const back = crowd()[i]!
    const { turnAt: _turnAt, ...table } = INSTANCES[i]!
    const original = { clip: clipsOnly.clips[table.clipIndex]!, startTime: table.startTime, speed: table.speed }
    const shown = resolveVATFrame(back, TIME)
    const retraced = resolveVATFrame(original, 2 * TURN.turnAt - TIME)

    expect({ row: shown.row, rowNext: shown.rowNext }).toEqual({ row: retraced.row, rowNext: retraced.rowNext })
    expect(shown.mix).toBeCloseTo(retraced.mix, 5)
    expect(shown.row).not.toBe(resolveVATFrame(original, TIME).row)
  })
})
