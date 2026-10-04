// Last Light: a swarm of rats held off by a light (ADR-0044). The swarm steps,
// then the crowd stands every rat where the swarm has it; the light walks where
// the keys send it, and the camera trails it.
//
// The URL sets the start: `?webgl` draws through WebGPURenderer's WebGL 2
// backend, `?rats=8192` starts with that many rats, `?shadows` with the lamp's
// shadows on, and `?loop` has the light walk a fixed loop instead of the keys,
// so two runs can be measured against each other.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu'
import { fog, positionWorld, smoothstep, uniform } from 'three/tsl'
import { loadVAT } from 'three-vat'
import { getMaxTextureSize, type VATTimeUniform } from 'three-vat/tsl'
import { collapseBatchRuns } from './collapse'
import { dirt } from './ground'
import { createPanel, createReadouts, ZOOM_MAX, ZOOM_MIN, type Look, type Settings } from './panel'
import { Rats } from './rats'
import { defaultTuning, Swarm, type Light } from './swarm'

const RATS = 2000
/** The count's top, where the device's textures allow it: a playback row a rat. */
const MAX_RATS = 16384
const SEED = 7
const url = new URLSearchParams(location.search)
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
 * How far the sun's shadows reach around the light it follows, in metres:
 * enough to cover the view, so no shadow ends on screen. And how deep they
 * reach: past the ground from the furthest place the panel can put the sun.
 */
const SUN_SHADOW_REACH = 16
const SUN_SHADOW_DEPTH = 80

/** How the scene looks to start; the panel's look folders edit it. */
const look: Look = {
  // The lamp's reach ends a little over twice the ring out, so the ground past
  // the swarm keeps the fog's cold tone and the warm ring reads sharply.
  lamp: { color: 0xffa850, intensity: 36, reach: 7.5, falloff: 2 },
  // A cold, dim moon, high and to one side: the rats' shadows read without
  // washing out the lamp's ring.
  sun: { color: 0x9fb4c8, intensity: 1, x: 9, y: 25, z: 15, shadows: true, softness: 2, darkness: 1 },
  fill: { sky: 0x8fa8a0, ground: 0x1c2220, intensity: 0.7 },
  // Round the light, not the camera: the dark closes in on the holder from
  // every side, a little past where the lamp's reach runs out.
  fog: { color: 0x3a4641, near: 5, far: 16 },
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
scene.background = new Color()
// The fog is a ring round the light: how thick it is at a point is how far
// that point is from the light on the ground, not from the camera. Every
// material reads the one node, so the uniforms move it without a recompile.
const fogColor = uniform(new Color())
const fogNear = uniform(0)
const fogFar = uniform(1)
const fogCentre = uniform(new Vector2())
scene.fogNode = fog(fogColor, smoothstep(fogNear, fogFar, positionWorld.xz.distance(fogCentre)))

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
  far: SUN_SHADOW_DEPTH,
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
/** The collision disc and the ring's width at the usual size: the rat scale multiplies both. */
const RAT_RADIUS = tuning.ratRadius
const BAND = tuning.band
const maxTextureSize = getMaxTextureSize(renderer)
/** The count's top: 16,384, or what this device's textures hold. */
const capacity = Math.min(MAX_RATS, maxTextureSize)
const settings: Settings = {
  rats: Math.min(Math.max(Math.round(Number(url.get('rats') || RATS)) || RATS, 0), capacity),
  minSpeed: tuning.minSpeed,
  maxSpeed: tuning.maxSpeed,
  size: 1,
  strength: 1,
  on: true,
  shadows: url.has('shadows'),
  zoom: 1,
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
  // A uniform the shadow reads: the slider recompiles nothing.
  sun.shadow.intensity = look.sun.darkness

  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity

  fogColor.value.set(look.fog.color)
  ;(scene.background as Color).set(look.fog.color)
  fogNear.value = look.fog.near
  fogFar.value = Math.max(look.fog.far, look.fog.near + 0.5)

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
  size() {
    // One size for the rat drawn and the disc it collides as: the swarm keeps
    // bigger rats further apart, and the crowd draws them, and lengthens their
    // strides, to match. The ring widens with them, so it stays as many rats
    // deep: in a ring of fixed width, bigger rats only pile up.
    tuning.ratRadius = RAT_RADIUS * settings.size
    tuning.band = BAND * settings.size
    rats.retime(tuning)
  },
  speeds() {
    // Every rat plays at the speed it really moves, so its feet follow on their own.
    tuning.minSpeed = settings.minSpeed
    tuning.maxSpeed = settings.maxSpeed
  },
  light: lookChanged,
  shadows: shadowsChanged,
  look: lookChanged,
})
lookChanged()
shadowsChanged()
const readouts = createReadouts(backend)

