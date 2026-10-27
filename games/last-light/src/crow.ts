// The goose game's crow: it comes down out of the dark as the game opens,
// once the tree is burning, and leads her after. It flies to where the next
// gosling waits, perches short of it on her side, turned to her, and caws
// now and then while she is far: "caw!" in the hold hint's hand over its
// head, or, out of view, at the screen's edge toward it. Once that gosling is
// found it takes off for the next, and after the last, for the pond. It says
// nothing else, and never waits for her.
// `public/models/crow.glb`: one skinned crow, its clips its take-off, its
// flight, its landing and its idle; drawn in toon in a crow's black. A flight
// is one arc, up off the ground and down again: the take-off clip scrubbed
// over its first share, the landing's over its last, the flight's played
// between.
import { AnimationMixer, Box3, Group, MeshToonNodeMaterial, Vector3, type AnimationAction, type Camera, type Mesh, type Object3D } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { callAt } from './callhint'
import type { Point } from './plain'
import { createToonGradient } from './toon'

const MODEL = './models/crow.glb'
const CLIPS = { fly: 'Crow_Fly', idle: 'Crow_Idle', land: 'Crow_Land', takeOff: 'Crow_TakeOff' }
/** How tall it is drawn, m, as its file stands it, wings spread; and which way its beak points in the file, rad about y from +z. */
const SIZE = 0.55
const FACING = 0
/** Its feathers and its eyes, the file's two materials in that order. */
const FEATHERS = 0x24222b
const EYES = 0xd8d2c0
/** How fast it flies, m/s, how high it flies at most, m, and its shortest flight, s. */
const SPEED = 4.5
const CRUISE = 2.6
const SHORTEST = 1.6
/** The share of a flight spent taking off, and landing. */
const TAKING_OFF = 0.25
const LANDING = 0.3
/** How long it takes to turn to her, perched, s. */
const TURN = 0.4
/** How far she must be from it before it caws, m; the pause between caws, s, drawn between these; how long a caw shows, s. */
const CAW_FROM = 6
const CAW_PAUSE = [3, 6.5] as const
const CAW_SHOWS = 1.3
const INK = '#f6ead0'

export interface Crow {
  object: Group
  /** Where it perches, or is flying to perch. */
  readonly perch: Point
  /** Whether it has flown in yet. */
  readonly arrived: boolean
  /** Fly to perch at `to`: from where it stands, or, the first time, from `from` in the air. */
  flyTo(to: Point, from?: { x: number; y: number; z: number }): void
  /** One frame, `dt` s on: flown on, perched turned to her at `her`, cawing while she is far, on the ground `groundAt` has, seen by `camera` on `canvas`. */
  update(dt: number, her: Point, groundAt: (x: number, z: number) => number, camera: Camera, canvas: HTMLElement): void
}

/** Where to perch while waiting by a gosling at `waits`, PERCH_OFF m short of it on the side of `from`. */
const PERCH_OFF = 1.6
export function perchBy(waits: Point, from: Point): Point {
  const dx = from.x - waits.x
  const dz = from.z - waits.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-6) return { ...waits }
  const off = Math.min(PERCH_OFF, d * 0.5)
  return { x: waits.x + (dx / d) * off, z: waits.z + (dz / d) * off }
}

