// The dead trees in the wind, as justASimpleTree's wind.js moves its trees: a
// large sway of the whole tree and a small flutter of each leaf card, both
// driven by noise, and each branch swinging on its own on top, out of step with
// its neighbours.
//
// Its files carry none of the wind's own numbers, each vertex's flex and beat,
// so they are drawn from where a point stands in its tree as laid: its flex
// from how far out from the trunk it is, its beat from which way round the
// trunk, and a little from where the tree stands, so two trees of a kind never
// swing alike. Both change smoothly along a branch, so the wood stays joined.
// The gusts drift over the plain, not over a tree, so they pass from tree to
// tree downwind.
import { BufferAttribute, Vector3, type BufferGeometry, type NodeBuilder, type NodeMaterial } from 'three/webgpu'
import { atan, attribute, cos, float, mx_noise_float, mx_noise_vec3, positionGeometry, positionLocal, renderGroup, rotate, sin, time, uniform, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

/** What the dead trees' wind folder edits, after justASimpleTree's wind section. */
export interface TreeWindLook {
  /** How far a tree's top sways, m. */
  strength: number
  /** How fast the gusts travel through the trees. */
  speed: number
  /** How big a gust is, m: larger, fewer of them. */
  gustSize: number
  /** Which way it blows, degrees round from +x toward +z. */
  direction: number
  /** How far each leaf card rocks, rad. */
  flutter: number
  /** How far the farthest-out branch swings on its own, a share of the sway's strength. */
  branches: number
}

/**
 * The wind to start: justASimpleTree's own for its spooky tree, stiff and dead, 0.1 m at the top; blowing as the falling
 * leaves are carried (fallingleaves.prototype.ts), so the trees bend the way the leaves fall.
 */
export function defaultTreeWindLook(): TreeWindLook {
  return { strength: 0.1, speed: 0.83, gustSize: 20, direction: -28, flutter: 0.25, branches: 0.6 }
}

// A branch's swing: mostly along the wind and back, some across it and a little up and down, each at its own rate, so it never quite repeats.
const SWING = [0.42, 0.31, 0.57] // swings a second: along the wind, across it, up and down
const SWING_SIZE = [0.6, 0.45, 0.2] // of the swing, each way
const ALONG_BIAS = 0.4 // of the swing, how far it leans downwind on average
/** How much the beat turns with where a tree stands, rad over the noise's range: neighbours swing out of step. */
const STANDS = 6
/** The noise's frequency the beat turns by, 1 / m: about a tree's width, so it barely turns within one. */
const STANDS_FREQUENCY = 0.1

/** The trees' wind: their wood and leaves moved by it, its values a uniform each. */
export interface TreeWind {
  /** Where a vertex of the wood sways to: for a material's positionNode, after the instance has placed it. */
  readonly wood: Node<'vec3'>
  /** Where a leaf card's vertex sways to, its card riding the wood: for the leaves' positionNode. */
  readonly leaves: Node<'vec3'>
  /** Rock each card of `material`'s leaves round its own centre, before the instance places it. Its geometry needs `cardCentres`. */
  flutter(material: NodeMaterial): void
  set(look: TreeWindLook): void
  /**
   * Where the wood at `at` on the plain, `inTree` where it stands in its tree as laid, sways to as last drawn, into
   * `out`: `wood` worked out on the CPU, for what sits on a branch and must ride it.
   */
  swayAt(at: Vector3, inTree: Vector3, out: Vector3): Vector3
}

// MaterialX's Perlin noise as three's mx_noise_float and mx_noise_vec3 take it in three dimensions, on the CPU: Bob
// Jenkins' lookup3 hash on the lattice, a gradient picked from its low bits, blended by the quintic fade.
const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0
function bjfinal(a: number, b: number, c: number): number {
  c = ((c ^ b) - rotl(b, 14)) >>> 0
  a = ((a ^ c) - rotl(c, 11)) >>> 0
  b = ((b ^ a) - rotl(a, 25)) >>> 0
  c = ((c ^ b) - rotl(b, 16)) >>> 0
  a = ((a ^ c) - rotl(c, 4)) >>> 0
  b = ((b ^ a) - rotl(a, 14)) >>> 0
  return ((c ^ b) - rotl(b, 24)) >>> 0
}
const SEED3 = (0xdeadbeef + (3 << 2) + 13) >>> 0
const hash3 = (x: number, y: number, z: number) => bjfinal((SEED3 + x) >>> 0, (SEED3 + y) >>> 0, (SEED3 + z) >>> 0)
function gradient(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z
  return (h & 1 ? -u : u) + (h & 2 ? -v : v)
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
/** The noise at (x, y, z), each corner's hash read through `channel`: whole for mx_noise_float, a byte of it for each of mx_noise_vec3's three. */
function perlin(x: number, y: number, z: number, channel: (hash: number) => number): number {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  const Z = Math.floor(z)
  const fx = x - X
  const fy = y - Y
  const fz = z - Z
  const corner = (i: number, j: number, k: number) => gradient(channel(hash3(X + i, Y + j, Z + k)), fx - i, fy - j, fz - k)
  const s = fade(fx)
  const t = fade(fy)
  const r = fade(fz)
  const lerp = (a: number, b: number, w: number) => a * (1 - w) + b * w
  const near = lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), s), lerp(corner(0, 1, 0), corner(1, 1, 0), s), t)
  const far = lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), s), lerp(corner(0, 1, 1), corner(1, 1, 1), s), t)
  return 0.982 * lerp(near, far, r)
}
/** three's mx_noise_float of a vec3, on the CPU. */
export const noiseFloat = (x: number, y: number, z: number): number => perlin(x, y, z, (h) => h)
/** three's mx_noise_vec3 of a vec3, on the CPU, into `out`. */
export function noiseVec3(x: number, y: number, z: number, out: Vector3): Vector3 {
  return out.set(perlin(x, y, z, (h) => h & 0xff), perlin(x, y, z, (h) => (h >>> 8) & 0xff), perlin(x, y, z, (h) => (h >>> 16) & 0xff))
}

