// The swarm stepped on the GPU, on WebGPU: compute passes the page runs, on the
// device the cull and the draw use, and the swarm's state never leaves the GPU.
// The step writes the cull's own state buffers (gpucull.ts): each step reads
// the latest state and writes the next into the buffer the pair no longer
// reads, so the cull blends the last two as it blended the worker's.
//
// The step is the CPU step's (swarm.ts), under its one model: each rat reads
// its neighbours as the last step left them and draws its chances from a hash
// of the step and its index. The kernels read the step's tuning constants and
// its hash from swarm.ts; the flame's three waves and the few literal
// thresholds of the rules are written here again, and a change to either
// file's rules goes into the other. Its phases, each a named function: the neighbour
// grid, by counting sort (cells cleared, rats counted into them, the counts
// scanned, the rats scattered into cell order); the step of every rat; then
// bring-round, where every rat that qualifies takes a ticket by an atomic add
// and only the tickets under the step's quota move. The flame's reach is
// worked out at each rat's own angle, where the CPU reads it from a table.
//
// The page keeps the clock, a fixed STEP a step, as many a frame as it owes,
// MOST_STEPS at most; it keeps what a step reads that is one number for the
// whole swarm (the light's walk, the quota owed, the step's keys); it hands the
// step the lights the level places, lit ones only, as a uniform array (the
// step's kernel binds all the storage buffers WebGPU allows a stage); and it
// spawns the rats, by the swarm's own rule, uploading the new ones only. What
// comes back is small and late: the rats whose gait changed, listed by the
// step, read back a list at a time, and how many rats the last step found at
// the holder, never awaited on the frame.
import { StorageBufferAttribute, Vector4, type ComputeNode, type Node, type StorageBufferNode, type Texture, type WebGPURenderer } from 'three/webgpu'
import {
  Fn,
  If,
  Loop,
  atan,
  atomicAdd,
  bool,
  atomicStore,
  cos,
  float,
  instanceIndex,
  int,
  invocationLocalIndex,
  ivec2,
  max,
  min,
  select,
  sin,
  sqrt,
  storage,
  textureLoad,
  uint,
  uniform,
  uniformArray,
  vec4,
  workgroupArray,
  workgroupBarrier,
  workgroupId,
} from 'three/tsl'
import {
  ANGLE_DRAW,
  DEPTH_DRAW,
  FALL,
  FALL_FLEE,
  FEEL,
  FLICKER,
  FLINCH,
  FLINCH_DRAW,
  GAIT_DWELL,
  IDLE,
  LIGHT_WALKING,
  MAX_LIGHTS,
  PILE_CAP,
  PITCH_MAX,
  PITCH_SMOOTHING,
  PUSH,
  RAT_HEIGHT,
  RIDE_DEPTH,
  RISE,
  ROUND_DEPTH,
  ROUND_HOLD,
  ROUND_RATE,
  ROUND_SPREAD,
  RUN,
  RUN_IN,
  RUN_OUT,
  SEEN,
  SIDE_DRAW,
  SWITCH,
  Swarm,
  TOP,
  WALK,
  WALK_IN,
  WALK_OUT,
  WHIM,
  WHIM_DRAW,
  SIDESTEP,
  followLight,
  hardRadius,
  mostRadius,
  pcg,
  type Dark,
  type FixedLight,
  type Ground,
  type Light,
  type LightTrack,
  type Tuning,
} from './swarm'
import { STEP } from './swarm-remote'
import { ANGLES, LitAreas } from './litareas'
import { seenTexture } from './seen'
import { MAX_WALLS, WALL_THICKNESS, Walls } from './walls'
import { HELD, STRIDE, forgetBuffers, type GpuCull } from './gpucull'

/** The most steps a frame takes: past them the clock skips ahead, as the worker skips past a quarter second. */
export const MOST_STEPS = 4
/** Vectors a rat's motion takes: (vx, vz, sx, sz), (flinch, burn, whim, gait since), (side, gait, tolerance, timid). */
const MOTION = 3
/** The gait lists' buffer, in words, for `capacity` rats: two lists, then the rats at the holder, then at each lit light. */
const listsLength = (capacity: number) => 2 * (capacity + 1) + 1 + MAX_LIGHTS
/** The grid's most cells a side: past it the cells grow wider than the feel, which only adds candidates. */
const GRID_MAX = 512
const CELLS_MAX = GRID_MAX * GRID_MAX + 1
/** The scan's workgroup: a block of cells scanned at once. */
const BLOCK = 256
const BLOCKS_MAX = Math.ceil(CELLS_MAX / BLOCK)
/** The cells' buffers, whole blocks: the scan's last workgroup reads and writes a whole block, past the cells in use. */
const CELLS_ALLOC = BLOCKS_MAX * BLOCK
/** Blocks one thread of the scan of the blocks' sums adds up. */
const PER_THREAD = Math.ceil(BLOCKS_MAX / BLOCK)
const TAU = Math.PI * 2

/** What the GPU step needs of a renderer: WebGPURenderer, or a stand-in under test. */
export interface Device {
  compute(passes: ComputeNode | ComputeNode[]): unknown
  getArrayBufferAsync(attribute: StorageBufferAttribute, target: null, offset: number, count: number): Promise<ArrayBuffer>
}

/** The page's clock for the step: a fixed STEP a step, as many as are owed, MOST_STEPS a frame at most. */
export class StepClock {
  /** Seconds owed and not yet stepped, under a step once a frame's steps are taken: how far the rats stand past the latest state but one. */
  behind = 0

  /** The steps owed after `elapsed` more seconds; past MOST_STEPS the rest is dropped, all but the share of a step. Paused, none, and nothing owed for it. */
  advance(elapsed: number, paused: boolean): number {
    if (paused) return 0
    this.behind += elapsed
    // A hair over, so a sum of steps that rounds a hair short still owes them.
    let steps = Math.floor(this.behind / STEP + 1e-6)
    if (steps > MOST_STEPS) {
      steps = MOST_STEPS
      this.behind %= STEP
    } else {
      this.behind = Math.max(0, this.behind - steps * STEP)
    }
    return steps
  }

  /** How far from the latest state but one to the latest the rats stand now. */
  get alpha(): number {
    return Math.min(1, this.behind / STEP)
  }
}

/** PCG hash in 32-bit unsigned arithmetic, as swarm.ts's `pcg`. */
function pcgOf(v: Node<'uint'>): Node<'uint'> {
  const state = v.mul(uint(747796405)).add(uint(2891336453)).toVar()
  const word = state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state).mul(uint(277803737)).toVar()
  return word.shiftRight(uint(22)).bitXor(word)
}

/** A rat's chance, 0 to 1, from a step's key for one draw and the rat's index, as swarm.ts's `chance`, to 24 bits. */
const chanceOf = (key: Node<'uint'>, i: Node<'int'>) => float(pcgOf(key.bitXor(uint(i))).shiftRight(uint(8))).div(16777216)

const clamp01 = (v: Node<'float'>) => v.clamp(0, 1)

/** How far the flame reaches at `theta` round a light at `now`, as a share of its reach: swarm.ts's flame table, worked out where it is read. */
export const flickerAt = (theta: Node<'float'>, now: Node<'float'>) =>
  float(1).add(
    sin(theta.mul(3).add(now.mul(1.3)))
      .mul(0.5)
      .add(sin(theta.mul(5).sub(now.mul(2.1)).add(1)).mul(0.3))
      .add(sin(theta.mul(8).add(now.mul(3.7)).add(2)).mul(0.2))
      .mul(FLICKER),
  )

/** A loop from 0 to `end`, its counter named: three would call every counter `i`, and a nested loop's would clash. */
const counter = (end: Node<'int'>, name: string) => ({ start: int(0), end, type: 'int' as const, name })
/** A loop over the `lit` placed lights. */
const overLights = counter

/** The greater and the lesser of two integers: three's typings take only floats for `max` and `min`. */
const imax = (a: Node<'int'>, b: Node<'int'>): Node<'int'> => select(a.greaterThan(b), a, b)
const imin = (a: Node<'int'>, b: Node<'int'>): Node<'int'> => select(a.lessThan(b), a, b)

/** Half a wall's thickness, m. */
const HALF = WALL_THICKNESS / 2
/** Never, as a share of a move: no wall met. */
const NEVER = 1e30

/** A wall of the uniform array, worked out: where it starts, its length, and its way along. */
function wallOf(walls: { element(i: Node<'int'>): Node<'vec4'> }, k: Node<'int'>) {
  const w = walls.element(k).toVar()
  const dx = w.z.sub(w.x)
  const dz = w.w.sub(w.y)
  const length = max(sqrt(dx.mul(dx).add(dz.mul(dz))), 1e-6).toVar()
  return { ax: w.x, az: w.y, length, ux: dx.div(length).toVar(), uz: dz.div(length).toVar() }
}

/**
 * Slide a body moving from (ox, oz) to (px, pz) along the first `count`
 * walls of `walls`, `reach` m off each's middle line, as walls.ts's `move`
 * does: twice over every wall, each slid along the first of its face on the
 * body's side and its rounded ends the move meets; then back at (ox, oz)
 * should it still end inside a wall or across one. `px` and `pz` are
 * variables, moved in place.
 */