export async function createCrow(): Promise<Crow> {
  const gltf = await new GLTFLoader().loadAsync(MODEL)
  const gradient = createToonGradient()
  const feathers = new MeshToonNodeMaterial({ color: FEATHERS, gradientMap: gradient })
  const eyes = new MeshToonNodeMaterial({ color: EYES, gradientMap: gradient })
  let first = true
  gltf.scene.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    mesh.material = first ? feathers : eyes
    first = false
    mesh.castShadow = true
    mesh.frustumCulled = false
  })
  const box = new Box3().setFromObject(gltf.scene, true)
  const body = new Group().add(gltf.scene)
  body.scale.setScalar(SIZE / (box.max.y - box.min.y))
  body.rotation.y = -FACING
  const object = new Group().add(body)
  object.visible = false
  const mixer = new AnimationMixer(gltf.scene as Object3D)
  const action = (name: string): AnimationAction => {
    const clip = gltf.animations.find((a) => a.name === name)!
    const played = mixer.clipAction(clip)
    played.play()
    played.setEffectiveWeight(0)
    return played
  }
  const fly = action(CLIPS.fly)
  const idle = action(CLIPS.idle)
  const land = action(CLIPS.land)
  const takeOff = action(CLIPS.takeOff)
  land.timeScale = takeOff.timeScale = 0

  const from = new Vector3()
  const perch = { x: 0, z: 0 }
  let flight = Number.NaN
  let length = 0
  let arrived = false
  let yaw = 0
  let cawIn: number = CAW_PAUSE[0]
  let cawAge = Infinity
  const caw = document.createElement('div')
  caw.textContent = 'caw!'
  caw.style.cssText = `position:fixed;left:0;top:0;pointer-events:none;opacity:0;font-family:Gaegu,cursive;font-weight:700;font-size:30px;color:${INK};text-shadow:0 2px 4px #000c;white-space:nowrap`
  document.body.append(caw)
  const head = new Vector3()

  return {
    object,
    perch,
    get arrived() {
      return arrived
    },
    flyTo(to, start) {
      if (start && !arrived) {
        from.set(start.x, start.y, start.z)
        arrived = true
        object.visible = true
      } else from.copy(object.position)
      perch.x = to.x
      perch.z = to.z
      length = Math.max(SHORTEST, Math.hypot(to.x - from.x, to.z - from.z) / SPEED)
      flight = 0
    },
    update(dt, her, groundAt, camera, canvas) {
      if (!arrived) return
      const ground = groundAt(perch.x, perch.z)
      let weights = { fly: 0, idle: 1, land: 0, takeOff: 0 }
      if (!Number.isNaN(flight)) {
        flight += dt
        const s = Math.min(1, flight / length)
        const along = s * s * (3 - 2 * s)
        const x = from.x + (perch.x - from.x) * along
        const z = from.z + (perch.z - from.z) * along
        const far = Math.min(1, Math.hypot(perch.x - from.x, perch.z - from.z) / 6)
        const y = from.y + (ground - from.y) * along + CRUISE * far * Math.sin(Math.PI * s)
        if (Math.hypot(perch.x - from.x, perch.z - from.z) > 1e-3) yaw = Math.atan2(perch.x - from.x, perch.z - from.z)
        object.position.set(x, y, z)
        // Taking off, then flying, then landing: the two ends scrubbed over their shares of the flight.
        if (s < TAKING_OFF && from.y <= groundAt(from.x, from.z) + 0.05) {
          weights = { fly: 0, idle: 0, land: 0, takeOff: 1 }
          takeOff.time = (s / TAKING_OFF) * takeOff.getClip().duration
        } else if (s > 1 - LANDING) {
          weights = { fly: 0, idle: 0, land: 1, takeOff: 0 }
          land.time = ((s - (1 - LANDING)) / LANDING) * land.getClip().duration
        } else weights = { fly: 1, idle: 0, land: 0, takeOff: 0 }
        if (s >= 1) flight = Number.NaN
      } else {
        object.position.set(perch.x, ground, perch.z)
        const to = Math.atan2(her.x - perch.x, her.z - perch.z)
        yaw += Math.atan2(Math.sin(to - yaw), Math.cos(to - yaw)) * (1 - Math.exp(-dt / TURN))
      }
      object.rotation.y = yaw
      fly.setEffectiveWeight(weights.fly)
      idle.setEffectiveWeight(weights.idle)
      land.setEffectiveWeight(weights.land)
      takeOff.setEffectiveWeight(weights.takeOff)
      mixer.update(dt)
      // Its caw, perched while she is far: over its head, or at the screen's edge toward it.
      const far = Math.hypot(her.x - perch.x, her.z - perch.z) > CAW_FROM
      cawAge += dt
      if (Number.isNaN(flight) && far) {
        cawIn -= dt
        if (cawIn <= 0) {
          cawAge = 0
          cawIn = CAW_PAUSE[0] + Math.random() * (CAW_PAUSE[1] - CAW_PAUSE[0])
        }
      }
      const showing = cawAge < CAW_SHOWS
      caw.style.opacity = showing ? String(Math.min(1, cawAge / 0.1) * Math.min(1, (CAW_SHOWS - cawAge) / 0.5)) : '0'
      if (showing) {
        head.set(object.position.x, object.position.y + SIZE * 0.7, object.position.z).project(camera)
        const at = callAt(head, canvas.getBoundingClientRect())
        const rise = 30 * Math.min(1, cawAge / 0.6)
        caw.style.transform = `translate(${at.x}px, ${at.y - rise}px) translate(-50%, -100%) scale(${Math.min(1, 0.6 + cawAge * 4)})`
      }
    },
  }
}
