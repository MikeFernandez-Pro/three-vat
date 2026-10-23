// A page for explaining the light and the walls (light-3d.html): one light,
// one wall and the rats, in the sewers' moss glow. The game's own swarm steps
// them on the page, and its lit areas (litareas.ts) are what the lamp is cut
// by, through `litMask` as its shadow node, as the game cuts its torch: no
// shadow map, one table that the rats and the drawing both read. The light
// is a bare lamp, no torch drawn; the panel sets it, the fill from the dome,
// a moon with real shadows to compare against, the fog and the count.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  LineBasicNodeMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  PointLight,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  Vector3,
  WebGPURenderer,
  type Node,
} from 'three/webgpu'
import { attribute, color, float, int, mix, step, uniform, vec3 } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { loadVAT, setVATInstance, type VATInstance } from 'three-vat'
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from 'three-vat/tsl'
import { ANGLES, SEEN_CAP } from './litareas'
import { litMask } from './lights'
import { RAT } from './rats'
import { seenTexture } from './seen'
import { Swarm, hardRadius } from './swarm'
import { RAT_LENGTH, RAT_SIZE, gameTuning } from './gameplay'
import { WALL_THICKNESS, type Wall } from './walls'

/** The moss glow theme's colours (themes.ts). */
const MOSS = { lamp: 0xbefaab, sky: 0x6b9f85, ground: 0x537f3f, fog: 0x1e2f29, fur: 0x161c1a, eyes: 0xff9a2a, moon: 0x9fd8c0 }
const CAP = 8000
const DT = 1 / 60
const SPEED = 2
const WALL_HEIGHT = 2.2
/** How far the lamp pools past the hard edge the rats keep off, as the game's placed lights do (lights.ts). */
const POOL = 2.3
/** The densest fog the panel's slider reaches. */
const MOST_FOG = 0.25
/**
 * The room the rats are kept in: walls that are never drawn, far in the fog,
 * and further from anywhere the light goes than its rays reach, so the one
 * wall drawn is the only one that casts a shadow.
 */
const ROOM = 16
/** How far from the middle the light may go, m: its rays, SEEN_CAP long, stop short of the room's walls. */
const LIGHT_BOX = ROOM - SEEN_CAP - 1
/** The box the rats start in. */
const START = 8

// ---------------------------------------------------------------- renderer
const renderer = new WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = NeutralToneMapping
renderer.shadowMap.enabled = true
document.body.append(renderer.domElement)
await renderer.init()

const scene = new Scene()
const background = new Color(MOSS.fog)
scene.background = background
const fog = new FogExp2(MOSS.fog, 0.4 * MOST_FOG)
scene.fog = fog
const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100)
camera.position.set(5.5, 7.5, 9)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.3, 0)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI * 0.47
controls.minDistance = 3
controls.maxDistance = 25
// The arrow keys move the light, not the camera.
controls.keys = { LEFT: '', UP: '', RIGHT: '', BOTTOM: '' }
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// The fill from the dome, unblocked by anything: it lights both sides of the wall alike.
const ambient = new HemisphereLight(MOSS.sky, MOSS.ground, 0.35)
scene.add(ambient)
// A moon: a directional light with a real shadow map, to set beside the lamp's table.
const moon = new DirectionalLight(MOSS.moon, 0)
moon.shadow.mapSize.set(2048, 2048)
moon.shadow.camera.left = moon.shadow.camera.bottom = -12
moon.shadow.camera.right = moon.shadow.camera.top = 12
moon.shadow.camera.near = 1
moon.shadow.camera.far = 60
moon.shadow.bias = -0.0005
scene.add(moon, moon.target)

