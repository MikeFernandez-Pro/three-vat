import { describe, expect, it } from 'vitest'
import { BoxGeometry, Mesh, MeshBasicNodeMaterial } from 'three/webgpu'
import { positionLocal, uniform } from 'three/tsl'
import { vatNodes } from 'three-vat/tsl'
import { createVATPlaybackTexture } from 'three-vat'
// three-vat's own WGSL helpers: they build a shader against a stand-in renderer, no GPU.
import { computeWGSL, makeVATFixture, unassignedReads, vertexWGSL } from '../../../src/test-utils'
import { GpuCull, type Pair } from './gpucull'
import type { State } from './swarm-remote'

const CAPACITY = 8

/** A state of `count` rats a step at `time`: every number it holds tells which state and which rat it came from. */
function state(time: number, count = 3): State {
  const of = (k: number) => Float32Array.from({ length: CAPACITY }, (_, i) => time * 100 + i * 10 + k)
  return {
    type: 'state',
    time,
    count,
    arena: 10,
    x: of(1),
    y: of(2),
    z: of(3),
    heading: of(4),
    pitch: of(5),
    place: of(6),
    gait: new Uint8Array(CAPACITY),
    ms: 0,
    inside: 0,
  }
}

/** The pair the page samples between `prev` and `cur`, as RemoteSwarm hands it. */
const pair = (prev: State | undefined, cur: State, alpha = 0.5): Pair => ({
  prev,
  cur,
  alpha: prev === undefined ? 1 : alpha,
  jump: 0.11,
  both: prev === undefined ? 0 : Math.min(prev.count, cur.count),
})

/** What buffer `k` holds for rat `i`: (x, y, z, heading, pitch, place). */
function rat(cull: GpuCull, k: number, i: number): number[] {
  const a = cull.states[k].array as Float32Array
  return [0, 1, 2, 3, 4, 5].map((c) => a[i * 8 + c])
}

/** Rat `i` as `s` has it, in the same order. */
const from = (s: { x: Float32Array; y: Float32Array; z: Float32Array; heading: Float32Array; pitch: Float32Array; place: Float32Array }, i: number) => [
  s.x[i],
  s.y[i],
  s.z[i],
  s.heading[i],
  s.pitch[i],
  s.place[i],
]

/** Which buffer holds `s`'s rats, judged by the first rat. */
const holding = (cull: GpuCull, s: State) => [0, 1].filter((k) => rat(cull, k, 0).join() === from(s, 0).join())

/** How many times each buffer has been uploaded. */
const uploads = (cull: GpuCull) => cull.states.map((b) => b.version)

/** Detach `s`'s arrays, as the page does when it sends a state back to the worker. */
function recycle(s: State): void {
  for (const a of [s.x, s.y, s.z, s.heading, s.pitch, s.place]) structuredClone(a.buffer, { transfer: [a.buffer] })
}