function slideOffWalls(
  walls: { element(i: Node<'int'>): Node<'vec4'> },
  count: Node<'int'>,
  ox: Node<'float'>,
  oz: Node<'float'>,
  px: Node<'float'>,
  pz: Node<'float'>,
  reach: Node<'float'>,
): void {
  for (const name of ['wallFirst', 'wallAgain']) {
    Loop(counter(count, name), (inputs) => {
      const k = (inputs as unknown as Record<string, Node<'int'>>)[name]!
      const { ax, az, length, ux, uz } = wallOf(walls, k)
      // Far from the wall, the move is none of its business: past half its length and a metre from its middle.
      const mx0 = px.sub(ax.add(ux.mul(length.mul(0.5))))
      const mz0 = pz.sub(az.add(uz.mul(length.mul(0.5))))
      If(sqrt(mx0.mul(mx0).add(mz0.mul(mz0))).lessThan(length.mul(0.5).add(reach).add(1)), () => {
        // Across the wall, + to its left; and along it.
        const nX = uz.negate().toVar()
        const nZ = ux
        const so = ox.sub(ax).mul(nX).add(oz.sub(az).mul(nZ)).toVar()
        const side = select(so.greaterThanEqual(0), float(1), float(-1)).toVar()
        const sn = px.sub(ax).mul(nX).add(pz.sub(az).mul(nZ)).toVar()
        const tn = px.sub(ax).mul(ux).add(pz.sub(az).mul(uz)).toVar()
        const sso = side.mul(so).toVar()
        const ssn = side.mul(sn).toVar()
        // Where along the move it meets the face, as a share of it; a body already a hair inside the face meets it where it starts.
        const meetFace = float(NEVER).toVar()
        If(ssn.lessThan(reach).and(ssn.lessThan(sso)), () => {
          const s = select(sso.greaterThan(reach), sso.sub(reach).div(sso.sub(ssn)), float(0)).toVar()
          const to = ox.sub(ax).mul(ux).add(oz.sub(az).mul(uz)).toVar()
          const at = to.add(tn.sub(to).mul(s)).toVar()
          If(at.greaterThanEqual(0).and(at.lessThanEqual(length)), () => {
            meetFace.assign(s)
          })
        })
        // Where along the move it meets either end, as a share of it: the nearer root of the circle round it.
        const meetEnd = float(NEVER).toVar()
        const end = float(0).toVar()
        const mx = px.sub(ox).toVar()
        const mz = pz.sub(oz).toVar()
        const mm = mx.mul(mx).add(mz.mul(mz)).toVar()
        for (const far of [false, true]) {
          const e = (far ? length : float(0)).toVar()
          const ex = ax.add(ux.mul(e)).toVar()
          const ez = az.add(uz.mul(e)).toVar()
          const fx = ox.sub(ex).toVar()
          const fz = oz.sub(ez).toVar()
          const c = fx.mul(fx).add(fz.mul(fz)).sub(reach.mul(reach)).toVar()
          If(c.lessThan(0), () => {
            // Already inside the end's circle, from a body set down there: out the way it already leans.
            const gx = px.sub(ex).toVar()
            const gz = pz.sub(ez).toVar()
            If(gx.mul(gx).add(gz.mul(gz)).lessThan(reach.mul(reach)).and(meetEnd.greaterThan(0)), () => {
              meetEnd.assign(0)
              end.assign(e)
            })
          }).ElseIf(mm.greaterThanEqual(1e-18), () => {
            const bb = fx.mul(mx).add(fz.mul(mz)).toVar()
            const disc = bb.mul(bb).sub(mm.mul(c)).toVar()
            If(disc.greaterThanEqual(0), () => {
              const s = bb.negate().sub(sqrt(disc)).div(mm).toVar()
              If(s.greaterThanEqual(0).and(s.lessThanEqual(1)).and(s.lessThan(meetEnd)), () => {
                meetEnd.assign(s)
                end.assign(e)
              })
            })
          })
        }
        If(meetFace.lessThanEqual(meetEnd).and(meetFace.lessThan(NEVER)), () => {
          // On the face, the rest of the move along it.
          const push = side.mul(reach).sub(sn).toVar()
          px.addAssign(push.mul(nX))
          pz.addAssign(push.mul(nZ))
        }).ElseIf(meetEnd.lessThan(NEVER), () => {
          // Round the end: out onto its circle from where the move would end.
          const ex = ax.add(ux.mul(end)).toVar()
          const ez = az.add(uz.mul(end)).toVar()
          const rx = px.sub(ex).toVar()
          const rz = pz.sub(ez).toVar()
          const d = sqrt(rx.mul(rx).add(rz.mul(rz))).toVar()
          If(d.lessThan(reach), () => {
            If(d.lessThan(1e-9), () => {
              rx.assign(ox.sub(ex))
              rz.assign(oz.sub(ez))
              d.assign(sqrt(rx.mul(rx).add(rz.mul(rz))))
              If(d.equal(0), () => {
                d.assign(1)
              })
            })
            px.assign(ex.add(rx.div(d).mul(reach)))
            pz.assign(ez.add(rz.div(d).mul(reach)))
          })
        })
      })
    })
  }
  // Still inside a wall's box, or across its middle line: the move is not made.
  const blocked = bool(false).toVar()
  Loop(counter(count, 'wallCheck'), (inputs) => {
    const k = (inputs as unknown as { wallCheck: Node<'int'> }).wallCheck
    const { ax, az, length, ux, uz } = wallOf(walls, k)
    const so = ox.sub(ax).mul(uz.negate()).add(oz.sub(az).mul(ux)).toVar()
    const sn = px.sub(ax).mul(uz.negate()).add(pz.sub(az).mul(ux)).toVar()
    const tn = px.sub(ax).mul(ux).add(pz.sub(az).mul(uz)).toVar()
    If(tn.greaterThanEqual(0).and(tn.lessThanEqual(length)).and(sn.abs().lessThan(HALF)), () => {
      blocked.assign(bool(true))
    }).ElseIf(select(so.lessThan(0), float(1), float(0)).notEqual(select(sn.lessThan(0), float(1), float(0))), () => {
      const to = ox.sub(ax).mul(ux).add(oz.sub(az).mul(uz)).toVar()
      const at = to.add(tn.sub(to).mul(so).div(so.sub(sn))).toVar()
      If(at.greaterThanEqual(0).and(at.lessThanEqual(length)), () => {
        blocked.assign(bool(true))
      })
    })
  })
  If(blocked, () => {
    px.assign(ox)
    pz.assign(oz)
  })
}

/** A workgroup's shared array of unsigned integers, read and written as a storage array is. */
type Shared = StorageBufferNode<'uint'>

export class GpuSwarm {
  /** Rats alive, and the arena's radius. */
  count: number
  arena: number
  /** What each rat's feet play, as last read back: a step or two late. */
  readonly gait: Uint8Array
  /** Counts up each time the rats are stood anew: a frame that finds it unchanged has nothing new to draw. */
  version = 0
  /** Counts up each step made: how often the rats really move. */
  steps = 0
  /** The page's time dispatching the last frame's steps, ms; and a step's GPU time, ms, when timestamps are on, NaN until then. */
  ms = 0
  gpuMs = Number.NaN
  /** The rats the steps found inside a light: not counted on the GPU. */
  readonly inside = 0
  /** The rats the last step read back found at the holder: a step or two late. */
  reached = 0
  /** The rats the last step read back found at each light's edge, in the order the lights were handed on: a step or two late. */
  atLights: readonly number[] = []
  /** The lit lights the level places, as the step reads them, (x, z, reach, how far off it can matter) each; and how many. */
  readonly lights = Array.from({ length: MAX_LIGHTS }, () => new Vector4())
  lit = 0
  /** Which of the lights handed on each lit one is, and how many were handed on; and the same as the last step read them. */
  private readonly litOf = new Int32Array(MAX_LIGHTS)
  private handed = 0
  private readonly steppedLitOf = new Int32Array(MAX_LIGHTS)
  private steppedLit = 0
  private steppedHanded = 0
  /** The lights as a uniform array: read anew by the first step of each frame. */
  private readonly lightsNode = uniformArray(this.lights, 'vec4') as unknown as { element(i: Node<'int'>): Node<'vec4'> }
  /** The level's walls, as the step reads them, (from x, from z, to x, to z) each, MAX_WALLS at most; and how many. */
  readonly walls = Array.from({ length: MAX_WALLS }, () => new Vector4())
  private readonly wallsNode = uniformArray(this.walls, 'vec4') as unknown as { element(i: Node<'int'>): Node<'vec4'> }
  /** How far apart the states are made, s: always a step. */
  readonly pace = STEP
  /** Whether the rats have been stood at all. */
  get ready(): boolean {
    return this.version > 0
  }

