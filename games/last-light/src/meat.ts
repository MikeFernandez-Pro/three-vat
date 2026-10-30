// The meat at the centre: the goose, her torch in her beak (a pumpkin kid with a torch in its hand on the kid's ghosts
// trial), the meat the swarm is starving for, standing at the light where every rat wants to be. A skinned model played
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
  /** Where the file holds more than one: the armature it is, the rest dropped. */
  armature?: string
  /** Whether the file stands it up z and not y: stood up, it is turned a quarter round x. */
  zUp?: boolean
  /** The clips it plays: standing, and carried along; and, where it swims, the same two afloat. */
  idle: string
  run: string
  waterIdle?: string
  swim?: string
  /** Its walk, where it has one: played for the run while it is calm (`setCalm`). */
  walk?: string
  /** Its jump of fright, where it has one, played through by `setStartle`. */
  startle?: string
  /** Its feet's bones, where it has its footfalls heard: each foot is down where it is lowest in its run and its walk. */
  feet?: readonly [string, string]
  /** Which way the model faces as modelled, as a yaw; it is turned to face +z, as the rat does. */
  facing: number
  /** The way it faces before the light first walks, as a yaw: 0 at the camera, PI ahead, up the screen. */
  start: number
  /**
   * The bone that carries the torch's end; and the part the end is on, the
   * torch's cup: the end is the middle of the cup's end furthest from the
   * bone, for a torch held lying down, or of its top, for one held upright.
   */
  carrier: string
  torchPart: string
  torchEnd: 'far' | 'top'
  /** Whether the first part, the pyjamas, starts striped. */
  striped: boolean
  /** What the panel calls its parts, by material, where the file's names say nothing. */
  partNames: Record<string, string>
  /** The colours its parts start in, by material, where the panel set them over the file's. */
  partColours: Record<string, number>
  /** The part, by material, that may glow, its colour added as light, as bright as the panel has it: none, none glows. */
  glowPart?: string
  /** How bright that part glows to start, 0 not at all. */
  glow?: number
  /** How tall it stands to start, m; and how fast its run clip plays to start, 1 as authored, and its swim, its run's speed if not given. */
  height: number
  runSpeed: number
  swimSpeed?: number
}

