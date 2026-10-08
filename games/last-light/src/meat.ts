// The meat at the centre: a pumpkin kid with a torch in its hand, the meat
// the swarm is starving for, standing at the light where every rat wants to be. A skinned model played
// by three's own mixer, not baked: one of it needs no VAT. Its flat colours,
// a mesh a colour on one rig, are merged into one skinned mesh on the shell
// material the rats and the floor wear, each colour a part of its own, so it
// is one draw and one shading; a piece the file left unskinned, the wrap
// wound round the bone's top, is skinned whole to that bone and rides it.
// Its idle plays on the clock the page
// gives, the run's, so the stop motion holds it on the beat with the rats;
// and as the light walks it runs, blending from the one clip to the other by
// how fast it goes, and turns to face its way. The blend and the turn move on
// that clock too, so they step on the beat like the pose. The torch's end is
// the mouth of the cup at the far end of the torch in its hand: the flame
// burns on it, carried on the bone that carries it.
import {
  AnimationMixer,
  BufferAttribute,
  Group,
  Matrix4,
  Object3D,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Bone,
  type BufferGeometry,
  type Material,
  type Mesh,
  type Color,
} from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ShellToonMaterial, type PaintLook, type ShellLook, type StripeLook } from './shell'
import { createStrokes } from './strokes'
import type { ToonLook } from './toon'

/** The character the meat is: its model and clips, which way it faces, and where its torch burns. */
interface Character {
  /** What the panel calls it. */
  label: string
  model: string
  /** The clips it plays: standing, and carried along. */
  idle: string
  run: string
  /** Which way the model faces as modelled, as a yaw; it is turned to face +z, as the rat does. */
  facing: number
  /** The way it faces before the light first walks, as a yaw: 0 at the camera, PI ahead, up the screen. */
  start: number
  /**
   * The bone that carries the torch's end; and the part the end is on, the
   * torch's cup: the end is the middle of the cup's end furthest from the
   * bone, for a torch held lying down.
   */
  carrier: string
  torchPart: string
  /** What the panel calls its parts, by material, where the file's names say nothing. */
  partNames: Record<string, string>
  /** The colours its parts start in, by material, where the panel set them over the file's. */
  partColours: Record<string, number>
  /** How tall it stands to start, m; and how fast its run clip plays to start, 1 as authored. */
  height: number
  runSpeed: number
}

// A child in pyjamas with a pumpkin for a head, facing +x as modelled, a torch in the
// right hand, lying along +x at rest: the flame burns in the metal cup at its far end.
const CHARACTER: Character = {
  label: 'pumpkin kid',
  model: './models/pumpkinKid.glb',
  idle: 'Idle',
  run: 'Run',
  facing: Math.PI / 2,
  start: Math.PI,
  carrier: 'skinned_r_handPlacement_bn',
  torchPart: 'LightGrey.002',
  partNames: {
    PJ_Pants: 'pyjamas',
    'Material.002': 'hands and feet',
    PJ_Skin: 'neck',
    'Material.006': 'pumpkin',
    'Material.009': 'stem',
    'DarkWood.002': 'torch handle',
    'LightGrey.002': 'torch cup',
  },
  // Set from the panel on 2026-10-08: the neck the hands' colour, a cream face, a darker stem, a dark wood handle and a cream cup.
  partColours: {
    PJ_Pants: 0x424a83,
    'Material.002': 0xe7a289,
    PJ_Skin: 0xe7a289,
    'Material.006': 0xe77729,
    'Material.008': 0xfefcc3,
    'Material.010': 0xeeab6d,
    'Material.009': 0x49302d,
    'Material.007': 0xa03613,
    'DarkWood.002': 0x543636,
    'LightGrey.002': 0xf5f8c9,
  },
  // Set from the panel on 2026-10-08: 1.35 m tall, its run played half as fast again.
  height: 1.35,
  runSpeed: 1.5,
}

/** What the panel calls it. */
export const characterLabel = CHARACTER.label
/** The light's pace, m/s, at which the meat is all run; and the seconds its blend and its turn take to follow. */
const RUN_FULL = 1
const EASE = 0.2
const UP = new Vector3(0, 1, 0)
/** The part the stripes go on: the first material, the pumpkin kid's pyjamas. */
const STRIPED = 0
/** What the merged geometry keeps of each mesh: what the shell reads, and the skin. */
const KEPT = ['position', 'normal', 'skinIndex', 'skinWeight', 'part']

/**
 * Skin `geometry`, a mesh the file left unskinned, whole to the bone at
 * `slot` of `body`'s skeleton, its rest placement baked into `body`'s space:
 * so it rides that bone with the rest, as a wrap wound round a bone would
 * that lost its bone on export. Its skin attributes are laid as `body`'s
 * are, so the two merge.
 */
