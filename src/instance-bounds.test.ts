// An instance's bounds at a moment (#152): the union of the frame bounds of
// the rows `resolveVATFrame` reports it showing, never an interpolation
// between boxes. Held to that definition through the public resolver, on the
// fixture whose every frame has a box of its own.
import { Box3, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { resolveVATBounds } from './instance-bounds.js'
import {
  createVATPlaybackTexture,
  LoopMode,
  pauseVATInstance,
  resolveVATFrame,
  setVATInstance,
} from './instance-playback.js'
import type { VATInstance } from './instance-playback.js'
import { makeRigVATFixture, makeVATFixture } from './test-utils.js'
import type { VAT } from './types.js'

const vat = makeVATFixture()
const [walk, run] = vat.clips as [VAT['clips'][number], VAT['clips'][number]]

/** Frame `row`'s box, read off the VAT as a caller would. */
const frameBox = (row: number) =>
  new Box3(new Vector3().fromArray(vat.frameBounds, row * 6), new Vector3().fromArray(vat.frameBounds, row * 6 + 3))

/** The union of the boxes of `rows`. */
const unionOf = (rows: number[]) => rows.reduce((box, row) => box.union(frameBox(row)), new Box3())

describe('resolveVATBounds', () => {
  it('is the union of both rows a playing instance interpolates', () => {
    const instance: VATInstance = { clip: walk, startTime: 0 }
    const time = 4.5 / 30 // halfway between rows 4 and 5
    const frame = resolveVATFrame(instance, time)
    expect([frame.row, frame.rowNext]).toEqual([4, 5])

    const box = resolveVATBounds(vat, instance, time, new Box3())
    expect(box).toEqual(unionOf([4, 5]))
    // Never an interpolation between the two: it holds both whole.
    expect(box.containsBox(frameBox(4)) && box.containsBox(frameBox(5))).toBe(true)
  })

  it('is the last row alone for a one-shot that has finished on it', () => {
    const instance: VATInstance = { clip: run, startTime: 0, loopMode: LoopMode.Once }
    const frame = resolveVATFrame(instance, 10)
    expect(frame.finished).toBe(true)
    expect(resolveVATBounds(vat, instance, 10, new Box3())).toEqual(unionOf([17]))
  })

  it('takes the rows across the seam where a loop wraps', () => {
    const instance: VATInstance = { clip: walk, startTime: 0 }
    const time = 9.5 / 30
    const frame = resolveVATFrame(instance, time)
    expect(frame.wraps).toBe(true)
    expect(resolveVATBounds(vat, instance, time, new Box3())).toEqual(unionOf([9, 0]))
  })

  it('covers both bands mid-crossfade, and drops the outgoing one once the blend is over', () => {
    const instance: VATInstance = {
      clip: run,
      startTime: 1,
      from: { clip: walk, startTime: 0 },
      fadeDuration: 0.5,
    }
    const during = 1 + 2.5 / 24
    const frame = resolveVATFrame(instance, during)
    const outgoing = frame.outgoing!
    expect(outgoing.weight).toBeGreaterThan(0)
    expect(resolveVATBounds(vat, instance, during, new Box3())).toEqual(
      unionOf([frame.row, frame.rowNext, outgoing.row, outgoing.rowNext]),
    )

    // Over, the outgoing band is still resolved, at weight zero, and draws
    // nothing: a robot that blended into its death is not hit where it walked.
    const after = 3
    const done = resolveVATFrame(instance, after)
    expect(done.outgoing!.weight).toBe(0)
    expect(resolveVATBounds(vat, instance, after, new Box3())).toEqual(unionOf([done.row, done.rowNext]))
  })

  it('holds still on a paused instance, at the rows the pause stopped on', () => {
    const playing: VATInstance = { clip: walk, startTime: 0 }
    const paused = pauseVATInstance(createVATPlaybackTexture([playing]), 0, 4.5 / 30)
    const held = resolveVATBounds(vat, paused, 4.5 / 30, new Box3())
    expect(held).toEqual(unionOf([4, 5]))
    // Later, the walk would be elsewhere; the paused robot is not.
    expect(resolveVATBounds(vat, playing, 7.5 / 30, new Box3())).toEqual(unionOf([7, 8]))
    expect(resolveVATBounds(vat, paused, 7.5 / 30, new Box3())).toEqual(held)
  })

  it('reads the band a crossfade leaves from what setVATInstance returns', () => {
    const playback = createVATPlaybackTexture([{ clip: walk, startTime: 0 }])
    const written = setVATInstance(playback, 0, { clip: run, startTime: 1, fadeDuration: 0.5 })
    expect(written.from?.clip.startFrame).toBe(walk.startFrame)
    const during = 1 + 2.5 / 24
    const frame = resolveVATFrame(written, during)
    expect(resolveVATBounds(vat, written, during, new Box3())).toEqual(
      unionOf([frame.row, frame.rowNext, frame.outgoing!.row, frame.outgoing!.rowNext]),
    )
  })

  it('writes into the target it is handed, and returns it', () => {
    const target = new Box3(new Vector3(-9, -9, -9), new Vector3(9, 9, 9))
    expect(resolveVATBounds(vat, { clip: walk, startTime: 0 }, 0, target)).toBe(target)
    expect(target).toEqual(unionOf([0, 1]))
  })

  it('reads a rig-encoded VAT the same way', () => {
    const rig = makeRigVATFixture()
    const instance: VATInstance = { clip: rig.clips[0]!, startTime: 0 }
    expect(resolveVATBounds(rig, instance, 4.5 / 30, new Box3())).toEqual(unionOf([4, 5]))
  })
})
