// The rats culled on the GPU, on WebGPU (ADR-0052). A compute pass blends
// every rat between the two swarm states the page stands them between, tests
// it against the view, and writes each rat in view into a survivor list: its
// logical index, which the decode reads its playback row by, and its finished
// transform. One indirect draw a pass draws the survivors; the cull counts
// them into the draw's arguments. So the page composes no rat matrices, and
// three keeps no batch.
//
// The states go up as they come in, each once: a new state goes into the
// buffer the sampled pair no longer reads. Per frame only the blend between
// the two and the view's planes are set. The buffers are the swarm's own
// state, rat by rat, so a GPU step could write them later.
import {
  IndirectStorageBufferAttribute,
  StorageBufferAttribute,
  Vector4,
  type BufferAttribute,
  type Frustum,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'
import { Fn, If, atomicAdd, atomicLoad, atomicStore, cos, float, instanceIndex, int, normalLocal, select, sin, storage, struct, uint, uniform, vec3, vec4 } from 'three/tsl'
import type { State } from './swarm-remote'

const TAU = Math.PI * 2

/** Floats a rat takes in a state buffer: (x, y, z, heading) and (pitch, place, moved, 0). */
const STRIDE = 8
/** Floats a survivor's transform takes: (x, y, z, metres a unit) and (cos yaw, sin yaw, cos tilt, sin tilt). */
const TRANSFORM = 8

/** How often the count of rats in view is read back, ms: a readout's pace, not the frame's. */
const READ_EVERY = 250

/** The two states the page last stood the rats between, as RemoteSwarm samples them, and how. */
export interface Pair {
  /** The earlier state; none, and every rat stands where `cur` has it. */
  prev: State | undefined
  cur: State
  /** How far from `prev` to `cur`. */
  alpha: number
  /** The rats both states hold; the rest are newcomers, standing where `cur` has them. */
  both: number
}

/** Where each rat is held on the page, the first `count` of each: the staggered hold's places. */
export type Held = Pick<State, 'count' | 'x' | 'y' | 'z' | 'heading' | 'pitch' | 'place'>

/**
 * `v` tilted about x and turned about up by `trig`, (cos yaw, sin yaw, cos
 * tilt, sin tilt): tilted first, as the rat is, then turned.
 */
export function turnBy(trig: Node<'vec4'>, v: Node<'vec3'>): Node<'vec3'> {
  const y1 = v.y.mul(trig.z).sub(v.z.mul(trig.w))
  const z1 = v.y.mul(trig.w).add(v.z.mul(trig.z))
  return vec3(v.x.mul(trig.x).add(z1.mul(trig.y)), y1, v.x.negate().mul(trig.y).add(z1.mul(trig.x)))
}

/** Free the GPU's copies of `buffers`: BufferAttribute has no dispose of its own in three r186, so its renderer's attributes are told directly. */
export function forgetBuffers(renderer: WebGPURenderer, buffers: readonly BufferAttribute[]): void {
  const attributes = (renderer as unknown as { _attributes: { delete(attribute: BufferAttribute): unknown } | null })._attributes
  for (const buffer of buffers) attributes?.delete(buffer)
}

export class GpuCull {
  /** The pair's two buffers, rat `i` at `i × STRIDE`: whichever of the two each state was put in. */
  readonly states: readonly [StorageBufferAttribute, StorageBufferAttribute]
  /** The draw's arguments: index count, instance count (the survivors, counted by the cull), first index, base vertex, first instance. */
  readonly args: IndirectStorageBufferAttribute
  /** The logical index of the rat drawn at slot `instanceIndex`, as the cull kept it: what the decode reads its row by. */
  readonly logicalIndex: Node<'int'>
  /**
   * What the cull blends by: the buffer the earlier and the latest state are
   * in, how far between, the rats both hold, and the rats there are.
   */
  readonly blend = {
    prev: uniform(0, 'int'),
    cur: uniform(0, 'int'),
    alpha: uniform(1),
    both: uniform(0, 'int'),
    count: uniform(0, 'int'),
  }
  /** A rat's size, metres a model unit: from `smallest` to `smallest + span` times `usual`, by its place between the slowest and the fastest. */
  readonly size = { usual: uniform(1), smallest: uniform(1), span: uniform(0) }
  /** The passes run before the frame's: the count zeroed, then the cull. */
  readonly passes: readonly [Node, Node]
  /** The logical index of each rat the cull kept, in draw order. */
  readonly survivors: StorageBufferAttribute
  /** Each survivor's transform, in draw order: (x, y, z, metres a unit) and (cos yaw, sin yaw, cos tilt, sin tilt). */
  readonly transforms: StorageBufferAttribute
  /** Rats in view, as last read back; none until the first read comes in, and NaN where reading fails. */
  drawn = 0
  /** Which state each buffer holds: none before its first, or once held places overwrote it. */
  private readonly holds: (State | undefined)[] = [undefined, undefined]
  /** The draw's arguments as the passes read and count them. */
  private readonly draw
  private readonly planes = Array.from({ length: 6 }, () => uniform(new Vector4()))
  private reading = false
  private readAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly capacity: number,
    /** The rat's index count: every survivor draws all of it. */
    indexCount: number,
    /** How far past the view a rat is still drawn, m. */
    margin: number,
  ) {
    this.states = [
      new StorageBufferAttribute(new Float32Array(capacity * STRIDE), 4),
      new StorageBufferAttribute(new Float32Array(capacity * STRIDE), 4),
    ]
    this.survivors = new StorageBufferAttribute(new Uint32Array(capacity), 1)
    this.transforms = new StorageBufferAttribute(new Float32Array(capacity * TRANSFORM), 4)
    this.args = new IndirectStorageBufferAttribute(new Uint32Array([indexCount, 0, 0, 0, 0]), 5)
    this.logicalIndex = int(storage(this.survivors, 'uint', capacity).toReadOnly().element(instanceIndex))

    const draw = (this.draw = storage(
      this.args,
      struct({ indexCount: 'uint', instanceCount: { type: 'uint', atomic: true }, firstIndex: 'uint', baseVertex: 'uint', firstInstance: 'uint' }, 'RatDraw'),
      1,
    ))
    const reset = Fn(() => {
      atomicStore(draw.get('instanceCount'), uint(0))
    })().compute(1)

    const kept = storage(this.survivors, 'uint', capacity)
    const out = storage(this.transforms, 'vec4', capacity * 2)
    const radius = float(margin).negate()
    const cull = Fn(() => {
      const i = int(instanceIndex).toVar()
      const rat = this.between(i)
      // A sphere of the margin round the rat, on the inner side of every plane of the view.
      let inside = i.lessThan(this.blend.count)
      for (const plane of this.planes) inside = inside.and(plane.xyz.dot(rat.position).add(plane.w).greaterThanEqual(radius))
      If(inside, () => {
        const slot = int(atomicAdd(draw.get('instanceCount'), uint(1)) as never).toVar()
        kept.element(slot).assign(uint(i))
        // A heading turns from +x toward +z, and the rat faces +z: a quarter turn from it. A turn about its own x by minus the pitch lifts its nose.
        const yaw = float(Math.PI / 2).sub(rat.heading)
        const tilt = rat.pitch.negate()
        const metres = this.size.usual.mul(this.size.smallest.add(this.size.span.mul(rat.place)))
        out.element(slot.mul(2)).assign(vec4(rat.position, metres))
        out.element(slot.mul(2).add(1)).assign(vec4(cos(yaw), sin(yaw), cos(tilt), sin(tilt)))
      })
    })().compute(capacity)
    this.passes = [reset, cull]
  }

  /**
   * Stand the rats between `pair`'s states, `count` of them at most: a state
   * not yet on the GPU goes up, into the buffer the other of the pair is not
   * in. A pair held across beats uploads nothing, and keeps its blend.
   */
  stand(pair: Pair, count: number): void {
    const { cur } = pair
    // With no rat in both, no rat reads the earlier state: it need not be up.
    const prev = pair.both > 0 ? pair.prev : undefined
    // A first state, or one of a pair that skipped past both of the last, goes where the last pair read its earlier state.
    const older = 1 - this.blend.cur.value
    let c = this.holds.indexOf(cur)
    let p: number
    if (prev === undefined) {
      if (c < 0) c = this.put(older, cur)
      p = c
    } else {
      p = this.holds.indexOf(prev)
      if (p < 0) p = this.put(c >= 0 ? 1 - c : older, prev)
      if (c < 0) c = this.put(1 - p, cur)
    }
    this.blend.prev.value = p
    this.blend.cur.value = c
    this.blend.alpha.value = pair.alpha
    this.blend.both.value = prev === undefined ? 0 : pair.both
    this.blend.count.value = Math.min(count, cur.count)
  }

  /**
   * The staggered hold: every rat where the page holds it, each on its own
   * beat, written into the current buffer and stood there, the blend at one.
   * Every rat goes up, every frame it is called.
   */
  hold(held: Held): void {
    const k = this.blend.cur.value
    // Held places, moved by nobody: the blend at one stands every rat where it is held.
    this.write(k, held)
    this.holds[k] = undefined
    this.blend.prev.value = k
    this.blend.alpha.value = 1
    this.blend.both.value = 0
    this.blend.count.value = held.count
  }

  /** Cull against `frustum`, before the frame's passes: every pass draws the survivors. Then, now and then, read back how many survived. */
  cull(renderer: WebGPURenderer, frustum: Frustum): void {
    frustum.planes.forEach((plane, k) => this.planes[k]!.value.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant))
    renderer.compute(this.passes as unknown as Parameters<WebGPURenderer['compute']>[0])
    this.readBack(renderer)
  }

  /** How many rats the cull kept, read in the body of a pass run after it. */
  keptCount(): Node<'uint'> {
    return atomicLoad(this.draw.get('instanceCount')) as unknown as Node<'uint'>
  }

  /** `posed`, the decode's position in the model's units, turned, sized and placed as the rat drawn at this slot; the normal turned with it. */
  transform(posed: Node<'vec3'>): Node<'vec3'> {
    return Fn(() => {
      const local = posed.toVar()
      const transforms = storage(this.transforms, 'vec4', this.capacity * 2).toReadOnly()
      const at = transforms.element(int(instanceIndex).mul(2)).toVar()
      const trig = transforms.element(int(instanceIndex).mul(2).add(1)).toVar()
      normalLocal.assign(turnBy(trig, normalLocal))
      return turnBy(trig, local.mul(at.w)).add(at.xyz)
    })()
  }

  /** Free the GPU's copies of every buffer and the passes' pipelines. */
  dispose(renderer: WebGPURenderer): void {
    for (const pass of this.passes) pass.dispose()
    forgetBuffers(renderer, [...this.states, this.survivors, this.transforms, this.args])
  }

  /**
   * Rat `i` between the two states: where it stands, which way it heads, its
   * pitch, as the page blends them, and its place, as the latest has it.
   */
  private between(i: Node<'int'>) {
    const states = this.states.map((s) => storage(s, 'vec4', this.capacity * 2).toReadOnly())
    const read = (which: Node<'int'>, half: number) => select(which.equal(0), states[0]!.element(i.mul(2).add(half)), states[1]!.element(i.mul(2).add(half))).toVar()
    const prev0 = read(this.blend.prev, 0)
    const prev1 = read(this.blend.prev, 1)
    const cur0 = read(this.blend.cur, 0)
    const cur1 = read(this.blend.cur, 1)
    // A rat the earlier state had not spawned, or one the worker moved rather than ran, stands where the latest has it.
    const latest = i.greaterThanEqual(this.blend.both).or(cur1.z.greaterThan(0.5))
    const alpha = select(latest, float(1), this.blend.alpha).toVar()
    // The heading the short way round.
    const turn = cur0.w.sub(prev0.w)
    const short = turn.sub(turn.div(TAU).round().mul(TAU))
    return {
      position: prev0.xyz.add(cur0.xyz.sub(prev0.xyz).mul(alpha)),
      heading: prev0.w.add(short.mul(alpha)),
      pitch: prev1.x.add(cur1.x.sub(prev1.x).mul(alpha)),
      place: cur1.y,
    }
  }

  /** Put `s` up into buffer `k`, which then holds it. */
  private put(k: number, s: State): number {
    this.write(k, s, s.moved)
    this.holds[k] = s
    return k
  }

  /** Copy `held`'s rats into buffer `k`, which of them the worker `moved` too, and upload just those. */
  private write(k: number, held: Held, moved?: Uint8Array): void {
    const target = this.states[k]!
    const out = target.array as Float32Array
    const { x, y, z, heading, pitch, place, count } = held
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE
      out[o] = x[i]!
      out[o + 1] = y[i]!
      out[o + 2] = z[i]!
      out[o + 3] = heading[i]!
      out[o + 4] = pitch[i]!
      out[o + 5] = place[i]!
      out[o + 6] = moved?.[i] ?? 0
    }
    target.clearUpdateRanges()
    target.addUpdateRange(0, count * STRIDE)
    target.needsUpdate = true
  }

  /** Read back how many rats the cull kept, one read at a time, every READ_EVERY ms at most: never awaited on the frame. */
  private readBack(renderer: WebGPURenderer): void {
    const now = performance.now()
    if (this.reading || now - this.readAt < READ_EVERY) return
    this.reading = true
    this.readAt = now
    renderer
      .getArrayBufferAsync(this.args)
      .then((buffer) => {
        this.drawn = new Uint32Array(buffer as ArrayBuffer)[1]!
      })
      .catch(() => {
        this.drawn = Number.NaN
      })
      .finally(() => {
        this.reading = false
      })
  }
}