// ---------------------------------------------------------------- keys
// WASD or the arrows walk the light, as the camera sees the ground: up the
// screen is -z. The light walks only while a key is held.
const loop = url.has('loop')
let loopTime = 0
const KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
}
const held = new Set<string>()
// Captured on the way down: lil-gui stops keys from bubbling out of the panel.
addEventListener(
  'keydown',
  (event) => {
    if (!(event.code in KEYS) || event.target instanceof HTMLInputElement) return
    event.preventDefault()
    held.add(event.code)
  },
  { capture: true },
)
addEventListener('keyup', (event) => held.delete(event.code), { capture: true })
// Keys released while the page had no focus never send their keyup.
addEventListener('blur', () => held.clear())

// The camera's zoom: the wheel, + and -, and the panel's slider, all one setting.
/** Zoom by `factor`, inside its range. */
function zoomBy(factor: number) {
  settings.zoom = Math.min(Math.max(settings.zoom * factor, ZOOM_MIN), ZOOM_MAX)
}
renderer.domElement.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault()
    zoomBy(Math.exp(-event.deltaY * 0.001))
  },
  { passive: false },
)
addEventListener(
  'keydown',
  (event) => {
    if (event.target instanceof HTMLInputElement) return
    if (event.code === 'Equal' || event.code === 'NumpadAdd') zoomBy(1.1)
    else if (event.code === 'Minus' || event.code === 'NumpadSubtract') zoomBy(1 / 1.1)
  },
  { capture: true },
)

/** A point a metre past the light the way the held keys point, or null when none do. */
function heading(): { x: number; z: number } | null {
  let x = 0
  let z = 0
  for (const code of held) {
    x += KEYS[code][0]
    z += KEYS[code][1]
  }
  const d = Math.hypot(x, z)
  return d === 0 ? null : { x: light.x + x / d, z: light.z + z / d }
}

// ---------------------------------------------------------------- loop
const timer = new Timer()
const aim = new Vector3()
const want = new Vector3()

/** Carry the lamp, the fog's centre and the sun's aim to the light, and trail it with the camera; at once when `dt` is negative. */
function follow(dt: number) {
  lamp.position.set(light.x, LIGHT_HEIGHT, light.z)
  fogCentre.value.set(light.x, light.z)
  // The sun stays over the light, so its shadows always cover the view.
  sun.target.position.set(light.x, 0, light.z)
  sun.position.copy(sun.target.position).add(look.sun)
  aim.set(light.x, 0, light.z)
  want.copy(aim).addScaledVector(CAMERA_OFFSET, 1 / settings.zoom)
  camera.position.lerp(want, dt < 0 ? 1 : 1 - Math.exp(-CAMERA_FOLLOW * dt))
  camera.lookAt(aim.x, aim.y, aim.z - 0.6)
}
follow(-1)

renderer.setAnimationLoop(() => {
  timer.update()
  const frame = timer.getDelta()
  const dt = Math.min(frame, 1 / 30)
  time.value += dt

  if (loop) {
    loopTime += dt
    swarm.walkLight(light, swarm.loopPoint(loopTime), dt)
  } else {
    const to = heading()
    if (to !== null) swarm.walkLight(light, to, dt)
  }

  const { ms } = swarm.step(dt, light, tuning)
  follow(dt)
  rats.draw(swarm, tuning, camera)
  renderer.render(scene, camera)
  readouts({ drawn: rats.drawn, count: swarm.count, steeringMs: ms, frameMs: frame * 1000 })
})