// ---------------------------------------------------------------- the level
const wall = (ax: number, az: number, bx: number, bz: number): Wall => ({ from: { x: ax, z: az }, to: { x: bx, z: bz } })
const WALL = wall(-2.5, 0, 2.5, 0)
const WALLS = [WALL, wall(-ROOM, -ROOM, ROOM, -ROOM), wall(ROOM, -ROOM, ROOM, ROOM), wall(ROOM, ROOM, -ROOM, ROOM), wall(-ROOM, ROOM, -ROOM, -ROOM)]
const inside = { minX: -START, maxX: START, minZ: -START, maxZ: START }

// The stone: the sewers' stone_wall_01, a pale blue the moss tint turns green.
const loader = new TextureLoader()
const stone = (repeatX: number, repeatY: number) => {
  const load = (name: string, srgb = false) => {
    const texture = loader.load(`./textures/surfaces/stone_wall_01/${name}.png`)
    texture.wrapS = texture.wrapT = RepeatWrapping
    texture.repeat.set(repeatX, repeatY)
    if (srgb) texture.colorSpace = SRGBColorSpace
    return texture
  }
  return new MeshStandardNodeMaterial({ map: load('color', true), normalMap: load('normal'), roughnessMap: load('roughness'), aoMap: load('ao'), color: 0x8fb89c, roughness: 0.85 })
}
const floor = new Mesh(new PlaneGeometry(ROOM * 2, ROOM * 2), stone(ROOM * 0.66, ROOM * 0.66))
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)
const length = Math.hypot(WALL.to.x - WALL.from.x, WALL.to.z - WALL.from.z)
const wallMesh = new Mesh(new BoxGeometry(length, WALL_HEIGHT, WALL_THICKNESS), stone(length / 1.6, WALL_HEIGHT / 1.6))
wallMesh.position.set((WALL.from.x + WALL.to.x) / 2, WALL_HEIGHT / 2, (WALL.from.z + WALL.to.z) / 2)
wallMesh.rotation.y = -Math.atan2(WALL.to.z - WALL.from.z, WALL.to.x - WALL.from.x)
wallMesh.receiveShadow = true
scene.add(wallMesh)

// ---------------------------------------------------------------- the swarm
const tuning = Object.assign(gameTuning(), { notice: Infinity })
const light = { x: 0, z: -3.2, strength: 0.8, on: true }
const swarm = new Swarm(CAP, 7, 1, { walls: WALLS, bounds: inside, lights: [{ x: light.x, z: light.z, reach: 4, on: true }] })
swarm.reset(1500)

// ---------------------------------------------------------------- the light
// Its lamp is cut by what it sees, the walls alone, as the game cuts its torch (main.ts): the shadow node is the lit area.
const seen = seenTexture(swarm.areas)
const centre = uniform(new Vector2(light.x, light.z))
const cut = uniform(1)
const sees = litMask(seen.texture, int(0), centre, uniform(0), uniform(0))
const lamp = new PointLight(MOSS.lamp, 9, 0, 1.4)
lamp.castShadow = true
lamp.shadow.shadowNode = mix(float(1), sees, cut)
lamp.shadow.autoUpdate = false
scene.add(lamp)
/**
 * Every material the lamp lights reads the table once in its own graph too, for nothing (times 0). Read only
 * through a light's shadow node, the texture is bound once and never refreshed, and the lamp goes on reading
 * the first table it was handed, from before the light stood anywhere: no wall cut it, and it shone through
 * the wall. The game gets away with it on WebGPU because the GPU step binds the same texture every frame.
 */
const readsTheTable = (material: MeshStandardNodeMaterial, emissive: Node<'vec3'> = vec3(0)) => {
  material.emissiveNode = emissive.add(sees.mul(0))
  material.needsUpdate = true
}
readsTheTable(floor.material as MeshStandardNodeMaterial)
readsTheTable(wallMesh.material as MeshStandardNodeMaterial)

