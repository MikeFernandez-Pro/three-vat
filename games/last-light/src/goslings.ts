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
  Group,
  type Mesh,
  MeshToonNodeMaterial,
  Vector3,
  type AnimationAction,
  type Material,
  type Object3D,
} from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { GoosePlay } from './gooseplay'
import type { PlaySwarm } from './play'
import { standingIn, swimmingIn, type PondLook } from './pond'
import { createToonGradient } from './toon'

/** The gosling's file, and its clips: standing, running, afloat, swimming and hopping. */
const MODEL = './models/geese.glb'
/** Its armature in the file, which holds the goose's too. */
const ARMATURE = 'GooseBabyArmature'
const CLIPS = { idle: 'baby_idle', run: 'baby_run', waterIdle: 'baby_water_idle', swim: 'baby_swim', jump: 'baby_jump' }
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
   * across with the bucket; facing the lift's way, where it has one.
   */
  update(now: GoosePlay<PlaySwarm>, dt: number, time: number, lift?: (k: number) => Lift): void
  /** The top of gosling `k`'s head, as last drawn, lifted where it was, in `out`. */
  headOf(k: number, out: Vector3): Vector3
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
  const gradient = createToonGradient()
  // One toon material a part, in the model's own colours: its down, its beak and feet, its eyes.
  const materials = new Map<string, MeshToonNodeMaterial>()
  const toonOf = (material: Material & { color?: Color }) => {
    let toon = materials.get(material.name)
    if (!toon) materials.set(material.name, (toon = new MeshToonNodeMaterial({ color: material.color ?? new Color(0xffffff), gradientMap: gradient })))
    return toon
  }
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
      mesh.material = toonOf(mesh.material as Material)
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
    return { bird, body, mixer, idle: action(CLIPS.idle), run: action(CLIPS.run), waterIdle: action(CLIPS.waterIdle), swim: action(CLIPS.swim), jump: action(CLIPS.jump), swimming: 0, turn: TURN[0]! + (TURN[1]! - TURN[0]!) * own, yaw: Number.NaN, pace: 0, moving: 0, was: { x: 0, z: 0 } }
  })
  /** The held time the clips were last played to, s. */
  let playedTo = Number.NaN

  return {
    object,
    update(now, dt, time, lift) {
      const step = Number.isNaN(playedTo) ? 0 : Math.max(0, time - playedTo)
      playedTo = time
      now.goslings.forEach((g, k) => {
        const one = birds[k]
        if (!g || !one) return
        const { bird, body, was } = one
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
        // Standing, a searching gosling turns to where it looks, out into the dark.
        const look = g.state === 'waiting' ? now.lookOf(k) : undefined
        if (look !== undefined && dt > 0 && one.moving < 0.5) one.yaw += Math.atan2(Math.sin(look - one.yaw), Math.cos(look - one.yaw)) * (1 - Math.exp(-dt / one.turn))
        if (off?.yaw !== undefined) one.yaw = off.yaw
        bird.rotation.y = one.yaw
        // Its gait: standing or running, blended briefly from one to the other.
        const { moving } = one
        // On land its idle and run; afloat its water idle and swim.
        const land = one.waterIdle && one.swim ? 1 - one.swimming : 1
        one.idle?.setEffectiveWeight((1 - moving) * land)
        one.run?.setEffectiveWeight(moving * land)
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
          for (const other of [one.idle, one.run, one.waterIdle, one.swim]) other?.setEffectiveWeight(0)
          one.jump.timeScale = 0
          one.jump.time = hop.share * one.jump.getClip().duration
          one.yaw = off?.yaw ?? Math.atan2(hop.to.x - hop.from.x, hop.to.z - hop.from.z)
          bird.rotation.y = one.yaw
        }
        if (step > 0) one.mixer.update(step)
      })
    },
    headOf(k, out) {
      return out.copy(birds[k]!.bird.position).setY(birds[k]!.bird.position.y + size.height)
    },
  }
}
