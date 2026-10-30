// The geese at home on the pond's island: the mother goose
// (public/models/gooseMother.glb, brought in on 2026-10-29: the
// goose's own rig, ribbons on, its clips the goose's and the gosling's and her
// own `lady_*`) sitting in the nest on her `lady_nest_idle`; and goslings
// (geese.glb's, as goslings.ts draws them) at play in front of the tent, each
// running to a spot of dry ground picked at random, standing a moment, and off
// again. Drawn only: nothing in the play knows of them. In the ending
// (gooseoutro.ts) the page directs them instead: she gets up and runs down to
// meet him, the goslings run to the water's edge and on to the ring, hopping.
// Each bird is one skinned mesh in one shell, its parts' colours as its
// vertices', its white the goose's (`setDown`), her rim too (`setRim`), as the
// goslings following her are.
import { AnimationMixer, Box3, Color, Group, Vector3, type AnimationAction, type AnimationClip, type Mesh, type Node, type Object3D } from 'three/webgpu'
import { attribute, mix, uniform } from 'three/tsl'
import { modelLoader } from './gltf'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { oneMesh } from './goslings'
import { ShellToonMaterial, type ShellLook } from './shell'
import type { Act } from './gooseoutro'
import type { Point } from './plain'

const MOTHER_MODEL = './models/gooseMother.glb'
const MOTHER_CLIP = 'lady_nest_idle'
/** Hers once up off the nest, standing and running. */
const MOTHER_CLIPS = { idle: 'lady_idle', run: 'lady_run_happy' }
/** The pace her run plays at as authored, m/s, as the goose's. */
const MOTHER_RUN_PACE = 1.4
/** Her white: the part that takes the goose's white and glow. */
const MOTHER_WHITE = 'Material.004'
const GOSLING_MODEL = './models/geese.glb'
const GOSLING_ARMATURE = 'GooseBabyArmature'
const GOSLING_WHITE = 'GooseMaterial001'
const GOSLING_CLIPS = { idle: 'baby_idle', run: 'baby_run_happy', jump: 'baby_jump', shake: 'baby_shake_dry' }
/** The pace a gosling's run plays at as authored, m/s, as goslings.ts has it. */
const RUN_PACE = 0.7
/** How long a gosling takes to turn most of the way to where it runs, s; how long its gait blends, s. */
const TURN = 0.15
const GAIT_BLEND = 0.1
/** How many spots it tries for one on dry ground before it stays where it is. */
const TRIES = 20
/** How near its spot it has arrived, m. */
const ARRIVED = 0.05

/** What the island geese folder edits. */
export interface IslandGeeseLook {
  /** The mother: where she sits off the nest's middle, m, how far up, m, which way she faces, degrees, and how big she is, 1 the goose's own size. */
  mother: { show: boolean; x: number; z: number; y: number; turn: number; size: number }
  /**
   * The goslings at play: how many; the middle of where they play off the island's middle, m, and how far round it;
   * how fast they run, m/s, and the longest they stand between runs, s.
   */
  goslings: { count: number; x: number; z: number; radius: number; speed: number; rest: number }
}

/** As big as the goose, facing the camera; four goslings in front of the tent, out to the water's edge. */
export function defaultIslandGeeseLook(): IslandGeeseLook {
  return {
    mother: { show: true, x: 0, z: 0, y: 0, turn: 0, size: 1 },
    goslings: { count: 4, x: -0.4, z: 2.4, radius: 2.6, speed: 0.9, rest: 2 },
  }
}

/** Where the island geese stand, from the page, read every frame. */
export interface IslandPlaces {
  /** Whether the island shows. */
  shown(): boolean
  /** The island's middle. */
  island(): Point
  /** The nest's middle, on the ground there. */
  nest(): Vector3
  /** How high the ground is at (x, z), m. */
  ground(x: number, z: number): number
  /** How big the goose is drawn against her file's units: the mother, on the same rig in the same units, as big. */
  gooseScale(): number
  /** Whether a gosling may play at (x, z): dry ground, clear of the tent and the fire. */
  free(x: number, z: number): boolean
}