// A child in pyjamas with a pumpkin for a head, facing +x as modelled, a torch in the
// right hand, lying along +x at rest: the flame burns in the metal cup at its far end.
const PUMPKIN_KID: Character = {
  label: 'pumpkin kid',
  model: './models/pumpkinKid.glb',
  idle: 'Idle',
  run: 'Run',
  facing: Math.PI / 2,
  start: Math.PI,
  carrier: 'skinned_r_handPlacement_bn',
  torchPart: 'LightGrey.002',
  torchEnd: 'far',
  striped: true,
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

// The torch in its beak, the flame in the metal cup at its top, on its right; the goose faces -z as modelled, in its
// file's colours. Its file holds the gosling too (goslings.ts), y-up, with the clips of both, its own unprefixed; and
// it swims: still or swimming, afloat.
const GOOSE: Character = {
  label: 'goose',
  model: './models/geese.glb',
  armature: 'GooseArmature_01',
  idle: 'idle',
  run: 'run',
  walk: 'walk',
  startle: 'jump',
  feet: ['bone_leg_L4', 'bone_leg_R4'],
  waterIdle: 'water_idle',
  swim: 'swim',
  facing: Math.PI,
  start: Math.PI,
  carrier: 'bone_head_2',
  torchPart: 'LightGrey',
  torchEnd: 'top',
  striped: false,
  partNames: {},
  // Her white pure white, as set from the panel on 2026-10-29, not glowing at all since the same day (no bloom): her goslings' too.
  partColours: { 'Material.004': 0xffffff },
  glowPart: 'Material.004',
  glow: 0,
  // Set from the panel on 2026-10-08: 0.9 m tall, 1.05 m on 2026-10-26; on 2026-10-21 her swim three times as fast as authored.
  height: 1.05,
  runSpeed: 1,
  swimSpeed: 3,
}

/** Which the meat is: the goose in the goose game; the pumpkin kid on the kid's ghosts trial, kid-ghosts.html. */
export const goose = !location.pathname.endsWith('/kid-ghosts.html')
const CHARACTER = goose ? GOOSE : PUMPKIN_KID

/** What the panel calls it; and whether it swims, with clips of its own for the water. */
export const characterLabel = CHARACTER.label
export const swims = CHARACTER.waterIdle !== undefined && CHARACTER.swim !== undefined
/** The light's pace, m/s, at which the meat is all run; and the seconds its blend and its turn take to follow. */
const RUN_FULL = 1
/** Calm, the pace at which it is all walk, m/s; and the pace its walk plays at as authored, m/s. */
const CALM_FULL = 0.25
const WALK_STRIDE = 0.6
const EASE = 0.2
/** How long its jump of fright takes to give the pose back to its idle and run once it is over, s: eased, not cut. */
const STARTLE_OUT = 0.6
/** A foot is down once within this share of its rise above its lowest. */
const LANDED = 0.15
/** Feet that come down within this share of their gait's round of each other are one step. */
const ONE_STEP = 0.15
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
  /** How fast its idle and its run clips play, 1 as authored; and its water idle and its swim, where it swims. */
  idleSpeed: number
  runSpeed: number
  waterIdleSpeed: number
  swimSpeed: number
  /** Whether it casts a shadow: the lamp burns right over it, so its own falls under it. */
  castShadow: boolean
  /** Its parts' colours, a material each in the model's order, read once it is loaded. */
  parts: MeatPart[]
  /** Stripes on the first part, across its rest pose. */
  stripes: StripeLook
  paint: PaintLook
  toon: ToonLook
}

/** A part of the meat, by what the panel calls it, and its colour; the part that may glow, how bright, 0 not at all. */
export interface MeatPart {
  name: string
  color: number
  glow?: number
}

