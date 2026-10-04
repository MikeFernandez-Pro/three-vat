// Last Light: a swarm of rats held off by a light (ADR-0044). The swarm steps,
// then the crowd stands every rat where the swarm has it; the light walks to the
// pointer, or its own loop once the pointer has been idle; the camera trails it.
//
// The URL sets the start: `?webgl` draws through WebGPURenderer's WebGL 2
// backend, `?rats=8192` starts with that many rats, `?shadows` with the lamp's
// shadows on.
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
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
import { dirt } from './ground'
import { createPanel, createReadouts, type Look, type Settings } from './panel'
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
/**
 * The sun's distance from the light it follows, and how far its shadows reach
 * around it, in metres: enough to cover the view, so no shadow ends on screen.
 */
const SUN_DISTANCE = 30
const SUN_SHADOW_REACH = 16

/** How the scene looks to start; the panel's look folders edit it. */
const look: Look = {
  // The lamp's reach ends a little over twice the ring out, so the ground past
  // the swarm keeps the fog's cold tone and the warm ring reads sharply.
  lamp: { color: 0xffa850, intensity: 36, reach: 7.5, falloff: 2 },
  // A cold, dim moon, high and to one side: the rats' shadows read without
  // washing out the lamp's ring.
  sun: { color: 0x9fb4c8, intensity: 1, elevation: 55, azimuth: 30, shadows: true, softness: 2 },
  fill: { sky: 0x8fa8a0, ground: 0x1c2220, intensity: 0.7 },
  fog: { color: 0x3a4641, near: 6, far: 38 },
  // Tinted down so the rats read as a dark carpet at the light's edge, not brown.
  rats: { color: 0x404040 },
}

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
// Ready for the sun and the lamp to cast, each while its shadows toggle is on;
// filtered, so the sun's softness has edges to soften.
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFShadowMap

const scene = new Scene()
const fog = new Fog(0, 0, 1)
scene.fog = fog
scene.background = new Color()

const camera = new PerspectiveCamera(CAMERA_FOV, innerWidth / innerHeight, 0.1, 100)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// A dim cold fill, a far cold sun, and the one warm light.
const fill = new HemisphereLight()
scene.add(fill)

const sun = new DirectionalLight()
sun.shadow.mapSize.set(2048, 2048)
Object.assign(sun.shadow.camera, {
  left: -SUN_SHADOW_REACH,
  right: SUN_SHADOW_REACH,
  top: SUN_SHADOW_REACH,
  bottom: -SUN_SHADOW_REACH,
  near: 1,
  far: SUN_DISTANCE * 2,
})
sun.shadow.camera.updateProjectionMatrix()
sun.shadow.bias = -0.0005
scene.add(sun, sun.target)

const lamp = new PointLight()
lamp.shadow.mapSize.set(1024, 1024)
lamp.shadow.camera.near = 0.05
lamp.shadow.camera.far = 30
scene.add(lamp)

scene.add(await dirt())

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
// Drawn, and culled, from the first frame on, once the camera has its place.
rats.show(swarm, tuning)
rats.mesh.castShadow = true
scene.add(rats.mesh)

// ---------------------------------------------------------------- panel
const sunDirection = new Vector3()

/** Everything the look folders set; the lamp's intensity also follows the light's strength. */
function lookChanged() {
  light.strength = settings.strength
  light.on = settings.on
  lamp.color.set(look.lamp.color)
  lamp.intensity = settings.on ? look.lamp.intensity * settings.strength : 0
  lamp.distance = look.lamp.reach
  lamp.decay = look.lamp.falloff

  sun.color.set(look.sun.color)
  sun.intensity = look.sun.intensity
  sun.castShadow = look.sun.shadows
  sun.shadow.radius = look.sun.softness
  const up = (look.sun.elevation * Math.PI) / 180
  const round = (look.sun.azimuth * Math.PI) / 180
  sunDirection.set(Math.cos(up) * Math.sin(round), Math.sin(up), Math.cos(up) * Math.cos(round))

  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity

  fog.color.set(look.fog.color)
  ;(scene.background as Color).set(look.fog.color)
  fog.near = look.fog.near
  fog.far = Math.max(look.fog.far, look.fog.near + 0.5)

  rats.material.color.set(look.rats.color)
}

/**
 * The lamp's shadows: a cube of six passes, so a toggle to measure. The rats
 * are culled by `rats.draw` either way, never by three, so every pass draws
 * the same rats (see rats.ts).
 */
function shadowsChanged() {
  lamp.castShadow = settings.shadows
}

createPanel(settings, look, capacity, {
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
  light: lookChanged,
  shadows: shadowsChanged,
  look: lookChanged,
})
lookChanged()
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
const aim = new Vector3()
const want = new Vector3()

/** Carry the lamp and the sun's aim to the light, and trail it with the camera; at once when `dt` is negative. */
function follow(dt: number) {
  lamp.position.set(light.x, LIGHT_HEIGHT, light.z)
  // The sun stays over the light, so its shadows always cover the view.
  sun.target.position.set(light.x, 0, light.z)
  sun.position.copy(sun.target.position).addScaledVector(sunDirection, SUN_DISTANCE)
  aim.set(light.x, 0, light.z)
  want.copy(aim).add(CAMERA_OFFSET)
  camera.position.lerp(want, dt < 0 ? 1 : 1 - Math.exp(-CAMERA_FOLLOW * dt))
  camera.lookAt(aim.x, aim.y, aim.z - 0.6)
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
  follow(dt)
  rats.draw(swarm, camera)
  renderer.render(scene, camera)
  readouts({ drawn: rats.drawn, count: swarm.count, steeringMs: ms, frameMs: frame * 1000 })
})