// The rays, on the ground: every fourth of the light's 512, to where each stops.
const RAY_EVERY = 4
const rayPositions = new Float32Array((ANGLES / RAY_EVERY) * 2 * 3)
const rayGeometry = new BufferGeometry()
rayGeometry.setAttribute('position', new BufferAttribute(rayPositions, 3))
const rayMaterial = new LineBasicNodeMaterial({ color: MOSS.lamp, transparent: true, opacity: 0.35, depthWrite: false })
rayMaterial.fog = false
const rays = new LineSegments(rayGeometry, rayMaterial)
rays.frustumCulled = false
rays.visible = false
scene.add(rays)

// ---------------------------------------------------------------- the rats
const maxTextureSize = getMaxTextureSize(renderer)
const vat = await loadVAT(RAT.url)
const time: VATTimeUniform = uniform(0)
const clipNamed = (name: string | undefined) => vat.clips.find((clip) => clip.name === name) ?? vat.clips[0]!
// RUN, WALK, IDLE, in the swarm's order.
const gaitClips = [clipNamed(RAT.clip), clipNamed(RAT.walk), clipNamed(RAT.idle)]
const instances: VATInstance[] = Array.from({ length: CAP }, () => ({ clip: gaitClips[0]!, startTime: -Math.random() * 2, speed: RAT.playback }))
const { mesh: rats, playback } = createVATMesh(vat, instances, { time, maxTextureSize })
// Dark silhouettes in the family's darkest value, their eyes the one bright point on them (themes.ts): the eyes are the bake's yellow vertices.
const baked = attribute('color', 'vec3')
const eye = step(baked.z, float(0.2)).mul(step(float(0.35), baked.y))
for (const material of [rats.material].flat() as MeshStandardNodeMaterial[]) {
  material.colorNode = mix(color(MOSS.fur).mul(baked.x.mul(0.6).add(0.6)), color(0x000000), eye)
  readsTheTable(material, color(MOSS.eyes).mul(eye).mul(2.5).toVec3())
  material.roughness = 0.6
}
rats.receiveShadow = true
rats.frustumCulled = false
scene.add(rats)
const gaits = new Uint8Array(CAP)
const baseScale = RAT_LENGTH / (vat.bounds.max.z - vat.bounds.min.z)
const UP = new Vector3(0, 1, 0)
const RIGHT = new Vector3(1, 0, 0)
const matrix = new Matrix4()
const turn = new Quaternion()
const nose = new Quaternion()
const position = new Vector3()
const scale = new Vector3()

function placeRats() {
  const { x, y, z, heading, pitch, gait, count } = swarm
  for (let i = 0; i < count; i++) {
    if (gait[i] !== gaits[i]) {
      gaits[i] = gait[i]!
      setVATInstance(playback, i, { clip: gaitClips[gait[i]!] ?? gaitClips[0]!, startTime: time.value - Math.random(), speed: RAT.playback })
    }
    scale.setScalar(baseScale * RAT_SIZE * (0.85 + 0.3 * swarm.place(i)))
    turn.setFromAxisAngle(UP, Math.PI / 2 - heading[i]!).multiply(nose.setFromAxisAngle(RIGHT, -pitch[i]!))
    rats.setMatrixAt(i, matrix.compose(position.set(x[i]!, y[i]!, z[i]!), turn, scale))
  }
  rats.count = count
  rats.instanceMatrix.needsUpdate = true
}

// ---------------------------------------------------------------- the panel
const settings = {
  // The light.
  auto: true,
  rays: false,
  wallShadow: true,
  size: 2.4,
  brightness: 9,
  lampColor: MOSS.lamp,
  height: 1.1,
  falloff: 1.4,
  // The rats.
  rats: 1500,
  // The fill.
  ambient: 0.35,
  sky: MOSS.sky,
  ground: MOSS.ground,
  // The moon.
  moon: 0,
  moonColor: MOSS.moon,
  azimuth: 135,
  elevation: 50,
  moonShadows: false,
  // The air.
  fog: 40,
  fogColor: MOSS.fog,
  exposure: 1,
}

