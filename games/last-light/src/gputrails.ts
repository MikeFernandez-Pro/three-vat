// The eyes' trails laid on the GPU, on WebGPU: the page works out no ribbon.
// A compute pass, after the cull, finds every eye of every rat the cull kept
// where the rat is drawn (its eye's baked track at its clip and frame, tilted,
// turned, sized and placed by the cull's transform) and keeps it in a short
// history a ribbon, by rat, by the CPU's own rules (trails.ts): a new place
// once a share of the trail's seconds has passed and the eye has moved, a
// fresh start where it jumped or was out of view at the last lay. The pass
// also works out where the trail's age cuts the path, and lists the rats it
// laid, which the ribbons' one indirect draw is counted from: a ribbon an eye
// of each. The vertex stage reads the history as the CPU's ribbons read their
// attributes. The pass reads the swarm only through the cull's buffers, so it
// does not care what made the states.
//
// Each rat's clip and start time go up when its playback row is written,
// which is rarely; the rows written since the last lay go up together.
import { IndirectStorageBufferAttribute, StorageBufferAttribute, type Node, type WebGPURenderer } from 'three/webgpu'
import { Fn, If, dot, float, instanceIndex, int, max, mix, select, step, storage, uint, uniform, vec4 } from 'three/tsl'
import { JUMP, POINTS, STILL, STRIP_INDICES, type Ribbon } from './trails'
import { forgetBuffers, turnBy, type GpuCull } from './gpucull'

/**
 * Vectors a ribbon's history takes: the eye's place and height and the first
 * place at the cut; the cut's place and the ribbon's number; the seven older
 * places, two to a vector; the places' ages, four to a vector; and when it
 * last took a place, with the lay it was last laid in.
 */
const RECORD = 9
/** Lays counted before the count goes round: a float holds every whole number below 2^24. */
const TICKS = 2 ** 20

/** What a rat's playback row says of its clip, as far as its eyes care. */
export interface RowClip {
  /** The clip's first baked frame. */
  startFrame: number
  /** The baked frames it loops over. */
  frames: number
}

/** Ribbon `r`'s history in `records`: its `k`th vector. */
function recordOf(records: { element(index: Node<'int'>): unknown }, r: Node<'int'>): (k: number) => Node<'vec4'> {
  const base = r.mul(RECORD).toVar()
  return (k) => records.element(base.add(k)) as unknown as Node<'vec4'>
}

export class GpuTrails {
  /** Every ribbon's history, ribbon `rat × eyes + eye` at `× RECORD` vectors. */
  readonly ribbons: StorageBufferAttribute
  /** Each rat's clip: (first frame, frames, frames a second at its playback speed, start time). */
  readonly clips: StorageBufferAttribute
  /** The ribbons' draw: their strip's index count, and the ribbons laid, counted by the pass. */
  readonly args: IndirectStorageBufferAttribute
  /** The pass that lays them, after the cull. */
  readonly pass: Node
  /** The ribbon drawn as `instanceIndex`, as the vertex stage reads it. */
  readonly ribbon: () => Ribbon
  /** The rats the last lay laid, in draw order: ribbon instance `slot × eyes + eye` is that rat's eye. */
  private readonly laid: StorageBufferAttribute
  /** Each eye's place at every baked frame, a vector each. */
  private readonly track: StorageBufferAttribute
  /** The page's clock, s, the lay is as of. */
  private readonly now = uniform(0)
  /** How long a trail is, s. */
  private readonly seconds = uniform(0.3)
  /** The lay's number: a ribbon not laid in the one before starts over. From two, so an unlaid ribbon's zero is never the last. */
  private readonly tick = uniform(2)
  /** The rats whose clip changed since the last lay: from `dirtyFrom` to `dirtyTo`, none where `dirtyFrom` is past it. */
  private dirtyFrom = Number.POSITIVE_INFINITY
  private dirtyTo = -1

