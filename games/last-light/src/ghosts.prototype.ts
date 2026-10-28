// PROTOTYPE, throwaway (`?ghosts`, `?ghosts=float`, `?ghosts=rag`, `?ghosts=ball`, `&ghostcount=`): ghost geese, a sheet
// over a goose that is not there. Asked for on 2026-10-27: characters in the world that haunt and guide
// her, no light of their own, several of them. For now each goes slowly round a small circle in front
// of her, walking or idle: the question is whether a sheet over a goose reads as a Halloween ghost, and
// how its cloth hangs and trails.
//
// Each ghost is a hidden copy of the ghost goose (ghostGoose.glb: her rig, no wings, no torch) playing its idle, and a sheet: the verlet
// cloth of three's webgpu_compute_cloth example, springs and points in storage buffers stepped by two
// compute passes at 360 steps a second. The sheet is worn, as a costume's cloth is in games: dropped
// straight down from over her onto a smooth blob round her bones (the spheres, blended, swollen by the
// cloth's thickness), every point that lands on her rides the bone it landed nearest, and only the rest,
// the skirt and the tent between her head and her back, is simulated. WebGPU only, agreed.
//
// The presets are the silhouettes to judge: `long` hangs to the ground, `float` is a short sheet
// hovering high with nothing under its hem, `rag` is the floating one torn at its edge, a little
// see-through, in more wind. `ball` (asked for on 2026-10-28, for a more natural ghost) is the plain
// sheet ghost: no goose under it, the sheet laid over one sphere and hanging free from its middle.
import {
  AnimationMixer,
  Box3,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshLambertNodeMaterial,
  Object3D,
  PointLight,
  Raycaster,
  Vector3,
  type AnimationAction,
  type ComputeNode,
  type Node,
  type WebGPURenderer,
} from 'three/webgpu'
import {
  atan,
  attribute,
  faceDirection,
  float,
  Fn,
  frontFacing,
  If,
  instancedArray,
  instanceIndex,
  length,
  Loop,
  mix,
  Return,
  select,
  sin,
  smoothstep,
  time,
  transformNormalToView,
  triNoise3D,
  uint,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import type { FixedLight } from './swarm'
import { FakeLamp, type FakeLamps } from './fakelamps'

// The ghosts' own goose, brought in on 2026-10-27 (ghostGoose.glb): her rig and clips, no wings, no torch.
// Its default scene is the skinned goose, off the origin; its other scene, a still preview, is not loaded.
const MODEL = './models/ghostGoose.glb'
/** Her height, m, as meat.ts draws her: a ghost is her size. */
const HEIGHT = 1.05
/** Points a side of a sheet; its grid is SIDE x SIDE, laid out as a disc. */
const SIDE = 41
/** Cloth steps a second, the example's; and the longest frame stepped, s, so a stall does not throw the sheet. */
const STEPS = 360
const STEP = 1 / STEPS
const LONGEST = 1 / 30
/** Seconds of cloth stepped before the first frame, so it starts hanging, not falling. */
const SETTLE = 3
/** Where the ghosts stand, m off her start: in front of her (-z), in the fixed camera's view, clear of the fire pit on her right. */
const SPOTS: readonly [number, number][] = [
  [-1.5, -1.5],
  [0.9, -2.9],
  [-0.9, -4.3],
  [2.7, -3.8],
  [-3, -3.4],
  [1.6, -4.8],
  [-1.2, -5],
  [3.8, -5.2],
]

/** The spheres her blob is made of: a bone and a radius, m. */
const COLLIDERS: readonly { bone: string; radius: number }[] = [
  { bone: 'bone_head_1', radius: 0.075 },
  { bone: 'bone_head_3', radius: 0.05 },
  { bone: 'bone_neck_3', radius: 0.065 },
  { bone: 'bone_neck_5', radius: 0.06 },
  { bone: 'bone_neck_7', radius: 0.06 },
  { bone: 'bone_spine_1', radius: 0.16 },
  { bone: 'bone_spine_2', radius: 0.19 },
  { bone: 'bone_spine_3', radius: 0.16 },
  { bone: 'bone_spine_4', radius: 0.1 },
]
const DOWN = new Vector3(0, -1, 0)
/** The bone the sheet's middle is laid over. */
const HEAD_BONE = 'bone_head_1'

interface Preset {
  /** The sheet's radius, m, and how far behind her head its middle lies, m. */
  radius: number
  behind: number
  /** How high her feet float over the ground, m. */
  hover: number
  /** Torn at the edge. */
  torn: boolean
  wind: number
  opacity: number
  /** Laid over one sphere of this radius, m, not over her: no goose under it. */
  ball?: number
  /** Its own starting look, over the shared one. */
  look?: Partial<GhostLook>
}

const PRESETS: Record<string, Preset> = {
  long: { radius: 0.85, behind: 0.15, hover: 0.11, torn: false, wind: 3.1, opacity: 0.2 },
  float: { radius: 0.6, behind: 0.12, hover: 0.5, torn: false, wind: 0.6, opacity: 0.2 },
  rag: { radius: 0.68, behind: 0.12, hover: 0.45, torn: true, wind: 1.6, opacity: 0.2 },
  ball: {
    radius: 0.8,
    behind: 0,
    hover: 0.12,
    torn: false,
    wind: 1.2,
    opacity: 0.2,
    ball: 0.2,
    look: { bodies: 1, ballHeight: 0.66, eyesAhead: 0.14, eyesApart: 0.084, eyeSize: 0.035 },
  },
}

/** What the ghosts' folder edits live. */
export interface GhostLook {
  /** Cloth: spring pull per step, the bending springs' share of it, the speed kept per step, gravity's share, wind. */
  stiffness: number
  bend: number
  damping: number
  gravity: number
  wind: number
  /** Her blob: the spheres' radii as a share of the table's, how much they blend into one, m, the cloth's thickness off it, m. */
  bodies: number
  blend: number
  thickness: number
  /** What the sheet is dropped on: the spheres blended into one smooth blob, or her own mesh. */
  drape: 'blob' | 'shape'
  /** The `ball` preset's sphere: how high its middle stands over her feet, m. */
  ballHeight: number
  /** How high she floats, m, her bob, m and per second, and her turn, radians, 0 facing the camera. */
  hover: number
  bob: number
  bobRate: number
  turn: number
  /** Each going slowly round a circle about its spot: whether they do, its radius, m, and their pace, m/s. */
  circling: boolean
  circle: number
  speed: number
  /** Walking a walk: how fast, m/s, every ghost alike, so they still meet as they were laid to. */
  walkSpeed: number
  /** The rig's clip, and its pace. */
  clip: string
  pace: number
  /** The sheet: colour, its own glow in the dark, the inside's shade, opacity. */
  colour: number
  glow: number
  inside: number
  opacity: number
  /** The eyes: forward of her head bone and apart, m, their radius, m, and how dark, 0 the sheet's own to 1 black, their glow gone with it. */
  eyesAhead: number
  eyesApart: number
  eyeSize: number
  eyeDark: number
  /** Its own light, which holds rats off as a brazier's does: whether it shines, how far it holds them, m, its lamp's colour,
   * strength and height over her feet, m. */
  lit: boolean
  reach: number
  lamp: number
  lampStrength: number
  lampHeight: number
  /** Debug: the spheres drawn, the goose under the sheet drawn, the worn points shown red. */
  showBodies: boolean
  showGoose: boolean
  showWorn: boolean
}

// Set from the panel on 2026-10-27: a soft, see-through pale blue sheet, glowing; then again, brighter, with a
// wider, stronger light and a faint bob.
// Then on 2026-10-27 again: a stiff sheet blowing hard, paler and bluer, its eyes bigger, its feet slower; and once
// more, a little softer, heavier and swinging longer, its inside lighter; then soft and swinging on almost freely.
const defaultLook = (preset: Preset): GhostLook => ({
  stiffness: 0.2,
  bend: 0.8,
  damping: 0.999,
  gravity: 1.57,
  wind: preset.wind,
  bodies: 1.18,
  blend: 0.12,
  drape: 'blob',
  thickness: 0.04,
  ballHeight: 0.66,
  hover: preset.hover,
  bob: 0.025,
  bobRate: 0.45,
  turn: 0.6,
  circling: true,
  circle: 0.9,
  speed: 0.4,
  walkSpeed: 1,
  clip: 'walk',
  pace: 0.49,
  colour: 0x94a9ff,
  glow: 1.12,
  inside: 0.72,
  opacity: preset.opacity,
  eyesAhead: 0.04,
  eyesApart: 0.07,
  eyeSize: 0.047,
  eyeDark: 1,
  lit: true,
  reach: 1.75,
  lamp: 0x94d4ff,
  lampStrength: 18.9,
  lampHeight: 0.5,
  showBodies: false,
  showGoose: false,
  showWorn: false,
  ...preset.look,
})

interface Ghost {
  rig: Group
  model: Object3D
  mixer: AnimationMixer
  actions: Map<string, AnimationAction>
  head: Object3D
  bones: Object3D[]
  meshes: Mesh[]
  lamp: PointLight | FakeLamp
  x: number
  z: number
  /** Its circle's middle, where it stands on its spot; how far round it, radians, and which way, 1 or -1. */
  cx: number
  cz: number
  round: number
  way: number
  yaw: number
  phase: number
}

/** Where each ghost walks, if not round a circle of its own: how many, their light's reach, m, and where ghost `g` is at `t` s of the play. */
export interface Walk {
  count: number
  reach: number
  /** How fast they were laid to walk, m/s: `at` is where they are at that pace. */
  speed: number
  at(g: number, t: number): { x: number; z: number }
}

export interface Ghosts {
  readonly object: Group
  readonly look: GhostLook
  readonly preset: string
  readonly count: number
  /** Whether they walk a walk, not circles of their own. */
  readonly walking: boolean
  /** Each ghost's light as the swarm reads it, moved with it every frame: the rats keep out of it. */
  readonly lights: FixedLight[]
  /** Lays the sheets again on her blob as it is set now. */
  wear(): void
  /** `t`, the play's time, s, for a walk's ghosts. */
  update(dt: number, t?: number): void
}

/** The concentric map of the square [-1, 1]^2 onto the unit disc (Shirley and Chiu): the grid laid as a round sheet. */
function disc(a: number, b: number): [number, number] {
  if (a === 0 && b === 0) return [0, 0]
  let r: number
  let phi: number
  if (Math.abs(a) > Math.abs(b)) {
    r = a
    phi = (Math.PI / 4) * (b / a)
  } else {
    r = b
    phi = Math.PI / 2 - (Math.PI / 4) * (a / b)
  }
  return [r * Math.cos(phi), r * Math.sin(phi)]
}

/** The polynomial smooth minimum: two distances blended over `k`. */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export async function createGhosts(
  renderer: WebGPURenderer,
  her: { x: number; z: number },
  groundAt: (x: number, z: number) => number,
  presetName: string,
  count: number,
  walk?: Walk,
  /** Where given, each ghost's lamp a fake lamp of these (fakelamps.ts), not a point light. */
  lamps?: FakeLamps,
): Promise<Ghosts> {
  const preset = PRESETS[presetName] ?? PRESETS.long!
  const look = defaultLook(preset)
  // Her blob, or the `ball` preset's one sphere, a bone of its own in the rig.
  const colliders = preset.ball ? [{ bone: 'ball', radius: preset.ball }] : COLLIDERS
  const K = colliders.length
  if (new URLSearchParams(location.search).has('ghostdebug')) look.showBodies = look.showGoose = look.showWorn = true
  if (new URLSearchParams(location.search).get('ghostdrape') === 'shape') look.drape = 'shape'
  count = walk ? walk.count : Math.max(1, Math.min(SPOTS.length, count))
  if (walk) {
    look.reach = walk.reach
    look.walkSpeed = walk.speed
  }
  const object = new Group()
  const gltf = await new GLTFLoader().loadAsync(MODEL)
  const upright = new Group().add(gltf.scene)
  upright.updateMatrixWorld(true)
  const box = new Box3().setFromObject(upright, true)
  const scale = HEIGHT / (box.max.y - box.min.y)
  const centre = box.getCenter(new Vector3())
  const goose = new MeshLambertNodeMaterial({ color: 0x8899aa })

  // The ghosts, each its own rig, still, where SPOTS has them.
  const ghosts: Ghost[] = []
  for (let g = 0; g < count; g++) {
    const model = clone(gltf.scene) as Object3D
    model.position.set(-centre.x, -box.min.y, -centre.z)
    const meshes: Mesh[] = []
    model.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.material = goose
      mesh.frustumCulled = false
      meshes.push(mesh)
    })
    // Modelled facing -z; turned to face +z, so a turn of 0 looks along +z, at the camera.
    const body = new Group().add(model)
    body.rotation.y = Math.PI
    body.scale.setScalar(scale)
    const ball = new Object3D()
    ball.name = 'ball'
    ball.position.y = look.ballHeight
    const rig = new Group().add(preset.ball ? ball : body)
    // Its lamp, as a brazier's (lights.ts): no falling off inside its reach, cut at it; no shadow, so no new pipelines for one.
    const lamp = lamps ? lamps.track(new FakeLamp(look.lamp, look.lampStrength, look.reach, 0)) : new PointLight(look.lamp, look.lampStrength, look.reach, 0)
    rig.add(lamp)
    object.add(rig)
    const mixer = new AnimationMixer(model)
    const actions = new Map<string, AnimationAction>()
    for (const clip of gltf.animations) if (!clip.name.startsWith('baby')) actions.set(clip.name, mixer.clipAction(clip))
    const [dx, dz] = SPOTS[g % SPOTS.length]!
    ghosts.push({
      rig,
      model,
      mixer,
      actions,
      head: preset.ball ? ball : model.getObjectByName(HEAD_BONE)!,
      bones: preset.ball ? [ball] : COLLIDERS.map((c) => model.getObjectByName(c.bone)!),
      meshes,
      lamp,
      x: her.x + dx,
      z: her.z + dz,
      cx: her.x + dx,
      cz: her.z + dz,
      round: g * 2.39996,
      way: g % 2 ? -1 : 1,
      yaw: 0,
      phase: g * 2.39996,
    })
  }
  let playing = ''
  const play = (name: string) => {
    if (name === playing) return
    playing = name
    ghosts.forEach((ghost, g) => {
      ghost.mixer.stopAllAction()
      const action = ghost.actions.get(name)
      if (!action) return
      action.play()
      action.time = ((g * 0.618034) % 1) * action.getClip().duration
    })
  }
  play(look.clip)
  let clock = 0
  /** How far along their walk they are, in s at the pace it was laid at: the play's time, sped or slowed by the
   * folder's speed, so a change of speed moves none of them on with a jump; and the play's time last seen. */
  let now = 0
  let seen = 0
  /**
   * Where its walk has it, facing the way it goes, easing round; else round its circle by `dt`, facing the way it goes;
   * or still on its spot, turned as the panel has it.
   */
  const go = (ghost: Ghost, dt: number, g: number) => {
    if (walk) {
      const here = walk.at(g, now)
      const next = walk.at(g, now + 0.15)
      ghost.x = here.x
      ghost.z = here.z
      const want = Math.atan2(next.x - here.x, next.z - here.z)
      const d = Math.atan2(Math.sin(want - ghost.yaw), Math.cos(want - ghost.yaw))
      ghost.yaw += dt > 0 ? d * (1 - Math.exp(-dt / 0.25)) : d
      return
    }
    if (!look.circling) {
      ghost.x = ghost.cx
      ghost.z = ghost.cz
      ghost.yaw = look.turn + ghost.phase * 0.15
      return
    }
    ghost.round += (ghost.way * look.speed * dt) / Math.max(look.circle, 0.1)
    ghost.x = ghost.cx + Math.cos(ghost.round) * look.circle
    ghost.z = ghost.cz + Math.sin(ghost.round) * look.circle
    // Along the circle: d/dt of (cos, sin) is (-sin, cos), its way round.
    ghost.yaw = Math.atan2(-Math.sin(ghost.round) * ghost.way, Math.cos(ghost.round) * ghost.way)
  }
  const placeRig = (ghost: Ghost) => {
    const y = groundAt(ghost.x, ghost.z) + look.hover + look.bob * Math.sin(clock * look.bobRate * Math.PI * 2 + ghost.phase)
    ghost.rig.position.set(ghost.x, y, ghost.z)
    ghost.rig.rotation.set(0, ghost.yaw, 0)
    if (preset.ball) ghost.head.position.y = look.ballHeight
    ghost.rig.updateMatrixWorld(true)
  }
  ghosts.forEach((ghost, g) => {
    ghost.mixer.update(0)
    go(ghost, 0, g)
    placeRig(ghost)
  })

  // The sheet's grid, laid flat as a disc in the ghost's own frame (x across, z forward), round her head bone.
  const V = SIDE * SIDE
  const N = count * V
  const at = (i: number, j: number) => j * SIDE + i
  const restXZ = new Float32Array(V * 2)
  for (let j = 0; j < SIDE; j++)
    for (let i = 0; i < SIDE; i++) {
      const [x, z] = disc((i / (SIDE - 1)) * 2 - 1, (j / (SIDE - 1)) * 2 - 1)
      // Relative to her head: the middle lies `behind` it, toward her tail (-z).
      restXZ.set([x * preset.radius, z * preset.radius - preset.behind], at(i, j) * 2)
    }

  // The springs: along, across, the diagonals, and the bending ones two points apart; rest lengths as laid flat.
  const springs: number[] = []
  const bends: number[] = []
  const link = (a: number, b: number, bend: boolean) => {
    springs.push(a, b)
    bends.push(bend ? 1 : 0)
  }
  for (let j = 0; j < SIDE; j++)
    for (let i = 0; i < SIDE; i++) {
      if (i + 1 < SIDE) link(at(i, j), at(i + 1, j), false)
      if (j + 1 < SIDE) link(at(i, j), at(i, j + 1), false)
      if (i + 1 < SIDE && j + 1 < SIDE) link(at(i, j), at(i + 1, j + 1), false)
      if (i + 1 < SIDE && j > 0) link(at(i, j), at(i + 1, j - 1), false)
      if (i + 2 < SIDE) link(at(i, j), at(i + 2, j), true)
      if (j + 2 < SIDE) link(at(i, j), at(i, j + 2), true)
    }
  const S1 = bends.length
  const S = S1 * count
  const springIds = new Uint32Array(S * 2)
  const springRest = new Float32Array(S * 2)
  const touching: number[][] = Array.from({ length: N }, () => [])
  for (let g = 0; g < count; g++)
    for (let s = 0; s < S1; s++) {
      const ra = springs[s * 2]!
      const rb = springs[s * 2 + 1]!
      const a = g * V + ra
      const b = g * V + rb
      const id = g * S1 + s
      springIds.set([a, b], id * 2)
      springRest.set([Math.hypot(restXZ[ra * 2]! - restXZ[rb * 2]!, restXZ[ra * 2 + 1]! - restXZ[rb * 2 + 1]!), bends[s]!], id * 2)
      touching[a]!.push(id)
      touching[b]!.push(id)
    }
  // Each point: worn (1) or free (0), its springs' count and where they start in the list, its ghost.
  const params = new Uint32Array(N * 4)
  const list: number[] = []
  for (let n = 0; n < N; n++) {
    params.set([0, touching[n]!.length, list.length, Math.floor(n / V)], n * 4)
    list.push(...touching[n]!)
  }

  const positions = new Float32Array(N * 3)
  const position = instancedArray(positions, 'vec3')
  const velocity = instancedArray(N, 'vec3')
  const vertexParams = instancedArray(params, 'uvec4')
  const springList = instancedArray(new Uint32Array(list), 'uint')
  const springVertex = instancedArray(springIds, 'uvec2')
  const springLength = instancedArray(springRest, 'vec2')
  const springForce = instancedArray(S, 'vec3')
  // Laid from the rigs every frame, one buffer (a pass may bind 8): the spheres (x, y, z, radius swollen by the
  // cloth's thickness), then every point's worn place (read only for the worn), then each ghost's ground.
  const WORN = count * K
  const FLOORS = WORN + N
  const laidArray = new Float32Array((FLOORS + count) * 4)
  const laid = instancedArray(laidArray, 'vec4')

  // Where each worn point rides: its bone, by index into COLLIDERS, and its place in that bone's space.
  const wornBone = new Int8Array(N).fill(-1)
  const wornLocal = new Float32Array(N * 3)
  const point = new Vector3()
  const centres = Array.from({ length: K }, () => new Vector3())
  const invert = new Matrix4()

  /** Her blob's distance at `p`, and the sphere nearest it into `nearest`. */
  const blobAt = (p: Vector3, nearest: { k: number }): number => {
    let d = Infinity
    let best = Infinity
    for (let k = 0; k < K; k++) {
      const own = p.distanceTo(centres[k]!) - colliders[k]!.radius * look.bodies
      if (own < best) {
        best = own
        nearest.k = k
      }
      d = smin(d, own, look.blend)
    }
    return d
  }

  /**
   * Lays each ghost's sheet on her blob as it stands: every point dropped straight down from over her; one that
   * lands on the blob (swollen by the thickness) is worn, riding the bone nearest; one that misses hangs free,
   * started a slope down from where it would lie flat, so the settle has little to undo.
   */
  const down = new Raycaster()
  const wear = () => {
    const nearest = { k: 0 }
    ghosts.forEach((ghost, g) => {
      ghost.rig.updateMatrixWorld(true)
      ghost.bones.forEach((bone, k) => bone.getWorldPosition(centres[k]!))
      const top = ghost.head.getWorldPosition(new Vector3())
      const yaw = ghost.rig.rotation.y
      const cos = Math.cos(yaw)
      const sin = Math.sin(yaw)
      const ground = groundAt(ghost.x, ghost.z)
      const landed: number[] = []
      for (let v = 0; v < V; v++) {
        const n = g * V + v
        const lx = restXZ[v * 2]!
        const lz = restXZ[v * 2 + 1]!
        // The ghost's frame turned by its yaw: x across, z forward.
        const wx = top.x + lx * cos + lz * sin
        const wz = top.z - lx * sin + lz * cos
        point.set(wx, top.y + 0.6, wz)
        let hit = false
        if (look.drape === 'shape') {
          // On her mesh as she stands, skinned; off it by the thickness, along its face.
          down.set(point, DOWN)
          const first = down.intersectObjects(ghost.meshes, false)[0]
          if (first) {
            hit = true
            point.copy(first.point)
            if (first.face) point.addScaledVector(first.face.normal.clone().transformDirection(first.object.matrixWorld), look.thickness)
            blobAt(point, nearest)
          }
        } else for (let s = 0; s < 96 && point.y > ground; s++) {
          const d = blobAt(point, nearest) - look.thickness
          if (d < 1e-4) {
            hit = true
            break
          }
          point.y -= Math.max(d, 0.003)
        }
        if (hit) {
          const bone = ghost.bones[nearest.k]!
          invert.copy(bone.matrixWorld).invert()
          const local = point.clone().applyMatrix4(invert)
          wornBone[n] = nearest.k
          wornLocal.set([local.x, local.y, local.z], n * 3)
          positions.set([point.x, point.y, point.z], n * 3)
          params[n * 4] = 1
          landed.push(v)
        } else {
          wornBone[n] = -1
          params[n * 4] = 0
          positions.set([wx, Number.NaN, wz], n * 3)
        }
      }
      // A free point starts below the nearest worn one by its distance from it, laid flat: hanging as it would.
      for (let v = 0; v < V; v++) {
        const n = g * V + v
        if (wornBone[n]! >= 0) continue
        let near = Infinity
        let y = top.y
        for (const w of landed) {
          const d = Math.hypot(restXZ[v * 2]! - restXZ[w * 2]!, restXZ[v * 2 + 1]! - restXZ[w * 2 + 1]!)
          if (d < near) {
            near = d
            y = positions[(g * V + w) * 3 + 1]!
          }
        }
        positions[n * 3 + 1] = Math.max(ground + 0.02, y - near)
      }
    })
    position.value.needsUpdate = true
    vertexParams.value.needsUpdate = true
    velocity.value.array.fill(0)
    velocity.value.needsUpdate = true
  }

  const stiffness = uniform(look.stiffness)
  const bend = uniform(look.bend)
  const damping = uniform(look.damping)
  const gravity = uniform(9.8 * STEP * STEP)
  const wind = uniform(look.wind)

  const springPass = Fn(() => {
    If(instanceIndex.greaterThanEqual(uint(S)), () => Return())
    const ids = springVertex.element(instanceIndex)
    const rest = springLength.element(instanceIndex)
    const delta = position.element(ids.y).sub(position.element(ids.x)).toVar()
    const dist = delta.length().max(1e-6)
    const k = select(rest.y.greaterThan(0.5), stiffness.mul(bend), stiffness)
    springForce.element(instanceIndex).assign(delta.mul(dist.sub(rest.x).mul(k).mul(0.5).div(dist)))
  })().compute(S) as ComputeNode

  const pointPass = Fn(() => {
    If(instanceIndex.greaterThanEqual(uint(N)), () => Return())
    const p = vertexParams.element(instanceIndex)
    const here = position.element(instanceIndex)
    If(p.x.greaterThan(uint(0)), () => {
      here.assign(laid.element(instanceIndex.add(uint(WORN))).xyz)
      Return()
    })
    const v = velocity.element(instanceIndex).mul(damping).toVar()
    Loop(p.y, ({ i }) => {
      const id = springList.element(p.z.add(uint(i)))
      const f = springForce.element(id)
      v.addAssign(select(springVertex.element(id).x.equal(instanceIndex), f, f.negate()))
    })
    v.y.subAssign(gravity)
    const gust = triNoise3D(here.mul(0.8), float(0.6), time).sub(0.25).mul(wind).mul(4e-5)
    v.addAssign(vec3(gust, gust.mul(0.3), gust.mul(0.6)))
    // Out of her spheres, swollen by the cloth's thickness; held where it touches, as cloth on a body is.
    Loop({ start: uint(0), end: uint(K), type: 'uint' }, ({ i }) => {
      const c = laid.element(p.w.mul(uint(K)).add(i))
      const off = here.add(v).sub(c.xyz).toVar()
      const dist = off.length().max(1e-6)
      const pen = c.w.sub(dist).max(0)
      v.mulAssign(select(pen.greaterThan(0), float(0.7), float(1)))
      v.addAssign(off.mul(pen.div(dist)))
    })
    const floor = laid.element(p.w.add(uint(FLOORS))).x
    If(here.y.add(v.y).lessThan(floor), () => {
      v.y.assign(floor.sub(here.y))
      v.x.mulAssign(0.6)
      v.z.mulAssign(0.6)
    })
    velocity.element(instanceIndex).assign(v)
    here.addAssign(v)
  })().compute(N) as ComputeNode

  // The drawn sheets: every point drawn where the cloth has it, its normal from its neighbours.
  const ids = new Float32Array(N)
  const nbr = new Float32Array(N * 4)
  const rest = new Float32Array(N * 2)
  const index: number[] = []
  for (let g = 0; g < count; g++)
    for (let j = 0; j < SIDE; j++)
      for (let i = 0; i < SIDE; i++) {
        const n = g * V + at(i, j)
        ids[n] = n
        nbr.set([g * V + at(Math.max(i - 1, 0), j), g * V + at(Math.min(i + 1, SIDE - 1), j), g * V + at(i, Math.max(j - 1, 0)), g * V + at(i, Math.min(j + 1, SIDE - 1))], n * 4)
        rest.set([restXZ[at(i, j) * 2]!, restXZ[at(i, j) * 2 + 1]!], n * 2)
        if (i + 1 < SIDE && j + 1 < SIDE) {
          const a = n
          const b = g * V + at(i + 1, j)
          const c = g * V + at(i, j + 1)
          const d = g * V + at(i + 1, j + 1)
          index.push(a, c, b, b, c, d)
        }
      }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(N * 3), 3))
  geometry.setAttribute('vid', new Float32BufferAttribute(ids, 1))
  geometry.setAttribute('nbr', new Float32BufferAttribute(nbr, 4))
  geometry.setAttribute('rest', new Float32BufferAttribute(rest, 2))
  geometry.setIndex(index)

  const colour = uniform(new Color(look.colour))
  const glow = uniform(look.glow)
  const inside = uniform(look.inside)
  const opacity = uniform(look.opacity)
  const eyesAhead = uniform(look.eyesAhead)
  const eyesApart = uniform(look.eyesApart)
  const eyeSize = uniform(look.eyeSize)
  const eyeDark = uniform(look.eyeDark)
  const showWorn = uniform(0)
  const sheet = new MeshLambertNodeMaterial({ side: DoubleSide, transparent: true })
  const n4 = attribute('nbr', 'vec4')
  const vid = uint(attribute('vid', 'float'))
  const along = position.element(uint(n4.y)).sub(position.element(uint(n4.x)))
  const across = position.element(uint(n4.w)).sub(position.element(uint(n4.z)))
  sheet.positionNode = position.element(vid)
  sheet.normalNode = transformNormalToView(across.cross(along).normalize()).toVarying().mul(faceDirection)
  const worn = vertexParams.element(vid).x.toFloat().toVarying()
  const restAt = attribute('rest', 'vec2')
  const eye = (side: number) => length(restAt.sub(vec2(eyesApart.mul(side), eyesAhead)))
  const eyes = smoothstep(eyeSize, eyeSize.mul(0.8), eye(1).min(eye(-1))).mul(eyeDark)
  const shade = select(frontFacing, float(1), inside)
  const cloth = mix(colour, vec3(1, 0.2, 0.1), worn.mul(showWorn))
  sheet.colorNode = vec4(mix(cloth.mul(shade), vec3(0.02, 0.02, 0.03), eyes), 1)
  // Every node material takes an emissive node; the types give it to the standard one alone.
  ;(sheet as unknown as { emissiveNode: Node }).emissiveNode = cloth.mul(glow).mul(shade).mul(eyes.oneMinus())
  // Torn: the edge cut ragged, by its angle round the middle.
  const middle = restAt.add(vec2(0, preset.behind))
  const angle = atan(middle.y, middle.x)
  const tear = float(0.86).add(sin(angle.mul(7)).mul(0.05)).add(sin(angle.mul(17).add(1.3)).mul(0.04)).add(sin(angle.mul(31).add(4.1)).mul(0.03))
  // The eyes as solid as they are dark, the light behind the sheet not showing through them.
  const solid = mix(opacity, float(1), eyes)
  sheet.opacityNode = preset.torn ? select(length(middle).div(preset.radius).lessThan(tear), solid, float(0)) : solid
  sheet.alphaTest = 0.05
  const sheets = new Mesh(geometry, sheet)
  sheets.frustumCulled = false
  object.add(sheets)

  // The spheres, to see what the sheet lies on.
  const balls = new InstancedMesh(new IcosahedronGeometry(1, 2), new MeshBasicNodeMaterial({ color: 0xff5533, wireframe: true }), count * K)
  balls.frustumCulled = false
  object.add(balls)
  const ballMatrix = new Matrix4()

  const lay = () => {
    ghosts.forEach((ghost, g) => {
      ghost.bones.forEach((bone, k) => {
        bone.getWorldPosition(point)
        const r = colliders[k]!.radius * look.bodies
        laidArray.set([point.x, point.y, point.z, r + look.thickness], (g * K + k) * 4)
        balls.setMatrixAt(g * K + k, ballMatrix.makeScale(r, r, r).setPosition(point))
      })
      for (let v = 0; v < V; v++) {
        const n = g * V + v
        const k = wornBone[n]!
        if (k < 0) continue
        point.fromArray(wornLocal, n * 3).applyMatrix4(ghost.bones[k]!.matrixWorld)
        laidArray.set([point.x, point.y, point.z, 0], (WORN + n) * 4)
      }
      laidArray[(FLOORS + g) * 4] = groundAt(ghost.x, ghost.z) + 0.02
    })
    laid.value.needsUpdate = true
    balls.instanceMatrix.needsUpdate = true
  }
  const step = () => {
    renderer.compute(springPass)
    renderer.compute(pointPass)
  }
  /** Lays the sheets on her as she stands and lets the free cloth fall still. */
  const dress = () => {
    wear()
    lay()
    for (let s = 0; s < SETTLE * STEPS; s++) step()
  }
  dress()

  const lights: FixedLight[] = ghosts.map((ghost) => ({ x: ghost.x, z: ghost.z, reach: look.reach, on: look.lit }))
  let owed = 0
  const update = (dt: number, t?: number) => {
    clock += dt
    const passed = t === undefined ? dt : Math.max(0, t - seen)
    if (t !== undefined) seen = t
    now += passed * (walk ? look.walkSpeed / Math.max(walk.speed, 1e-6) : 1)
    stiffness.value = look.stiffness
    bend.value = look.bend
    damping.value = look.damping
    gravity.value = 9.8 * look.gravity * STEP * STEP
    wind.value = look.wind
    colour.value.set(look.colour)
    glow.value = look.glow
    inside.value = look.inside
    opacity.value = look.opacity
    eyesAhead.value = look.eyesAhead
    eyesApart.value = look.eyesApart
    eyeSize.value = look.eyeSize
    eyeDark.value = look.eyeDark
    showWorn.value = look.showWorn ? 1 : 0
    balls.visible = look.showBodies
    play(look.clip)
    ghosts.forEach((ghost, g) => {
      ghost.mixer.timeScale = look.pace
      ghost.mixer.update(dt)
      ghost.model.traverse((o) => {
        if ((o as Mesh).isMesh) o.visible = look.showGoose
      })
      go(ghost, dt, g)
      placeRig(ghost)
    })
    ghosts.forEach((ghost, g) => {
      const light = lights[g]!
      light.x = ghost.x
      light.z = ghost.z
      light.reach = look.reach
      light.on = look.lit
      ghost.lamp.visible = look.lit
      ghost.lamp.color.set(look.lamp)
      ghost.lamp.intensity = look.lampStrength
      ghost.lamp.distance = look.reach
      ghost.lamp.position.y = look.lampHeight
    })
    lay()
    owed = Math.min(owed + dt, LONGEST)
    while (owed >= STEP) {
      step()
      owed -= STEP
    }
  }

  return { object, look, preset: presetName in PRESETS ? presetName : 'long', count, walking: walk !== undefined, lights, wear: dress, update }
}

