// The goose game's goslings and pond, drawn (#187). A gosling is its own
// armature in the goose's file, `public/models/geese.glb`, a third of her
// height, in its own colours, each with a mixer of its own playing the file's
// baby idle while it stands and its run whenever it moves at all, however
// slowly or however it is moved; and in the water its baby water idle and
// swim, afloat, as the water gets deep enough.
// It is stood where the goose play has it, on the pond's ground (pond.ts):
// waiting by its brazier, facing it; out of the well, hopping, its jump played
// once a hop; in her circle, turning after the way it
// goes, a moment behind, down the bank and afloat after her. The pond itself
// is pond.ts's.
import {
  AnimationMixer,
  Box3,
  Color,
  Float32BufferAttribute,
  Group,
  type Mesh,
  SkinnedMesh,
  Vector3,
  type AnimationAction,
  type Material,
  type Node,
  type Object3D,
} from 'three/webgpu'
import { attribute, mix, uniform } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Act } from './gooseoutro'
import type { GoosePlay } from './gooseplay'
import type { PlaySwarm } from './play'
import { standingIn, swimmingIn, type PondLook } from './pond'
import { ShellToonMaterial, type ShellLook } from './shell'

/** The gosling's file, and its clips: standing, running, afloat, swimming and hopping. */
const MODEL = './models/geese.glb'
/** Its armature in the file, which holds the goose's too. */
const ARMATURE = 'GooseBabyArmature'
/** Its down's material in the file: the part that takes the goose's white and glow (`setDown`). */
const DOWN = 'GooseMaterial001'
const CLIPS = { idle: 'baby_idle', scared: 'baby_idle_scared', run: 'baby_run', walk: 'baby_walk', waterIdle: 'baby_water_idle', swim: 'baby_swim', jump: 'baby_jump', shake: 'baby_shake_dry' }
/** The pace a gosling's walk plays at as authored, m/s. */
const WALK_PACE = 0.45
/** How tall a gosling stands, m, as the page opens: set from the panel on 2026-10-26. */
export const GOSLING_HEIGHT = 0.45
/** How long a gosling's pace is smoothed over, s, for how fast its clips play. */
const PACE_SMOOTHING = 0.1
/** How fast it must go in a frame to be moving, m/s, and how long its run takes to blend in or out, s. */
const STILL = 0.01
const GAIT_BLEND = 0.08
/** How long it takes to turn most of the way to where it goes, s: each its own, between the two; and how fast it must go to turn at all, m/s. */
const TURN = [0.18, 0.3]
const TURNS_FROM = 0.15
/** The pace its run and its swim play at their own speed, m/s, a gosling's short legs; and how much faster than that they play at the most. */
const SWIM_PACE = 0.35
const RUN_PACE = 0.7
const FASTEST = 2.5

/** How fast each of a gosling's clips plays, 1 as authored: its run and swim faster again the faster it goes. */
export interface GoslingSpeeds {
  idle: number
  run: number
  waterIdle: number
  swim: number
}

/** Every clip as authored. */
export const defaultGoslingSpeeds = (): GoslingSpeeds => ({ idle: 1, run: 1, waterIdle: 1, swim: 1 })

/** How far off its place a gosling is drawn, m; and, where given, which way it faces there, its yaw, rad. */
export interface Lift {
  x: number
  y: number
  z: number
  yaw?: number
}

