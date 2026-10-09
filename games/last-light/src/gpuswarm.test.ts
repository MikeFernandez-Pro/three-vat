// The GPU step's page side, through its own calls only, over a stand-in for
// the renderer that records what is computed and holds each read back until
// the test answers it; and its kernels, by the WGSL they compile to.
import { describe, expect, it } from 'vitest'
import type { ComputeNode, StorageBufferAttribute } from 'three/webgpu'
import { computeWGSL, unassignedReads } from '../../../src/test-utils'
import { GpuCull, HELD } from './gpucull'
import { GpuSwarm, MOST_STEPS, StepClock, type Device } from './gpuswarm'
import { FLICKER, IDLE, MAX_LIGHTS, RUN, Swarm, WALK, arenaRadiusFor, defaultTuning, type FixedLight, type Light } from './swarm'
import { STEP } from './swarm-remote'
import { MAX_WALLS } from './walls'

const CAPACITY = 8
const SEED = 7

/** A renderer that runs nothing: it records each compute, and each read back waits for `answer`. */
class FakeDevice implements Device {
  readonly computed: ComputeNode[][] = []
  readonly reads: { attribute: StorageBufferAttribute; offset: number; count: number; answer(words: number[]): Promise<void> }[] = []
  compute(passes: ComputeNode | ComputeNode[]): void {
    this.computed.push(Array.isArray(passes) ? passes : [passes])
  }
  getArrayBufferAsync(attribute: StorageBufferAttribute, _target: null, offset: number, count: number): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      this.reads.push({
        attribute,
        offset,
        count,
        answer: async (words) => {
          const buffer = new Uint32Array(count / 4)
          buffer.set(words)
          resolve(buffer.buffer)
          // Let the page's handlers run.
          await new Promise((settle) => setTimeout(settle))
        },
      })
    })
  }
  /** The steps computed: every call of more than one pass is a step. */
  get steps(): number {
    return this.computed.filter((passes) => passes.length > 1).length
  }
}

/** A GPU swarm of `count` rats on a stand-in, its clock the test's own, in ms. */
function swarmOf(count: number) {
  const cull = new GpuCull(CAPACITY, 36, 1)
  const device = new FakeDevice()
  const clock = { ms: 1000 }
  const swarm = new GpuSwarm(cull, device, CAPACITY, SEED, count, 1, () => clock.ms)
  const light: Light = { x: 0, z: 0, strength: 1, on: true }
  const tuning = defaultTuning()
  const lights: FixedLight[] = []
  /** A frame `ms` after the last, sending `n` rats. */
  const frame = (ms: number, n = swarm.count, paused = false) => {
    clock.ms += ms
    swarm.send(n, light, tuning, paused, undefined, lights)
  }
  return { cull, device, swarm, frame, lights, tuning }
}

/** The reads back of the gait lists, a whole list each; and of the rats at the holder and at each lit light, a word each. */
const listReads = (device: FakeDevice) => device.reads.filter((read) => read.count === (CAPACITY + 1) * 4)
const holderReads = (device: FakeDevice) => device.reads.filter((read) => read.count === (1 + MAX_LIGHTS) * 4)

/** Rat `i` in the cull's buffer `k`: (x, y, z, heading, pitch, place, moved, beat). */
const ratIn = (cull: GpuCull, k: number, i: number) => Array.from((cull.states[k]!.array as Float32Array).subarray(i * 8, i * 8 + 8))

describe('StepClock', () => {
  it('owes a step a sixtieth of a second, and keeps the share of one between frames', () => {
    const clock = new StepClock()
    expect(clock.advance(STEP, false)).toBe(1)
    expect(clock.advance(STEP / 2, false)).toBe(0)
    expect(clock.alpha).toBeCloseTo(0.5)
    expect(clock.advance(STEP / 2, false)).toBe(1)
    expect(clock.advance(2 * STEP, false)).toBe(2)
    expect(clock.alpha).toBeCloseTo(0, 5)
  })

  it(`takes ${MOST_STEPS} steps a frame at most, and skips the rest but the share of a step`, () => {
    const clock = new StepClock()
    expect(clock.advance(0.5 + STEP / 4, false)).toBe(MOST_STEPS)
    expect(clock.alpha).toBeCloseTo(0.25, 3)
    expect(clock.advance(STEP * 0.75, false)).toBe(1)
  })

  it('steps nothing while paused, and owes nothing for the pause', () => {
    const clock = new StepClock()
    clock.advance(STEP * 1.5, false)
    expect(clock.advance(10, true)).toBe(0)
    expect(clock.alpha).toBeCloseTo(0.5)
    expect(clock.advance(STEP / 2, false)).toBe(1)
  })
})