/** The ghosts' folder; the preset and the count reload the page, the blob's settings lay the sheets again, the rest is live. */
export function mountGhostControls(ghosts: Ghosts, more?: (gui: GUI) => void): void {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;bottom:8px;left:524px;z-index:1000;max-height:90vh;overflow:auto'
  document.body.append(container)
  const gui = new GUI({ title: 'ghosts (prototype)', container, width: 250 } as ConstructorParameters<typeof GUI>[0])
  gui.close()
  // What the page adds (the graves) first, open; the ghosts' own folders after it, shut.
  more?.(gui)
  const { look } = ghosts
  const reload = (key: string, value: string) => {
    const url = new URL(location.href)
    url.searchParams.set(key, value)
    location.href = url.toString()
  }
  const page = { preset: ghosts.preset, count: ghosts.count }
  gui.add(page, 'preset', Object.keys(PRESETS)).name('sheet (reloads)').onFinishChange((v: string) => reload('ghosts', v))
  if (!ghosts.walking) gui.add(page, 'count', 1, SPOTS.length, 1).name('how many (reloads)').onFinishChange((v: number) => reload('ghostcount', String(v)))
  const again = () => ghosts.wear()
  const ball = PRESETS[ghosts.preset]?.ball !== undefined
  const blob = gui.addFolder(ball ? 'the sphere under it' : 'her shape under it').close()
  blob.add(look, 'bodies', 0.5, 2, 0.01).name(ball ? 'sphere size' : 'bodies size').onFinishChange(again)
  if (ball) blob.add(look, 'ballHeight', 0.2, 1.4, 0.01).name('sphere height m').onFinishChange(again)
  else blob.add(look, 'drape', ['blob', 'shape']).name('dropped on').onFinishChange(again)
  blob.add(look, 'blend', 0, 0.4, 0.005).name('blob smoothness m').onFinishChange(again)
  blob.add(look, 'thickness', 0, 0.15, 0.005).name('thickness m').onFinishChange(again)
  if (!ghosts.walking) blob.add(look, 'turn', -Math.PI, Math.PI, 0.01).name('turn (standing)').onFinishChange(again)
  blob.add(look, 'hover', 0, 1.2, 0.01).name('hover m').onFinishChange(again)
  blob.add({ again }, 'again').name('lay the sheet again')
  const cloth = gui.addFolder('cloth').close()
  cloth.add(look, 'stiffness', 0.05, 0.5, 0.01).name('stiffness')
  cloth.add(look, 'bend', 0, 1, 0.01).name('bending share')
  cloth.add(look, 'damping', 0.85, 0.999, 0.001).name('speed kept a step')
  cloth.add(look, 'gravity', 0, 2, 0.01).name('gravity share')
  cloth.add(look, 'wind', 0, 6, 0.05).name('wind')
  const idle = gui.addFolder('moves')
  if (ghosts.walking) idle.add(look, 'walkSpeed', 0.1, 3, 0.05).name('walk speed m/s')
  else {
    idle.add(look, 'circling').name('going round')
    idle.add(look, 'circle', 0.2, 4, 0.05).name('circle radius m')
    idle.add(look, 'speed', 0, 2, 0.01).name('pace m/s')
  }
  idle.add(look, 'clip', ['idle', 'water_idle', 'swim', 'walk', 'shake_dry']).name('rig clip')
  idle.add(look, 'pace', 0, 2, 0.01).name('clip pace')
  idle.add(look, 'bob', 0, 0.3, 0.005).name('bob m')
  idle.add(look, 'bobRate', 0, 2, 0.01).name('bob /s')
  const sheet = gui.addFolder('sheet').close()
  sheet.addColor(look, 'colour').name('colour')
  sheet.add(look, 'glow', 0, 2, 0.01).name('own glow')
  sheet.add(look, 'inside', 0, 1, 0.01).name('inside shade')
  sheet.add(look, 'opacity', 0.1, 1, 0.01).name('opacity')
  sheet.add(look, 'eyesAhead', -0.3, 0.4, 0.005).name('eyes ahead m')
  sheet.add(look, 'eyesApart', 0, 0.2, 0.002).name('eyes apart m')
  sheet.add(look, 'eyeSize', 0, 0.08, 0.001).name('eye size m')
  sheet.add(look, 'eyeDark', 0, 1, 0.01).name('eye darkness')
  const light = gui.addFolder('its light').close()
  light.add(look, 'lit').name('shines (rats keep out)')
  light.add(look, 'reach', 0.3, 6, 0.05).name('reach m')
  light.addColor(look, 'lamp').name('lamp colour')
  light.add(look, 'lampStrength', 0, 30, 0.1).name('lamp strength')
  light.add(look, 'lampHeight', 0, 1.5, 0.01).name('lamp height m')
  const debug = gui.addFolder('debug').close()
  debug.add(look, 'showBodies').name('show spheres')
  if (!ball) debug.add(look, 'showGoose').name('show goose')
  debug.add(look, 'showWorn').name('worn cloth red')
  gui.add({ copy: () => {
    const text = JSON.stringify(look)
    console.log(text)
    void navigator.clipboard?.writeText(text)
  } }, 'copy').name('copy values')
}