export interface Goslings {
  /** The birds, one child to a brazier, in the route's order: an empty group at a brazier with no gosling. */
  object: Group
  /**
   * Each gosling where `now` has it: turned and its gait blended over `dt` of
   * play, s; its clips played on to `time`, the page's held time, s, so they
   * hold on the beat as the goose's do. Each `lift` m off its place, where given: up in a scene's bucket or up its tree, and
   * across with the bucket; facing the lift's way, where it has one. Each as its `cue` has it, where given: in the
   * ending, shaking dry or hopping, its clip held at how far through it is, lifted as high as it hops; standing,
   * turning to the cue's way.
   */
  update(now: GoosePlay<PlaySwarm>, dt: number, time: number, lift?: (k: number) => Lift, cue?: (k: number) => { act?: Act; face?: number } | undefined): void
  /** The top of gosling `k`'s head, as last drawn, lifted where it was, in `out`. */
  headOf(k: number, out: Vector3): Vector3
  /** Their down in `color` and glowing `glow`, its colour times this added as light: the goose's white, as her parts have it. */
  setDown(color: number, glow: number): void
  /** Their rim, the goose's: on or off, how bright, how wide, how soft and its colour. */
  setRim(look: Pick<ShellLook, 'rim' | 'rimStrength' | 'rimWidth' | 'rimSoftness' | 'rimColor'>): void
  /** Whether they are calm: moving, each walks, and never runs. */
  calm: boolean
  /** Whether they cower: standing, each its frightened idle. */
  scared: boolean
  /**
   * Where given, whether a gosling standing at (x, y, z), its feet, may be seen: one that may not is neither drawn nor
   * played, though it is placed and turned as ever. Never culled by three, as skinned, they are drawn every pass else.
   */
  seen?: (x: number, y: number, z: number) => boolean
}