describe('GpuSwarm.send', () => {
  it('steps as the clock owes, a frame at a time, and none while paused', () => {
    const { device, swarm, frame } = swarmOf(4)
    frame(1000 / 60)
    expect(device.steps).toBe(1)
    frame(1000 / 30)
    expect(device.steps).toBe(3)
    frame(1000)
    expect(device.steps).toBe(3 + MOST_STEPS)
    frame(1000, swarm.count, true)
    expect(device.steps).toBe(3 + MOST_STEPS)
    expect(swarm.steps).toBe(3 + MOST_STEPS)
  })

  it('stands the rats between the last two steps, as far as the clock has got past the latest but one', () => {
    const { cull, swarm, frame } = swarmOf(4)
    swarm.sample(0)
    swarm.stand()
    // Before any step, the one state there is.
    expect(cull.blend.prev.value).toBe(cull.blend.cur.value)
    expect(cull.blend.both.value).toBe(0)
    frame((1000 / 60) * 1.25)
    swarm.stand()
    expect(cull.blend.cur.value).toBe(1)
    expect(cull.blend.prev.value).toBe(0)
    expect(cull.blend.alpha.value).toBeCloseTo(0.25, 3)
    expect(cull.blend.both.value).toBe(4)
    expect(cull.blend.count.value).toBe(4)
    // A count shrunk between beats draws fewer at once.
    frame(1, 3)
    swarm.stand()
    expect(cull.blend.count.value).toBe(3)
  })

  it("uploads the rats it starts with into the latest state, spawned by the swarm's own rule, each idle", () => {
    const { cull, swarm } = swarmOf(3)
    const reference = new Swarm(CAPACITY, SEED)
    reference.reset(3)
    for (let i = 0; i < 3; i++) {
      expect(ratIn(cull, 0, i)).toEqual([reference.x[i], 0, reference.z[i], reference.heading[i], 0, reference.places[i], 0, 0].map(Math.fround))
      expect(swarm.gait[i]).toBe(IDLE)
    }
    expect(cull.states[0]!.updateRanges).toEqual([{ start: 0, count: 3 * 8 }])
    // Held from nowhere yet: the first hold takes them.
    expect(ratIn(cull, HELD, 0)[7]).toBe(-1)
  })

  it('uploads only the newcomers as the count grows, into the state the next step reads, and stands fewer as it shrinks', () => {
    const { cull, swarm, frame } = swarmOf(3)
    frame(1000 / 60)
    // The step wrote buffer 1; it holds the latest state now.
    cull.states[1]!.clearUpdateRanges()
    const before = cull.states[1]!.version
    frame(1, 5)
    const reference = new Swarm(CAPACITY, SEED)
    reference.reset(3)
    reference.setCount(5)
    expect(cull.states[1]!.updateRanges).toEqual([{ start: 3 * 8, count: 2 * 8 }])
    expect(cull.states[1]!.version).toBe(before + 1)
    for (const i of [3, 4]) expect(ratIn(cull, 1, i).slice(0, 6)).toEqual([reference.x[i], 0, reference.z[i], reference.heading[i], 0, reference.places[i]].map(Math.fround))
    swarm.sample(0)
    swarm.stand()
    // The newcomers are not in the state before: they stand where the latest has them.
    expect(cull.blend.both.value).toBe(3)
    expect(cull.blend.count.value).toBe(5)
    frame(1, 2)
    swarm.stand()
    expect(cull.blend.count.value).toBe(2)
    expect(swarm.arena).toBe(arenaRadiusFor(2))
  })
})

