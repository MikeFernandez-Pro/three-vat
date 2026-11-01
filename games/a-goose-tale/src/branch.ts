// The burning branch A Goose Tale starts with (gooseplay.ts, gooseintro.ts):
// snapped off the burning tree's crown in the opening, it falls burning,
// lies on the ground among the rats, and once he picks it up it is his torch,
// carried in his beak where the goose's own torch lay, its broken end where
// the flame burns. Drawn here, not played: the page lays it lying, falling
// or carried, and burns its flame on it.
//
// A crooked stick of a few tapered lengths, each a little off the line of
// the last, with one short twig off its first bend, made once, a unit long
// from its butt up +y to its broken end, and laid by a pose: where its butt
// is, how it is turned, and how long it is, the same size lying as carried.
// Its bark in the dead trees' wood and its broken end charred black, in the
// scenes' shell.
import { BufferAttribute, Color, CylinderGeometry, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Object3D } from 'three/webgpu'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import type { ToonLook } from './toon'

/**
 * The branch as made, a unit long: each bend's place, from its butt at the origin to its broken end at (0, 1, 0), and
 * how thick it is there, a share of its length, thinning toward the end; and from which bend on it is charred.
 */
const BENDS = [
  { x: 0, y: 0, z: 0, r: 0.05 },
  { x: 0.04, y: 0.34, z: 0.012, r: 0.045 },
  { x: -0.028, y: 0.66, z: -0.01, r: 0.039 },
  { x: 0.008, y: 0.86, z: 0.004, r: 0.035 },
  { x: 0, y: 1, z: 0, r: 0.033 },
] as const
const CHARRED_FROM = 3
/** Its twig: off which bend, to where, and how thick at its foot and its tip. */
const TWIG = { from: 1, to: { x: 0.2, y: 0.55, z: 0.05 }, r: [0.022, 0.009] } as const
/** How many sides each length is round: few, as a stick is drawn. */
const SIDES = 6
/** How far each length runs on into the next, a share of its own thickness, so no crack shows at a bend. */
const OVERLAP = 0.6

/** Bark and its char: the dead trees' wood (main.ts) at their colour strength, and a burnt black. */
export const BARK = 0xe4aff3
export const BARK_SATURATION = 0.64
export const CHAR = 0x2a1f1f

const UP = new Vector3(0, 1, 0)

/** A tapered length from `a`, `ra` thick, to `b`, `rb` thick, each of its points of part `part`. */
function length(a: Vector3, b: Vector3, ra: number, rb: number, part: number): BufferGeometry {
  const way = new Vector3().subVectors(b, a)
  const long = way.length()
  const over = OVERLAP * Math.max(ra, rb)
  const geometry = new CylinderGeometry(rb, ra, long + over, SIDES, 1)
  geometry.translate(0, (long + over) / 2 - over / 2, 0)
  geometry.applyQuaternion(new Quaternion().setFromUnitVectors(UP, way.normalize()))
  geometry.translate(a.x, a.y, a.z)
  geometry.setAttribute('part', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(part), 1))
  return geometry
}

/** The branch made, a unit long: its lengths, the last of them charred, and its twig. */
function branchGeometry(): BufferGeometry {
  const at = BENDS.map(({ x, y, z }) => new Vector3(x, y, z))
  const lengths = BENDS.slice(1).map((bend, k) => length(at[k]!, at[k + 1]!, BENDS[k]!.r, bend.r, k >= CHARRED_FROM ? 1 : 0))
  const twig = length(at[TWIG.from]!, new Vector3(TWIG.to.x, TWIG.to.y, TWIG.to.z), TWIG.r[0], TWIG.r[1], 0)
  const geometry = mergeGeometries([...lengths, twig])!
  geometry.deleteAttribute('uv')
  return geometry
}

/** Where the branch is laid: its butt, how it is turned, and how long it is, m. */
export interface BranchPose {
  position: Vector3
  quaternion: Quaternion
  length: number
}

export const branchPose = (): BranchPose => ({ position: new Vector3(), quaternion: new Quaternion(), length: 1 })

export interface BurningBranch {
  /** What the scene adds. */
  readonly object: Mesh
  /** Its bark's and its char's colours. */
  setColours(bark: number, char: number): void
  /** Take the scenes' shell, as each of theirs does. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /** Laid as `pose` has it. */
  place(pose: BranchPose): void
  /** Where its broken end is, as last placed: where it burns. */
  end(out: Vector3): Vector3
}

export function createBranch(): BurningBranch {
  const material = new ShellToonMaterial({ parts: 2 })
  const object = new Mesh(branchGeometry(), material)
  object.castShadow = object.receiveShadow = true
  object.frustumCulled = false
  const tip = new Vector3()
  const branch: BurningBranch = {
    object,
    setColours(bark, char) {
      material.parts[0]!.value.set(bark)
      material.parts[1]!.value.set(char)
    },
    setShell(look) {
      material.set(look)
      material.setPaint(look.paint)
      material.setToon(look.toon)
    },
    place({ position, quaternion, length }) {
      object.position.copy(position)
      object.quaternion.copy(quaternion)
      object.scale.setScalar(length)
      object.updateMatrixWorld()
    },
    end(out) {
      return out.copy(tip.set(0, 1, 0)).applyMatrix4(object.matrixWorld)
    },
  }
  const bark = new Color(BARK)
  const hsl = { h: 0, s: 0, l: 0 }
  bark.getHSL(hsl)
  branch.setColours(bark.setHSL(hsl.h, hsl.s * BARK_SATURATION, hsl.l).getHex(), CHAR)
  return branch
}

const way = new Vector3()
const across = new Vector3()
const middle = new Vector3()
const turn = new Quaternion()
const scratch = new Matrix4()
const unit = new Vector3()

/**
 * The branch lying on the ground: its broken end at `end`, its butt `length` m off along `yaw`, radians round from +x
 * toward +z, the broken end raised `rise` radians off the ground, as on its twig; and turned over `tumble` radians
 * about its middle, across its length, as it is in its fall.
 */
export function lyingPose(end: Vector3, yaw: number, length: number, rise: number, tumble: number, out: BranchPose): BranchPose {
  way.set(Math.cos(yaw) * Math.cos(rise), Math.sin(rise), Math.sin(yaw) * Math.cos(rise))
  out.quaternion.setFromUnitVectors(UP, way)
  out.position.copy(end).addScaledVector(way, -length)
  out.length = length
  if (tumble !== 0) {
    across.crossVectors(way, UP).normalize()
    turn.setFromAxisAngle(across, tumble)
    middle.copy(end).addScaledVector(way, -length / 2)
    out.position.sub(middle).applyQuaternion(turn).add(middle)
    out.quaternion.premultiply(turn)
  }
  return out
}

/**
 * The branch carried where `held` has the goose's own torch, from its butt to where it burns, in the space of the bone
 * that carries it, as that bone is posed now.
 */
export function carriedPose(held: { readonly carrier: Object3D; readonly butt: Vector3; readonly end: Vector3 }, out: BranchPose): BranchPose {
  way.subVectors(held.end, held.butt)
  const long = way.length()
  scratch.compose(held.butt, turn.setFromUnitVectors(UP, way.normalize()), unit.setScalar(long))
  scratch.premultiply(held.carrier.matrixWorld)
  scratch.decompose(out.position, out.quaternion, unit)
  out.length = unit.x
  return out
}