describe('GpuCull.stand', () => {
  it('puts a first state alone in one buffer, the pair reading it as both, every rat as the latest has it', () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    const s1 = state(1)
    cull.stand(pair(undefined, s1), 3)
    const [k] = holding(cull, s1)
    expect(k).toBeDefined()
    for (let i = 0; i < 3; i++) expect(rat(cull, k!, i)).toEqual(from(s1, i))
    expect(uploads(cull).reduce((a, b) => a + b)).toBe(1)
    expect(cull.states[k!].updateRanges).toEqual([{ start: 0, count: 3 * 8 }])
    expect(cull.blend.prev.value).toBe(k)
    expect(cull.blend.cur.value).toBe(k)
    expect(cull.blend.alpha.value).toBe(1)
    expect(cull.blend.both.value).toBe(0)
    expect(cull.blend.count.value).toBe(3)
  })

  it('uploads each new state once, into the buffer the pair no longer reads', () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    const [s1, s2, s3, s4] = [state(1), state(2), state(3), state(4)]
    cull.stand(pair(undefined, s1), 3)
    cull.stand(pair(s1, s2, 0.25), 3)
    const [a] = holding(cull, s1)
    const [b] = holding(cull, s2)
    expect(a).not.toBe(b)
    expect(cull.blend.prev.value).toBe(a)
    expect(cull.blend.cur.value).toBe(b)
    expect(cull.blend.alpha.value).toBe(0.25)
    expect(cull.blend.jump.value).toBeCloseTo(0.11)
    expect(cull.blend.both.value).toBe(3)
    expect(uploads(cull).reduce((x, y) => x + y)).toBe(2)
    recycle(s1)
    cull.stand(pair(s2, s3), 3)
    expect(holding(cull, s3)).toEqual([a])
    expect(holding(cull, s2)).toEqual([b])
    expect(cull.blend.prev.value).toBe(b)
    expect(cull.blend.cur.value).toBe(a)
    recycle(s2)
    cull.stand(pair(s3, s4), 3)
    expect(holding(cull, s4)).toEqual([b])
    expect(uploads(cull).reduce((x, y) => x + y)).toBe(4)
  })

  it('uploads both of a pair that skipped past the states on the GPU, each once', () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    const [s1, s2, s3, s4, s6] = [state(1), state(2), state(3), state(4), state(6)]
    cull.stand(pair(s1, s2), 3)
    const before = uploads(cull).reduce((x, y) => x + y)
    cull.stand(pair(s3, s4), 3)
    expect(uploads(cull).reduce((x, y) => x + y)).toBe(before + 2)
    expect(holding(cull, s3)).toHaveLength(1)
    expect(holding(cull, s4)).toHaveLength(1)
    expect(cull.blend.prev.value).toBe(holding(cull, s3)[0])
    expect(cull.blend.cur.value).toBe(holding(cull, s4)[0])
    // One of the pair kept, the state between skipped: only the new one goes up.
    cull.stand(pair(s4, s6), 3)
    expect(uploads(cull).reduce((x, y) => x + y)).toBe(before + 3)
    expect(cull.blend.prev.value).toBe(holding(cull, s4)[0])
    expect(cull.blend.cur.value).toBe(holding(cull, s6)[0])
  })

  it('uploads nothing for a pair held across beats, its blend held with it, though its states went back to the worker', () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    const [s1, s2] = [state(1), state(2)]
    const held = pair(s1, s2, 0.4)
    cull.stand(held, 3)
    const before = uploads(cull)
    recycle(s1)
    recycle(s2)
    for (let beat = 0; beat < 5; beat++) cull.stand(held, 3)
    expect(uploads(cull)).toEqual(before)
    expect(cull.blend.alpha.value).toBeCloseTo(0.4)
    expect(cull.blend.both.value).toBe(3)
  })

  it('stands no more rats than the latest state holds, and lets the newcomers stand where it has them', () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    cull.stand(pair(state(1, 2), state(2, 5)), 7)
    expect(cull.blend.count.value).toBe(5)
    expect(cull.blend.both.value).toBe(2)
  })
})

describe('GpuCull.hold', () => {
  it("writes each rat's held place into the current buffer, the blend at one", () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    const [s1, s2] = [state(1), state(2)]
    cull.stand(pair(s1, s2), 3)
    const [k] = holding(cull, s2)
    const placed = { ...state(9, 4) }
    const before = uploads(cull)
    cull.hold(placed)
    for (let i = 0; i < 4; i++) expect(rat(cull, k!, i)).toEqual(from(placed, i))
    expect(cull.states[k!].version).toBe(before[k!]! + 1)
    expect(cull.states[k!].updateRanges).toEqual([{ start: 0, count: 4 * 8 }])
    expect(cull.blend.prev.value).toBe(k)
    expect(cull.blend.cur.value).toBe(k)
    expect(cull.blend.alpha.value).toBe(1)
    expect(cull.blend.both.value).toBe(0)
    expect(cull.blend.count.value).toBe(4)
    // Every frame it holds, each rat's place goes up again: the staggered beats move some every frame.
    cull.hold(placed)
    expect(cull.states[k!].version).toBe(before[k!]! + 2)
    // Back to the pair: the state the held places overwrote goes up again, the other stays.
    cull.stand(pair(s1, s2), 3)
    expect(holding(cull, s2)).toEqual([k])
    expect(holding(cull, s1)).toEqual([1 - k!])
    expect(cull.states[1 - k!].version).toBe(before[1 - k!])
  })
})

describe('GpuCull on the GPU', () => {
  it('culls in a pass whose WGSL reads nothing it has not assigned', () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    const [reset, pass] = cull.passes.map(computeWGSL)
    expect(reset).toContain('atomicStore')
    expect(pass).toContain('atomicAdd')
    for (const wgsl of [reset, pass]) expect(unassignedReads(wgsl!)).toEqual([])
  })

  it('turns and places the decoded rat in a vertex stage that reads nothing it has not assigned', () => {
    const cull = new GpuCull(CAPACITY, 36, 1)
    const vat = makeVATFixture()
    vat.geometry.computeVertexNormals()
    const playback = createVATPlaybackTexture([], { capacity: CAPACITY })
    const decode = vatNodes(vat as never, { time: uniform(0), playback, logicalIndex: cull.logicalIndex }).positionNode
    const material = new MeshBasicNodeMaterial()
    material.positionNode = cull.transform(decode)
    const wgsl = vertexWGSL(new Mesh(vat.geometry, material), material)
    expect(unassignedReads(wgsl)).toEqual([])
    // The plain position too: the transform alone.
    const plain = new MeshBasicNodeMaterial()
    plain.positionNode = cull.transform(positionLocal)
    expect(unassignedReads(vertexWGSL(new Mesh(new BoxGeometry(), plain), plain))).toEqual([])
  })
})
