// The meat at the centre: the roast chicken the swarm is starving for,
// standing at the light where every rat wants to be. A skinned model played
// by three's own mixer, not baked: one of it needs no VAT. Its flat colours,
// a mesh a colour on one rig, are merged into one skinned mesh on the shell
// material the rats and the floor wear, each colour a part of its own, so it
// is one draw and one shading; a piece the file left unskinned, the wrap
// wound round the bone's top, is skinned whole to that bone and rides it.
// Its idle plays on the clock the page
// gives, the run's, so the stop motion holds it on the beat with the rats;
// and as the light walks it runs, blending from the one clip to the other by
// how fast it goes, and turns to face its way. The blend and the turn move on
// that clock too, so they step on the beat like the pose. Asked to, it hops:
// its jump clip plays once over the idle and the run, and while the clip has
// it off the ground the whole of it rises on an arc, as high as the folder
// says, the torch and the lamp with it. A hop is juice: the swarm never sees
// it. Its highest point at rest is a torch's end: the flame burns on it,
// carried on the bone at the top of the rig.
import {
  AnimationMixer,
  BufferAttribute,
  Group,
  LoopOnce,
  Matrix4,
  Object3D,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Bone,
  type BufferGeometry,
  type Material,
  type Mesh,
} from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ShellToonMaterial, type GradeLook, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import type { ToonLook } from './toon'

/** The model, and the clips it plays: standing, and carried along. */
const MODEL = './models/roastedChicken.glb'
const IDLE = 'Chicken_Idle_Scared'
const RUN = 'Chicken_Run'
const JUMP = 'Chicken_Jump'
/** The light's pace, m/s, at which the meat is all run; and the seconds its blend and its turn take to follow. */
const RUN_FULL = 1
const EASE = 0.2
/** The seconds the jump takes to show, from its first frame, and to give way to the idle again once it has landed. */
const JUMP_IN = 0.06
const JUMP_OUT = 0.2
/**
 * The seconds of the jump clip at which its feet leave the ground and meet it
 * again, read off its legs: a crouch to 0.08, the push, then the legs held
 * tucked to 0.67 and the landing crouch. The clip never lifts the body; the
 * hop's arc spans these, and plays as fast as the clip does.
 */
const TAKEOFF = 0.12
const LANDING = 0.78
/** Which way the model faces at no turn, as a yaw: +z, as the rat does. */
const FACING = 0
/** The bone at the top of the rig, which carries the torch's end; and the material the end is the highest point of, every one where none is named so. */
const TOP_BONE = 'DEF_top'
const TORCH_MATERIAL = ''
const UP = new Vector3(0, 1, 0)
/** The part the gradient shades: the skin, the first material. */
const SKIN = 0
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
  /** How fast its jump clip plays, 1 as authored; and how high a hop lifts it, m, at the top of its arc. */
  jumpSpeed: number
  jumpStrength: number
  /** Whether it casts a shadow: the lamp burns right over it, so its own falls under it. */
  castShadow: boolean
  /** Its parts' colours, as modelled to start, a material each in the model's order: the skin, the stuffing at its open end, and the herbs on it. */
  colors: number[]
  /** The skin shaded top to bottom, over its own colour. */
  grade: GradeLook
  paint: PaintLook
  toon: ToonLook
}