/** Each leaf card's centre, as laid, on every vertex of it: its cards are its separate pieces. A vec3 attribute, `card`. */
export function cardCentres(geometry: BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const count = position.count
  const index = geometry.getIndex()
  const parent = new Int32Array(count).map((_, k) => k)
  const root = (k: number): number => {
    while (parent[k] !== k) k = parent[k] = parent[parent[k]!]!
    return k
  }
  const at = (k: number) => (index ? index.getX(k) : k)
  const corners = index ? index.count : count
  for (let k = 0; k + 2 < corners; k += 3) {
    const a = root(at(k))
    parent[root(at(k + 1))] = a
    parent[root(at(k + 2))] = a
  }
  const sums = new Map<number, [number, number, number, number]>()
  for (let k = 0; k < count; k++) {
    const r = root(k)
    const sum = sums.get(r) ?? sums.set(r, [0, 0, 0, 0]).get(r)!
    sum[0] += position.getX(k)
    sum[1] += position.getY(k)
    sum[2] += position.getZ(k)
    sum[3]++
  }
  const centres = new Float32Array(count * 3)
  for (let k = 0; k < count; k++) {
    const [x, y, z, n] = sums.get(root(k))!
    centres.set([x / n, y / n, z / n], k * 3)
  }
  geometry.setAttribute('card', new BufferAttribute(centres, 3))
}

/**
 * The wind for trees laid `laid` m tall, their trunks `trunk` m round their middle and their crowns reaching `crown` m
 * out from it, as laid: a point swings on its own as far out past the trunk as it stands, to all of it at the crown's edge.
 */