/**
 * The ending's word on them for a frame: where the mother is, her yaw, how far up off the nest, 0 to 1, and whether
 * she runs; where each gosling shown is, what it does there, and the way it turns to, a yaw, standing.
 */
export interface IslandCue {
  mother: { at: Point; yaw: number; up: number; running: boolean }
  goslings: { at: Point; act?: Act; face?: number }[]
}

export interface IslandGeese {
  object: Group
  readonly look: IslandGeeseLook
  /** Where they are now: the mother and her yaw, and each gosling shown. */
  cast(): { mother: Point; motherYaw: number; goslings: Point[] }
  /** The ending's cue, each frame it plays, read on the next update; none, they sit and play as before. */
  direct(cue: IslandCue | undefined): void
  /** Each bird on over `dt` s; its clips played on to `time`, the page's held time, s. */
  update(dt: number, time: number): void
  /** Their white in `color`, glowing `glow`: the goose's. */
  setDown(color: number, glow: number): void
  /** Their rim, the goose's. */
  setRim(look: Pick<ShellLook, 'rim' | 'rimStrength' | 'rimWidth' | 'rimSoftness' | 'rimColor'>): void
}

/** The most goslings the folder may ask for. */
export const MOST_GOSLINGS = 8

/** `root` stood on its feet's middle, facing +z as a yaw of 0 reads: the body to scale, its height 1 at `perMetre`, and the group to place. */
function upright(root: Object3D, material: ShellToonMaterial): { bird: Group; body: Group } {
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    mesh.material = material
    mesh.castShadow = mesh.receiveShadow = true
    mesh.frustumCulled = false
  })
  const holder = new Group().add(root)
  holder.updateMatrixWorld(true)
  const box = new Box3().setFromObject(holder, true)
  const centre = box.getCenter(new Vector3())
  root.position.set(-centre.x, -box.min.y, -centre.z)
  // Modelled facing -z: turned to face +z.
  const body = new Group().add(holder)
  body.rotation.y = Math.PI
  body.userData.perMetre = 1 / (box.max.y - box.min.y)
  return { bird: new Group().add(body), body }
}

/** `clip` played on `mixer`, from `share` of the way in, at weight `weight`. */
function played(mixer: AnimationMixer, clip: AnimationClip | undefined, share: number, weight: number): AnimationAction | undefined {
  if (!clip) return undefined
  const action = mixer.clipAction(clip)
  action.play()
  action.time = share * clip.duration
  action.setEffectiveWeight(weight)
  return action
}