/** Half a metre of roast chicken on the ground, in its own colours, shaded as the rats start. */
export const defaultMeat = (): MeatLook => ({
  enabled: true,
  height: 0.72,
  lift: 0,
  jumpSpeed: 1,
  jumpStrength: 0.35,
  castShadow: true,
  // The skin orange, the stuffing a warm gold, the herbs a bright green: set from the panel on 2026-10-07.
  colors: [0xe87b2c, 0xf9bc39, 0x54ff3d],
  // The gradient left on but one orange top to bottom, the roast's char gone with the new model: set from the panel on 2026-10-07.
  grade: { enabled: true, top: 0xe17637, bottom: 0xe17637, mid: 0.61, blend: 0.64 },
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
  /** Take the meat folder's values. */
  set(look: MeatLook): void
  /** Pose it at `time` seconds of its clips, the light walking at (vx, vz) m/s. */
  pose(time: number, vx: number, vz: number): void
  /** Hop: play the jump once from its start, unless it is in the air still; landed, it may go again before it has stood up. */
  jump(): void
  /**
   * Where the end of its bandage is, world space, as last posed and placed:
   * where the torch burns. Moved by `offset`, m, as the meat faces: x to its
   * left, y up, z ahead, turning with it but never leaning with the bone.
   */
  tip(out: Vector3, offset?: Vector3): Vector3
}

export async function createMeat(): Promise<Meat> {
  const gltf = await new GLTFLoader().loadAsync(MODEL)
  const root = gltf.scene
  root.updateMatrixWorld(true)
  const skinned: SkinnedMesh[] = []
  const loose: Mesh[] = []
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) skinned.push(o as SkinnedMesh)
    else if ((o as Mesh).isMesh) loose.push(o as Mesh)
  })
  const body = skinned[0]
  const carrier = root.getObjectByName(TOP_BONE) ?? body.skeleton.bones[0]
  const carrierSlot = Math.max(0, body.skeleton.bones.indexOf(carrier as Bone))

  // The parts, one a material, in the order the skinned meshes come: the order the folder's colours are in. A loose mesh takes its material's.
  const names: string[] = []
  const partOf = (mesh: Mesh) => {
    const name = (mesh.material as Material).name
    if (!names.includes(name)) names.push(name)
    return names.indexOf(name)
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

  // The torch's end: the highest point at rest of what carries it, carried by the bone at the top.
  const torchPart = names.indexOf(TORCH_MATERIAL)
  const part = geometry.getAttribute('part')
  const positions = geometry.getAttribute('position')
  let top = -1
  for (let i = 0; i < positions.count; i++) {
    if (torchPart >= 0 && part.getX(i) !== torchPart) continue
    if (top < 0 || positions.getY(i) > positions.getY(top)) top = i
  }
  const end = body.localToWorld(new Vector3().fromBufferAttribute(positions, Math.max(0, top)))
  const torch = new Object3D()
  torch.position.copy(carrier.worldToLocal(end))
  carrier.add(torch)

  const material = new ShellToonMaterial({ parts: names.length, graded: true, painted: { strokes: createStrokes(), extent: modelHeight } })
  const merged = new SkinnedMesh(geometry, material)
  merged.bind(body.skeleton, body.bindMatrix)
  merged.castShadow = merged.receiveShadow = true
  merged.frustumCulled = false
  const holder = body.parent!
  for (const mesh of [...skinned, ...loose]) mesh.parent?.remove(mesh)
  holder.add(merged)

  const mixer = new AnimationMixer(root)
  const play = (name: string): AnimationAction | undefined => {
    const clip = gltf.animations.find((c) => c.name === name)
    if (clip === undefined) return undefined
    const action = mixer.clipAction(clip)
    action.play()
    return action
  }
  const idle = play(IDLE)
  const run = play(RUN)
  // The jump plays once, asked for, and holds its last frame, a stand, while it gives way.
  const jump = play(JUMP)
  jump?.setLoop(LoopOnce, 1)
  if (jump !== undefined) jump.clampWhenFinished = true
  jump?.stop()
  /** How much of the run shows, 0 to 1, and of the jump; the time it was last posed at, and the way it faces. */
  let running = 0
  let air = 0
  let posedAt = 0
  let yaw = 0
  const turned = new Vector3()
  /** The folder's lift and hop, m, and how high the hop has it now. */
  let lift = 0
  let strength = 0
  let hop = 0

  // The model's own size is three centimetres: it is scaled to the folder's height.
  const object = new Group()
  object.add(root)

  return {
    object,
    material,
    set(look) {
      object.visible = look.enabled
      merged.castShadow = look.castShadow
      root.scale.setScalar(look.height / modelHeight)
      lift = look.lift
      strength = look.jumpStrength
      if (jump !== undefined) jump.timeScale = look.jumpSpeed
      root.position.y = lift + hop
      look.colors.forEach((color, i) => material.parts[i]?.value.set(color))
      material.setGrade(SKIN, look.grade, box.min.y, modelHeight)
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
        let turn = Math.atan2(vx, vz) + FACING - yaw
        turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2))
        yaw += turn * k
        root.rotation.y = yaw
      }
      // The jump shows at once and gives way once landed; the idle and the run share what it leaves.
      const jumping = jump?.isRunning() ?? false
      if (step > 0 && step < 1) air += ((jumping ? 1 : 0) - air) * (1 - Math.exp(-step / (jumping ? JUMP_IN : JUMP_OUT)))
      idle?.setEffectiveWeight((1 - running) * (1 - air))
      run?.setEffectiveWeight(running * (1 - air))
      jump?.setEffectiveWeight(air)
      // Moved on by the step, not set to the time: a clip played once keeps its place that way.
      if (step > 0) mixer.update(step)
      // Off the ground between takeoff and landing, on an arc as high as the folder says.
      const u = jumping ? (jump!.time - TAKEOFF) / (LANDING - TAKEOFF) : 0
      hop = u > 0 && u < 1 ? strength * 4 * u * (1 - u) : 0
      root.position.y = lift + hop
    },
    jump() {
      if (jump === undefined || (jump.isRunning() && jump.time < LANDING)) return
      jump.reset().play()
    },
    tip(out, offset) {
      object.updateMatrixWorld(true)
      torch.getWorldPosition(out)
      if (offset !== undefined) out.add(turned.copy(offset).applyAxisAngle(UP, yaw))
      return out
    },
  }
}