export function createTreeWind(laid: number, trunk: number, crown: number): TreeWind {
  const u = {
    strength: uniform(0.1).setGroup(renderGroup),
    speed: uniform(0.83).setGroup(renderGroup),
    frequency: uniform(0.05).setGroup(renderGroup),
    direction: uniform(0).setGroup(renderGroup),
    flutter: uniform(0.25).setGroup(renderGroup),
    branches: uniform(0.6).setGroup(renderGroup),
  }
  const downwind = vec3(cos(u.direction), 0, sin(u.direction))
  const across = vec3(downwind.z.negate(), 0, downwind.x)

  // The sway of a point `at` on the plain, `laid` where it stands in its tree as laid: a noise field drifting downwind
  // pushes it along the wind, with a little turbulence, more the higher up it is. How far down the bend reaches follows
  // the strength: a breeze moves only the crown, a gale bends the whole tree from the ground. The root never moves.
  const sway = (at: Node<'vec3'>, inTree: Node<'vec3'>) => {
    const drift = at.mul(u.frequency).sub(downwind.mul(time.mul(u.speed)))
    const gust = mx_noise_float(drift).add(0.6)
    const turbulence = mx_noise_vec3(drift.add(17.3)).mul(0.35)
    const reach = float(2).sub(u.strength.clamp(0, 1))
    const bend = inTree.y.div(laid).max(0).pow(reach)
    const flex = inTree.xz.length().sub(trunk).div(crown - trunk).clamp(0, 1)
    const phase = atan(inTree.z, inTree.x).add(mx_noise_float(at.mul(STANDS_FREQUENCY)).mul(STANDS))
    const beat = (i: number) => sin(time.mul(SWING[i]! * Math.PI * 2).add(phase).add(i * 2.1)).mul(SWING_SIZE[i]!)
    const own = downwind
      .mul(beat(0).add(ALONG_BIAS))
      .add(across.mul(beat(1)))
      .add(vec3(0, beat(2), 0))
      .mul(flex.mul(gust).mul(u.strength).mul(u.branches))
    return at.add(downwind.mul(gust).add(turbulence).mul(bend.mul(u.strength)).add(own))
  }

  const scratch = new Vector3()
  const card = attribute('card', 'vec3')
  // A card's flutter: two small angles rocking out of phase with its neighbours, stronger when a gust passes.
  const rocked = () => {
    const t = time.mul(u.speed).mul(6).add(mx_noise_float(card.mul(7.3)).mul(Math.PI * 4))
    const gust = mx_noise_float(card.mul(u.frequency).sub(time.mul(u.speed))).add(1)
    const angles = vec3(sin(t), sin(t.mul(1.3).add(1.7)), 0).mul(u.flutter.mul(gust))
    return card.add(rotate(positionGeometry.sub(card), angles))
  }

  return {
    wood: sway(positionLocal, positionGeometry),
    leaves: sway(positionLocal, card),
    flutter(material) {
      // Before three's own positioning, as its fat lines do theirs: the card rocks as laid, then the instance places it.
      const place = material.setupPosition.bind(material)
      material.setupPosition = (builder: NodeBuilder) => {
        positionLocal.assign(rocked())
        return place(builder)
      }
    },
    swayAt(at, inTree, out) {
      const t = time.value
      const direction = u.direction.value
      const dx = Math.cos(direction)
      const dz = Math.sin(direction)
      const frequency = u.frequency.value
      const strength = u.strength.value
      const drift = [at.x * frequency - dx * t * u.speed.value, at.y * frequency, at.z * frequency - dz * t * u.speed.value] as const
      const gust = noiseFloat(...drift) + 0.6
      const turbulence = noiseVec3(drift[0] + 17.3, drift[1] + 17.3, drift[2] + 17.3, scratch).multiplyScalar(0.35)
      const reach = 2 - Math.min(1, Math.max(0, strength))
      const bend = Math.max(0, inTree.y / laid) ** reach
      const flex = Math.min(1, Math.max(0, (Math.hypot(inTree.x, inTree.z) - trunk) / (crown - trunk)))
      const phase = Math.atan2(inTree.z, inTree.x) + noiseFloat(at.x * STANDS_FREQUENCY, at.y * STANDS_FREQUENCY, at.z * STANDS_FREQUENCY) * STANDS
      const beat = (i: number) => Math.sin(t * SWING[i]! * Math.PI * 2 + phase + i * 2.1) * SWING_SIZE[i]!
      const swing = flex * gust * strength * u.branches.value
      const along = (beat(0) + ALONG_BIAS) * swing
      const across = beat(1) * swing
      const bent = bend * strength
      return out.set(
        at.x + (dx * gust + turbulence.x) * bent + dx * along - dz * across,
        at.y + turbulence.y * bent + beat(2) * swing,
        at.z + (dz * gust + turbulence.z) * bent + dz * along + dx * across,
      )
    },
    set(look) {
      u.strength.value = look.strength
      u.speed.value = look.speed
      u.frequency.value = 1 / Math.max(1, look.gustSize)
      u.direction.value = (look.direction * Math.PI) / 180
      u.flutter.value = look.flutter
      u.branches.value = look.branches
    },
  }
}