function placeMoon() {
  const azimuth = (settings.azimuth * Math.PI) / 180
  const elevation = (settings.elevation * Math.PI) / 180
  moon.position.set(Math.cos(elevation) * Math.cos(azimuth) * 30, Math.sin(elevation) * 30, Math.cos(elevation) * Math.sin(azimuth) * 30)
}
function shadowCasters() {
  // Only the moon draws a shadow map: the lamp's shadow is the table.
  rats.castShadow = wallMesh.castShadow = settings.moonShadows
  moon.castShadow = settings.moonShadows
}

const gui = new GUI({ title: 'Controls' })
const lightFolder = gui.addFolder('Light')
const autoController = lightFolder.add(settings, 'auto').name('walk round the wall')
lightFolder.add(settings, 'rays').name('rays on the ground').onChange((on: boolean) => (rays.visible = on))
lightFolder.add(settings, 'wallShadow').name('wall shadow (the table)').onChange((on: boolean) => (cut.value = on ? 1 : 0))
lightFolder.add(settings, 'size', 0.6, 4.5, 0.1).name('size (m)').onChange((size: number) => (light.strength = size / tuning.ringMax))
lightFolder.add(settings, 'brightness', 0, 40, 0.5).onChange((value: number) => (lamp.intensity = value))
lightFolder.addColor(settings, 'lampColor').name('colour').onChange((value: number) => lamp.color.set(value))
lightFolder.add(settings, 'height', 0.2, 2, 0.05).name('height (m)')
lightFolder.add(settings, 'falloff', 0, 3, 0.05).onChange((value: number) => (lamp.decay = value))
gui.addFolder('Rats').add(settings, 'rats', 100, CAP, 100).name('count')
const fillFolder = gui.addFolder('Ambient (dome fill)')
fillFolder.add(settings, 'ambient', 0, 3, 0.01).name('intensity').onChange((value: number) => (ambient.intensity = value))
fillFolder.addColor(settings, 'sky').name('from above').onChange((value: number) => ambient.color.set(value))
fillFolder.addColor(settings, 'ground').name('from below').onChange((value: number) => ambient.groundColor.set(value))
const moonFolder = gui.addFolder('Moon (directional)')
moonFolder.add(settings, 'moon', 0, 5, 0.05).name('intensity').onChange((value: number) => (moon.intensity = value))
moonFolder.addColor(settings, 'moonColor').name('colour').onChange((value: number) => moon.color.set(value))
moonFolder.add(settings, 'azimuth', 0, 360, 1).name('direction (deg)').onChange(placeMoon)
moonFolder.add(settings, 'elevation', 5, 90, 1).name('elevation (deg)').onChange(placeMoon)
moonFolder.add(settings, 'moonShadows').name('shadows (a real shadow map)').onChange(shadowCasters)
const airFolder = gui.addFolder('Air')
airFolder.add(settings, 'fog', 0, 100, 1).name('fog (%)').onChange((value: number) => (fog.density = (value / 100) * MOST_FOG))
airFolder.addColor(settings, 'fogColor').name('fog colour').onChange((value: number) => {
  fog.color.set(value)
  background.set(value)
})
airFolder.add(settings, 'exposure', 0.2, 3, 0.05).onChange((value: number) => (renderer.toneMappingExposure = value))
placeMoon()
shadowCasters()

function setAuto(on: boolean) {
  settings.auto = on
  autoController.updateDisplay()
}

// ---------------------------------------------------------------- moving the light
/** Round the wall, as the light walks on its own. */
const LOOP = [
  [0, -3.2],
  [4.2, -1.2],
  [4.2, 1.6],
  [0, 3.2],
  [-4.2, 1.6],
  [-4.2, -1.2],
]
let waypoint = 1
let target: { x: number; z: number } | null = null
const keys = new Set<string>()