/** The goslings of `play`, on the ground at `groundAt` and `pond`'s, afloat in its water, their clips at `speeds` and their height at `size`, m, each read live. */
export async function createGoslings(
  play: GoosePlay<PlaySwarm>,
  pond: PondLook,
  speeds: GoslingSpeeds = defaultGoslingSpeeds(),
  groundAt: (x: number, z: number) => number = () => 0,
  size: { height: number } = { height: GOSLING_HEIGHT },
): Promise<Goslings> {
  const gltf = await new GLTFLoader().loadAsync(MODEL)
  // Only its own armature: the file holds the goose's too.
  for (const child of [...gltf.scene.children]) if (child.name !== ARMATURE) gltf.scene.remove(child)
  const object = new Group()
  // One toon material for the whole bird, its parts in the model's own colours as its vertices' colours, its down in
  // the goose's white, glowing as she does; the goose's shell, for her rim (`setRim`), with no sheen and no highlight.
  const down = uniform(new Color(0xffffff))
  const downGlow = uniform(0)
  const toon = new ShellToonMaterial()
  const inDown = attribute<'float'>('down', 'float')
  toon.colorNode = mix(attribute<'vec3'>('color', 'vec3'), down, inDown)
  // Three's types leave the toon material its emissive node out.
  ;(toon as unknown as { emissiveNode: Node | null }).emissiveNode = down.mul(downGlow).mul(inDown)
  oneMesh(gltf.scene, toon)
  // The file is y-up, off the origin, facing -z, as the goose is modelled. Its box as it stands, skinned at rest,
  // sets it on the ground at the middle of its feet's square, and its height its scale.
  const upright = new Group().add(gltf.scene)
  upright.updateMatrixWorld(true)
  const box = new Box3().setFromObject(upright, true)
  const perMetre = 1 / (box.max.y - box.min.y)
  const centre = box.getCenter(new Vector3())
  const clip = (name: string) => gltf.animations.find((a) => a.name === name)
  const birds = play.goslings.map((g, k) => {
    if (!g) {
      object.add(new Group())
      return undefined
    }
    const own = (k * 0.618034) % 1
    const model = clone(gltf.scene) as Object3D
    model.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      mesh.material = toon
      mesh.castShadow = mesh.receiveShadow = true
      mesh.frustumCulled = false
    })
    model.position.set(-centre.x, -box.min.y, -centre.z)
    // Facing -z, turned to face +z, as a yaw of 0 reads.
    const body = new Group().add(model)
    body.rotation.y = Math.PI
    body.scale.setScalar(size.height * perMetre)
    const bird = new Group().add(body)
    object.add(bird)
    const mixer = new AnimationMixer(model)
    const action = (name: string): AnimationAction | undefined => {
      const found = clip(name)
      if (!found) return undefined
      const played = mixer.clipAction(found)
      played.play()
      // Each its own way into the clip, so none steps in time with another.
      played.time = own * found.duration
      played.setEffectiveWeight(0)
      return played
    }
    return { bird, body, mixer, idle: action(CLIPS.idle), scared: action(CLIPS.scared), run: action(CLIPS.run), walk: action(CLIPS.walk), waterIdle: action(CLIPS.waterIdle), swim: action(CLIPS.swim), jump: action(CLIPS.jump), shake: action(CLIPS.shake), swimming: 0, turn: TURN[0]! + (TURN[1]! - TURN[0]!) * own, yaw: Number.NaN, pace: 0, moving: 0, was: { x: 0, z: 0 } }
  })
  /** The held time the clips were last played to, s. */
  let playedTo = Number.NaN

  const goslings: Goslings = {
    object,
    setDown(color, glow) {
      down.value.set(color)
      downGlow.value = glow
    },
    setRim(look) {
      toon.set({ sheen: 0, specular: 0, shininess: 30, softness: 0, specularColor: 0xffffff, ...look })
    },
    calm: false,
    scared: false,
    update(now, dt, time, lift, cue) {
      const step = Number.isNaN(playedTo) ? 0 : Math.max(0, time - playedTo)
      playedTo = time
      now.goslings.forEach((g, k) => {
        const one = birds[k]
        if (!g || !one) return
        const { bird, body, was } = one
        // Its life bitten away, it is gone.
        bird.visible = g.state !== 'gone'
        if (!bird.visible) return
        body.scale.setScalar(size.height * perMetre)
        // On the ground, down the pond's bank and afloat where it is out of its depth.
        const off = lift?.(k)
        bird.position.set(g.x + (off?.x ?? 0), groundAt(g.x, g.z) + standingIn(pond, g.x, g.z, pond.gosling) + (off?.y ?? 0), g.z + (off?.z ?? 0))
        // How far it swims, eased as its feet leave the bed.
        const swimmingTo = swimmingIn(pond, g.x, g.z, pond.gosling)
        one.swimming += (swimmingTo - one.swimming) * (dt > 0 ? 1 - Math.exp(-dt / PACE_SMOOTHING) : 0)
        // Its own pace, smoothed; and its turn after where it goes, eased at its own rate. Waiting, it faces its brazier.
        if (Number.isNaN(one.yaw)) {
          const b = now.plain.braziers[k]!
          one.yaw = Math.atan2(b.x - g.x, b.z - g.z)
          was.x = g.x
          was.z = g.z
        }
        const dx = g.x - was.x
        const dz = g.z - was.z
        was.x = g.x
        was.z = g.z
        if (dt > 0) {
          const pace = Math.hypot(dx, dz) / dt
          one.pace += (pace - one.pace) * (1 - Math.exp(-dt / PACE_SMOOTHING))
          // Moving at all this frame, walked, pushed or swung round her, it runs; still, it stands.
          const moves = pace > STILL ? 1 : 0
          one.moving += (moves - one.moving) * (1 - Math.exp(-dt / GAIT_BLEND))
          if (one.pace > TURNS_FROM && pace > 0) {
            const to = Math.atan2(dx, dz)
            one.yaw += Math.atan2(Math.sin(to - one.yaw), Math.cos(to - one.yaw)) * (1 - Math.exp(-dt / one.turn))
          }
        }
        // Standing, a searching gosling turns to where it looks, out into the dark; the guide, back at her.
        const look = g.state !== 'circle' ? now.lookOf(k) : undefined
        if (look !== undefined && dt > 0 && one.moving < 0.5) one.yaw += Math.atan2(Math.sin(look - one.yaw), Math.cos(look - one.yaw)) * (1 - Math.exp(-dt / one.turn))
        const cued = cue?.(k)
        if (cued?.face !== undefined && dt > 0 && one.moving < 0.5) one.yaw += Math.atan2(Math.sin(cued.face - one.yaw), Math.cos(cued.face - one.yaw)) * (1 - Math.exp(-dt / one.turn))
        if (off?.yaw !== undefined) one.yaw = off.yaw
        bird.rotation.y = one.yaw
        if (goslings.seen && !goslings.seen(bird.position.x, bird.position.y, bird.position.z)) {
          bird.visible = false
          return
        }
        // Its gait: standing or running, blended briefly from one to the other.
        const { moving } = one
        // On land its idle and run; afloat its water idle and swim.
        const land = one.waterIdle && one.swim ? 1 - one.swimming : 1
        const cowers = goslings.scared && one.scared !== undefined
        one.idle?.setEffectiveWeight(cowers ? 0 : (1 - moving) * land)
        one.scared?.setEffectiveWeight(cowers ? (1 - moving) * land : 0)
        const walks = goslings.calm && one.walk !== undefined
        one.run?.setEffectiveWeight(walks ? 0 : moving * land)
        one.walk?.setEffectiveWeight(walks ? moving * land : 0)
        if (one.walk) one.walk.timeScale = Math.max(0.5, one.pace / WALK_PACE)
        one.waterIdle?.setEffectiveWeight((1 - moving) * (1 - land))
        one.swim?.setEffectiveWeight(moving * (1 - land))
        if (one.swim) one.swim.timeScale = speeds.swim * Math.min(FASTEST, Math.max(1, one.pace / SWIM_PACE))
        if (one.idle) one.idle.timeScale = speeds.idle
        if (one.run) one.run.timeScale = speeds.run * Math.min(FASTEST, Math.max(1, one.pace / RUN_PACE))
        if (one.waterIdle) one.waterIdle.timeScale = speeds.waterIdle
        // Climbing out of the well or down from the tree, each hop its jump, played through once over the hop, facing the way it
        // hops, or the lift's way where it has one.
        const hop = now.hopOf(k)
        one.jump?.setEffectiveWeight(hop && one.jump ? 1 : 0)
        if (hop && one.jump) {
          for (const other of [one.idle, one.scared, one.run, one.walk, one.waterIdle, one.swim]) other?.setEffectiveWeight(0)
          one.jump.timeScale = 0
          one.jump.time = hop.share * one.jump.getClip().duration
          one.yaw = off?.yaw ?? Math.atan2(hop.to.x - hop.from.x, hop.to.z - hop.from.z)
          bird.rotation.y = one.yaw
        }
        const doing = cued?.act
        const acting = doing && (doing.clip === 'shake' ? one.shake : one.jump)
        one.shake?.setEffectiveWeight(acting && acting === one.shake ? 1 : 0)
        if (acting) {
          for (const other of [one.idle, one.scared, one.run, one.walk, one.waterIdle, one.swim, one.jump, one.shake]) other?.setEffectiveWeight(other === acting ? 1 : 0)
          acting.timeScale = 0
          acting.time = doing.share * acting.getClip().duration
          bird.position.y += doing.lift
        }
        if (step > 0) one.mixer.update(step)
      })
    },
    headOf(k, out) {
      return out.copy(birds[k]!.bird.position).setY(birds[k]!.bird.position.y + size.height)
    },
  }
  return goslings
}