  constructor(
    /** The cull, whose survivors and their transforms are laid. */
    cull: GpuCull,
    /** The most rats there can be. */
    capacity: number,
    /** The eyes a rat has. */
    eyes: number,
    /** Each eye's place at every baked frame, in the model's units: eye `e` at row `f` at `(f × eyes + e) × 3`. */
    eyeTrack: Float32Array,
    /** The run's clock, as the decode reads it. */
    time: Node<'float'>,
  ) {
    this.ribbons = new StorageBufferAttribute(new Float32Array(capacity * eyes * RECORD * 4), 4)
    this.clips = new StorageBufferAttribute(new Float32Array(capacity * 4), 4)
    this.laid = new StorageBufferAttribute(new Uint32Array(capacity), 1)
    this.args = new IndirectStorageBufferAttribute(new Uint32Array([STRIP_INDICES, 0, 0, 0, 0]), 5)
    const rows = eyeTrack.length / 3
    const track = new Float32Array(rows * 4)
    for (let i = 0; i < rows; i++) track.set(eyeTrack.subarray(i * 3, i * 3 + 3), i * 4)
    this.track = new StorageBufferAttribute(track, 4)

    const records = storage(this.ribbons, 'vec4', capacity * eyes * RECORD)
    const clips = storage(this.clips, 'vec4', capacity).toReadOnly()
    const laid = storage(this.laid, 'uint', capacity)
    const draw = storage(this.args, 'uint', 5)
    const eyeAt = storage(this.track, 'vec4', rows).toReadOnly()
    const survivors = storage(cull.survivors, 'uint', capacity).toReadOnly()
    const transforms = storage(cull.transforms, 'vec4', capacity * 2).toReadOnly()
    const { now, seconds, tick } = this
    const index = (n: number) => vec4(n, n + 1, n + 2, n + 3)
    /** Of eight values, four to a vector, the `k`th. */
    const pick = (low: Node<'vec4'>, high: Node<'vec4'>, k: Node<'float'>) =>
      dot(low, step(index(0).sub(k).abs(), vec4(0.5))).add(dot(high, step(index(4).sub(k).abs(), vec4(0.5))))

    /** Ribbon `r`'s eye at `eye` this lay: its history moved along, the cut worked out. */
    const follow = (r: Node<'int'>, eye: Node<'vec3'>) => {
      const at = recordOf(records, r)
      const head = at(0).toVar()
      const [a, b, c, d] = [2, 3, 4, 5].map((k) => at(k).toVar())
      const ages0 = at(6).toVar()
      const ages1 = at(7).toVar()
      const since = at(8).toVar()
      const moved = eye.xz.sub(head.xz).length()
      // Never laid, out of view at the last lay, or moved rather than ran: every place at the eye, taken now, so the strip has no area.
      const fresh = since.y.notEqual(tick.sub(1)).or(moved.greaterThan(JUMP))
      // Everyone a place older, the eye taking the first: once a share of the trail's seconds has passed and the eye has moved.
      const older = fresh.not().and(now.sub(since.x).greaterThanEqual(seconds.div(POINTS - 1))).and(moved.greaterThan(STILL))
      const here = vec4(eye.x, eye.z, eye.x, eye.z)
      const shift = (kept: Node<'vec4'>, aged: Node<'vec4'>) => select(fresh, here, select(older, aged, kept))
      const a1 = shift(a, vec4(head.x, head.z, a.x, a.y)).toVar()
      const b1 = shift(b, vec4(a.z, a.w, b.x, b.y)).toVar()
      const c1 = shift(c, vec4(b.z, b.w, c.x, c.y)).toVar()
      const d1 = shift(d, vec4(c.z, c.w, 0, 0)).toVar()
      const ages = vec4(now)
      const agesA = select(fresh, ages, select(older, vec4(now, ages0.x, ages0.y, ages0.z), vec4(now, ages0.y, ages0.z, ages0.w))).toVar()
      const agesB = select(fresh, ages, select(older, vec4(ages0.w, ages1.x, ages1.y, ages1.z), ages1)).toVar()
      const sampled = select(fresh.or(older), now, since.x)
      // Where the trail's age cuts the path: the first place older than its seconds, the ages falling along it; and where the path was at exactly that age.
      const young = step(now.sub(seconds), agesA)
      const first = float(1).add(young.y).add(young.z).add(young.w).add(dot(step(now.sub(seconds), agesB), vec4(1))).toVar()
      const xs0 = vec4(eye.x, a1.x, a1.z, b1.x)
      const zs0 = vec4(eye.z, a1.y, a1.w, b1.y)
      const xs1 = vec4(b1.z, c1.x, c1.z, d1.x)
      const zs1 = vec4(b1.w, c1.y, c1.w, d1.y)
      const before = first.sub(1)
      const younger = now.sub(pick(agesA, agesB, before)).toVar()
      const oldest = now.sub(pick(agesA, agesB, first)).toVar()
      const t = select(oldest.greaterThan(younger), seconds.sub(younger).div(oldest.sub(younger)).clamp(0, 1), float(0))
      const cutX = mix(pick(xs0, xs1, before), pick(xs0, xs1, first), t)
      const cutZ = mix(pick(zs0, zs1, before), pick(zs0, zs1, first), t)
      at(0).assign(vec4(eye, first))
      at(1).assign(vec4(cutX, cutZ, float(r), 0))
      at(2).assign(a1)
      at(3).assign(b1)
      at(4).assign(c1)
      at(5).assign(d1)
      at(6).assign(agesA)
      at(7).assign(agesB)
      at(8).assign(vec4(sampled, tick, 0, 0))
    }

    this.pass = Fn(() => {
      const slot = int(instanceIndex).toVar()
      const count = int(cull.keptCount()).toVar()
      If(slot.equal(0), () => {
        draw.element(1).assign(uint(count.mul(eyes)))
      })
      If(slot.lessThan(count), () => {
        const rat = int(survivors.element(slot)).toVar()
        laid.element(slot).assign(uint(rat))
        const place = transforms.element(slot.mul(2)).toVar()
        const trig = transforms.element(slot.mul(2).add(1)).toVar()
        // The two baked frames the rat shows and how far between, as the decode reads a looping clip.
        const clip = clips.element(rat).toVar()
        const spread = max(time.sub(clip.w), 0).mul(clip.z).mod(clip.y).toVar()
        const f0 = spread.floor().toVar()
        const f1 = select(f0.add(1).equal(clip.y), float(0), f0.add(1))
        const row0 = int(clip.x.add(f0)).mul(eyes).toVar()
        const row1 = int(clip.x.add(f1)).mul(eyes).toVar()
        for (let e = 0; e < eyes; e++) {
          const local = mix(eyeAt.element(row0.add(e)).xyz, eyeAt.element(row1.add(e)).xyz, spread.sub(f0))
          follow(rat.mul(eyes).add(e), turnBy(trig, local.mul(place.w)).add(place.xyz))
        }
      })
    })().compute(capacity)

    // Views of their own: toReadOnly marks the node it is called on, and the pass writes through its own.
    const read = storage(this.ribbons, 'vec4', capacity * eyes * RECORD).toReadOnly()
    const drawn = storage(this.laid, 'uint', capacity).toReadOnly()
    this.ribbon = () => {
      const i = int(instanceIndex)
      const at = recordOf(read, int(drawn.element(i.div(eyes))).mul(eyes).add(i.mod(eyes)))
      return { head: at(0), cut: at(1), past: [at(2), at(3), at(4), at(5)] }
    }
  }