describe('GpuSwarm gaits', () => {
  it('reads back the list the steps wrote, one read at a time, and each rat listed takes its gait', async () => {
    const { device, swarm, frame } = swarmOf(6)
    frame(1000 / 60)
    expect(listReads(device)).toHaveLength(1)
    const [read] = listReads(device)
    // The steps of round one wrote list one; the next round's list was emptied first.
    expect(read!.offset).toBe((CAPACITY + 1) * 4)
    expect(read!.count).toBe((CAPACITY + 1) * 4)
    expect(device.computed.some((passes) => passes[0] === swarm.clearList)).toBe(true)
    frame(1000 / 60)
    expect(listReads(device)).toHaveLength(1)
    await read!.answer([2, 5 * 4 + WALK, 1 * 4 + RUN])
    expect(swarm.gait[5]).toBe(WALK)
    expect(swarm.gait[1]).toBe(RUN)
    expect(swarm.gait[0]).toBe(IDLE)
    // The next read is of the other list.
    frame(1000 / 60)
    expect(listReads(device)).toHaveLength(2)
    expect(listReads(device)[1]!.offset).toBe(0)
  })
})

describe('GpuSwarm at the holder', () => {
  it('reads back how many rats the last step found at the holder, one read at a time', async () => {
    const { device, swarm, frame } = swarmOf(6)
    expect(swarm.reached).toBe(0)
    frame(1000 / 60)
    expect(holderReads(device)).toHaveLength(1)
    frame(1000 / 60)
    expect(holderReads(device)).toHaveLength(1)
    await holderReads(device)[0]!.answer([5])
    expect(swarm.reached).toBe(5)
    frame(1000 / 60)
    expect(holderReads(device)).toHaveLength(2)
  })
})

describe("GpuSwarm at the lights", () => {
  it("reads back how many rats the last step found at each lit light's edge, handed on in the lights' order", async () => {
    const { device, swarm, frame, lights } = swarmOf(6)
    lights.push({ x: 1, z: 0, reach: 1, on: true }, { x: 2, z: 0, reach: 1, on: false }, { x: 3, z: 0, reach: 1, on: true })
    expect(swarm.atLights).toEqual([])
    frame(1000 / 60)
    // The lit lights, counted in the step's order: the first and the third.
    await holderReads(device)[0]!.answer([5, 4, 9])
    expect(swarm.reached).toBe(5)
    expect(swarm.atLights).toEqual([4, 0, 9])
  })

  it('reads each count against the lights the steps it read back were handed, not those lit since', async () => {
    const { device, swarm, frame, lights } = swarmOf(6)
    lights.push({ x: 1, z: 0, reach: 1, on: true }, { x: 2, z: 0, reach: 1, on: true })
    frame(1000 / 60)
    // The first goes out before the read comes back: the count the step made at the second is still the second's.
    lights[0]!.on = false
    frame(1000 / 60)
    await holderReads(device)[0]!.answer([0, 30, 2])
    expect(swarm.atLights).toEqual([30, 2])
  })

  it('reads each count against the lights the last step was handed, on a frame that takes no step', async () => {
    const { device, swarm, frame, lights } = swarmOf(6)
    lights.push({ x: 1, z: 0, reach: 1, on: true }, { x: 2, z: 0, reach: 1, on: true })
    frame(1000 / 60)
    await holderReads(device)[0]!.answer([0, 0, 0])
    // The first goes out on a frame too soon after the last for a step: what the buffer holds is still the last step's.
    lights[0]!.on = false
    frame(1)
    expect(device.steps).toBe(1)
    await holderReads(device)[1]!.answer([0, 30, 2])
    expect(swarm.atLights).toEqual([30, 2])
  })
})