/** Where the keys send the light, on the ground as the camera sees it: up the screen is away from the camera. */
function keyed(): { x: number; z: number } | null {
  let forward = 0
  let sideways = 0
  if (keys.has('w') || keys.has('z') || keys.has('arrowup')) forward += 1
  if (keys.has('s') || keys.has('arrowdown')) forward -= 1
  if (keys.has('a') || keys.has('q') || keys.has('arrowleft')) sideways -= 1
  if (keys.has('d') || keys.has('arrowright')) sideways += 1
  if (forward === 0 && sideways === 0) return null
  const ahead = new Vector3()
  camera.getWorldDirection(ahead)
  ahead.y = 0
  ahead.normalize()
  const dx = ahead.x * forward - ahead.z * sideways
  const dz = ahead.z * forward + ahead.x * sideways
  const d = Math.hypot(dx, dz)
  return { x: light.x + (dx / d) * 10, z: light.z + (dz / d) * 10 }
}

function stepSwarm() {
  let to = keyed()
  if (to !== null) {
    setAuto(false)
    target = null
  } else if (settings.auto) {
    const [wx, wz] = LOOP[waypoint]!
    if (Math.hypot(wx! - light.x, wz! - light.z) < 0.4) waypoint = (waypoint + 1) % LOOP.length
    to = { x: LOOP[waypoint]![0]!, z: LOOP[waypoint]![1]! }
  } else to = target
  if (to !== null) swarm.walkLight(light, to, DT, SPEED)
  light.x = Math.max(-LIGHT_BOX, Math.min(LIGHT_BOX, light.x))
  light.z = Math.max(-LIGHT_BOX, Math.min(LIGHT_BOX, light.z))
  if (swarm.count !== settings.rats) swarm.setCount(settings.rats)
  return swarm.step(DT, light, tuning).ms
}

const raycaster = new Raycaster()
const groundPlane = new Plane(new Vector3(0, 1, 0), 0)
const pointer = new Vector2()
let downAt: { x: number; y: number } | null = null
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }))
renderer.domElement.addEventListener('pointerup', (e) => {
  // A click, not a drag of the camera.
  if (downAt === null || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.ray.intersectPlane(groundPlane, new Vector3())
  if (hit === null) return
  target = { x: hit.x, z: hit.z }
  setAuto(false)
})
// Captured on the way down: lil-gui stops keys from bubbling out of the panel.
addEventListener(
  'keydown',
  (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return
    keys.add(e.key.toLowerCase())
  },
  { capture: true },
)
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()), { capture: true })
const stats = document.getElementById('stats')!

// ---------------------------------------------------------------- loop
let last = performance.now()
let owed = 0
let stepMs = 0
renderer.setAnimationLoop((now: number) => {
  owed = Math.min(owed + (now - last) / 1000, DT * 4)
  last = now
  while (owed >= DT) {
    stepMs = stepSwarm()
    owed -= DT
  }
  time.value = now / 1000
  // The lamp is cut from where the table was last seen: where the light stood at the step.
  centre.value.set(light.x, light.z)
  seen.update()
  lamp.position.set(light.x, settings.height, light.z)
  lamp.distance = hardRadius(light, tuning) * POOL
  if (rays.visible) {
    const table = swarm.areas.table
    for (let k = 0; k < ANGLES / RAY_EVERY; k++) {
      const b = k * RAY_EVERY
      const a = (b / ANGLES) * Math.PI * 2 - Math.PI
      const d = Math.min(table[b]!, SEEN_CAP)
      rayPositions.set([light.x, 0.03, light.z, light.x + Math.cos(a) * d, 0.03, light.z + Math.sin(a) * d], k * 6)
    }
    rayGeometry.attributes.position!.needsUpdate = true
  }
  placeRats()
  controls.update()
  renderer.render(scene, camera)
  stats.textContent = `rats ${swarm.count}   swarm step ${stepMs.toFixed(1)} ms`
})