/**
 * The gosling's parts, its down, its beak and feet, and its eyes, three skinned meshes on the one skeleton in the
 * file, made one in `material`, each vertex in its part's colour, and marked 1 in `down` where it is the down
 * (`downPart`'s material): one draw a gosling in each pass, not three (2026-10-27). The island's mother goose too.
 */
export function oneMesh(root: Object3D, material: ShellToonMaterial, downPart = DOWN): void {
  const parts: SkinnedMesh[] = []
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh)
  })
  const first = parts[0]
  if (!first || parts.length < 2) return
  const geometries = parts.map((part) => {
    const geometry = part.geometry.clone()
    const colour = (part.material as Material & { color?: Color }).color ?? new Color(0xffffff)
    const count = geometry.getAttribute('position').count
    const colours = new Float32Array(count * 3)
    for (let k = 0; k < count; k++) colour.toArray(colours, k * 3)
    geometry.setAttribute('color', new Float32BufferAttribute(colours, 3))
    geometry.setAttribute('down', new Float32BufferAttribute(new Float32Array(count).fill((part.material as Material).name === downPart ? 1 : 0), 1))
    return geometry
  })
  const merged = mergeGeometries(geometries)
  if (!merged) throw new Error("the gosling's parts would not merge")
  const mesh = new SkinnedMesh(merged, material)
  mesh.name = first.name
  mesh.position.copy(first.position)
  mesh.quaternion.copy(first.quaternion)
  mesh.scale.copy(first.scale)
  mesh.bind(first.skeleton, first.bindMatrix)
  first.parent!.add(mesh)
  for (const part of parts) part.removeFromParent()
}