describe("GpuSwarm and the level's lights", () => {
  it('hands the step the lit ones, where each is, its reach and how far off it can matter, as they stand each frame', () => {
    const { swarm, frame, lights, tuning } = swarmOf(4)
    lights.push({ x: 1, z: 2, reach: 1.5, on: true }, { x: 3, z: 4, reach: 2, on: false }, { x: 5, z: 6, reach: 0.5, on: true })
    frame(1000 / 60)
    const far = (reach: number) => reach * (1 + FLICKER) + 2 * tuning.gap + Math.max(tuning.gap, tuning.ratRadius)
    const near = (k: number, expected: number[]) => swarm.lights[k]!.toArray().forEach((v, c) => expect(v).toBeCloseTo(expected[c]!, 9))
    expect(swarm.lit).toBe(2)
    near(0, [1, 2, 1.5, far(1.5)])
    near(1, [5, 6, 0.5, far(0.5)])
    lights[1]!.on = true
    frame(1000 / 60)
    expect(swarm.lit).toBe(3)
    near(1, [3, 4, 2, far(2)])
  })

  it(`takes the first ${MAX_LIGHTS} lit at most`, () => {
    const { swarm, frame, lights } = swarmOf(4)
    for (let k = 0; k < MAX_LIGHTS + 3; k++) lights.push({ x: k, z: 0, reach: 1, on: true })
    frame(1000 / 60)
    expect(swarm.lit).toBe(MAX_LIGHTS)
  })
})

describe("GpuSwarm and the level's walls", () => {
  it(`hands the step every wall from end to end, and refuses a level of more than ${MAX_WALLS}`, () => {
    const walls = Array.from({ length: MAX_WALLS }, (_, k) => ({ from: { x: k, z: -1 }, to: { x: k, z: 1 } }))
    const swarm = new GpuSwarm(new GpuCull(CAPACITY, 36, 1), new FakeDevice(), CAPACITY, SEED, 4, 1, () => 0, { walls })
    expect(swarm.walls[0]!.toArray()).toEqual([0, -1, 0, 1])
    expect(swarm.walls[MAX_WALLS - 1]!.toArray()).toEqual([MAX_WALLS - 1, -1, MAX_WALLS - 1, 1])
    walls.push({ from: { x: 0, z: 5 }, to: { x: 1, z: 5 } })
    expect(() => new GpuSwarm(new GpuCull(CAPACITY, 36, 1), new FakeDevice(), CAPACITY, SEED, 4, 1, () => 0, { walls })).toThrow()
  })
})

describe('GpuSwarm holds', () => {
  it('holds every rat on the beat in the held buffer, and stands them there until the next hold', () => {
    const { cull, device, swarm, frame } = swarmOf(4)
    frame(1000 / 60)
    swarm.hold(0)
    swarm.stand()
    const holds = () => device.computed.filter((passes) => passes[0] === cull.holdPass).length
    expect(holds()).toBe(1)
    expect(cull.holding.all.value).toBe(1)
    expect(cull.blend.cur.value).toBe(HELD)
    expect(cull.blend.prev.value).toBe(HELD)
    expect(cull.blend.alpha.value).toBe(1)
    // Between beats nothing is held again, and the rats stand where they were held: newcomers wait for the next beat.
    frame(1000 / 60, 6)
    swarm.stand()
    expect(holds()).toBe(1)
    expect(cull.blend.cur.value).toBe(HELD)
    expect(cull.blend.count.value).toBe(4)
  })

  it('holds each rat on its own beat every frame under the staggered stop motion', () => {
    const { cull, device, swarm } = swarmOf(4)
    swarm.sampleStaggered(0, 2.5, 12)
    swarm.stand()
    swarm.sampleStaggered(0, 2.55, 12)
    swarm.stand()
    expect(device.computed.filter((passes) => passes[0] === cull.holdPass)).toHaveLength(2)
    expect(cull.holding.stagger.value).toBe(1)
    expect(cull.holding.all.value).toBe(0)
    expect(cull.holding.beat.value).toBe(30)
    expect(cull.holding.share.value).toBeCloseTo(0.6, 5)
  })
})

describe('GpuSwarm on the GPU', () => {
  it('steps in passes whose WGSL reads nothing it has not assigned, and binds no more storage buffers than a device allows a stage by default', () => {
    const { cull, swarm } = swarmOf(4)
    const kernels = new Set([...swarm.passes.flatMap((passes) => passes.all), swarm.clearList, cull.holdPass as ComputeNode])
    for (const kernel of kernels) {
      const wgsl = computeWGSL(kernel)
      expect(wgsl).toContain('fn main(')
      expect(unassignedReads(wgsl)).toEqual([])
      // WebGPU's default maxStorageBuffersPerShaderStage: past it the pipeline is invalid, and nothing steps.
      expect((wgsl.match(/var<storage/g) ?? []).length).toBeLessThanOrEqual(8)
    }
  })
})