function rigidlySkin(geometry: BufferGeometry, mesh: Mesh, body: SkinnedMesh, slot: number): void {
  const into = new Matrix4().copy(body.matrixWorld).invert().multiply(mesh.matrixWorld)
  geometry.applyMatrix4(into)
  // A placement that mirrors turns every face inside out: wound back.
  if (into.determinant() < 0) {
    const index = geometry.getIndex()!
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1)
      index.setX(i + 1, index.getX(i + 2))
      index.setX(i + 2, b)
    }
  }
  const count = geometry.getAttribute('position').count
  const like = (name: string, x: number) => {
    const model = body.geometry.getAttribute(name) as BufferAttribute
    const Array = model.array.constructor as typeof Float32Array
    const attribute = new BufferAttribute(new Array(count * 4), 4, model.normalized)
    for (let i = 0; i < count; i++) attribute.setXYZW(i, x, 0, 0, 0)
    geometry.setAttribute(name, attribute)
  }
  like('skinIndex', slot)
  like('skinWeight', 1)
}

/** What the meat folder edits: its place and colours, and its own shell, painted strokes and toon steps. */
export interface MeatLook extends ShellLook {
  enabled: boolean
  /** How tall it stands, m, and how far off the ground. */
  height: number
  lift: number
  /** How fast its idle and its run clips play, 1 as authored. */
  idleSpeed: number
  runSpeed: number
  /** Whether it casts a shadow: the lamp burns right over it, so its own falls under it. */
  castShadow: boolean
  /** Its parts' colours, a material each in the model's order, read once it is loaded. */
  parts: MeatPart[]
  /** Stripes on the first part, across its rest pose. */
  stripes: StripeLook
  paint: PaintLook
  toon: ToonLook
}

/** A part of the meat, by what the panel calls it, and its colour. */
export interface MeatPart {
  name: string
  color: number
}

