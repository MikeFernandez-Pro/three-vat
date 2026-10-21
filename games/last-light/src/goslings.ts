// The goose game's goslings and pond, drawn (#187). A gosling is its own
// model, `public/models/babyGoose.glb`, a third of the goose's height, in its
// own colours, each with a mixer of its own playing the file's baby idle, walk
// and run, blended by how fast it really goes.
// It is stood where the goose play has it: waiting by its brazier, facing it;
// in her circle, turning after the way it goes, a moment behind; taken,
// sinking into the ground where the dark took it and gone; home, afloat on the
// pond and bobbing. The pond is a grey disc on the ground.
import {
  AnimationMixer,
  Box3,
  CircleGeometry,
  Color,
  Group,
  Mesh,
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
import { createToonGradient } from './toon'

/** The gosling's file, and its clips: standing, walking and running. */
const MODEL = './models/babyGoose.glb'
const CLIPS = { idle: 'baby_idle', walk: 'baby_walk', run: 'baby_run' }
/** How tall a gosling stands, m: a third of the goose. */
const HEIGHT = 0.3
/** How long a taken gosling takes to sink out of sight, s, and how deep it goes, m. */
const SINK = 1.2
const SINK_DEPTH = 0.25
/** Afloat, how deep it sits in the water, m, how high it bobs, m, how fast, radians a second, and how far apart the bobs are, radians. */
const AFLOAT = 0.04
const BOB = 0.015
const BOB_RATE = 2.4
const BOB_STEP = 1.9
/** How long a gosling's pace is smoothed over, s, so a frame's jitter never sets it running. */
const PACE_SMOOTHING = 0.1
/** How long it takes to turn most of the way to where it goes, s: each its own, between the two; and how fast it must go to turn at all, m/s. */
const TURN = [0.18, 0.3]
const TURNS_FROM = 0.15
/** Its gait by its pace, m/s: standing under the first, walking from it, running from the second. */
const WALKS = [0.05, 0.3]
const RUNS = [0.9, 1.6]
/** The pace its walk and its run play at their own speed, m/s, a gosling's short legs; and how much faster than that they play at the most. */
const WALK_PACE = 0.35
const RUN_PACE = 0.7
const FASTEST = 2.5

export interface Goslings {
  object: Group
  /**
   * Each gosling where `now` has it: turned and its gait blended over `dt` of
   * play, s; its clips played on to `time`, the page's held time, s, so they
   * hold on the beat as the goose's do.
   */
  update(now: GoosePlay<PlaySwarm>, dt: number, time: number): void
}

/** Between 0 at `a` and 1 at `b`, smoothly. */
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** The goslings of `play` and its pond. */
export async function createGoslings(play: GoosePlay<PlaySwarm>): Promise<Goslings> {
  const gltf = await new GLTFLoader().loadAsync(MODEL)
  const object = new Group()
  const gradient = createToonGradient()
  // One toon material a part, in the model's own colours: its down, its beak and feet, its eyes.
  const materials = new Map<string, MeshToonNodeMaterial>()
  const toonOf = (material: Material & { color?: Color }) => {
    let toon = materials.get(material.name)
    if (!toon) materials.set(material.name, (toon = new MeshToonNodeMaterial({ color: material.color ?? new Color(0xffffff), gradientMap: gradient })))
    return toon
  }
  // The file is z-up, off the origin, facing +y: stood up, it faces -z, as the goose is modelled. Its box as it
  // stands, skinned at rest, sets it on the ground at the middle of its feet's square, and its height its scale.
  const upright = new Group().add(gltf.scene)
  gltf.scene.rotation.x = -Math.PI / 2
  upright.updateMatrixWorld(true)
  const box = new Box3().setFromObject(upright, true)
  const scale = HEIGHT / (box.max.y - box.min.y)
  const centre = box.getCenter(new Vector3())
  const clip = (name: string) => gltf.animations.find((a) => a.name === name)
  const birds = play.goslings.map((_, k) => {
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
    // Stood up facing -z, then turned to face +z, as a yaw of 0 reads.
    const body = new Group().add(model)
    body.rotation.y = Math.PI
    body.scale.setScalar(scale)
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
    return { bird, mixer, idle: action(CLIPS.idle), walk: action(CLIPS.walk), run: action(CLIPS.run), turn: TURN[0]! + (TURN[1]! - TURN[0]!) * own, yaw: Number.NaN, pace: 0, was: { x: 0, z: 0 } }
  })
  /** The held time the clips were last played to, s. */
  let playedTo = Number.NaN

  const { pond } = play.plain
  const water = new MeshToonNodeMaterial({ color: 0x404a52, gradientMap: gradient })
  const disc = new Mesh(new CircleGeometry(pond.radius, 48), water)
  disc.rotation.x = -Math.PI / 2
  disc.position.set(pond.x, 0.01, pond.z)
  disc.receiveShadow = true
  object.add(disc)

  return {
    object,
    update(now, dt, time) {
      const step = Number.isNaN(playedTo) ? 0 : Math.max(0, time - playedTo)
      playedTo = time
      now.goslings.forEach((g, k) => {
        const one = birds[k]!
        const { bird, was } = one
        const sunk = g.state === 'taken' ? (now.t - g.takenAt) / SINK : 0
        bird.visible = sunk < 1
        if (!bird.visible) return
        bird.position.set(g.x, -SINK_DEPTH * sunk, g.z)
        const afloat = now.ended && g.state === 'circle'
        if (afloat) bird.position.y = -AFLOAT + BOB * Math.sin(time * BOB_RATE + k * BOB_STEP)
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
          if (one.pace > TURNS_FROM && pace > 0) {
            const to = Math.atan2(dx, dz)
            one.yaw += Math.atan2(Math.sin(to - one.yaw), Math.cos(to - one.yaw)) * (1 - Math.exp(-dt / one.turn))
          }
        }
        if (afloat || g.state === 'taken') one.pace = 0
        bird.rotation.y = one.yaw
        // Its gait by its pace: standing, walking, running, each blended into the next.
        const moving = smooth(WALKS[0]!, WALKS[1]!, one.pace)
        const running = smooth(RUNS[0]!, RUNS[1]!, one.pace)
        one.idle?.setEffectiveWeight(1 - moving)
        one.walk?.setEffectiveWeight(moving * (1 - running))
        one.run?.setEffectiveWeight(moving * running)
        if (one.walk) one.walk.timeScale = Math.min(FASTEST, Math.max(1, one.pace / WALK_PACE))
        if (one.run) one.run.timeScale = Math.min(FASTEST, Math.max(1, one.pace / RUN_PACE))
        if (step > 0 && g.state !== 'taken') one.mixer.update(step)
      })
    },
  }
}