  /** The step's passes, from each of the pair's buffers into the other: the grid's, the rats', bring-round. */
  readonly passes: readonly [Passes, Passes]
  /** The pass that empties the list the steps are about to write. */
  readonly clearList: ComputeNode
  /** Each rat's motion, by the pair's buffer it goes with, rat `i` at `i × MOTION` vectors. */
  private readonly motion: readonly [StorageBufferAttribute, StorageBufferAttribute]
  /** The grid: rats a cell, then where each cell starts; each block's sum, then where it starts; each rat's cell and place in it; the rats in cell order. */
  private readonly cells = new StorageBufferAttribute(new Uint32Array(CELLS_ALLOC), 1)
  private readonly starts = new StorageBufferAttribute(new Uint32Array(CELLS_ALLOC), 1)
  private readonly sums = new StorageBufferAttribute(new Uint32Array(BLOCKS_MAX), 1)
  private readonly offsets = new StorageBufferAttribute(new Uint32Array(BLOCKS_MAX), 1)
  private readonly slots: StorageBufferAttribute
  private readonly sorted: StorageBufferAttribute
  /** Bring-round's tickets, taken by atomic add. */
  private readonly tickets = new StorageBufferAttribute(new Uint32Array(1), 1)
  /**
   * The gait lists, two in turn: a list's count, then its rats, each `rat × 4 + gait`.
   * The steps write one while the page reads the other back. And after both, at
   * `atHolder`, the rats the last step found at the holder, then at each lit
   * light's edge, in the step's order, counted by atomic add.
   */
  private readonly lists: StorageBufferAttribute
  /** Each rat's (list round it was last listed in, its place in that list), so a rat is listed once a round. */
  private readonly listed: StorageBufferAttribute
  /** What a step reads that is one number for the whole swarm. */
  private readonly u = {
    count: uniform(0, 'int'),
    arena: uniform(0),
    grid: uniform(1, 'int'),
    cellSize: uniform(1),
    blocks: uniform(1, 'int'),
    now: uniform(0),
    lightX: uniform(0),
    lightZ: uniform(0),
    inner: uniform(0),
    far: uniform(0),
    zone: uniform(0),
    reachAhead: uniform(0),
    lux: uniform(0),
    luz: uniform(0),
    r: uniform(0),
    gap: uniform(0),
    minSpeed: uniform(0),
    maxSpeed: uniform(0),
    turnRate: uniform(0),
    reaction: uniform(1),
    agitation: uniform(0),
    height: uniform(0),
    pileRamp: uniform(1),
    whimKey: uniform(0, 'uint'),
    flinchKey: uniform(0, 'uint'),
    sideKey: uniform(0, 'uint'),
    angleKey: uniform(0, 'uint'),
    depthKey: uniform(0, 'uint'),
    quota: uniform(0, 'uint'),
    roundFrom: uniform(0, 'int'),
    darkX: uniform(0),
    darkZ: uniform(0),
    darkRadius: uniform(0),
    walkX: uniform(0),
    walkZ: uniform(0),
    holderReach: uniform(0),
    lit: uniform(0, 'int'),
    walls: uniform(0, 'int'),
    notice: uniform(0),
    /** The level's box rats are brought round into, (min x, min z, max x, max z): the arena's square with none. */
    bounds: uniform(new Vector4(-1e30, -1e30, 1e30, 1e30)),
    round: uniform(0, 'uint'),
    clearAt: uniform(0, 'uint'),
  }
  /** The lit areas' texture the step reads. */
  private readonly seenTexture: Texture
  /** Spawns rats by the swarm's own rule; it is never stepped. */
  private readonly spawner: Swarm
  private readonly clock = new StepClock()
  private readonly seedKey: number
  /** Swarm time, s: a step's worth each step. The drawing leans the lights' flames at it, as the step does. */
  time = 0
  /** The buffer of the pair the latest state is in, and the rats each buffer holds; whether a step made the other. */
  private latest = 0
  private readonly holds = [0, 0]
  private stepped = false
  /** The light as the last frame left it, each step's light stood between it and this frame's. */
  private readonly lightWas: Light = { x: 0, z: 0, strength: 0, on: false }
  private readonly was: LightTrack = { x: 0, z: 0, vx: 0, vz: 0, fresh: true }
  private roundOwed = 0
  /** The list round: which list the steps write, by its parity. From one, so a rat's zero is never this round. */
  private round = 1
  private reading = false
  private readingHolder = false
  private lastFrame: number
  /** How the rats are stood: between the pair live, held all on the beat, or each on its own beat; and whether the hold is to be taken this frame. */
  private mode: 'live' | 'held' | 'staggered' = 'live'
  private holdNow = false
  private heldCount = 0
  private readonly holdAt = { beat: 0, share: 0 }
  /** The steps made and not yet timed, by their compute's timestamp uid. */
  private untimed: string[] = []

  constructor(
    /** The cull, whose state buffers the step writes. */
    private readonly cull: GpuCull,
    private readonly device: Device,
    readonly capacity: number,
    seed: number,
    count: number,
    arenaScale = 1,
    /** The page's clock, ms. */
    private readonly now: () => number = () => performance.now(),
    /** The level's walls, the box rats start in and the lights they start out of. */
    ground: Ground = { walls: [] },
    /**
     * The lit areas, as the page keeps them for the drawing too (litareas.ts):
     * a row of ANGLES distances for the torch, then one for each lit placed
     * light, in the step's order; the page works them out each frame before
     * it sends. None, and nothing is cut short by a wall.
     */
    seen?: Texture,
  ) {
    this.seenTexture = seen ?? seenTexture(new LitAreas(new Walls([]))).texture
    this.gait = new Uint8Array(capacity)
    this.motion = [
      new StorageBufferAttribute(new Float32Array(capacity * MOTION * 4), 4),
      new StorageBufferAttribute(new Float32Array(capacity * MOTION * 4), 4),
    ]
    this.slots = new StorageBufferAttribute(new Uint32Array(capacity * 2), 1)
    this.sorted = new StorageBufferAttribute(new Uint32Array(capacity), 1)
    this.lists = new StorageBufferAttribute(new Uint32Array(listsLength(capacity)), 1)
    this.listed = new StorageBufferAttribute(new Uint32Array(capacity * 2), 1)
    this.seedKey = pcg(seed >>> 0)
    this.spawner = new Swarm(capacity, seed, arenaScale, ground)
    this.spawner.reset(count)
    if (ground.walls.length > MAX_WALLS) throw new Error(`The GPU step reads ${MAX_WALLS} walls at most; the level has ${ground.walls.length}.`)
    if (ground.bounds !== undefined) this.u.bounds.value.set(ground.bounds.minX, ground.bounds.minZ, ground.bounds.maxX, ground.bounds.maxZ)
    ground.walls.forEach(({ from, to }, k) => this.walls[k]!.set(from.x, from.z, to.x, to.z))
    this.u.walls.value = Math.min(ground.walls.length, MAX_WALLS)
    this.count = count
    this.arena = this.spawner.arena
    this.spawned(0, count)
    this.lastFrame = now()
    this.passes = [this.build(0, 1), this.build(1, 0)]
    const lists = storage(this.lists, 'uint', listsLength(capacity)).toAtomic()
    this.clearList = Fn(() => {
      atomicStore(lists.element(this.u.clearAt), uint(0))
    })().compute(1)
  }

  /**
   * What the steps read, every frame, and the steps the clock owes, taken
   * now: the count, grown by spawning and shrunk by stepping fewer; the
   * light, each step's stood between the last frame's and this one's; the
   * tuning; what the page cannot see. Paused, nothing is stepped.
   */
  send(count: number, light: Light, tuning: Tuning, paused: boolean, dark?: Dark, lights: readonly FixedLight[] = []): void {
    const start = this.now()
    const elapsed = (start - this.lastFrame) / 1000
    this.lastFrame = start
    if (count !== this.count) this.setCount(count)
    this.placeLights(lights, tuning)
    const steps = this.clock.advance(elapsed, paused)
    const from = this.lightWas
    for (let s = 1; s <= steps; s++) {
      const k = s / steps
      this.step({ x: from.x + (light.x - from.x) * k, z: from.z + (light.z - from.z) * k, strength: light.strength, on: light.on }, tuning, dark)
    }
    Object.assign(this.lightWas, light)
    this.readGaits()
    this.readHolder()
    this.ms = this.now() - start
  }

  /** Stand the rats between the pair, live, from now: the rats move every frame. */
  sample(_now: number): void {
    this.version++
    this.mode = 'live'
  }

  /** Hold every rat where the pair has it now, until the next hold. */
  hold(_now: number): void {
    this.version++
    this.mode = 'held'
    this.holdNow = true
  }

  /** The staggered hold: each rat held from where the pair has it when its own beat turns, `fps` a second from `clock`. */
  sampleStaggered(_now: number, clock: number, fps: number): void {
    this.version++
    this.mode = 'staggered'
    this.holdNow = true
    const beats = clock * fps
    this.holdAt.beat = Math.floor(beats)
    this.holdAt.share = beats - Math.floor(beats)
  }

  /** Stand the rats for the cull, before it runs: between the pair, or held, taking the hold first where one is due. */
  stand(): void {
    const { blend, holding } = this.cull
    const cur = this.latest
    const prev = this.stepped ? 1 - cur : cur
    blend.prev.value = prev
    blend.cur.value = cur
    blend.alpha.value = this.stepped ? this.clock.alpha : 1
    blend.both.value = this.stepped ? Math.min(this.holds[prev]!, this.holds[cur]!) : 0
    blend.count.value = this.count
    if (this.mode === 'live') return
    if (this.holdNow) {
      const staggered = this.mode === 'staggered'
      holding.beat.value = staggered ? this.holdAt.beat : 0
      holding.share.value = staggered ? this.holdAt.share : 0
      holding.stagger.value = staggered ? 1 : 0
      holding.all.value = staggered ? 0 : 1
      this.device.compute(this.cull.holdPass as ComputeNode)
      this.heldCount = this.count
      this.holdNow = false
    }
    blend.prev.value = blend.cur.value = HELD
    blend.alpha.value = 1
    blend.both.value = 0
    // A count shrunk since the hold draws fewer: the rats past it have no playback rows any more.
    blend.count.value = Math.min(this.heldCount, this.count)
  }