/** The meat on the ground at its height, its clips as authored, shaded as the rats start, in its parts' own colours. */
export const defaultMeat = (): MeatLook => ({
  enabled: true,
  height: CHARACTER.height,
  lift: 0,
  idleSpeed: 1,
  runSpeed: CHARACTER.runSpeed,
  castShadow: false,
  parts: [],
  // The pyjamas in pale blue stripes, upright, about 3 cm apart.
  stripes: { enabled: true, color: 0x8fa7c4, count: 40, width: 0.35, angle: 90 },
  sheen: 0,
  specular: 0.27,
  shininess: 30,
  softness: 0.17,
  specularColor: 0x1c401c,
  rim: true,
  rimStrength: 1.24,
  rimWidth: 0.37,
  rimSoftness: 0.1,
  rimColor: 0xe66e2d,
  paint: { strength: 1.3, density: 2.5, size: 1.75, rounding: 0 },
  toon: { steps: 3, three: [0.03, 0.38, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
})

export interface Meat {
  /** What the scene adds; move it to the light. */
  readonly object: Group
  readonly material: ShellToonMaterial
  /** Its parts: what the panel calls each, and the colour it starts in, its character's or its file's. */
  readonly parts: MeatPart[]
  /** Take the meat folder's values. */
  set(look: MeatLook): void
  /** Pose it at `time` seconds of its clips, the light walking at (vx, vz) m/s. */
  pose(time: number, vx: number, vz: number): void
  /**
   * Where the end of its bandage is, world space, as last posed and placed:
   * where the torch burns. Moved by `offset`, m, as the meat faces: x to its
   * left, y up, z ahead, turning with it but never leaning with the bone.
   */
  tip(out: Vector3, offset?: Vector3): Vector3
}

export async function createMeat(): Promise<Meat> {
  const gltf = await new GLTFLoader().loadAsync(CHARACTER.model)
  gltf.scene.rotation.y = -CHARACTER.facing
  const root = new Group().add(gltf.scene)
  root.updateMatrixWorld(true)
  const skinned: SkinnedMesh[] = []
  const loose: Mesh[] = []
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh)
    else if ((o as Mesh).isMesh) loose.push(o as Mesh)
  })
  const body = skinned[0]
  const carrier = root.getObjectByName(CHARACTER.carrier) ?? body.skeleton.bones[0]
  const carrierSlot = Math.max(0, body.skeleton.bones.indexOf(carrier as Bone))

  // The parts, one a material, in the order the skinned meshes come: the order the folder's colours are in. A loose mesh takes its material's.
  const names: string[] = []
  const colours: Color[] = []
  const partOf = (mesh: Mesh) => {
    const material = mesh.material as Material & { color: Color }
    if (!names.includes(material.name)) {
      names.push(material.name)
      colours.push(material.color)
    }
    return names.indexOf(material.name)
  }
  // One geometry, each mesh's vertices naming their part, on the one rig they share, with only what the shell reads.
  const geometries = [...skinned, ...loose].map((mesh) => {
    const geometry = mesh.geometry.clone() as BufferGeometry
    geometry.setAttribute('part', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(partOf(mesh)), 1))
    if (!(mesh as SkinnedMesh).isSkinnedMesh) rigidlySkin(geometry, mesh, body, carrierSlot)
    for (const name of Object.keys(geometry.attributes)) if (!KEPT.includes(name)) geometry.deleteAttribute(name)
    return geometry
  })
  const geometry = mergeGeometries(geometries)!
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const modelHeight = box.max.y - box.min.y
  // Its own left to right, as modelled: square to the way it faces, along the ground.
  const side = new Vector3(Math.cos(CHARACTER.facing), 0, -Math.sin(CHARACTER.facing))

  const material = new ShellToonMaterial({ parts: names.length, striped: true, painted: { strokes: createStrokes(), extent: modelHeight } })
  const merged = new SkinnedMesh(geometry, material)
  merged.bind(body.skeleton, body.bindMatrix)
  merged.castShadow = merged.receiveShadow = true
  merged.frustumCulled = false
  const holder = body.parent!
  for (const mesh of [...skinned, ...loose]) mesh.parent?.remove(mesh)
  holder.add(merged)

  // The torch's end, carried by the bone that carries it: the middle of the cup's end furthest
  // from the bone, its mouth on a torch held lying down. Read where the skin draws it, not where
  // the file lays it: a rig posed at rest off its bind pose draws it elsewhere.
  merged.updateMatrixWorld()
  const torchPart = names.indexOf(CHARACTER.torchPart)
  const part = geometry.getAttribute('part')
  const positions = geometry.getAttribute('position')
  const held = carrier.getWorldPosition(new Vector3())
  const drawn: Vector3[] = []
  for (let i = 0; i < positions.count; i++) {
    if (torchPart >= 0 && part.getX(i) !== torchPart) continue
    drawn.push(merged.localToWorld(merged.applyBoneTransform(i, new Vector3().fromBufferAttribute(positions, i))))
  }
  // The middle of every point within a hundredth of the model's height of the furthest.
  const furthest = Math.max(...drawn.map((at) => at.distanceTo(held)))
  const mouth = drawn.filter((at) => at.distanceTo(held) > furthest - modelHeight * 0.01)
  const end = mouth.reduce((sum, at) => sum.add(at), new Vector3()).divideScalar(mouth.length)
  const torch = new Object3D()
  torch.position.copy(carrier.worldToLocal(end))
  carrier.add(torch)

  const mixer = new AnimationMixer(root)
  const play = (name: string): AnimationAction | undefined => {
    const clip = gltf.animations.find((c) => c.name === name)
    if (clip === undefined) return undefined
    const action = mixer.clipAction(clip)
    action.play()
    return action
  }
  const idle = play(CHARACTER.idle)
  const run = play(CHARACTER.run)
  /** How much of the run shows, 0 to 1; the time it was last posed at, and the way it faces. */
  let running = 0
  let posedAt = 0
  let yaw = CHARACTER.start
  const turned = new Vector3()

  // The model's own size is three centimetres: it is scaled to the folder's height.
  const object = new Group()
  object.add(root)
  root.rotation.y = yaw

  return {
    object,
    material,
    parts: names.map((name, i) => ({ name: CHARACTER.partNames[name] ?? name, color: CHARACTER.partColours[name] ?? colours[i].getHex() })),
    set(look) {
      object.visible = look.enabled
      merged.castShadow = look.castShadow
      root.scale.setScalar(look.height / modelHeight)
      if (idle !== undefined) idle.timeScale = look.idleSpeed
      if (run !== undefined) run.timeScale = look.runSpeed
      root.position.y = look.lift
      look.parts.forEach((part, i) => material.parts[i]?.value.set(part.color))
      material.setStripes(STRIPED, look.stripes, side, modelHeight)
      material.set(look)
      material.setPaint(look.paint)
      material.setToon(look.toon)
    },
    pose(time, vx, vz) {
      // Eased by the time the pose moved on, so a held pose holds its blend and its turn too.
      const step = time - posedAt
      posedAt = time
      const k = step > 0 && step < 1 ? 1 - Math.exp(-step / EASE) : 0
      const speed = Math.hypot(vx, vz)
      running += (Math.min(1, speed / RUN_FULL) - running) * k
      if (speed > 0.05) {
        let turn = Math.atan2(vx, vz) - yaw
        turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2))
        yaw += turn * k
        root.rotation.y = yaw
      }
      // The idle and the run share the pose by the pace.
      idle?.setEffectiveWeight(1 - running)
      run?.setEffectiveWeight(running)
      // Moved on by the step, not set to the time, so a held pose holds.
      if (step > 0) mixer.update(step)
    },
    tip(out, offset) {
      object.updateMatrixWorld(true)
      torch.getWorldPosition(out)
      if (offset !== undefined) out.add(turned.copy(offset).applyAxisAngle(UP, yaw))
      return out
    },
  }
}