/** The meat on the ground at its height, its clips as authored, shaded as the rats start, in its parts' own colours. */
export const defaultMeat = (): MeatLook => ({
  enabled: true,
  height: CHARACTER.height,
  lift: 0,
  idleSpeed: 1,
  runSpeed: CHARACTER.runSpeed,
  waterIdleSpeed: 1,
  swimSpeed: CHARACTER.swimSpeed ?? CHARACTER.runSpeed,
  // The goose's shadow, and her highlight and rim, as set from the panel on 2026-10-26: a pale blue glint; her rim a
  // fainter lilac since 2026-10-29, the goslings' too.
  castShadow: goose,
  parts: [],
  // The pyjamas in pale blue stripes, upright, about 3 cm apart.
  stripes: { enabled: CHARACTER.striped, color: 0x8fa7c4, count: 40, width: 0.35, angle: 90 },
  sheen: 0,
  specular: 0.27,
  shininess: 30,
  softness: 0.17,
  specularColor: goose ? 0xc0d8f0 : 0x1c401c,
  rim: true,
  rimStrength: goose ? 0.64 : 1.24,
  rimWidth: 0.37,
  rimSoftness: 0.1,
  rimColor: goose ? 0xedbefe : 0xe66e2d,
  paint: { strength: 1.3, density: 2.5, size: 1.75, rounding: 0 },
  toon: { steps: 3, three: [0.03, 0.38, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
})

export interface Meat {
  /** What the scene adds; move it to the light. */
  readonly object: Group
  readonly material: ShellToonMaterial
  /** Its parts: what the panel calls each, and the colour it starts in, its character's or its file's. */
  readonly parts: MeatPart[]
  /** How big it is drawn against its file's own units: the folder's height over its model's. */
  modelScale(): number
  /** Take the meat folder's values. */
  set(look: MeatLook): void
  /** Pose it at `time` seconds of its clips, the light walking at (vx, vz) m/s; standing, turning to face `rest`, a yaw, if given. */
  pose(time: number, vx: number, vz: number, rest?: number): void
  /** Turn it to face `yaw` at once, as a page that turns it itself has it: 0 faces +z. */
  face(yaw: number): void
  /** How fast its clips play against the pose's time: under 1 for a slower cycle, a crawl's. */
  setRate(rate: number): void
  /** How far it swims, 0 on land to 1 afloat: its water clips take over, eased, where it has them. */
  setSwimming(share: number): void
  /** Whether it is calm: moving, it walks, at the pace its walk has, where it has a walk, and never runs. */
  setCalm(calm: boolean): void
  /** How far through its jump of fright it is, 0 to 1, the jump all of its pose; none, it is not startled. */
  setStartle(share: number | undefined): void
  /**
   * Where the end of its bandage is, world space, as last posed and placed:
   * where the torch burns. Moved by `offset`, m, as the meat faces: x to its
   * left, y up, z ahead, turning with it but never leaning with the bone.
   */
  tip(out: Vector3, offset?: Vector3): Vector3
  /**
   * Where the torch rests: the tip's mean over the idle, carried where the
   * meat now stands and faces, moved by `offset` as `tip` is. It holds still
   * while the arm sways, for a mark drawn round the torch that must not.
   */
  restTip(out: Vector3, offset?: Vector3): Vector3
  /** Its bone named `name`, as posed: to carry something on it. */
  bone(name: string): Object3D | undefined
  /** How many times a foot has come down so far, in its run or its walk on land, where its character has `feet`. */
  readonly footfalls: number
}

export async function createMeat(): Promise<Meat> {
  const gltf = await new GLTFLoader().loadAsync(CHARACTER.model)
  // Only its own armature, where the file holds others; stood up, where the file is z-up.
  if (CHARACTER.armature !== undefined) for (const child of [...gltf.scene.children]) if (child.name !== CHARACTER.armature) gltf.scene.remove(child)
  if (CHARACTER.zUp) gltf.scene.rotation.x = -Math.PI / 2
  const turned = new Group().add(gltf.scene)
  turned.rotation.y = -CHARACTER.facing
  const root = new Group().add(turned)
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
  // How tall it is as modelled, up its file's own up.
  const modelHeight = CHARACTER.zUp ? box.max.z - box.min.z : box.max.y - box.min.y
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
  // from the bone, its mouth on a torch held lying down, or the middle of its top, on one held
  // upright, so the flame burns in the cup and not on its rim. Read where the skin draws it, not where
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
  let end: Vector3
  if (CHARACTER.torchEnd === 'top') {
    const low = new Vector3(Infinity, Infinity, Infinity)
    const high = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const at of drawn) {
      low.min(at)
      high.max(at)
    }
    end = new Vector3((low.x + high.x) / 2, high.y, (low.z + high.z) / 2)
  } else {
    // The middle of every point within a hundredth of the model's height of the furthest.
    const furthest = Math.max(...drawn.map((at) => at.distanceTo(held)))
    const mouth = drawn.filter((at) => at.distanceTo(held) > furthest - modelHeight * 0.01)
    end = mouth.reduce((sum, at) => sum.add(at), new Vector3()).divideScalar(mouth.length)
  }
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
  const walk = CHARACTER.walk === undefined ? undefined : play(CHARACTER.walk)
  walk?.setEffectiveWeight(0)
  const startle = CHARACTER.startle === undefined ? undefined : play(CHARACTER.startle)
  startle?.setEffectiveWeight(0)
  if (startle) startle.timeScale = 0
  let startledAt: number | undefined
  /** How much of the pose its jump still holds, 1 while it jumps, easing to 0 after. */
  let startleHeld = 0
  const waterIdle = CHARACTER.waterIdle === undefined ? undefined : play(CHARACTER.waterIdle)
  const swim = CHARACTER.swim === undefined ? undefined : play(CHARACTER.swim)
  waterIdle?.setEffectiveWeight(0)
  swim?.setEffectiveWeight(0)
  // The torch's rest, in the root's own space: the tip's mean over a round of the idle, read once.
  const rest = new Vector3()
  if (idle !== undefined) {
    const samples = 32
    run?.setEffectiveWeight(0)
    const at = new Vector3()
    for (let k = 0; k < samples; k++) {
      mixer.setTime((k / samples) * idle.getClip().duration)
      root.updateMatrixWorld(true)
      rest.add(root.worldToLocal(torch.getWorldPosition(at)))
    }
    rest.divideScalar(samples)
    mixer.setTime(0)
    run?.setEffectiveWeight(1)
  }
  // When each foot comes down in the run and the walk, read once over a round of each alone: where it first sinks to
  // within LANDED of its lowest, in the root's own space, from higher.
  const landings = new Map<AnimationAction, number[]>()
  const feet = CHARACTER.feet?.map((name) => root.getObjectByName(name))
  if (feet !== undefined && feet.every((foot): foot is Object3D => foot !== undefined)) {
    const samples = 60
    const at = new Vector3()
    const gaits = [idle, run, walk]
    for (const gait of [run, walk]) {
      if (gait === undefined) continue
      const shown = gaits.map((action) => action?.getEffectiveWeight() ?? 0)
      for (const action of gaits) action?.setEffectiveWeight(action === gait ? 1 : 0)
      const duration = gait.getClip().duration
      const heights = feet.map(() => [] as number[])
      for (let k = 0; k < samples; k++) {
        mixer.setTime((k / samples) * duration)
        root.updateMatrixWorld(true)
        feet.forEach((foot, j) => heights[j]!.push(root.worldToLocal(foot.getWorldPosition(at)).y))
      }
      const times: number[] = []
      for (const ys of heights) {
        const low = Math.min(...ys)
        const down = low + (Math.max(...ys) - low) * LANDED
        ys.forEach((y, k) => {
          if (y <= down && ys[(k + samples - 1) % samples]! > down) times.push((k / samples) * duration)
        })
      }
      // The goose's run brings both feet down within 45 ms of each other, twice a round: heard as one step each time.
      times.sort((a, b) => a - b)
      landings.set(gait, times.filter((t, k) => k === 0 || t - times[k - 1]! > ONE_STEP * duration))
      gaits.forEach((action, j) => action?.setEffectiveWeight(shown[j]!))
    }
    mixer.setTime(0)
  }
  let footfalls = 0
  /** How much of the run shows, 0 to 1; the time it was last posed at, and the way it faces. */
  let running = 0
  /** How far it swims, 0 to 1, eased after the share it was last given. */
  let swimming = 0
  let calm = false
  let swimmingTo = 0
  let posedAt = 0
  /** How fast the clips play against the pose's time. */
  let rate = 1
  let yaw = CHARACTER.start
  const offsetTurned = new Vector3()

  // The model's own size is three centimetres: it is scaled to the folder's height.
  const object = new Group()
  object.add(root)
  root.rotation.y = yaw

  return {
    object,
    material,
    modelScale: () => root.scale.x,
    parts: names.map((name, i) => ({ name: CHARACTER.partNames[name] ?? name, color: CHARACTER.partColours[name] ?? colours[i].getHex(), ...(name === CHARACTER.glowPart && { glow: CHARACTER.glow ?? 0 }) })),
    set(look) {
      object.visible = look.enabled
      merged.castShadow = look.castShadow
      root.scale.setScalar(look.height / modelHeight)
      if (idle !== undefined) idle.timeScale = look.idleSpeed
      if (run !== undefined) run.timeScale = look.runSpeed
      if (waterIdle !== undefined) waterIdle.timeScale = look.waterIdleSpeed
      if (swim !== undefined) swim.timeScale = look.swimSpeed
      root.position.y = look.lift
      look.parts.forEach((part, i) => material.parts[i]?.value.set(part.color))
      const glowing = look.parts.findIndex((part) => part.glow !== undefined)
      material.setGlow(glowing, look.parts[glowing]?.glow ?? 0)
      material.setStripes(STRIPED, look.stripes, side, modelHeight)
      material.set(look)
      material.setPaint(look.paint)
      material.setToon(look.toon)
    },
    pose(time, vx, vz, rest) {
      // Eased by the time the pose moved on, so a held pose holds its blend and its turn too.
      const step = time - posedAt
      posedAt = time
      const k = step > 0 && step < 1 ? 1 - Math.exp(-step / EASE) : 0
      const speed = Math.hypot(vx, vz)
      running += (Math.min(1, speed / (calm && walk ? CALM_FULL : RUN_FULL)) - running) * k
      swimming += (swimmingTo - swimming) * k
      const walking = speed > 0.05
      if (walking || rest !== undefined) {
        let turn = (walking ? Math.atan2(vx, vz) : rest!) - yaw
        turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2))
        yaw += turn * k
        root.rotation.y = yaw
      }
      // The idle and the run share the pose by the pace, and their water clips take it over as it swims.
      const land = waterIdle !== undefined && swim !== undefined ? 1 - swimming : 1
      idle?.setEffectiveWeight((1 - running) * land)
      run?.setEffectiveWeight(calm && walk ? 0 : running * land)
      walk?.setEffectiveWeight(calm ? running * land : 0)
      if (walk) walk.timeScale = Math.max(0.5, speed / WALK_STRIDE)
      waterIdle?.setEffectiveWeight((1 - running) * (1 - land))
      swim?.setEffectiveWeight(running * (1 - land))
      // Startled, its jump holds the whole pose, scrubbed to how far through it is; over, it holds its last pose as the
      // idle and the run come back under it, over STARTLE_OUT s, eased at both ends.
      if (startle) {
        const jumping = startledAt !== undefined
        startleHeld = jumping ? 1 : Math.max(0, startleHeld - (step > 0 ? step / STARTLE_OUT : 0))
        const held = startleHeld * startleHeld * (3 - 2 * startleHeld)
        startle.setEffectiveWeight(held)
        if (jumping) startle.time = startledAt! * startle.getClip().duration
        if (held > 0) for (const other of [idle, run, walk, waterIdle, swim]) other?.setEffectiveWeight(other.getEffectiveWeight() * (1 - held))
      }
      // Moved on by the step, not set to the time, so a held pose holds.
      const gait = calm && walk ? walk : run
      const was = gait?.time ?? 0
      if (step > 0) mixer.update(step * rate)
      // A foot down each time the gait passes one of its landings, while it carries her on land.
      const times = gait && landings.get(gait)
      if (times && step > 0 && walking && startledAt === undefined && running * land > 0.5) {
        const now = gait!.time
        for (const t of times) if (now >= was ? t > was && t <= now : t > was || t <= now) footfalls++
      }
    },
    face(to) {
      yaw = to
      root.rotation.y = yaw
    },
    setRate(to) {
      rate = to
    },
    setSwimming(share) {
      swimmingTo = share
    },
    setCalm(to) {
      calm = to
    },
    setStartle(share) {
      startledAt = share
    },
    tip(out, offset) {
      object.updateMatrixWorld(true)
      torch.getWorldPosition(out)
      if (offset !== undefined) out.add(offsetTurned.copy(offset).applyAxisAngle(UP, yaw))
      return out
    },
    restTip(out, offset) {
      object.updateMatrixWorld(true)
      root.localToWorld(out.copy(rest))
      if (offset !== undefined) out.add(offsetTurned.copy(offset).applyAxisAngle(UP, yaw))
      return out
    },
    bone(name) {
      return root.getObjectByName(name)
    },
    get footfalls() {
      return footfalls
    },
  }
}
