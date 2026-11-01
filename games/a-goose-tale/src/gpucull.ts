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
// state, rat by rat, and the GPU's step (gpuswarm.ts) writes them in place.
// For that step a third buffer holds the rats still under the stop motion: a
// pass copies each rat into it as the pair has it when its beat turns, so the
// step can go on writing the pair between beats.
//
// On a level with height (#183) the cull stands each rat on the ground under
// it, read off the level's height grid between its points: the swarm's own
// height, a pile's, goes on top. The trails, laid from the cull's transforms,
// follow.
//
// The survivors are drawn at levels of detail: the cull sorts each into the
// list of its level by how long it stands on screen, and each level is a draw
// of its own over its own list. The survivor list itself stays whole, the
// trails and the count in view reading it as before.
import {
  IndirectStorageBufferAttribute,
  StorageBufferAttribute,
  Matrix4,
  Vector2,
  Vector3,
  Vector4,
  type BufferAttribute,
  type Frustum,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'
import { Fn, If, atomicAdd, atomicLoad, atomicStore, cos, float, floor, fract, instanceIndex, int, min, mix, normalLocal, select, sin, smoothstep, storage, uint, uniform, vec2, vec3, vec4 } from 'three/tsl'
import type { HeightGrid } from './heights'
import { bandCoc } from './tiltshift'
import type { State } from './swarm-remote'

const TAU = Math.PI * 2

/** Floats a rat takes in a state buffer: (x, y, z, heading) and (pitch, place, moved, 0); held, the last is its beat. */
export const STRIDE = 8
/** Which of the cull's buffers is the held one: the two before it are the pair's. */
export const HELD = 2
/** Floats a survivor's transform takes: (x, y, z, metres a unit) and (cos yaw, sin yaw, cos tilt, sin tilt). */
const TRANSFORM = 8
/** Uints a draw's arguments take: index count, instance count, first index, base vertex, first instance. */
export const DRAW = 5

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

/** The ground's height at (x, z), read off `heights`, `grid`'s points, between the four round it, as `grid.at` reads it. */
export function heightOn(grid: HeightGrid, heights: StorageBufferAttribute): (x: Node<'float'>, z: Node<'float'>) => Node<'float'> {
  const read = storage(heights, 'float', grid.heights.length).toReadOnly()
  return (x, z) => {
    const fx = x.sub(grid.minX).div(grid.cell).clamp(0, grid.nx - 1)
    const fz = z.sub(grid.minZ).div(grid.cell).clamp(0, grid.nz - 1)
    const i = min(floor(fx), float(grid.nx - 2))
    const j = min(floor(fz), float(grid.nz - 2))
    const row = int(j.mul(grid.nx).add(i))
    const a = mix(read.element(row), read.element(row.add(1)), fx.sub(i))
    const b = mix(read.element(row.add(grid.nx)), read.element(row.add(grid.nx + 1)), fx.sub(i))
    return mix(a, b, fz.sub(j))
  }
}

/** Free the GPU's copies of `buffers`: since three r187 a renderer drops an attribute's buffer when the attribute is disposed. */
export function forgetBuffers(buffers: readonly BufferAttribute[]): void {
  for (const buffer of buffers) buffer.dispose()
}

/**
 * The uniforms a level of detail is picked by, for `levels` levels and the
 * whole rat's draw after them, each `indexCount` long to start; and which
 * rats the whole rat's draw takes: none (0), every one (1), or those on the
 * left of the view (2), through `viewProjection`.
 */
function lodOf(levels: number, indexCount: number) {
  return {
    eye: uniform(new Vector3()),
    /** The way the camera looks, a unit long. */
    forward: uniform(new Vector3(0, 0, -1)),
    focal: uniform(1),
    /**
     * The depth of field, as post.ts blurs: the distance in focus, m; how far
     * from it a rat goes fully soft, m; and the blur's radius there, px, 0
     * without it.
     */
    focus: uniform(0),
    soft: uniform(1),
    blur: uniform(0),
    /**
     * Or the tilt-shift's band (tiltshift.ts), while `banded` is 1: the blur
     * by where the rat stands on the screen and not by its depth, `blur` its
     * radius; and the drawing buffer's width over its height.
     */
    banded: uniform(0),
    band: { centre: uniform(0.5), width: uniform(0), falloff: uniform(1), normal: uniform(new Vector2(0, 1)) },
    aspect: uniform(1),
    length: uniform(1),
    limits: Array.from({ length: levels - 1 }, () => uniform(0)),
    indexCounts: Array.from({ length: levels + 1 }, () => uniform(indexCount, 'uint')),
    whole: uniform(0, 'int'),
    viewProjection: uniform(new Matrix4()),
  }
}

export class GpuCull {
  /**
   * The pair's two buffers, rat `i` at `i × STRIDE`: whichever of the two each
   * state was put in; and the held buffer, HELD, the GPU's step stands the
   * rats in under the stop motion.
   */
  readonly states: readonly [StorageBufferAttribute, StorageBufferAttribute, StorageBufferAttribute]
  /**
   * The draws' arguments, DRAW uints each: first every survivor's, which only
   * counts them, then each level's, at `DRAW × (1 + level)`, the survivors at
   * that level. A level's draw reads them at that many bytes times four.
   */
  readonly args: IndirectStorageBufferAttribute
  /**
   * The logical index of the rat drawn at `instanceIndex` by the level the
   * drawing object's `userData.ratLevel` names: what the decode reads its row by.
   */
  readonly logicalIndex: Node<'int'>
  /**
   * The levels of detail: a level is drawn from `limits[level - 1]` pixels
   * long on screen down to `limits[level]`, the last to nothing. A draw more,
   * level `levels`, is the whole rat's, for what `lod.whole` sends it.
   */
  readonly levels: number
  /**
   * What a level is picked by: the eye, the pixels a metre at one metre's
   * distance, the model's length in its units, each level's lower limit in
   * pixels long, and each level's index count.
   */
  readonly lod: ReturnType<typeof lodOf>
  /** The level the drawing object draws, as its `userData.ratLevel` names it. */
  readonly level: Node<'int'>
  /** The slot, in the survivor list, of the rat drawn at `instanceIndex` by the drawing object's level. */
  private readonly slot: Node<'int'>
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
  /**
   * The pass that holds the rats for the GPU's step: each rat the blend
   * stands, copied into the held buffer as the blend has it, when its beat
   * turns, or every rat where `holding.all` is set.
   */
  readonly holdPass: Node
  /** The hold's beat: the whole beats and the share of one, the rats spread over it or not, and whether every rat is held now. */
  readonly holding = { beat: uniform(0), share: uniform(0), stagger: uniform(0), all: uniform(0) }
  /**
   * The logical index of each rat the cull kept, in draw order, the first
   * `capacity`; then, `capacity` a level, each level's survivors as their slots in that.
   */
  readonly survivors: StorageBufferAttribute
  /** Each survivor's transform, in draw order: (x, y, z, metres a unit) and (cos yaw, sin yaw, cos tilt, sin tilt). */
  readonly transforms: StorageBufferAttribute
  /** Rats in view, as last read back; none until the first read comes in, and NaN where reading fails. */
  drawn = 0
  /** Rats in view at each level and at the whole rat's draw, read back with `drawn`. */
  drawnAt: number[] = []
  /** Which state each buffer holds: none before its first, or once held places overwrote it. */
  private readonly holds: (State | undefined)[] = [undefined, undefined]
  /** The draw's arguments as the passes read and count them. */
  private readonly draw
  private readonly planes = Array.from({ length: 6 }, () => uniform(new Vector4()))
  private reading = false
  private readAt = Number.NEGATIVE_INFINITY
  /** The ground's heights, on a level with height. */
  private readonly ground: StorageBufferAttribute | undefined

  constructor(
    private readonly capacity: number,
    /** The rat's index count: every survivor draws all of it. */
    indexCount: number,
    /** How far past the view a rat is still drawn, m. */
    margin: number,
    /** The level's ground, each rat stood on it; none, and the ground is flat. */
    ground?: HeightGrid,
    /** The levels of detail drawn, each at `indexCount` until `lod.indexCounts` says otherwise. */
    levels = 1,
  ) {
    this.levels = levels
    this.states = [
      new StorageBufferAttribute(new Float32Array(capacity * STRIDE), 4),
      new StorageBufferAttribute(new Float32Array(capacity * STRIDE), 4),
      new StorageBufferAttribute(new Float32Array(capacity * STRIDE), 4),
    ]
    // The whole list, a list a level, and the whole rat's.
    const draws = levels + 1
    const lists = capacity * (1 + draws)
    this.survivors = new StorageBufferAttribute(new Uint32Array(lists), 1)
    this.transforms = new StorageBufferAttribute(new Float32Array(capacity * TRANSFORM), 4)
    const args = new Uint32Array(DRAW * (1 + draws))
    for (let l = 0; l <= draws; l++) args[DRAW * l] = indexCount
    this.args = new IndirectStorageBufferAttribute(args, DRAW)
    this.lod = lodOf(levels, indexCount)
    // The drawing object's level: one material over every level's mesh, each reading its own list.
    const level = (this.level = uniform(0, 'int').onObjectUpdate(({ object }) => (object?.userData.ratLevel as number | undefined) ?? 0))
    const read = storage(this.survivors, 'uint', lists).toReadOnly()
    this.slot = int(read.element(level.add(1).mul(capacity).add(int(instanceIndex))))
    this.logicalIndex = int(read.element(this.slot))
    this.ground = ground === undefined ? undefined : new StorageBufferAttribute(ground.heights, 1)
    const groundAt = ground === undefined ? undefined : heightOn(ground, this.ground!)

    const draw = (this.draw = storage(this.args, 'uint', DRAW * (1 + draws)).toAtomic())
    const reset = Fn(() => {
      atomicStore(draw.element(1), uint(0))
      for (let l = 0; l < draws; l++) {
        atomicStore(draw.element(DRAW * (1 + l)), this.lod.indexCounts[l]!)
        atomicStore(draw.element(DRAW * (1 + l) + 1), uint(0))
      }
    })().compute(1)

    const kept = storage(this.survivors, 'uint', lists)
    const out = storage(this.transforms, 'vec4', capacity * 2)
    const radius = float(margin).negate()
    const cull = Fn(() => {
      const i = int(instanceIndex).toVar()
      const rat = this.between(i)
      // Stood on the ground.
      const position = (groundAt === undefined ? rat.position : rat.position.add(vec3(0, groundAt(rat.position.x, rat.position.z), 0))).toVar()
      // A sphere of the margin round the rat, on the inner side of every plane of the view.
      let inside = i.lessThan(this.blend.count)
      for (const plane of this.planes) inside = inside.and(plane.xyz.dot(position).add(plane.w).greaterThanEqual(radius))
      If(inside, () => {
        const slot = int(atomicAdd(draw.element(1), uint(1)) as never).toVar()
        kept.element(slot).assign(uint(i))
        // A heading turns from +x toward +z, and the rat faces +z: a quarter turn from it. A turn about its own x by minus the pitch lifts its nose.
        const yaw = float(Math.PI / 2).sub(rat.heading)
        const tilt = rat.pitch.negate()
        const metres = this.size.usual.mul(this.size.smallest.add(this.size.span.mul(rat.place))).toVar()
        out.element(slot.mul(2)).assign(vec4(position, metres))
        out.element(slot.mul(2).add(1)).assign(vec4(cos(yaw), sin(yaw), cos(tilt), sin(tilt)))
        // Its level, by how many pixels long it stands, over how many the depth of field or the band smears it; into that level's list.
        const { eye, forward, focus, soft, blur, banded, band, aspect } = this.lod
        const clip = this.lod.viewProjection.mul(vec4(position, 1)).toVar()
        // The screen's uv as the post's: y down from the top.
        const uv = clip.xy.div(clip.w.max(0.001)).mul(vec2(0.5, -0.5)).add(0.5)
        const deep = smoothstep(0, soft, position.sub(eye).dot(forward).sub(focus).abs())
        const smear = mix(deep, bandCoc(uv, aspect, band), banded).mul(blur).max(1)
        const pixels = metres.mul(this.lod.length).mul(this.lod.focal).div(position.distance(eye).max(0.001)).div(smear)
        let at: Node<'int'> = int(levels - 1)
        for (let l = levels - 2; l >= 0; l--) at = select(pixels.greaterThanEqual(this.lod.limits[l]!), int(l), at) as Node<'int'>
        // Or the whole rat's draw, for every rat or those on the left of the view.
        const left = clip.x.lessThan(0)
        const whole = this.lod.whole.equal(1).or(this.lod.whole.equal(2).and(left))
        const own = select(whole, int(levels), at).toVar()
        const k = int(atomicAdd(draw.element(own.add(1).mul(DRAW).add(1)), uint(1)) as never).toVar()
        kept.element(own.add(1).mul(capacity).add(k)).assign(uint(slot))
      })
    })().compute(capacity)
    this.passes = [reset, cull]

    const held = storage(this.states[HELD], 'vec4', capacity * 2)
    this.holdPass = Fn(() => {
      const i = int(instanceIndex).toVar()
      If(i.lessThan(this.blend.count), () => {
        // Its own beat, the golden ratio spreading the phases evenly over any run of indices; or the one beat.
        const { beat, share, stagger, all } = this.holding
        const own = beat.add(floor(share.add(fract(float(i).mul(0.6180339887)).mul(stagger)))).toVar()
        const was = held.element(i.mul(2).add(1)).w
        If(all.greaterThan(0.5).or(was.notEqual(own)), () => {
          // The pair alone: the held buffer is written here, and a buffer is never bound both to read and to write.
          const rat = this.between(i, false)
          held.element(i.mul(2)).assign(vec4(rat.position, rat.heading))
          held.element(i.mul(2).add(1)).assign(vec4(rat.pitch, rat.place, 0, own))
        })
      })
    })().compute(capacity)
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
    return atomicLoad(this.draw.element(1)) as unknown as Node<'uint'>
  }

  /** `posed`, the decode's position in the model's units, turned, sized and placed as the rat drawn at this instance of its level; the normal turned with it. */
  transform(posed: Node<'vec3'>): Node<'vec3'> {
    return Fn(() => {
      const local = posed.toVar()
      const transforms = storage(this.transforms, 'vec4', this.capacity * 2).toReadOnly()
      const slot = this.slot.toVar()
      const at = transforms.element(slot.mul(2)).toVar()
      const trig = transforms.element(slot.mul(2).add(1)).toVar()
      normalLocal.assign(turnBy(trig, normalLocal))
      return turnBy(trig, local.mul(at.w)).add(at.xyz)
    })()
  }

  /** Where the rat drawn at this instance of its level stands, in the world. */
  place(): Node<'vec3'> {
    return storage(this.transforms, 'vec4', this.capacity * 2).toReadOnly().element(this.slot.mul(2)).xyz
  }

  /** Upload the ground's heights again, laid again in place on their grid. */
  groundChanged(): void {
    if (this.ground) this.ground.needsUpdate = true
  }

  /** Free the GPU's copies of every buffer and the passes' pipelines. */
  dispose(): void {
    for (const pass of [...this.passes, this.holdPass]) pass.dispose()
    forgetBuffers([...this.states, this.survivors, this.transforms, this.args, ...(this.ground === undefined ? [] : [this.ground])])
  }

  /**
   * Rat `i` between the two states: where it stands, which way it heads, its
   * pitch, as the page blends them, and its place, as the latest has it. The
   * held buffer is one the blend may read, unless `orHeld` is off.
   */
  between(i: Node<'int'>, orHeld = true) {
    const states = this.states.slice(0, orHeld ? 3 : 2).map((s) => storage(s, 'vec4', this.capacity * 2).toReadOnly())
    const at = (k: number, half: number) => states[k]!.element(i.mul(2).add(half))
    const read = (which: Node<'int'>, half: number) =>
      select(which.equal(0), at(0, half), orHeld ? select(which.equal(1), at(1, half), at(HELD, half)) : at(1, half)).toVar()
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
        const args = new Uint32Array(buffer as ArrayBuffer)
        this.drawn = args[1]!
        this.drawnAt = Array.from({ length: this.levels + 1 }, (_, l) => args[DRAW * (1 + l) + 1]!)
      })
      .catch(() => {
        this.drawn = Number.NaN
      })
      .finally(() => {
        this.reading = false
      })
  }
}