  /** Rat `i`'s playback row now plays `clip` from `startTime` at `framesASecond`: it goes up with the next lay. */
  setRow(i: number, clip: RowClip, startTime: number, framesASecond: number): void {
    const out = this.clips.array as Float32Array
    out[i * 4] = clip.startFrame
    out[i * 4 + 1] = clip.frames
    out[i * 4 + 2] = framesASecond
    out[i * 4 + 3] = startTime
    this.dirtyFrom = Math.min(this.dirtyFrom, i)
    this.dirtyTo = Math.max(this.dirtyTo, i)
  }

  /** Lay the eyes of every rat the cull just kept, as of `now` seconds, a trail `seconds` long. */
  lay(renderer: WebGPURenderer, now: number, seconds: number): void {
    if (this.dirtyFrom <= this.dirtyTo) {
      this.clips.clearUpdateRanges()
      this.clips.addUpdateRange(this.dirtyFrom * 4, (this.dirtyTo - this.dirtyFrom + 1) * 4)
      this.clips.needsUpdate = true
      this.dirtyFrom = Number.POSITIVE_INFINITY
      this.dirtyTo = -1
    }
    this.now.value = now
    this.seconds.value = seconds
    renderer.compute(this.pass as unknown as Parameters<WebGPURenderer['compute']>[0])
    // Counted round well inside a float's whole numbers, back to two: every ribbon starts over once, there.
    this.tick.value = this.tick.value + 1 >= TICKS ? 2 : this.tick.value + 1
  }

  /** Free the GPU's copies of every buffer and the pass's pipeline. */
  dispose(renderer: WebGPURenderer): void {
    this.pass.dispose()
    forgetBuffers(renderer, [this.ribbons, this.clips, this.laid, this.track, this.args])
  }
}