  /** The steps made since the last call, timed: each one's GPU time, read once the compute timestamps have been resolved, averaged into `gpuMs`. */
  timeSteps(renderer: WebGPURenderer): void {
    const pool = (renderer.backend as unknown as { timestampQueryPool?: { compute?: { hasTimestampQuery(uid: string): boolean; getTimestamp(uid: string): number } } }).timestampQueryPool?.compute
    if (pool === undefined) return
    let sum = 0
    let timed = 0
    this.untimed = this.untimed.filter((uid) => {
      if (!pool.hasTimestampQuery(uid)) return true
      sum += pool.getTimestamp(uid)
      timed++
      return false
    })
    // A uid the pool never resolves is let go once a second's worth are waiting.
    if (this.untimed.length > 60 * MOST_STEPS) this.untimed = []
    if (timed > 0) this.gpuMs = Number.isNaN(this.gpuMs) ? sum / timed : this.gpuMs + (sum / timed - this.gpuMs) * 0.1
  }

  /** Free the GPU's copies of the step's buffers and its passes' pipelines. */
  dispose(renderer: WebGPURenderer): void {
    for (const passes of this.passes) for (const pass of passes.all) pass.dispose()
    this.clearList.dispose()
    forgetBuffers(renderer, [...this.motion, this.cells, this.starts, this.sums, this.offsets, this.slots, this.sorted, this.tickets, this.lists, this.listed])
  }

  /** The lit lights of `lights`, MAX_LIGHTS at most, as the step reads them: each with how far off it can matter, as the CPU step works it out. */
  private placeLights(lights: readonly FixedLight[], tuning: Tuning): void {
    const margin = 2 * tuning.gap + Math.max(tuning.gap, tuning.ratRadius)
    let lit = 0
    for (const [index, light] of lights.entries()) {
      if (lit === MAX_LIGHTS) break
      if (!light.on || !(light.reach > 0)) continue
      this.litOf[lit] = index
      this.lights[lit++]!.set(light.x, light.z, light.reach, light.reach * (1 + FLICKER) + margin)
    }
    this.lit = lit
    this.handed = lights.length
    this.u.lit.value = lit
  }

  /** Grow or shrink to `count`: newcomers spawned at the arena's edge by the swarm's rule, and uploaded. */
  private setCount(count: number): void {
    const was = this.spawner.count
    this.spawner.setCount(count)
    this.count = count
    this.arena = this.spawner.arena
    if (count > was) this.spawned(was, count)
  }

  /**
   * Put the spawner's rats from `from` to `to` into the latest state, and
   * into the held places for a hold to come, and upload those alone: each
   * idle, its beat none yet.
   */
  private spawned(from: number, to: number): void {
    const k = this.latest
    const state = this.cull.states[k]!
    const held = this.cull.states[HELD]!
    const motion = this.motion[k]!
    const s = state.array as Float32Array
    const h = held.array as Float32Array
    const m = motion.array as Float32Array
    const sp = this.spawner
    for (let i = from; i < to; i++) {
      const o = i * STRIDE
      s[o] = h[o] = sp.x[i]!
      s[o + 1] = h[o + 1] = 0
      s[o + 2] = h[o + 2] = sp.z[i]!
      s[o + 3] = h[o + 3] = sp.heading[i]!
      s[o + 4] = h[o + 4] = 0
      s[o + 5] = h[o + 5] = sp.places[i]!
      s[o + 6] = h[o + 6] = 0
      s[o + 7] = 0
      h[o + 7] = -1
      const q = i * MOTION * 4
      m.fill(0, q, q + 6)
      m[q + 6] = sp.whim[i]!
      m[q + 7] = this.time
      m[q + 8] = 0
      m[q + 9] = IDLE
      m[q + 10] = sp.tolerance[i]!
      m[q + 11] = sp.timid[i]!
      this.gait[i] = IDLE
    }
    for (const [buffer, stride] of [[state, STRIDE], [held, STRIDE], [motion, MOTION * 4]] as const) {
      buffer.addUpdateRange(from * stride, (to - from) * stride)
      buffer.needsUpdate = true
    }
    this.holds[k] = to
  }

  /** One step of STEP under `light`: the grid, the rats, and bring-round where it is owed; from the latest state into the other of the pair. */
  private step(light: Light, tuning: Tuning, dark?: Dark): void {
    const count = this.count
    if (count === 0) return
    this.time += STEP
    this.steps++
    const u = this.u
    const stepKey = pcg((this.seedKey ^ this.steps) >>> 0)
    u.whimKey.value = pcg(stepKey + WHIM_DRAW)
    u.flinchKey.value = pcg(stepKey + FLINCH_DRAW)
    u.sideKey.value = pcg(stepKey + SIDE_DRAW)
    u.angleKey.value = pcg(stepKey + ANGLE_DRAW)
    u.depthKey.value = pcg(stepKey + DEPTH_DRAW)
    const { stepVx, stepVz, stepV, reachAhead, lux, luz } = followLight(this.was, light, STEP, tuning.lookAhead)
    const r = tuning.ratRadius
    const inner = hardRadius(light, tuning)
    const zone = Math.max(tuning.gap, r)
    u.count.value = count
    u.arena.value = this.arena
    u.now.value = this.time
    u.lightX.value = light.x
    u.lightZ.value = light.z
    u.inner.value = inner
    u.zone.value = zone
    u.far.value = mostRadius(light, tuning) + 2 * tuning.gap + zone
    u.reachAhead.value = reachAhead
    u.lux.value = lux
    u.luz.value = luz
    u.r.value = r
    u.gap.value = tuning.gap
    u.minSpeed.value = tuning.minSpeed
    u.maxSpeed.value = tuning.maxSpeed
    u.turnRate.value = tuning.turnRate
    u.reaction.value = tuning.reaction
    u.agitation.value = tuning.agitation
    u.height.value = RAT_HEIGHT * r * tuning.pile
    u.pileRamp.value = tuning.pileRamp
    u.holderReach.value = tuning.holderReach
    // Never an infinity: WGSL may take a uniform to hold none.
    u.notice.value = Math.min(tuning.notice, 1e30)
    u.round.value = this.round
    // The grid, a feel's width a cell, as the CPU's; but never more than GRID_MAX a side.
    const feel = 2 * r * FEEL
    const cellSize = Math.max(feel, (2 * this.arena) / (GRID_MAX - 4))
    const n = Math.ceil((2 * this.arena) / cellSize) + 3
    const cells = n * n + 1
    u.grid.value = n
    u.cellSize.value = cellSize
    u.blocks.value = Math.ceil(cells / BLOCK)
    // Bring-round as the CPU owes it: a share of the swarm a second, a little of it kept, spent only on a step the light walked.
    let quota = 0
    if (dark !== undefined && light.on) {
      this.roundOwed = Math.min(this.roundOwed + count * ROUND_RATE * STEP, count * ROUND_RATE * ROUND_HOLD + 1)
      if (stepV > LIGHT_WALKING) {
        quota = Math.floor(this.roundOwed)
        this.roundOwed -= quota
        u.darkX.value = dark.x
        u.darkZ.value = dark.z
        u.darkRadius.value = dark.radius
        u.walkX.value = stepVx / stepV
        u.walkZ.value = stepVz / stepV
        // Where the tickets start round the swarm: a new place each step, so no run of rats is always first, where the CPU takes up its search where it left off.
        u.roundFrom.value = stepKey % count
      }
    }
    u.quota.value = quota
    const passes = this.passes[this.latest]!
    for (const pass of passes.rats) pass.count = count
    for (const pass of passes.cells) pass.count = cells
    const run = quota > 0 ? passes.all : passes.unround
    this.device.compute(run)
    const uid = (this.device as { backend?: { getTimestampUID?(passes: unknown): string | undefined } }).backend?.getTimestampUID?.(run)
    if (uid !== undefined) this.untimed.push(uid)
    this.latest = 1 - this.latest
    this.holds[this.latest] = count
    this.stepped = true
    this.steppedLitOf.set(this.litOf)
    this.steppedLit = this.lit
    this.steppedHanded = this.handed
  }

  /**
   * Read back the list the steps wrote since the last read, one read at a
   * time, never awaited on the frame: the steps go on into the other list,
   * cleared first. Each rat listed takes the gait it was listed with.
   */
  private readGaits(): void {
    if (this.reading || !this.stepped) return
    const reading = this.round & 1
    const next = 1 - reading
    this.u.clearAt.value = next * (this.capacity + 1)
    this.device.compute(this.clearList)
    this.round++
    this.reading = true
    this.device
      .getArrayBufferAsync(this.lists, null, reading * (this.capacity + 1) * 4, (this.capacity + 1) * 4)
      .then((buffer) => {
        const list = new Uint32Array(buffer)
        const listed = Math.min(list[0]!, this.capacity)
        for (let e = 1; e <= listed; e++) {
          const entry = list[e]!
          this.gait[entry >>> 2] = entry & 3
        }
      })
      .catch(() => {})
      .finally(() => {
        this.reading = false
      })
  }

  /** Where in the lists' buffer the rats at the holder are counted. */
  private get atHolder(): number {
    return 2 * (this.capacity + 1)
  }

