// Last Light: a swarm of rats held off by a light (ADR-0044). The swarm steps,
// then the crowd stands every rat where the swarm has it; the light walks to the
// pointer, or its own loop once the pointer has been idle; the camera trails it.
//
// The URL sets the start: `?webgl` draws through WebGPURenderer's WebGL 2
// backend, `?rats=8192` starts with that many rats, `?shadows` with shadows on.
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
import { createPanel, createReadouts, type Settings } from './panel'
import { Rats } from './rats'
import { defaultTuning, Swarm, type Light } from './swarm'

const RATS = 2000
/** The count's top, where the device's textures allow it: a playback row a rat. */
const MAX_RATS = 16384
const SEED = 7
const url = new URLSearchParams(location.search)
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
// A playback row a rat, and WebGPU's default limit is 8,192 rows: ask for what
// the adapter can give, so the count reaches its top.
const forceWebGL = url.has('webgl')
type Adapter = { limits: { maxTextureDimension2D: number } }
const gpu = (navigator as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu
const adapter = forceWebGL ? null : await gpu?.requestAdapter()
const requiredLimits = adapter ? { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } : undefined
const renderer = new WebGPURenderer({ antialias: true, forceWebGL, requiredLimits })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
await renderer.init()
// The batch, one draw (ADR-0023): three's WebGPU backend draws it rat by rat.
// The WebGL 2 backend has multi-draw, and needs none.
collapseBatchRuns(renderer)
const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2'
// Ready for the lamp to cast, which it does only while the shadows toggle is on.
renderer.shadowMap.enabled = true

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
/** The lamp's intensity at full strength: the strength slider scales it, as it scales the hard radius. */
const LAMP_INTENSITY = lamp.intensity
lamp.shadow.mapSize.set(1024, 1024)
lamp.shadow.camera.near = 0.05
lamp.shadow.camera.far = 30

scene.add(flagstones())

// ---------------------------------------------------------------- swarm
const tuning = defaultTuning()
const maxTextureSize = getMaxTextureSize(renderer)
/** The count's top: 16,384, or what this device's textures hold. */
const capacity = Math.min(MAX_RATS, maxTextureSize)
const settings: Settings = {
  rats: Math.min(Math.max(Math.round(Number(url.get('rats') || RATS)) || RATS, 0), capacity),
  minSpeed: tuning.minSpeed,
  maxSpeed: tuning.maxSpeed,
  strength: 1,
  on: true,
  shadows: url.has('shadows'),
}
const swarm = new Swarm(capacity, SEED)
swarm.reset(settings.rats)
const light: Light = { x: 0, z: 0, strength: settings.strength, on: settings.on }

const vat = await loadVAT('./models/rat.vat.glb')
const time: VATTimeUniform = uniform(0)
const rats = new Rats(vat, capacity, maxTextureSize, time)
rats.show(swarm, tuning)
rats.draw(swarm)
rats.mesh.castShadow = true
scene.add(rats.mesh)

// ---------------------------------------------------------------- panel
function lightChanged() {
  light.strength = settings.strength
  light.on = settings.on
  lamp.intensity = settings.on ? LAMP_INTENSITY * settings.strength : 0
}

/**
 * The point light casts the rats' shadows. On WebGPU a batch culled per rat
 * draws the wrong rats once the shadow pass and the view cull differently, so
 * shadows on is culling off: the toggle measures both costs together.
 */
function shadowsChanged() {
  lamp.castShadow = settings.shadows
  rats.culled = !settings.shadows
}

createPanel(settings, capacity, {
  count() {
    // Grows at the arena's edge, so the rats on screen stay where they are.
    swarm.setCount(settings.rats)
    rats.show(swarm, tuning)
  },
  speeds() {
    tuning.minSpeed = settings.minSpeed
    tuning.maxSpeed = settings.maxSpeed
    rats.retime(swarm, tuning)
  },
  light: lightChanged,
  shadows: shadowsChanged,
})
lightChanged()
shadowsChanged()
const readouts = createReadouts(backend)

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
  const frame = timer.getDelta()
  const dt = Math.min(frame, 1 / 30)
  time.value += dt

  idle += dt
  if (idle >= IDLE) {
    loopTime += dt
    swarm.walkLight(light, swarm.loopPoint(loopTime), dt)
  } else swarm.walkLight(light, target, dt)

  const { ms } = swarm.step(dt, light, tuning)
  rats.draw(swarm)
  follow(dt)
  renderer.render(scene, camera)
  readouts({ drawn: rats.drawn, count: swarm.count, steeringMs: ms, frameMs: frame * 1000 })
})
