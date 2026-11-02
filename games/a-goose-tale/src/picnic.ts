// The breakfast on the pond's island: public/models/picnic.glb (brought in on
// 2026-11-02: "Breakfast & Picnic" by arlettaleviani, CC-BY-4.0, credited in
// public/licence.txt), its materials baked into one mesh on one atlas, cut out
// by the atlas's alpha, y-up, its tray's top on the origin, about 0.22 x 0.13 x
// 0.19 m. The file is unlit; here it stands in the scene pieces' shell (the
// tent's) under a highlight and rim of its own, so the night falls on it too.
// It lies in front of the island's oak as the game's camera sees it, its tray
// tipped to the slope of the ground under it, as the picnic folder moves it.
import { DoubleSide, Group, Quaternion, Vector3, type Mesh, type MeshBasicMaterial, type Texture } from 'three/webgpu'
import { texture } from 'three/tsl'
import { modelLoader } from './gltf'
import { ShellToonMaterial, type ShellLook } from './shell'
import { groundOf, islandMiddle, type PondLook } from './pond'
import type { ShineLook } from './panel'

const MODEL = './models/picnic.glb'
/** How wide the file's tray is, m, as modelled; how far its corners reach from its middle; how far under the origin its foot is. */
const MODEL_WIDTH = 0.218
const MODEL_REACH = 0.15
const MODEL_FOOT = 0.005
const UP = new Vector3(0, 1, 0)

/** What the picnic folder edits. */
export interface PicnicLook {
  show: boolean
  /** Where it lies off the island's middle, m, and how far up or down from the ground there. */
  x: number
  z: number
  y: number
  /** Which way it faces, degrees about y. */
  turn: number
  /** How wide its tray is, m. */
  size: number
  /** Its own highlight and rim, over the scene pieces' shell. */
  shine: ShineLook
}

/** The picnic to start, as set from the panel on 2026-11-02: in front of the island's oak as the camera sees it, on the island's near left; matt, a soft warm rim. */
export function defaultPicnicLook(): PicnicLook {
  return {
    show: true,
    x: -3.01,
    z: 1.33,
    y: 0,
    turn: 40,
    size: 1.62,
    shine: { specular: 0, shininess: 30, softness: 0.17, specularColor: 0xffe2c0, rim: true, rimStrength: 0.25, rimWidth: 0.35, rimSoftness: 0.1, rimColor: 0xffc890 },
  }
}

/** How far its corners reach from where it lies across the ground, m, as wide as `size`. */
export const picnicReach = (size: number): number => (MODEL_REACH * size) / MODEL_WIDTH

/** Where `look` lays it on the island of `pond`: its middle, on the ground there, and the way up of the slope under it, across its reach. */
export function picnicPlace(look: PicnicLook, pond: PondLook): { x: number; y: number; z: number; up: Vector3 } {
  const middle = islandMiddle(pond)
  const x = middle.x + look.x
  const z = middle.z + look.z
  const reach = picnicReach(look.size)
  const slopeX = (groundOf(pond, x + reach, z) - groundOf(pond, x - reach, z)) / (2 * reach)
  const slopeZ = (groundOf(pond, x, z + reach) - groundOf(pond, x, z - reach)) / (2 * reach)
  return { x, y: groundOf(pond, x, z) + look.y, z, up: new Vector3(-slopeX, 1, -slopeZ).normalize() }
}

export interface Picnic {
  readonly object: Group
  readonly look: PicnicLook
  /** Lay it again on the island of `pond`, as the folder has it. */
  set(pond: PondLook): void
  /** How far it reaches from where it lies across the ground at its widest, m, as big as it now is. */
  reach(): number
  /** The scene pieces' shell, as the look folder sets it, under its own highlight and rim. */
  setShell(look: ShellLook): void
  /** Its own highlight and rim again, as the folder has them. */
  shineChanged(): void
}

/** The picnic, in `look`. */
export async function createPicnic(look: PicnicLook = defaultPicnicLook()): Promise<Picnic> {
  const file = (await modelLoader().loadAsync(MODEL)).scene
  const meshes: Mesh[] = []
  file.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh)
  })
  const { map, alphaTest } = meshes[0]!.material as MeshBasicMaterial & { map: Texture }
  // The shadow pass reads its alpha off the colour, and cuts out by its own mask: the leaves' and the flower's cards leave no squares.
  const atlas = texture(map)
  const material = new ShellToonMaterial({ side: DoubleSide, shadowSide: DoubleSide, alphaTest })
  material.colorNode = atlas
  material.maskShadowNode = atlas.a.greaterThan(alphaTest)
  for (const mesh of meshes) {
    mesh.material = material
    mesh.castShadow = mesh.receiveShadow = true
  }
  const object = new Group().add(file)
  /** The shell it shares, last handed over, kept under its own highlight and rim. */
  let shared: ShellLook | undefined
  const shineChanged = () => {
    if (shared) material.set({ ...shared, ...look.shine })
  }
  const lean = new Quaternion()
  const turned = new Quaternion()
  return {
    object,
    look,
    set(pond) {
      object.visible = look.show && pond.island.show
      const { x, y, z, up } = picnicPlace(look, pond)
      const scale = look.size / MODEL_WIDTH
      object.position.set(x, y, z).addScaledVector(up, MODEL_FOOT * scale)
      object.quaternion.copy(lean.setFromUnitVectors(UP, up)).multiply(turned.setFromAxisAngle(UP, (look.turn * Math.PI) / 180))
      object.scale.setScalar(scale)
    },
    reach: () => picnicReach(look.size),
    setShell(shell) {
      shared = shell
      shineChanged()
    },
    shineChanged,
  }
}
