// The burning branch A Goose Tale starts with (gooseplay.ts, gooseintro.ts):
// snapped off the burning tree's crown in the opening, it falls burning,
// lies on the ground among the rats, and once he picks it up it is his torch,
// held by its butt in his bill, out to his right, its broken end where the
// flame burns. Drawn here, not played: the page lays it lying, falling
// or carried, and burns its flame on it.
//
// A limb drawn as the dead trees' are: one smooth curve, a little S-bent,
// round and tapering; made once, a unit long from its butt up +y to its
// broken end, and laid by a pose: where its butt is, how it is
// turned, and how long it is, the same size lying as carried. Its bark
// painted in strokes
// as the goose is, its broken end charred black and its very tip glowing a
// little red, as bright as the grave candles' flames, in the scenes' shell.
import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Matrix4, Mesh, Quaternion, Vector3, type Object3D } from 'three/webgpu'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import type { ToonLook } from './toon'

/** The limb's line, from its butt at the origin to its broken end at (0, 1, 0), a little S-bent; how thick it is at its butt and at its end, a share of its length; and from how far up it is charred, and from how far its tip glows. */
const LIMB = [
  [0, 0, 0],
  [0.05, 0.3, 0.02],
  [-0.035, 0.62, -0.012],
  [0.018, 0.86, 0.008],
  [0, 1, 0],
] as const
const LIMB_R = [0.054, 0.035] as const
const CHARRED_FROM = 0.84
const GLOWS_FROM = 0.95
/** How many sides it is round, and how many rings along a unit of its line. */
const SIDES = 10
const RINGS = 40

/** Bark, set from the panel on 2026-11-02, and its char, a burnt black. */
export const BARK = 0xf5ccff
export const CHAR = 0x2a1f1f
/** Its tip's glow: a little red, and as bright as the grave candles' flames glow (gravecandles.prototype.ts). */
export const EMBER = 0xc4452c
export const EMBER_GLOW = 4

const UP = new Vector3(0, 1, 0)

/**
 * A round tube along `curve`, `radius(t)` thick at each share `t` of its way, its points of part `part(t)`; closed at
 * its start by its first ring drawn in to its middle, and at its end the same, so it is whole from every side.
 */
function tube(curve: CatmullRomCurve3, rings: number, radius: (t: number) => number, part: (t: number) => number): BufferGeometry {
  const frames = curve.computeFrenetFrames(rings, false)
  const positions: number[] = []
  const parts: number[] = []
  const index: number[] = []
  const at = new Vector3()
  const out = new Vector3()
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    curve.getPointAt(t, at)
    const r = radius(t)
    for (let j = 0; j <= SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2
      out.copy(frames.normals[i]!).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i]!, Math.sin(a))
      positions.push(at.x + out.x * r, at.y + out.y * r, at.z + out.z * r)
      parts.push(part(t))
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < SIDES; j++) {
      const a = i * (SIDES + 1) + j
      const b = a + SIDES + 1
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  // Each end drawn in to a point at its middle.
  for (const [ring, t, flip] of [[0, 0, true], [rings, 1, false]] as const) {
    curve.getPointAt(t, at)
    const middle = positions.length / 3
    positions.push(at.x, at.y, at.z)
    parts.push(part(t))
    for (let j = 0; j < SIDES; j++) {
      const a = ring * (SIDES + 1) + j
      if (flip) index.push(middle, a + 1, a)
      else index.push(middle, a, a + 1)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('part', new BufferAttribute(new Float32Array(parts), 1))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** The branch made, a unit long: its limb, charred toward its broken end, its tip glowing. */
function branchGeometry(): BufferGeometry {
  const limb = new CatmullRomCurve3(LIMB.map(([x, y, z]) => new Vector3(x, y, z)))
  return tube(limb, RINGS, (t) => LIMB_R[0] + (LIMB_R[1] - LIMB_R[0]) * t, (t) => (t >= GLOWS_FROM ? 2 : t >= CHARRED_FROM ? 1 : 0))
}

/** Where the branch is laid: its butt, how it is turned, and how long it is, m. */
export interface BranchPose {
  position: Vector3
  quaternion: Quaternion
  length: number
}

export const branchPose = (): BranchPose => ({ position: new Vector3(), quaternion: new Quaternion(), length: 1 })

/** Its bark's, its char's and its glowing tip's colours. */
export interface BranchColours {
  bark: number
  char: number
  ember: number
}

/** The branch's colours as made. */
export const branchColours = (): BranchColours => ({ bark: BARK, char: CHAR, ember: EMBER })

export interface BurningBranch {
  /** What the scene adds. */
  readonly object: Mesh
  setColours(colours: BranchColours): void
  /** Take the scenes' shell, as each of theirs does. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /** Laid as `pose` has it. */
  place(pose: BranchPose): void
  /** Where its broken end is, as last placed: where it burns. */
  end(out: Vector3): Vector3
}

export function createBranch(): BurningBranch {
  const material = new ShellToonMaterial({ parts: 3, painted: { strokes: createStrokes(), extent: 1 } })
  const object = new Mesh(branchGeometry(), material)
  object.castShadow = object.receiveShadow = true
  object.frustumCulled = false
  const tip = new Vector3()
  const branch: BurningBranch = {
    object,
    setColours({ bark, char, ember }) {
      material.parts[0]!.value.set(bark)
      material.parts[1]!.value.set(char)
      material.parts[2]!.value.set(ember)
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
  branch.setColours(branchColours())
  material.setGlow(2, EMBER_GLOW)
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
 * toward +z, the broken end raised `rise` radians off the ground; and turned over `tumble` radians
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
 * The branch carried where `held` has it, from its butt to where it burns, in the space of the bone that carries it,
 * as that bone is posed now.
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