/** The mother in the nest and the goslings at play, where `places` has them, the goslings `goslingHeight` tall, read live. */
export async function createIslandGeese(places: IslandPlaces, goslingHeight: { height: number }, look = defaultIslandGeeseLook()): Promise<IslandGeese> {
  const loader = modelLoader()
  const [motherFile, goslingFile] = await Promise.all([loader.loadAsync(MOTHER_MODEL), loader.loadAsync(GOSLING_MODEL)])
  const object = new Group()
  const downColour = uniform(new Color(0xffffff))
  const downGlow = uniform(0)
  /** One shell for each file's birds, coloured by their vertices, their white the goose's: the mother's, the goslings'. */
  const shells = [new ShellToonMaterial(), new ShellToonMaterial()]
  for (const shell of shells) {
    const inDown = attribute<'float'>('down', 'float')
    shell.colorNode = mix(attribute<'vec3'>('color', 'vec3'), downColour, inDown)
    ;(shell as unknown as { emissiveNode: Node | null }).emissiveNode = downColour.mul(downGlow).mul(inDown)
  }

  // The mother: the file's skinned scene, its other a still copy.
  const motherScene = motherFile.scenes.find((s) => s.getObjectByProperty('isSkinnedMesh', true)) ?? motherFile.scene
  oneMesh(motherScene, shells[0]!, MOTHER_WHITE)
  const mother = upright(motherScene, shells[0]!)
  object.add(mother.bird)
  const motherMixer = new AnimationMixer(motherScene)
  const motherClip = (name: string) => motherFile.animations.find((a) => a.name === name)
  const motherNest = played(motherMixer, motherClip(MOTHER_CLIP), 0, 1)
  const motherIdle = played(motherMixer, motherClip(MOTHER_CLIPS.idle), 0, 0)
  const motherRun = played(motherMixer, motherClip(MOTHER_CLIPS.run), 0, 0)
  /** How much she runs, 0 to 1, eased; where she was last frame, in the ending. */
  let motherRunning = 0
  const motherWas = { x: Number.NaN, z: 0 }

  // The goslings: the file's baby armature alone, a copy each.
  for (const child of [...goslingFile.scene.children]) if (child.name !== GOSLING_ARMATURE) goslingFile.scene.remove(child)
  oneMesh(goslingFile.scene, shells[1]!, GOSLING_WHITE)
  const clip = (name: string) => goslingFile.animations.find((a) => a.name === name)
  const goslings = Array.from({ length: MOST_GOSLINGS }, (_, k) => {
    const own = (k * 0.618034 + 0.3) % 1
    const model = clone(goslingFile.scene) as Object3D
    const { bird, body } = upright(model, shells[1]!)
    object.add(bird)
    const mixer = new AnimationMixer(model)
    return {
      bird,
      body,
      mixer,
      idle: played(mixer, clip(GOSLING_CLIPS.idle), own, 1),
      run: played(mixer, clip(GOSLING_CLIPS.run), own, 0),
      jump: played(mixer, clip(GOSLING_CLIPS.jump), 0, 0),
      shake: played(mixer, clip(GOSLING_CLIPS.shake), 0, 0),
      /** Where it is and where it runs to, m; how long it stands yet, s; which way it faces, rad; how much it runs, 0 to 1. */
      at: { x: Number.NaN, z: 0 },
      to: { x: 0, z: 0 },
      wait: own * look.goslings.rest,
      yaw: own * Math.PI * 2,
      running: 0,
      /** Its own pace, a share of the folder's. */
      pace: 0.8 + 0.4 * own,
    }
  })

  /** A spot to play at, somewhere in the play area on free ground; none found, where it is. */
  const spot = (from: Point): Point => {
    const middle = places.island()
    const { x, z, radius } = look.goslings
    for (let k = 0; k < TRIES; k++) {
      const angle = Math.random() * Math.PI * 2
      const r = radius * Math.sqrt(Math.random())
      const p = { x: middle.x + x + Math.cos(angle) * r, z: middle.z + z + Math.sin(angle) * r }
      if (places.free(p.x, p.z) && places.free((p.x + from.x) / 2, (p.z + from.z) / 2)) return p
    }
    return { ...from }
  }

  let playedTo = Number.NaN
  let cue: IslandCue | undefined
  const shownCount = () => Math.min(MOST_GOSLINGS, Math.max(0, Math.round(look.goslings.count)))
  return {
    object,
    look,
    cast() {
      const nest = places.nest()
      const m = look.mother
      return {
        mother: { x: nest.x + m.x, z: nest.z + m.z },
        motherYaw: (m.turn * Math.PI) / 180,
        goslings: goslings.slice(0, shownCount()).map((g) => (Number.isNaN(g.at.x) ? { ...places.island() } : { ...g.at })),
      }
    },
    direct(to) {
      cue = to
    },
    setDown(color, strength) {
      downColour.value.set(color)
      downGlow.value = strength
    },
    setRim(rim) {
      for (const shell of shells) shell.set({ sheen: 0, specular: 0, shininess: 30, softness: 0, specularColor: 0xffffff, ...rim })
    },
    update(dt, time) {
      const step = Number.isNaN(playedTo) ? 0 : Math.max(0, time - playedTo)
      playedTo = time
      const shown = places.shown()
      // She sits in the nest, as the folder places her off its middle.
      const m = look.mother
      mother.bird.visible = shown && m.show
      if (mother.bird.visible) {
        const nest = places.nest()
        mother.bird.position.set(nest.x + m.x, nest.y + m.y, nest.z + m.z)
        mother.bird.rotation.y = (m.turn * Math.PI) / 180
        mother.body.scale.setScalar(m.size * places.gooseScale())
        if (cue) {
          // Up off the nest, the nest's pose blended into her standing and her run; down from the nest to the ground.
          const { at, yaw, up, running } = cue.mother
          const pace = dt > 0 && !Number.isNaN(motherWas.x) ? Math.hypot(at.x - motherWas.x, at.z - motherWas.z) / dt : 0
          motherWas.x = at.x
          motherWas.z = at.z
          motherRunning += ((running ? 1 : 0) - motherRunning) * (dt > 0 ? 1 - Math.exp(-dt / GAIT_BLEND) : 0)
          motherNest?.setEffectiveWeight(1 - up)
          motherIdle?.setEffectiveWeight(up * (1 - motherRunning))
          motherRun?.setEffectiveWeight(up * motherRunning)
          if (motherRun && running) motherRun.timeScale = Math.max(0.6, pace / MOTHER_RUN_PACE)
          const sat = nest.y + m.y
          mother.bird.position.set(at.x, sat + (places.ground(at.x, at.z) - sat) * up, at.z)
          mother.bird.rotation.y = yaw
        }
        if (step > 0) motherMixer.update(step)
      }
      const count = shownCount()
      goslings.forEach((g, k) => {
        g.bird.visible = shown && k < count
        if (!g.bird.visible) return
        if (Number.isNaN(g.at.x)) {
          const middle = places.island()
          const first = spot({ x: middle.x + look.goslings.x, z: middle.z + look.goslings.z })
          g.at = { ...first }
          g.to = { ...first }
        }
        // Standing a moment, then off to a spot of its own; there, standing again. In the ending, where it is cued.
        let moving = 0
        const cued = cue?.goslings[k]
        if (cued) {
          const dx = cued.at.x - g.at.x
          const dz = cued.at.z - g.at.z
          if (Math.hypot(dx, dz) > 1e-4) {
            moving = 1
            const heading = Math.atan2(dx, dz)
            g.yaw += Math.atan2(Math.sin(heading - g.yaw), Math.cos(heading - g.yaw)) * (dt > 0 ? 1 - Math.exp(-dt / TURN) : 0)
          } else if (cued.face !== undefined) {
            g.yaw += Math.atan2(Math.sin(cued.face - g.yaw), Math.cos(cued.face - g.yaw)) * (dt > 0 ? 1 - Math.exp(-dt / TURN) : 0)
          }
          g.at = { ...cued.at }
          g.to = { ...cued.at }
        } else if (g.wait > 0) g.wait -= dt
        else {
          const dx = g.to.x - g.at.x
          const dz = g.to.z - g.at.z
          const far = Math.hypot(dx, dz)
          if (far < ARRIVED) {
            g.wait = 0.3 + Math.random() * look.goslings.rest
            g.to = spot(g.at)
          } else {
            const go = Math.min(far, look.goslings.speed * g.pace * dt)
            g.at.x += (dx / far) * go
            g.at.z += (dz / far) * go
            moving = 1
            const heading = Math.atan2(dx, dz)
            g.yaw += Math.atan2(Math.sin(heading - g.yaw), Math.cos(heading - g.yaw)) * (dt > 0 ? 1 - Math.exp(-dt / TURN) : 0)
          }
        }
        g.running += (moving - g.running) * (dt > 0 ? 1 - Math.exp(-dt / GAIT_BLEND) : 0)
        g.idle?.setEffectiveWeight(1 - g.running)
        g.run?.setEffectiveWeight(g.running)
        if (g.run) g.run.timeScale = Math.max(0.6, (look.goslings.speed * g.pace) / RUN_PACE)
        // Shaking dry or hopping, its clip held at how far through it is, the rest let go.
        const act = cued?.act
        const acting = act && g[act.clip]
        for (const one of [g.jump, g.shake]) one?.setEffectiveWeight(one === acting ? 1 : 0)
        if (acting) {
          g.idle?.setEffectiveWeight(0)
          g.run?.setEffectiveWeight(0)
          acting.timeScale = 0
          acting.time = act.share * acting.getClip().duration
        }
        g.bird.position.set(g.at.x, places.ground(g.at.x, g.at.z) + (act?.lift ?? 0), g.at.z)
        g.bird.rotation.y = g.yaw
        g.body.scale.setScalar(goslingHeight.height * g.body.userData.perMetre)
        if (step > 0) g.mixer.update(step)
      })
    },
  }
}
