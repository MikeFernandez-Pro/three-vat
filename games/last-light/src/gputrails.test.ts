import { describe, expect, it } from 'vitest'
import { Color, type BufferAttribute, type WebGPURenderer } from 'three/webgpu'
import { uniform } from 'three/tsl'
// three-vat's own WGSL helpers: they build a shader against a stand-in renderer, no GPU.
import { computeWGSL, unassignedReads, vertexWGSL } from '../../../src/test-utils'
import { GpuCull } from './gpucull'
import { GpuTrails } from './gputrails'
import { Trails } from './trails'

const CAPACITY = 8
const EYES = 2
const FRAMES = 4

/** Trails for CAPACITY rats with two eyes, over a cull of as many, every eye's track at the origin. */
function trails() {
  const cull = new GpuCull(CAPACITY, 36, 1)
  return { cull, trails: new GpuTrails(cull, CAPACITY, EYES, new Float32Array(FRAMES * EYES * 3), uniform(0)) }
}

/** A renderer that only counts what it is asked to run and forget. */
function renderer() {
  const ran: unknown[] = []
  const deleted: BufferAttribute[] = []
  const stub = { compute: (pass: unknown) => ran.push(pass), _attributes: { delete: (b: BufferAttribute) => deleted.push(b) } }
  return { ran, deleted, renderer: stub as unknown as WebGPURenderer }
}

/** Rat `i`'s clip as the GPU has it: (first frame, frames, frames a second, start time). */
const clipOf = (t: GpuTrails, i: number) => Array.from((t.clips.array as Float32Array).subarray(i * 4, i * 4 + 4))

describe('GpuTrails.setRow', () => {
  it("keeps each rat's clip and start time, and sends up only the rats written since the last lay, once", () => {
    const { trails: t } = trails()
    const { renderer: r } = renderer()
    t.setRow(5, { startFrame: 16, frames: 16 }, 2.5, 50)
    t.setRow(2, { startFrame: 0, frames: 15 }, 1.25, 30)
    expect(clipOf(t, 5)).toEqual([16, 16, 50, 2.5])
    expect(clipOf(t, 2)).toEqual([0, 15, 30, 1.25])
    const version = t.clips.version
    t.lay(r, 1, 0.3)
    expect(t.clips.version).toBe(version + 1)
    expect(t.clips.updateRanges).toEqual([{ start: 2 * 4, count: 4 * 4 }])
    // Nothing written since: nothing goes up.
    t.lay(r, 2, 0.3)
    expect(t.clips.version).toBe(version + 1)
  })
})

describe('GpuTrails.lay', () => {
  it('runs its pass once a lay, and only when asked', () => {
    const { trails: t } = trails()
    const { renderer: r, ran } = renderer()
    t.lay(r, 1, 0.3)
    t.lay(r, 2, 0.3)
    expect(ran).toEqual([t.pass, t.pass])
  })
})

describe('GpuTrails.dispose', () => {
  it('frees every buffer it holds and its pass', () => {
    const { trails: t } = trails()
    const { renderer: r, deleted } = renderer()
    t.dispose(r)
    expect(deleted).toEqual(expect.arrayContaining([t.ribbons, t.clips, t.args]))
    expect(deleted).toHaveLength(5)
  })
})

describe('GpuTrails on the GPU', () => {
  it("lays every survivor's eyes in a pass whose WGSL reads nothing it has not assigned", () => {
    const { trails: t } = trails()
    const wgsl = computeWGSL(t.pass)
    expect(wgsl).toContain('atomicLoad')
    expect(unassignedReads(wgsl)).toEqual([])
  })

  it('stores only into buffers its pass declares writable, though the vertex stage reads them too', () => {
    const { trails: t } = trails()
    // The vertex stage's read-only view built first, as the ribbons' material does.
    t.ribbon()
    const wgsl = computeWGSL(t.pass)
    const readOnly = [...wgsl.matchAll(/var<storage,\s*read>\s+(\w+)/g)].map((m) => m[1])
    const stored = [...wgsl.matchAll(/(\w+)\.value\[[^\]]*\]\s*=(?!=)/g)].map((m) => m[1])
    expect(stored.length).toBeGreaterThan(0)
    expect(stored.filter((name) => readOnly.includes(name))).toEqual([])
  })

  it('draws the ribbons from the history in a vertex stage that reads nothing it has not assigned', () => {
    const { trails: t } = trails()
    const ribbons = new Trails(uniform(new Color()), t.ribbon)
    ribbons.indirect(t.args)
    expect(unassignedReads(vertexWGSL(ribbons.mesh, ribbons.material))).toEqual([])
  })
})