  /**
   * Read back how many rats the last step found at the holder and at each lit
   * light's edge, one read at a time, never awaited on the frame. The counts
   * are the last step's, made with the lights as that step read them, which a
   * frame that takes no step may since have changed: each is handed on as the
   * light it was counted at, whatever is lit by the time it comes back.
   */
  private readHolder(): void {
    if (this.readingHolder || !this.stepped) return
    this.readingHolder = true
    const litOf = this.steppedLitOf.slice(0, this.steppedLit)
    const handed = this.steppedHanded
    this.device
      .getArrayBufferAsync(this.lists, null, this.atHolder * 4, (1 + MAX_LIGHTS) * 4)
      .then((buffer) => {
        const counts = new Uint32Array(buffer)
        this.reached = counts[0]!
        const atLights = new Array<number>(handed).fill(0)
        litOf.forEach((index, k) => (atLights[index] = counts[1 + k]!))
        this.atLights = atLights
      })
      .catch(() => {})
      .finally(() => {
        this.readingHolder = false
      })
  }

  /** How far row `row`'s light sees toward (dx, dz), m: the nearer of the two directions either side, as litareas.ts reads it. */
  private readonly seenAt = (row: Node<'int'>, dx: Node<'float'>, dz: Node<'float'>): Node<'float'> => {
    const fb = atan(dz, dx).add(Math.PI).div(TAU).mul(ANGLES)
    const b0 = imin(int(fb), int(ANGLES - 1)).toVar()
    const b1 = select(b0.equal(int(ANGLES - 1)), int(0), b0.add(1))
    return min(textureLoad(this.seenTexture, ivec2(b0, row)).x, textureLoad(this.seenTexture, ivec2(b1, row)).x)
  }

  /**
   * Whether (x, z) is in a lit area this step: the torch's, `torchInner` its
   * hard radius, 0 where the rat is in a wall's shadow from it; or a placed
   * light's. Inside the flame's reach that way, and within what the light sees.
   */
  private litAt(x: Node<'float'>, z: Node<'float'>, torchInner: Node<'float'>): Node<'bool'> {
    const u = this.u
    const lit = bool(false).toVar()
    If(torchInner.greaterThan(0), () => {
      const dx = x.sub(u.lightX).toVar()
      const dz = z.sub(u.lightZ).toVar()
      const d = sqrt(dx.mul(dx).add(dz.mul(dz))).toVar()
      If(d.lessThan(u.far).and(d.lessThan(min(u.inner.mul(flickerAt(atan(dz, dx), u.now)), this.seenAt(int(0), dx, dz)))), () => {
        lit.assign(bool(true))
      })
    })
    Loop(overLights(u.lit, 'p'), (inputs) => {
      const k = (inputs as unknown as { p: Node<'int'> }).p
      const l = this.lightsNode.element(k).toVar()
      const dx = x.sub(l.x).toVar()
      const dz = z.sub(l.y).toVar()
      const d2 = dx.mul(dx).add(dz.mul(dz)).toVar()
      If(d2.lessThan(l.w.mul(l.w)), () => {
        If(sqrt(d2).lessThan(min(l.z.mul(flickerAt(atan(dz, dx), u.now)), this.seenAt(k.add(1), dx, dz))), () => {
          lit.assign(bool(true))
        })
      })
    })
    return lit
  }

  /** The passes of a step that reads buffer `src` of the pair and writes `dst`. */
  private build(src: number, dst: number): Passes {
    const cap = this.capacity
    const u = this.u
    const stateIn = storage(this.cull.states[src]!, 'vec4', cap * 2).toReadOnly()
    const motionIn = storage(this.motion[src]!, 'vec4', cap * MOTION).toReadOnly()
    const stateOut = () => storage(this.cull.states[dst]!, 'vec4', cap * 2)
    const motionOut = () => storage(this.motion[dst]!, 'vec4', cap * MOTION)
    const lists = () => storage(this.lists, 'uint', listsLength(cap)).toAtomic()
    const listed = () => storage(this.listed, 'uint', cap * 2)

    /** Rat `i`'s gait is now `gait`: into this round's list, once a round, its entry rewritten if listed already. */
    const report = (lists: StorageBufferNode<'uint'>, listed: StorageBufferNode<'uint'>, i: Node<'int'>, gait: Node<'float'>) => {
      const base = u.round.bitAnd(uint(1)).mul(uint(cap + 1)).toVar()
      If(listed.element(i.mul(2)).notEqual(u.round), () => {
        listed.element(i.mul(2)).assign(u.round)
        listed.element(i.mul(2).add(1)).assign(atomicAdd(lists.element(base), uint(1)) as never)
      })
      atomicStore(lists.element(base.add(1).add(listed.element(i.mul(2).add(1)))), uint(i).mul(4).add(uint(gait)))
    }

    /** The cell the point (x, z) is in, clamped into the grid. */
    const cellOf = (x: Node<'float'>, z: Node<'float'>) => {
      const off = u.arena.add(u.cellSize)
      const top = u.grid.sub(1)
      const cx = imin(imax(int(x.add(off).div(u.cellSize)), int(0)), top)
      const cz = imin(imax(int(z.add(off).div(u.cellSize)), int(0)), top)
      return cz.mul(u.grid).add(cx)
    }

    // The grid: the cells emptied, and the tickets.
    const clearCells = Fn(() => {
      const c = int(instanceIndex)
      storage(this.cells, 'uint', CELLS_ALLOC).element(c).assign(uint(0))
      If(c.equal(0), () => {
        storage(this.tickets, 'uint', 1).element(0).assign(uint(0))
      })
      If(c.lessThan(1 + MAX_LIGHTS), () => {
        atomicStore(lists().element(c.add(this.atHolder)), uint(0))
      })
    })().compute(CELLS_ALLOC, [BLOCK])

    // Every rat counted into its cell, keeping its place there.
    const countCells = Fn(() => {
      const i = int(instanceIndex)
      const p = stateIn.element(i.mul(2)).toVar()
      const c = cellOf(p.x, p.z).toVar()
      const cellCounts = storage(this.cells, 'uint', CELLS_ALLOC).toAtomic()
      const slots = storage(this.slots, 'uint', cap * 2)
      slots.element(i.mul(2)).assign(uint(c))
      slots.element(i.mul(2).add(1)).assign(atomicAdd(cellCounts.element(c), uint(1)) as never)
    })().compute(cap)

    /** Scan the workgroup's `shared` values in place, each the sum of its own and those before it. */
    const scanShared = (shared: Shared, l: Node<'uint'>) => {
      for (let off = 1; off < BLOCK; off *= 2) {
        workgroupBarrier()
        const before = uint(0).toVar()
        If(l.greaterThanEqual(uint(off)), () => {
          before.assign(shared.element(l.sub(uint(off))))
        })
        workgroupBarrier()
        shared.element(l).addAssign(before)
      }
      workgroupBarrier()
    }

    // Where each cell starts within its block, and each block's sum.
    const scanBlocks = Fn(() => {
      const shared = workgroupArray('uint', BLOCK) as unknown as Shared
      const g = int(instanceIndex)
      const l = uint(invocationLocalIndex).toVar()
      const counts = storage(this.cells, 'uint', CELLS_ALLOC).toReadOnly()
      const v = counts.element(g).toVar()
      shared.element(l).assign(v)
      scanShared(shared, l)
      storage(this.starts, 'uint', CELLS_ALLOC).element(g).assign(shared.element(l).sub(v))
      If(l.equal(uint(BLOCK - 1)), () => {
        storage(this.sums, 'uint', BLOCKS_MAX).element(workgroupId.x).assign(shared.element(l))
      })
    })().compute(CELLS_ALLOC, [BLOCK])

    // Where each block starts: one workgroup, each thread adding up a run of blocks.
    const scanSums = Fn(() => {
      const shared = workgroupArray('uint', BLOCK) as unknown as Shared
      const l = uint(invocationLocalIndex).toVar()
      const sums = storage(this.sums, 'uint', BLOCKS_MAX).toReadOnly()
      const offsets = storage(this.offsets, 'uint', BLOCKS_MAX)
      const first = int(l).mul(PER_THREAD).toVar()
      const total = uint(0).toVar()
      for (let k = 0; k < PER_THREAD; k++) {
        If(first.add(k).lessThan(u.blocks), () => {
          total.addAssign(sums.element(first.add(k)))
        })
      }
      shared.element(l).assign(total)
      scanShared(shared, l)
      const run = shared.element(l).sub(total).toVar()
      for (let k = 0; k < PER_THREAD; k++) {
        If(first.add(k).lessThan(u.blocks), () => {
          offsets.element(first.add(k)).assign(run)
          run.addAssign(sums.element(first.add(k)))
        })
      }
    })().compute(BLOCK, [BLOCK])

    // Each cell's start, its block's added.
    const addOffsets = Fn(() => {
      const c = int(instanceIndex)
      const offsets = storage(this.offsets, 'uint', BLOCKS_MAX).toReadOnly()
      storage(this.starts, 'uint', CELLS_ALLOC).element(c).addAssign(offsets.element(c.div(BLOCK)))
    })().compute(CELLS_ALLOC, [BLOCK])

    // Every rat into its place in cell order.
    const scatter = Fn(() => {
      const i = int(instanceIndex)
      const slots = storage(this.slots, 'uint', cap * 2).toReadOnly()
      const starts = storage(this.starts, 'uint', CELLS_ALLOC).toReadOnly()
      const at = starts.element(slots.element(i.mul(2))).add(slots.element(i.mul(2).add(1)))
      storage(this.sorted, 'uint', cap).element(at).assign(uint(i))
    })().compute(cap)

    // One node for the lists, the gaits' and the count at the holder: each node a binding, and the step's kernel binds all WebGPU allows.
    const ratLists = lists()
    const stepRats = this.stepRats(stateIn, motionIn, stateOut(), motionOut(), cellOf, ratLists, (i, gait) => report(ratLists, listed(), i, gait))
    const bringRound = this.bringRound(stateOut(), motionOut(), (i, gait) => report(lists(), listed(), i, gait))

    return {
      all: [clearCells, countCells, scanBlocks, scanSums, addOffsets, scatter, stepRats, bringRound],
      unround: [clearCells, countCells, scanBlocks, scanSums, addOffsets, scatter, stepRats],
      rats: [countCells, scatter, stepRats, bringRound],
      cells: [clearCells, scanBlocks, addOffsets],
    }
  }

