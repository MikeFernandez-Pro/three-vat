// Last Light: a swarm of rats held off by a light (ADR-0044). The swarm steps,
// then the crowd stands every rat where the swarm has it; the light walks to the
// pointer, or its own loop once the pointer has been idle; the camera trails it.
import {
  Color,
  FogExp2,
  HemisphereLight,
  PerspectiveCamera,
  Plane,
  PointLight,
  Raycaster,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu'
import { uniform } from 'three/tsl'
import { loadVAT } from 'three-vat'
import { getMaxTextureSize, type VATTimeUniform } from 'three-vat/tsl'
import { collapseBatchRuns } from './collapse'
import { flagstones } from './flagstones'
import { Rats } from './rats'
import { defaultTuning, Swarm, type Light } from './swarm'

const RATS = 2000
const SEED = 7
/** The pointer left alone this long, in seconds, and the light walks its loop. */
const IDLE = 3
/** The light's height above the ground: where its holder carries it. */
const LIGHT_HEIGHT = 1.1
/**
 * Where the camera sits from the light, its field of view, and how quickly it
 * closes the distance, per second: high and close behind, a little further back
 * than over the shoulder, so the ring and the swarm around it fill the view.
 */
const CAMERA_OFFSET = new Vector3(0, 9, 7)
const CAMERA_FOV = 42
const CAMERA_FOLLOW = 3
/** The cold grey-green the fog and the sky share, and how thick the fog is. */
const FOG = 0x3a4641
const FOG_DENSITY = 0.04

// ---------------------------------------------------------------- renderer
const renderer = new WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
await renderer.init()
// The batch, one draw (ADR-0023): three's WebGPU backend draws it rat by rat.
collapseBatchRuns(renderer)

const scene = new Scene()
scene.background = new Color(FOG)
scene.fog = new FogExp2(FOG, FOG_DENSITY)

const camera = new PerspectiveCamera(CAMERA_FOV, innerWidth / innerHeight, 0.1, 100)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// A dim cold fill, and the one warm light. The lamp's reach ends a little over
// twice the ring out, so the stone past the swarm keeps the fog's cold tone and
// the warm ring reads sharply.
scene.add(new HemisphereLight(0x8fa8a0, 0x1c2220, 0.7))
const lamp = new PointLight(0xffa850, 36, 7.5, 2)
scene.add(lamp)

scene.add(flagstones())

// ---------------------------------------------------------------- swarm
const tuning = defaultTuning()
const swarm = new Swarm(RATS, SEED)
swarm.reset(RATS)
const light: Light = { x: 0, z: 0, strength: 1, on: true }

const vat = await loadVAT('./models/rat.vat.glb')
const time: VATTimeUniform = uniform(0)
const rats = new Rats(vat, RATS, getMaxTextureSize(renderer), time)
rats.spawned(swarm, tuning, 0, swarm.count)
rats.draw(swarm)
scene.add(rats.mesh)

// ---------------------------------------------------------------- pointer
// The ground point under the pointer, taken when it moves: the light walks to
// that point, not to wherever the pointer lands as the camera trails it.
const ground = new Plane(new Vector3(0, 1, 0), 0)
const raycaster = new Raycaster()
const ndc = new Vector2()
const target = new Vector3()
let idle = Infinity
let loopTime = 0

renderer.domElement.addEventListener('pointermove', (event) => {
  ndc.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
  if (raycaster.ray.intersectPlane(ground, target) !== null) idle = 0
})

// ---------------------------------------------------------------- loop
const timer = new Timer()
const look = new Vector3()
const want = new Vector3()

/** Carry the lamp to the light, and trail it with the camera; at once when `dt` is negative. */
function follow(dt: number) {
  lamp.position.set(light.x, LIGHT_HEIGHT, light.z)
  look.set(light.x, 0, light.z)
  want.copy(look).add(CAMERA_OFFSET)
  camera.position.lerp(want, dt < 0 ? 1 : 1 - Math.exp(-CAMERA_FOLLOW * dt))
  camera.lookAt(look.x, look.y, look.z - 0.6)
}
follow(-1)

renderer.setAnimationLoop(() => {
  timer.update()
  const dt = Math.min(timer.getDelta(), 1 / 30)
  time.value += dt

  idle += dt
  if (idle >= IDLE) {
    loopTime += dt
    swarm.walkLight(light, swarm.loopPoint(loopTime), dt)
  } else swarm.walkLight(light, target, dt)

  swarm.step(dt, light, tuning)
  rats.draw(swarm)
  follow(dt)
  renderer.render(scene, camera)
})