  /** The step of every rat: the CPU step's rules, rat by rat, from the last state into the next. */
  private stepRats(
    stateIn: StorageBufferNode<'vec4'>,
    motionIn: StorageBufferNode<'vec4'>,
    stateOut: StorageBufferNode<'vec4'>,
    motionOut: StorageBufferNode<'vec4'>,
    cellOf: (x: Node<'float'>, z: Node<'float'>) => Node<'int'>,
    lists: StorageBufferNode<'uint'>,
    report: (i: Node<'int'>, gait: Node<'float'>) => void,
  ): ComputeNode {
    const u = this.u
    const cap = this.capacity
    const dt = float(STEP)
    const seenAt = this.seenAt
    return Fn(() => {
      const i = int(instanceIndex).toVar()
      const a = stateIn.element(i.mul(2)).toVar()
      const b = stateIn.element(i.mul(2).add(1)).toVar()
      const m0 = motionIn.element(i.mul(MOTION)).toVar()
      const m1 = motionIn.element(i.mul(MOTION).add(1)).toVar()
      const m2 = motionIn.element(i.mul(MOTION).add(2)).toVar()
      const x = a.x
      const z = a.z
      const place = b.y
      const vx = m0.x
      const vz = m0.y
      const tolerance = m2.z
      const timid = m2.w
      const v0 = u.minSpeed.add(u.maxSpeed.sub(u.minSpeed).mul(place)).toVar()
      const r = u.r
      const touch = r.mul(2).toVar()
      const feel = touch.mul(FEEL).toVar()
      // The way it goes, for the pile: where it really runs, or toward the holder when it hardly moves.
      const mv = sqrt(vx.mul(vx).add(vz.mul(vz))).toVar()
      const mount = float(0).toVar()

      // Toward the holder: what it wants; and its left, facing the holder.
      const hx = u.lightX.sub(x)
      const hz = u.lightZ.sub(z)
      const H = max(sqrt(hx.mul(hx).add(hz.mul(hz))), 1e-6).toVar()
      const ix = hx.div(H).toVar()
      const iz = hz.div(H).toVar()
      const lx = iz.negate()
      const lz = ix
      const moving = mv.greaterThan(WALK_OUT)
      const gx = select(moving, vx.div(mv), ix).toVar()
      const gz = select(moving, vz.div(mv), iz).toVar()

      // The light as it stands and as it is about to: the nearest point on its walk ahead.
      const along = x.sub(u.lightX).mul(u.lux).add(z.sub(u.lightZ).mul(u.luz)).clamp(0, u.reachAhead).toVar()
      const qx = u.lightX.add(u.lux.mul(along))
      const qz = u.lightZ.add(u.luz.mul(along))
      const ox0 = x.sub(qx)
      const oz0 = z.sub(qz)
      const Q = max(sqrt(ox0.mul(ox0).add(oz0.mul(oz0))), 1e-6).toVar()
      const ox = ox0.div(Q).toVar()
      const oz = oz0.div(Q).toVar()
      // How far the torch sees this way, against the walls: past it, the rat is in a wall's shadow, and the torch does not hold it.
      const near = u.inner.greaterThan(0).and(H.lessThan(u.far))
      const sees = select(near, seenAt(int(0), hx.negate(), hz.negate()), float(1e30)).toVar()
      const torchInner = select(sees.lessThan(H), float(0), u.inner).toVar()
      // How far the flame burns this way, now: its flicker at this rat's own angle round the light, as far as the torch sees.
      const flames = select(Q.lessThan(u.far), u.inner.mul(flickerAt(atan(oz, ox), u.now)), u.inner).toVar()
      const burns = min(flames, sees).toVar()
      // Caught in the light as it stands: inside the flame's reach at its angle round the holder, and in the torch's sight.
      const flameAtHolder = select(along.greaterThan(0), u.inner.mul(flickerAt(atan(hz.negate(), hx.negate()), u.now)), burns)
      const caughtIn = torchInner.greaterThan(0).and(H.lessThan(u.far)).and(H.lessThan(min(flameAtHolder, sees))).toVar()
      If(H.lessThan(u.holderReach), () => {
        atomicAdd(lists.element(this.atHolder), uint(1))
      })

      // The light that holds it: the one whose edge it is nearest, or deepest inside; the torch, unless a placed
      // light's is nearer. Every light works the same way, but for the torch's walk ahead: a placed light stays put.
      // A light the rat is in a wall's shadow from does not hold it at all.
      const lights = this.lightsNode
      const holdInner = torchInner.toVar()
      const holdBurns = burns.toVar()
      const holdQ = Q.toVar()
      const holdX = ox.toVar()
      const holdZ = oz.toVar()
      const holdAlong = along.toVar()
      // Which row of the lit areas the holding light is, and whether a wall cuts its light short this way.
      const holdRow = int(0).toVar()
      const holdCut = sees.lessThan(flames).toVar()
      const margin = select(torchInner.greaterThan(0), Q.sub(burns), float(1e30)).toVar()
      Loop(overLights(u.lit, 'k'), (inputs) => {
        const k = (inputs as unknown as { k: Node<'int'> }).k
        const l = lights.element(k).toVar()
        const dx = x.sub(l.x).toVar()
        const dz = z.sub(l.y).toVar()
        const d2 = dx.mul(dx).add(dz.mul(dz)).toVar()
        If(d2.lessThan(l.w.mul(l.w)), () => {
          const d = max(sqrt(d2), 1e-6).toVar()
          const seen = seenAt(k.add(1), dx, dz).toVar()
          If(seen.greaterThanEqual(d), () => {
            const flamesK = l.z.mul(flickerAt(atan(dz, dx), u.now)).toVar()
            const b = min(flamesK, seen).toVar()
            If(d.lessThan(b.add(u.holderReach)), () => {
              atomicAdd(lists.element(k.add(this.atHolder + 1)), uint(1))
            })
            If(d.lessThan(b), () => {
              caughtIn.assign(true)
            })
            If(d.sub(b).lessThan(margin), () => {
              margin.assign(d.sub(b))
              holdInner.assign(l.z)
              holdBurns.assign(b)
              holdQ.assign(d)
              holdX.assign(dx.div(d))
              holdZ.assign(dz.div(d))
              holdAlong.assign(0)
              holdRow.assign(k.add(1))
              holdCut.assign(seen.lessThan(flamesK))
            })
          })
        })
      })

      // The bodies round it: how crowded it is ahead, to its left and to its right; and their push.
      const ahead = float(0).toVar()
      const left = float(0).toVar()
      const right = float(0).toVar()
      const ax = float(0).toVar()
      const az = float(0).toVar()
      const scared = float(0).toVar()
      const pushOf = float(PUSH).div(touch).toVar()
      const height = u.height
      const c = cellOf(x, z).toVar()
      const cx = c.mod(u.grid).toVar()
      const cz = c.div(u.grid).toVar()
      const starts = storage(this.starts, 'uint', CELLS_ALLOC).toReadOnly()
      const sorted = storage(this.sorted, 'uint', cap).toReadOnly()
      // A row of the three cells about it is one run of the rats in cell order.
      const first = imax(cx.sub(1), int(0)).toVar()
      const last = imin(cx.add(1), u.grid.sub(1)).toVar()
      // Each loop's counter named, and its run's ends held in variables: three would call both counters `i`,
      // and the inner bound would read the inner one. A named counter comes in under its name.
      const rows = { start: imax(cz.sub(1), int(0)), end: imin(cz.add(1), u.grid.sub(1)), condition: '<=', type: 'int' as const, name: 'row' }
      Loop(rows, (inputs) => {
        const row = (inputs as unknown as { row: Node<'int'> }).row
        const from = int(starts.element(row.mul(u.grid).add(first))).toVar()
        const to = int(starts.element(row.mul(u.grid).add(last).add(1))).toVar()
        const run = { start: from, end: to, type: 'int' as const, name: 'q' }
        Loop(run, (inputs) => {
          const q = (inputs as unknown as { q: Node<'int'> }).q
          const j = int(sorted.element(q)).toVar()
          const pj = stateIn.element(j.mul(2)).toVar()
          const ex = pj.x.sub(x).toVar()
          const ez = pj.z.sub(z).toVar()
          const d2 = ex.mul(ex).add(ez.mul(ez)).toVar()
          If(j.notEqual(i).and(d2.lessThan(feel.mul(feel))).and(d2.greaterThanEqual(1e-12)), () => {
            const d = sqrt(d2).toVar()
            const inv = float(1).div(d).toVar()
            // 1 touching or closer, 0 at the edge of feeling.
            const w = select(d.lessThanEqual(touch), float(1), feel.sub(d).div(feel.sub(touch))).toVar()
            const fwd = ex.mul(ix).add(ez.mul(iz)).mul(inv)
            const lat = ex.mul(lx).add(ez.mul(lz)).mul(inv).toVar()
            ahead.addAssign(select(fwd.greaterThan(0.5), w, float(0)))
            left.addAssign(select(lat.greaterThan(0.3), w, float(0)))
            right.addAssign(select(lat.lessThan(-0.3), w, float(0)))
            If(d.lessThan(touch), () => {
              const mj1 = motionIn.element(j.mul(MOTION).add(1))
              If(mj1.x.greaterThan(FLINCH * 0.5), () => {
                scared.assign(1)
              })
              const f = pushOf.mul(touch.sub(d)).mul(inv).toVar()
              ax.subAssign(ex.mul(f))
              az.subAssign(ez.mul(f))
              const into = touch.sub(d).div(touch).toVar()
              // The pile: it rides a body it presses into that is ahead of its own way and not pressing back
              // into it, as deep as it is into it, from where that body rides. Two head on ride neither.
              If(height.greaterThan(0).and(ex.mul(gx).add(ez.mul(gz)).mul(inv).greaterThan(0.5)), () => {
                const mj0 = motionIn.element(j.mul(MOTION)).toVar()
                const jv = sqrt(mj0.x.mul(mj0.x).add(mj0.y.mul(mj0.y))).toVar()
                const tx = u.lightX.sub(pj.x)
                const tz = u.lightZ.sub(pj.z)
                const tl = max(sqrt(tx.mul(tx).add(tz.mul(tz))), 1e-6)
                const jRuns = jv.greaterThan(WALK_OUT)
                const jwx = select(jRuns, mj0.x.div(jv), tx.div(tl))
                const jwz = select(jRuns, mj0.y.div(jv), tz.div(tl))
                If(ex.mul(jwx).add(ez.mul(jwz)).mul(inv).negate().lessThanEqual(0.5), () => {
                  mount.assign(max(mount, pj.y.add(into.div(RIDE_DEPTH).mul(height))))
                })
              })
            })
          })
        })
      })

      // What it wants to do, as a velocity.
      const lit = holdInner.greaterThan(0)
      const edge = select(lit, clamp01(holdBurns.add(u.gap.mul(2).mul(timid)).add(u.zone).sub(holdQ).div(u.zone)), float(0)).toVar()
      // The pile is flat at a rat's own hold at the light and rises in a straight line from there, over `pileRamp` gaps.
      If(lit, () => {
        mount.mulAssign(clamp01(holdQ.sub(holdBurns).sub(u.gap.mul(timid.add(1))).div(u.pileRamp.mul(u.gap))))
      })
      const drop = float(FALL).toVar()
      const whim = m1.z.add(chanceOf(u.whimKey, i).mul(2).sub(1).mul(WHIM).mul(dt)).toVar()
      // At the edge it burns; away from it, it gets over it. Stood too long, it flinches.
      const burn = select(edge.greaterThan(0), m1.y.add(edge.mul(dt)), max(m1.y.sub(dt), 0)).toVar()
      const flinch = m1.x.toVar()
      If(flinch.lessThanEqual(0).and(burn.greaterThan(tolerance).or(scared.greaterThan(0.5).and(burn.greaterThan(tolerance.mul(0.5))))), () => {
        flinch.assign(chanceOf(u.flinchKey, i).mul(0.5).add(0.75).mul(FLINCH))
        burn.assign(0)
      })
      const side = m2.x.toVar()
      const wx = float(0).toVar()
      const wz = float(0).toVar()
      const faceX = float(0).toVar()
      const faceZ = float(0).toVar()
      const free = float(0).toVar()
      const caught = lit.and(holdQ.lessThan(holdBurns)).or(flinch.greaterThan(0)).or(holdAlong.greaterThan(0).and(edge.greaterThan(0)))
      If(caught, () => {
        // Caught in the light, flinching from it, or in the way of it coming: it turns and runs, away
        // the shortest way, through whatever is behind. And straight down: a rat running from the light never rides.
        mount.assign(0)
        drop.assign(FALL_FLEE)
        flinch.subAssign(dt)
        // Caught between the light and a wall, away is into the wall: it runs along the wall instead, the way the light sees further, out past the wall's end.
        const fx = holdX.toVar()
        const fz = holdZ.toVar()
        If(holdCut.and(holdQ.lessThan(holdBurns)), () => {
          const tx = holdZ.negate().mul(SIDESTEP)
          const tz = holdX.mul(SIDESTEP)
          const s = select(seenAt(holdRow, holdX.add(tx), holdZ.add(tz)).greaterThanEqual(seenAt(holdRow, holdX.sub(tx), holdZ.sub(tz))), float(1), float(-1))
          fx.assign(holdZ.negate().mul(s))
          fz.assign(holdX.mul(s))
        })
        wx.assign(fx.mul(v0).add(cos(whim).mul(u.agitation)))
        wz.assign(fz.mul(v0).add(sin(whim).mul(u.agitation)))
        faceX.assign(fx)
        faceZ.assign(fz)
        side.assign(0)
      })
        .ElseIf(H.greaterThan(u.notice), () => {
          // Too far off to notice the holder: it seethes where it is, at its whim, kept off a light's edge as any rat is.
          faceX.assign(ix)
          faceZ.assign(iz)
          free.assign(select(edge.greaterThan(0), float(0), float(1)))
          side.assign(0)
          wx.assign(holdX.mul(edge).mul(v0).add(cos(whim).mul(u.agitation)))
          wz.assign(holdZ.mul(edge).mul(v0).add(sin(whim).mul(u.agitation)))
        })
        .Else(() => {
        faceX.assign(ix)
        faceZ.assign(iz)
        free.assign(select(edge.greaterThan(0), float(0), float(1)))
        // At the light's edge, or behind bodies, it is blocked; the light also warns it off.
        const blocked = min(max(ahead, edge), 1).toVar()
        If(blocked.lessThan(0.1), () => {
          side.assign(0)
        })
          .ElseIf(side.equal(0), () => {
            const tie = select(chanceOf(u.sideKey, i).lessThan(0.5), float(1), float(-1))
            side.assign(select(left.lessThan(right), float(1), select(right.lessThan(left), float(-1), tie)))
          })
          .ElseIf(select(side.greaterThan(0), left, right).greaterThan(select(side.greaterThan(0), right, left).add(SWITCH)), () => {
            side.assign(side.negate())
          })
        const sideBlocked = clamp01(select(side.greaterThan(0), left, right))
        const slide = blocked.mul(float(1).sub(sideBlocked)).toVar()
        const want = blocked.oneMinus()
        const dx = ix.mul(want).add(lx.mul(side).mul(slide)).add(holdX.mul(edge)).toVar()
        const dz = iz.mul(want).add(lz.mul(side).mul(slide)).add(holdZ.mul(edge)).toVar()
        const wl = sqrt(dx.mul(dx).add(dz.mul(dz))).toVar()
        If(wl.greaterThan(1), () => {
          dx.divAssign(wl)
          dz.divAssign(wl)
        })
        wx.assign(dx.mul(v0).add(cos(whim).mul(u.agitation)))
        wz.assign(dz.mul(v0).add(sin(whim).mul(u.agitation)))
      })

      const nvx = vx.add(wx.sub(vx).div(u.reaction).add(ax).mul(dt)).toVar()
      const nvz = vz.add(wz.sub(vz).div(u.reaction).add(az).mul(dt)).toVar()
      const sp = sqrt(nvx.mul(nvx).add(nvz.mul(nvz))).toVar()
      const top = v0.mul(TOP)
      If(sp.greaterThan(top), () => {
        nvx.mulAssign(top.div(sp))
        nvz.mulAssign(top.div(sp))
      })
      // It will not step into a light: at any light's edge, the part of its velocity toward it goes.
      If(torchInner.greaterThan(0).and(Q.greaterThanEqual(burns)).and(Q.lessThan(burns.add(r))), () => {
        const toward = nvx.mul(ox).add(nvz.mul(oz)).negate().toVar()
        If(toward.greaterThan(0), () => {
          nvx.addAssign(ox.mul(toward))
          nvz.addAssign(oz.mul(toward))
        })
      })
      Loop(overLights(u.lit, 'e'), (inputs) => {
        const k = (inputs as unknown as { e: Node<'int'> }).e
        const l = lights.element(k).toVar()
        const dx = x.sub(l.x).toVar()
        const dz = z.sub(l.y).toVar()
        const d2 = dx.mul(dx).add(dz.mul(dz)).toVar()
        If(d2.lessThan(l.w.mul(l.w)), () => {
          const d = max(sqrt(d2), 1e-6).toVar()
          const seen = seenAt(k.add(1), dx, dz).toVar()
          const b = min(l.z.mul(flickerAt(atan(dz, dx), u.now)), seen).toVar()
          If(seen.greaterThanEqual(d).and(d.greaterThanEqual(b)).and(d.lessThan(b.add(r))), () => {
            const kx = dx.div(d).toVar()
            const kz = dz.div(d).toVar()
            const toward = nvx.mul(kx).add(nvz.mul(kz)).negate().toVar()
            If(toward.greaterThan(0), () => {
              nvx.addAssign(kx.mul(toward))
              nvz.addAssign(kz.mul(toward))
            })
          })
        })
      })
      const px = x.add(nvx.mul(dt)).toVar()
      const pz = z.add(nvz.mul(dt)).toVar()
      // Up the pile at a climb, and back down at a drop; its pitch the slope it takes.
      const pileWant = min(mount, height.mul(PILE_CAP)).toVar()
      const y0 = a.y
      const ny = y0.add(pileWant.sub(y0).mul(min(dt.div(select(pileWant.greaterThan(y0), float(RISE), drop)), 1))).toVar()
      const pitchWant = atan(ny.sub(y0), max(mv, WALK_IN).mul(dt)).clamp(-PITCH_MAX, PITCH_MAX)
      const pitch = b.x.add(pitchWant.sub(b.x).mul(Math.min(1, STEP / PITCH_SMOOTHING))).toVar()

      // The arena's edge.
      const rr = sqrt(px.mul(px).add(pz.mul(pz))).toVar()
      If(rr.greaterThan(u.arena), () => {
        px.mulAssign(u.arena.div(rr))
        pz.mulAssign(u.arena.div(rr))
      })
      // The walls: it slides along any it meets, and crosses none. And it does not step into a light's lit
      // area from outside it, not even round a wall's shadow: it stays where it was.
      const unwalledX = px.toVar()
      const unwalledZ = pz.toVar()
      slideOffWalls(this.wallsNode, u.walls, x, z, px, pz, r.add(HALF).toVar())
      const held = px.notEqual(unwalledX).or(pz.notEqual(unwalledZ)).toVar()
      If(caughtIn.not().and(this.litAt(px, pz, torchInner)), () => {
        px.assign(x)
        pz.assign(z)
        held.assign(bool(true))
      })
      // Held, it goes only as far as it went.
      If(held, () => {
        nvx.assign(px.sub(x).div(dt))
        nvz.assign(pz.sub(z).div(dt))
      })

      // Where it really went; its facing; its gait.
      const seenBy = Math.min(1, STEP / SEEN)
      const mx = m0.z.add(px.sub(x).div(dt).sub(m0.z).mul(seenBy)).toVar()
      const mz = m0.w.add(pz.sub(z).div(dt).sub(m0.w).mul(seenBy)).toVar()
      const seen = sqrt(mx.mul(mx).add(mz.mul(mz))).toVar()
      const heading = a.w.toVar()
      // At the edge it faces the light, flinching away from it; anywhere else, where it really goes.
      // And a rat really moving away from where it faces turns to run: no rat backs off facing the light.
      If(free.lessThan(0.5).or(seen.greaterThan(WALK_OUT)), () => {
        const retreating = seen.greaterThan(WALK_IN).and(mx.mul(faceX).add(mz.mul(faceZ)).lessThan(seen.mul(-0.5)))
        const run = free.greaterThan(0.5).or(retreating)
        const diff = select(run, atan(mz, mx), atan(faceZ, faceX)).sub(heading).toVar()
        diff.subAssign(diff.div(TAU).round().mul(TAU))
        const most = u.turnRate.mul(dt)
        heading.addAssign(diff.clamp(most.negate(), most))
      })
      const gait = m2.y.toVar()
      const next = gait.toVar()
      If(gait.equal(RUN), () => {
        If(seen.lessThan(RUN_OUT), () => {
          next.assign(select(seen.lessThan(WALK_OUT), float(IDLE), float(WALK)))
        })
      })
        .ElseIf(gait.equal(WALK), () => {
          If(seen.greaterThan(RUN_IN), () => {
            next.assign(RUN)
          }).ElseIf(seen.lessThan(WALK_OUT), () => {
            next.assign(IDLE)
          })
        })
        .ElseIf(seen.greaterThan(WALK_IN), () => {
          next.assign(select(seen.greaterThan(RUN_IN), float(RUN), float(WALK)))
        })
      const gaitSince = m1.w.toVar()
      If(next.notEqual(gait).and(u.now.sub(gaitSince).greaterThan(GAIT_DWELL)), () => {
        gait.assign(next)
        gaitSince.assign(u.now)
        report(i, next)
      })

      stateOut.element(i.mul(2)).assign(vec4(px, ny, pz, heading))
      stateOut.element(i.mul(2).add(1)).assign(vec4(pitch, place, 0, 0))
      motionOut.element(i.mul(MOTION)).assign(vec4(nvx, nvz, mx, mz))
      motionOut.element(i.mul(MOTION).add(1)).assign(vec4(flinch, burn, whim, gaitSince))
      motionOut.element(i.mul(MOTION).add(2)).assign(vec4(side, gait, tolerance, timid))
    })().compute(cap) as ComputeNode
  }

  /**
   * Bring-round, after the step: a rat in the dark and behind its centre is
   * set down in it again ahead of the walking light, running in, out of the
   * flame's reach and every placed light's, and inside the arena. Each rat that would be takes a ticket
   * by an atomic add, the swarm walked from a new place each step; only the
   * tickets under the quota move. A moved rat is marked, placed and never slid.
   */
  private bringRound(
    stateOut: StorageBufferNode<'vec4'>,
    motionOut: StorageBufferNode<'vec4'>,
    report: (i: Node<'int'>, gait: Node<'float'>) => void,
  ): ComputeNode {
    const u = this.u
    const tickets = storage(this.tickets, 'uint', 1).toAtomic()
    return Fn(() => {
      const i = int(instanceIndex).add(u.roundFrom).mod(u.count).toVar()
      const a = stateOut.element(i.mul(2)).toVar()
      const dx = a.x.sub(u.darkX)
      const dz = a.z.sub(u.darkZ)
      const left = dx.mul(dx).add(dz.mul(dz)).greaterThan(u.darkRadius.mul(u.darkRadius)).and(dx.mul(u.walkX).add(dz.mul(u.walkZ)).lessThan(0))
      If(left, () => {
        const keepOut = u.far
        const edge = max(u.darkRadius, keepOut)
        const angle = atan(u.walkZ, u.walkX).add(chanceOf(u.angleKey, i).mul(2).sub(1).mul(ROUND_SPREAD)).toVar()
        const off = edge.add(chanceOf(u.depthKey, i).mul(ROUND_DEPTH)).toVar()
        const nx = u.darkX.add(cos(angle).mul(off)).toVar()
        const nz = u.darkZ.add(sin(angle).mul(off)).toVar()
        const limit = u.arena.sub(1)
        const tx = u.lightX.sub(nx).toVar()
        const tz = u.lightZ.sub(nz).toVar()
        const tl2 = tx.mul(tx).add(tz.mul(tz)).toVar()
        // Out of every placed light's reach.
        const lights = this.lightsNode
        const unlit = float(1).toVar()
        Loop(overLights(u.lit, 'k'), (inputs) => {
          const k = (inputs as unknown as { k: Node<'int'> }).k
          const l = lights.element(k).toVar()
          const lx = nx.sub(l.x)
          const lz = nz.sub(l.y)
          If(lx.mul(lx).add(lz.mul(lz)).lessThan(l.w.mul(l.w)), () => {
            unlit.assign(0)
          })
        })
        // And out of every wall.
        const wallReach = u.r.add(HALF).toVar()
        Loop(counter(u.walls, 'w'), (inputs) => {
          const { ax, az, length, ux, uz } = wallOf(this.wallsNode, (inputs as unknown as { w: Node<'int'> }).w)
          const along = nx.sub(ax).mul(ux).add(nz.sub(az).mul(uz)).clamp(0, length)
          const gx = nx.sub(ax.add(ux.mul(along)))
          const gz = nz.sub(az.add(uz.mul(along)))
          If(gx.mul(gx).add(gz.mul(gz)).lessThan(wallReach.mul(wallReach)), () => {
            unlit.assign(0)
          })
        })
        // Inside the arena and the level's box, and out of the flame's reach wherever the dark is centred.
        const box = u.bounds
        const inBox = nx.greaterThanEqual(box.x).and(nx.lessThanEqual(box.z)).and(nz.greaterThanEqual(box.y)).and(nz.lessThanEqual(box.w))
        If(nx.mul(nx).add(nz.mul(nz)).lessThanEqual(limit.mul(limit)).and(inBox).and(tl2.greaterThanEqual(keepOut.mul(keepOut))).and(unlit.greaterThan(0.5)), () => {
          If(atomicAdd(tickets.element(0), uint(1)).lessThan(u.quota), () => {
            const b = stateOut.element(i.mul(2).add(1)).toVar()
            const m1 = motionOut.element(i.mul(MOTION).add(1)).toVar()
            const m2 = motionOut.element(i.mul(MOTION).add(2)).toVar()
            // Running in for the light already, as it would be had it come all the way.
            const tl = select(tl2.greaterThan(0), sqrt(tl2), float(1))
            const speed = u.minSpeed.add(u.maxSpeed.sub(u.minSpeed).mul(b.y))
            const vx = tx.div(tl).mul(speed).toVar()
            const vz = tz.div(tl).mul(speed).toVar()
            stateOut.element(i.mul(2)).assign(vec4(nx, a.y, nz, atan(tz, tx)))
            stateOut.element(i.mul(2).add(1)).assign(vec4(b.x, b.y, 1, b.w))
            motionOut.element(i.mul(MOTION)).assign(vec4(vx, vz, vx, vz))
            motionOut.element(i.mul(MOTION).add(1)).assign(vec4(0, 0, m1.z, u.now))
            motionOut.element(i.mul(MOTION).add(2)).assign(vec4(0, RUN, m2.z, m2.w))
            If(m2.y.notEqual(RUN), () => {
              report(i, float(RUN))
            })
          })
        })
      })
    })().compute(this.capacity) as ComputeNode
  }
}

/** A step's passes in order, with bring-round and without; and those dispatched a thread a rat or a thread a cell. */
export interface Passes {
  all: ComputeNode[]
  unround: ComputeNode[]
  rats: ComputeNode[]
  cells: ComputeNode[]
}
