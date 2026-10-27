// PROTOTYPE: the sewers played in 3D (2026-10-13), `sewers-3d.html`: the
// same play step as the 2D page (sewerplay.ts), drawn in the Blender scene
// (exports/sewers.glb, `pnpm export-sewers`), to feel the run at scale before
// any modelling. exports/ is git-ignored, so the page loads only on a machine
// that has the Blender scene's export. The pumpkin kid with his torch, its flame, embers and smoke
// (meat.ts, flame.ts), and the game's rats drawn at their levels of detail on
// WebGPU (rats.ts, ADR-0057); the rest grey boxes, the lights plain point
// lights, each pool as far as the play's reach. Lit and finished as the open
// arena's page is (main.ts), its depth of field and stop motion left out: the
// lamp in the torch, the moon overhead, the green fill, the fog ring round
// him, the occlusion, hatching, paper, vignette and bloom. Drawn through WebGPURenderer, its WebGL 2 backend under `?webgl`,
// where the rats are the batch and have no levels.
//
// The rats as the play sets them down: 8000 all round, on the hub's side of
// the huge door, most of them gathered in the cistern while he wades the canal.
//
// The camera is held behind him, turning as he turns, rigid or eased after him by the panel (sewers3d.camera.ts):
// A and D turn him, W and S walk him ahead or back; dragging tilts it, the
// wheel brings it in or out. C, or the panel, switches it to one of the five
// it was chosen over (sewers3d.cameras.ts), to compare. Whatever stands between it and him, a
// pillar, a door, a prop, a wall's corner, is dithered away round him
// as the camera sees him, as the hall branch's walls were.
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  PerspectiveCamera,
  PointLight,
  PropertyBinding,
  type Material,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector2,
  Vector3,
  VSMShadowMap,
  WebGPURenderer,
} from 'three/webgpu'
import { fog, mx_noise_float, positionWorld, renderGroup, smoothstep, uniform, vec3 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { loadVAT } from 'three-vat'
import { getMaxTextureSize, type VATTimeUniform } from 'three-vat/tsl'
import { RAT_SIZE, SIZE_BY_SPEED } from './gameplay'
import { defaultSeeThrough, seeThrough } from './blockout'
import { createMeat, defaultMeat } from './meat'
import { createFlame, defaultFlame } from './flame'
import { createEmbers } from './embers'
import { createSmoke } from './smoke'
import { createPost, defaultAO, leaveUnshaded, type PostLook } from './post'
import { addCharacterFolder, addCrowd, addEnvFolder, addFlameFolder, addFrameEffects, addLens, addLevelsFolder, addRatsFolder, keepOrdered, type RatsLook } from './panel'
import { listEnvMaps, loadEnvMap, type EnvLook } from './envmaps'
import { LEVELS, RAT, Rats, type LevelsLook, type Placed, type TrailLook } from './rats'
import { Attached, Fixed, Lazy, SEWER_HINTS, Shoulder, Stone, TopDown, Vault, type CameraRig, type Framing, type Pointer, type Subject } from './sewers3d.cameras'
import { FRAMING_RANGES } from './sewers3d.camera'
import { meshesOf, replaceWithNew } from './sewers3d.replace'
import { SewerPlay } from './sewerplay'
import { cellAt, type Point } from './sewers'
import { STEP } from './swarm-remote'
import { TorchLight, torchEdge, useTorchLights } from './torchlight'

const play = new SewerPlay()
const { map, swarm } = play

const hud = document.querySelector<HTMLDivElement>('#hud')!
const splitsEl = document.querySelector<HTMLDivElement>('#splits')!
const said = document.querySelector<HTMLDivElement>('#said')!
const promptEl = document.querySelector<HTMLDivElement>('#prompt')!
const end = document.querySelector<HTMLDivElement>('#end')!

const renderer = new WebGPURenderer({ antialias: true, forceWebGL: new URLSearchParams(location.search).has('webgl') })
useTorchLights(renderer)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.shadowMap.enabled = true
// Variance shadow maps, blurred, as the arena's: the moon's softness smooths its shadows.
// Variance shadow maps, blurred, as the arena's: the moon's softness smooths its shadows. The torch, a point light,
// keeps three's PCF.
renderer.shadowMap.type = VSMShadowMap
document.body.prepend(renderer.domElement)
await renderer.init()
const webgpu = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true

const scene = new Scene()
const DBG = new URLSearchParams(location.search) // TEMP bisect

/**
 * The open arena's look as main.ts starts it (2026-10-13): a hot orange lamp
 * in the torch with no falloff; a pale moon straight overhead, its shadows
 * fairly sharp and not quite black; a green fill, and a green fog ring round
 * him; the occlusion's green creases, faint hatching in the deepest shade,
 * paper, a light vignette and the eyes' bloom. No stop
 * motion, which this page never had. Underground the moon and the fill are turned right down, the torch and the placed lights all the light there is.
 * Set from the panel on 2026-10-20: a greener moon and fill, the fog ring on, thick and far, its edge wispy, and
 * the depth of field on, focused on the light. The fog greys out every surface past its ring, the lit ones too
 * (2026-10-16): past a few metres every material reads as losing its colour, which is the ring, not the shaders.
 */
const look = {
  lamp: { color: 0xff8442, intensity: 13, reach: 6.9, falloff: 0 },
  sun: { enabled: true, shadows: true, color: 0xb8ffcd, intensity: 0.3, height: 23, softness: 1.5, darkness: 0.9 },
  fill: { sky: 0x268235, ground: 0x0c361a, intensity: 0.3 },
  fog: { enabled: true, color: 0x0d1c0e, near: 1, far: 12.9, density: 3.2, wisp: 1.7, scale: 2.75, drift: 0.6 },
  post: {
    ao: { ...defaultAO(), color: 0x174f3e, radius: 1.73, thickness: 4, distanceExponent: 3.95, distanceFallOff: 2 },
    outline: { enabled: false, color: 0xe5fff4, thickness: 0.5, depth: 0.05, normal: 0.6 },
    hatch: { enabled: true, color: 0x06110c, below: 0.02, cross: true, spacing: 9, angle: 45, width: 0.35, strength: 0.2 },
    palette: { enabled: false, levels: 19 },
    grain: { grain: true, grainStrength: 0.08, grainSize: 1, grainOnBeat: false, grainSpeed: 0, paper: true, paperStrength: 1, paperScale: 2.5 },
    vignette: { enabled: true, strength: 0.21, inner: 0.18, outer: 1.16, own: false, colour: 0x000000 },
    dof: { enabled: true, onLight: true, focus: 7.8, focal: 5, bokeh: 1, glow: 0.6 },
    bloom: { enabled: true, strength: 1, radius: 0.5, resolution: 0.5 },
  } satisfies PostLook,
  // No environment map to start: the fog's colour behind, the lights alone lighting.
  env: { map: 'none', intensity: 1, background: false, blur: 0, rotation: 0 } as EnvLook,
}

if (DBG.has('redfog')) look.fog.color = 0xff0000
/** The night's colour behind the scene: the fog's. */
const sky = new Color(look.fog.color)
scene.background = sky
// The fog a ring round him, as the arena's is round the light: how thick it is at a point is how far that point is
// from him on the ground, its edge frayed by noise blown along the ground (none to start, the wisp at 0). The uniforms
// are in the render group, uploaded every render: in an object's own group the level's shaders, whose matrices never
// change, kept the centre they were first drawn with, and past a few metres from the start everything fogged over, the
// lit floor too (2026-10-21; the village's page had found the same).
const fogColor = uniform(new Color()).setGroup(renderGroup)
const fogNear = uniform(DBG.has('initfog') ? 1 : 0).setGroup(renderGroup)
const fogFar = uniform(DBG.has('initfog') ? 5.5 : 1).setGroup(renderGroup)
const fogCentre = uniform(new Vector2()).setGroup(renderGroup)
const fogDensity = uniform(1).setGroup(renderGroup)
const fogWisp = uniform(0).setGroup(renderGroup)
const fogScale = uniform(1).setGroup(renderGroup)
const fogDrift = uniform(0).setGroup(renderGroup)
const fogTime = uniform(0).setGroup(renderGroup)
const fogWind = fogDrift.mul(fogTime)
const fogPoint = vec3(positionWorld.x.add(fogWind), positionWorld.z.add(fogWind.mul(0.6)), positionWorld.y.add(fogWind.mul(0.3))).div(fogScale)
const fogNoise = mx_noise_float(fogPoint).add(mx_noise_float(fogPoint.mul(2.1).add(vec3(7.3, 1.9, 4.1))).mul(0.5))
const fogRamp = DBG.has('plainfog') ? smoothstep(fogNear, fogFar, positionWorld.xz.distance(fogCentre)) : smoothstep(fogNear, fogFar, positionWorld.xz.distance(fogCentre).add(fogNoise.mul(fogWisp)))
const fogAmount = DBG.has('plainfog') ? fogRamp : fogRamp.oneMinus().pow(fogDensity).oneMinus()
if (!DBG.has("nofog")) scene.fogNode = fog(fogColor, fogAmount)
const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 200)

const params = {
  gain: 2.5,
  spread: 2.5,
  /** The torch's shadows, which keep its light from leaking through a wall into the next gallery: on, unlike the arena's lamp. */
  shadows: true,
  seeAll: false,
  /** How high on him the see-through's hole is centred, m over his feet. */
  ditherHeight: 0.8,
  /** The camera rig, by its name. */
  rig: '',
}
const fill = new HemisphereLight()
const seeAll = new AmbientLight(0xffffff, 0)
scene.add(fill, seeAll)
// The moon straight overhead, its shadows over the ground round him, as the arena's follow the light.
const SUN_SHADOW_REACH = 16
const SUN_SHADOW_SIZE = 1024
const SOFTNESS_TEXELS = 2048
const sun = new DirectionalLight()
sun.shadow.mapSize.set(SUN_SHADOW_SIZE, SUN_SHADOW_SIZE)
Object.assign(sun.shadow.camera, { left: -SUN_SHADOW_REACH, right: SUN_SHADOW_REACH, top: SUN_SHADOW_REACH, bottom: -SUN_SHADOW_REACH, near: 1, far: 80 })
sun.shadow.camera.updateProjectionMatrix()
sun.shadow.bias = -0.0005
scene.add(sun, sun.target)

// ---------------------------------------------------------------- the level

// The file from Blender, sewers2.3 (2026-10-20); `?glb=sewers` plays the plain export (`pnpm export-sewers`), `?glb=sewers2.2` an
// older one, from exports/. Its modelled pieces, named `<box>.new`, take the grey boxes' places (sewers3d.replace.ts); `?boxes` keeps the boxes.
const gltf = await new GLTFLoader().loadAsync(`/exports/${new URLSearchParams(location.search).get('glb') ?? 'sewers2.3'}.glb`)
const level = gltf.scene
scene.add(level)
// The fourth chandelier's model was left under the name it came with: it is the ring's piece, as the other three's are.
const fourthRing = level.getObjectByName(PropertyBinding.sanitizeNodeName('vintage lantern 3d model.004'))
if (fourthRing) fourthRing.name = PropertyBinding.sanitizeNodeName('chandelier 4.ring.new')
if (!DBG.has('boxes')) replaceWithNew(level)
// The loader keeps names as three binds them: spaces made underscores, dots and colons dropped.
const named = <T extends Object3D = Object3D>(name: string) => level.getObjectByName(PropertyBinding.sanitizeNodeName(name)) as T | undefined
const all = (prefix: string) => {
  const out: Object3D[] = []
  const start = PropertyBinding.sanitizeNodeName(prefix)
  level.traverse((o) => o.name.startsWith(start) && out.push(o))
  return out
}

// The stone casts and takes shadows from either side, so no light leaks through a wall into the next gallery.
named('Stone')!.traverse((o) => {
  const mesh = o as Mesh
  if (!mesh.isMesh) return
  mesh.receiveShadow = true
  mesh.castShadow = !mesh.name.endsWith('water')
  ;(mesh.material as MeshStandardMaterial).shadowSide = DoubleSide
})
// The dither: every material of the level but the floors' and the water's, cut away in a Bayer pattern round the
// child as the camera sees him, where it stands nearer the camera than he does (blockout.ts's see-through); never
// the child himself. The file's materials are made node materials here, as the renderer would, to take its mask.
/** The see-through's look, as the panel's dither folder edits it: the walls' own to start. */
const seeLook = defaultSeeThrough()
const see = seeThrough(seeLook)
const NOT_DITHERED = new Set(['floor', 'water', 'water_bed', 'canal_bed', 'canal_water'])
// The chest glows once opened: materials of its own, before the level's are made node materials.
const chestMeshes = meshesOf(named('chest')!)
for (const mesh of chestMeshes) mesh.material = (mesh.material as MeshStandardMaterial).clone()
const asNodes = new Map<Material, MeshStandardNodeMaterial>()
level.traverse((o) => {
  const mesh = o as Mesh
  if (!mesh.isMesh) return
  const material = mesh.material as MeshStandardMaterial
  let node = asNodes.get(material)
  if (node === undefined) {
    node = new MeshStandardNodeMaterial()
    for (const key in material) (node as unknown as Record<string, unknown>)[key] = (material as unknown as Record<string, unknown>)[key]
    asNodes.set(material, node)
  }
  mesh.material = node
})
// The walls and the floor in the sewers' stone, stone_wall_01 as light-3d.html has it, a pale blue the moss tint turns green; the
// file's uv is in metres, a tile every 1.6 m to start, each surface's own tile and turn set from the panel's stone folders.
/** Each stone surface's tile, m, and turn, degrees, as the panel edits them, and what applies them to its maps. */
const stones: { name: string; look: { tile: number; rotation: number }; apply: () => void }[] = []
{
  const loader = new TextureLoader()
  for (const name of ['walls', 'floor']) {
    const mesh = named<Mesh>(name)
    if (!mesh) continue
    const look = { tile: 1.6, rotation: 0 }
    const textures: Texture[] = []
    const load = (file: string, srgb = false) => {
      const texture = loader.load(`./textures/surfaces/stone_wall_01/${file}.png`)
      texture.wrapS = texture.wrapT = RepeatWrapping
      if (srgb) texture.colorSpace = SRGBColorSpace
      textures.push(texture)
      return texture
    }
    const stone = mesh.material as MeshStandardNodeMaterial
    Object.assign(stone, { map: load('color', true), normalMap: load('normal'), roughnessMap: load('roughness'), aoMap: load('ao'), roughness: 0.85 })
    stone.color.set(0x8fb89c)
    stone.needsUpdate = true
    const apply = () => {
      for (const texture of textures) {
        texture.repeat.setScalar(1 / look.tile)
        texture.rotation = (look.rotation * Math.PI) / 180
      }
    }
    apply()
    stones.push({ name, look, apply })
  }
}
const dithered = new Set<Material>()
level.traverse((o) => {
  const mesh = o as Mesh
  if (!mesh.isMesh || NOT_DITHERED.has(mesh.name) || mesh.name.startsWith('start')) return
  const material = mesh.material as MeshStandardNodeMaterial
  if (dithered.has(material)) return
  dithered.add(material)
  if (!DBG.has("nodither")) see.cut(material)
})

// The designer's markers never show in play.
for (const name of ['Waiting rats', 'Checkpoints', 'Labels', 'canal edge (no rat crosses)', 'manhole']) {
  const o = named(name)
  if (o) o.visible = false
}
for (const o of all('')) if (o.name.endsWith('reach') || o.name.endsWith('swing')) o.visible = false
// Nor the colliders: the play reads them from the map (sewers.colliders.ts), as walls.
for (const o of all('collider')) o.visible = false

const pad = (k: number) => String(k).padStart(2, '0')
// The grey box the child was stands hidden where the file has it; the pumpkin kid stands in for him.
named<Mesh>('start (child, ~1.2 m)')!.visible = false
const hugeDoor = named('huge door')!
const symbolDoor = named('symbol door')!
const rods = { gas: named('huge door.rod.gas')!, water: named('huge door.rod.water')!, hub: named('huge door.rod.hub')! }
/** Which way each lever's handle swings over as it is pulled: the gas lever's east, the hub's south, toward him, the water lever's west. */
const SWING = { gas: new Vector3(1, 0, 0), hub: new Vector3(0, 0, 1), water: new Vector3(-1, 0, 0) }
const swingAxis = new Vector3()
// Where the doors and the rods rest, as the file has them: the doors sink from there, the rods draw back from there.
const rest = { huge: hugeDoor.position.y, symbol: symbolDoor.position.y, rods: { gas: rods.gas.position.x, water: rods.water.position.x, hub: rods.hub.position.x } }
// The modelled huge door (huge door.new) never moves: two arms bar it, each hooked at the middle. The gas lever frees
// the left one, the water lever the right: its hook lifts off, turning 60 degrees about the north axis, then its arm
// swings 140 degrees about the up axis, back toward the hub; the hub lever then swings both leaves open about the up
// axis, away from him. The grey box sinks instead, its rods drawing back; with the modelled door its rods are hidden.
const latches = {
  gas: { hook: named('hook1'), arm: named('arm1'), sign: 1 },
  water: { hook: named('hook2'), arm: named('arm2'), sign: -1 },
}
const leaves = { left: named('doorLeft'), right: named('doorRight') }
const modelledDoor = latches.gas.hook !== undefined && latches.gas.arm !== undefined && leaves.left !== undefined && leaves.right !== undefined
if (modelledDoor) for (const rod of Object.values(rods)) rod.visible = false
/** How far each lever's work on the huge door has gone, 0 to 1, in its own time: a latch over 3 s, the leaves over 4 s. */
const worked = { gas: 0, water: 0, hub: 0 }
const DEG = Math.PI / 180
const smooth = (t: number) => t * t * (3 - 2 * t)
/** `t` from 0 to 1 over the stretch `from` to `to` of the whole, smoothed. */
const stretch = (t: number, from: number, to: number) => smooth(Math.min(1, Math.max(0, (t - from) / (to - from))))
const handles = { gas: named('lever.gas.handle')!, water: named('lever.water.handle')!, hub: named('lever.hub.handle')! }
const clouds = map.jets.map((_, k) => named(`jet.${pad(k)}.cloud`)!)
const numerals = ['I', 'II', 'III', 'IV']
const plates = map.plates.map((plate) => named(`plate.${numerals[plate.numeral - 1]} ${plate.symbol}`)!)
const lightObjects = map.lights.map((_, k) => all(`light.${pad(k)} `)[0]!)

// Every light a point light, its pool as far as the play's reach times `spread`; a chandelier's swings with it.
const HEIGHTS = { lamp: 1, brazier: 1.2, fire: 1, chandelier: 2.4 }
/** The placed lights' colours by look, as the panel's folder edits them. */
const COLOURS = { lamp: 0xffd9a8, brazier: 0xffb878, fire: 0xffa860, chandelier: 0xfff0d8 }
const pointLights = map.lights.map((light) => {
  const p = new PointLight(COLOURS[light.look], params.gain, light.reach * params.spread, 1)
  p.position.y = HEIGHTS[light.look]
  scene.add(p)
  return p
})
// The torch's lamp, the arena's, burning in the flame: its pool's edge hard, so the circle is seen.
const torch = new TorchLight()
torch.castShadow = params.shadows && !DBG.has("noshadow")
torch.shadow.mapSize.set(512, 512)
torch.shadow.camera.near = 0.05
torch.shadow.bias = -0.004
scene.add(torch)

// ---------------------------------------------------------------- the child and his torch

/** The pumpkin kid, as on the open arena's page, in a group that stands, turns and leans him as the play has him. */
const kid = new Group()
const meat = await createMeat()
/** The pumpkin kid's look as the panel's character folder edits it. */
const meatLook = { ...defaultMeat(), parts: meat.parts.map((part) => ({ ...part })) }
meat.set(meatLook)
// He faces the group's +z; the group turns him.
meat.face(0)
kid.add(meat.object)
// He casts no shadow, from the torch or the moon, but takes the walls'. With variance shadow maps three draws every
// mesh that takes shadows into the shadow map too, so castShadow alone leaves his; in the shadow pass his every point
// is put at one, and none of him is drawn there.
kid.traverse((o) => {
  const mesh = o as Mesh
  o.castShadow = false
  o.receiveShadow = true
  if (mesh.isMesh) (mesh.material as MeshStandardNodeMaterial).castShadowPositionNode = vec3(0, 0, 0)
})
if (!DBG.has("nokid")) scene.add(kid)
/** How high his feet stand, m: up the ladder as he climbs it, down on the canal's bed as he wades. */
let stand = 0
/** The canal's bed, m below the floor, as tools/export-sewers.ts lays it. */
const CANAL_BED = -0.6
const flameLook = defaultFlame()
/** The flame's size with a full torch: it burns smaller as the light shrinks. */
const flameFull = { height: flameLook.height, width: flameLook.width }
const flame = createFlame()
const embers = createEmbers()
const smoke = createSmoke()
flame.set(flameLook)
embers.set(flameLook.embers)
smoke.set(flameLook.smoke)
// None of the torch casts a shadow: the flame is light.
// and none of it is shaded: the occlusion and the hatching are not drawn over it.
for (const part of [flame.object, embers.object, smoke.object]) {
  part.traverse((o) => {
    o.castShadow = false
    if ((o as Mesh).isMesh) leaveUnshaded((o as Mesh).material as MeshStandardNodeMaterial)
  })
  if (!DBG.has("nokid")) scene.add(part)
}
/** A flame in the fog ring like everything else: its layers' materials take the scene's fog, which flame.ts leaves off. */
const fogged = (object: Object3D) =>
  object.traverse((o) => {
    if ((o as Mesh).isMesh) ((o as Mesh).material as MeshStandardNodeMaterial).fog = true
  })
fogged(flame.object)
/** Where the torch's end, the flame's light and its tip are, this frame. */
const torchEnd = new Vector3()
const flameAt = new Vector3()
const torchRest = new Vector3()
const flameTip = new Vector3()
const flameOffset = new Vector3()
/** The page's clock, s: what the kid, his flame and the rats are posed at; it holds while paused. */
let elapsed = 0
/** The flame's draws, smooth: two waves on the clock at a pace of each channel's own, so it wavers rather than jumps. */
const flameDraw = (channel: number) => {
  const rate = 4 + ((channel * 1.37) % 5)
  return Math.sin(elapsed * rate + channel * 1.7) * 0.6 + Math.sin(elapsed * rate * 2.3 + channel) * 0.4
}
/** Where he stood last frame: he runs by how fast he went. */
const was = { x: play.holder.x, z: play.holder.z }

// The placed lights' flames, the torch's own (flame.ts), on every light but the gas lever's lantern: a great one up from
// the hub fire's ring, one on each brazier's bowl, a small one in each lantern's body and on each chandelier's ring,
// where it hangs or where it fell. Each stands on the modelled piece as the file has it: the fire's at the ring's foot,
// a bowl's and a ring's at its top, a lantern's halfway up its body, inside the glass. The file's `<light>.flame`
// markers no longer show.
const FLAME_SIZES: Record<string, { height: number; width: number; part: string; up: number }> = {
  fire: { height: 1, width: 0.55, part: 'ring', up: 0 },
  brazier: { height: 0.5, width: 0.28, part: 'bowl', up: 1 },
  lamp: { height: 0.26, width: 0.13, part: 'body', up: 0.45 },
  chandelier: { height: 0.28, width: 0.14, part: 'ring', up: 1 },
}
const NO_FLAME = new Set(['gas lever'])
const placedFlames = map.lights.map((light) => {
  named(`${light.name}.flame`)?.traverse((o) => (o.visible = false))
  const size = FLAME_SIZES[light.look]
  if (size === undefined || NO_FLAME.has(light.name)) return undefined
  const placedFlame = createFlame()
  placedFlame.set({ ...defaultFlame(), height: size.height, width: size.width, lean: 0 })
  placedFlame.object.traverse((o) => {
    o.castShadow = false
    if ((o as Mesh).isMesh) leaveUnshaded((o as Mesh).material as MeshStandardNodeMaterial)
  })
  fogged(placedFlame.object)
  scene.add(placedFlame.object)
  // The foot's height over the part's origin: on a chandelier it follows the ring down. The flame burns on the part
  // where the file has it, which may stand a little off the map's light.
  const part = named(`${light.name}.${size.part}`)
  let foot = 0.1
  if (part) {
    const box = new Box3().setFromObject(part)
    foot = box.min.y + (box.max.y - box.min.y) * size.up
    if (light.look === 'chandelier') foot -= part.position.y
  }
  return { flame: placedFlame, foot, part, follows: light.look === 'chandelier' }
})
const placedFoot = new Vector3()

// ---------------------------------------------------------------- the rats

// The game's rats, as the open arena's page draws them: culled and drawn at their levels of detail on WebGPU (ADR-0057), the batch on WebGL 2.
const vat = await loadVAT(RAT.url)
const time: VATTimeUniform = uniform(0)
const rats = new Rats(vat, RAT, swarm.capacity, getMaxTextureSize(renderer), time, 1.7, webgpu ? renderer : undefined)
rats.setSize(RAT_SIZE)
rats.setSizeBySpeed(SIZE_BY_SPEED)
// The arena page's look: matt rats in four tints, a soft green highlight and rim, glowing eyes and their amber trails;
// the panel's rats folder edits it, as the arena's does.
const levels: LevelsLook = { on: true, show: false, split: 'none', blur: 1, levels: LEVELS.map((level) => ({ ...level })) }
const ratsLook: RatsLook = {
  color: RAT.color,
  // The model's parts, skin, fur and eyes, each its own colour: the folder's eyes and variants come with them. The
  // eyes acid lime, glowing a little, set from the panel on 2026-10-20.
  parts: rats.parts.map((part) => ({ ...part, color: part.name === 'eyes' ? 0x8cff1a : part.color })),
  variants: [
    { tint: 0x282426, share: 0.25 },
    { tint: 0x313335, share: 0.05 },
    { tint: 0x3a3135, share: 0.23 },
    { tint: 0x7e7777, share: 0.02 },
  ],
  glow: 0.5,
  sheen: 0,
  specular: 0.27,
  shininess: 30,
  softness: 0.17,
  specularColor: 0x1c401c,
  rim: true,
  rimStrength: 0.17,
  rimWidth: 0.24,
  rimSoftness: 0.34,
  rimColor: 0xbefecd,
  toon: { steps: 3, three: [0, 0.38, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
  paint: { strength: 1.3, density: 2.5, size: 1.75, rounding: 0 },
  levels,
  stagger: { n: swarm.stagger, from: swarm.staggerFrom, show: false },
}
// The trails in the eyes' colour (set from the panel on 2026-10-21).
const trailsLook: TrailLook = { enabled: true, seconds: 0.11, width: 0.01, strength: 4, wave: 2, taper: 1.9, fade: 6, wiggle: 0, wiggleSpeed: 1.6, color: 0xffbe0a, eyeColour: true }
/** The rats' look taken, as the arena page takes it; the far crowd's staggered steps go to the swarm too. */
function ratsChanged(): void {
  rats.material.color.set(ratsLook.color)
  rats.material.set(ratsLook)
  rats.material.setToon(ratsLook.toon)
  rats.material.setPaint(ratsLook.paint)
  ratsLook.parts.forEach((part, i) => rats.setPartColor(i, part.color))
  rats.setVariants(ratsLook.variants)
  rats.setGlow('eyes', ratsLook.glow)
  rats.setLevels(ratsLook.levels)
  swarm.stagger = ratsLook.stagger.n
  swarm.staggerFrom = ratsLook.stagger.from
  rats.setStagger(ratsLook.stagger)
  rats.setTrails(trailsLook)
}
ratsChanged()
if (!DBG.has("norats")) scene.add(rats.object)
addEventListener('pagehide', (event) => event.persisted || rats.dispose())
/** The play's swarm as the rats read it: its own arrays, each rat where the last step left it, facing as it does. */
const placed: Placed = {
  ready: false,
  version: 0,
  count: 0,
  x: swarm.x,
  z: swarm.z,
  y: swarm.y,
  pitch: swarm.pitch,
  heading: swarm.heading,
  gait: swarm.gait,
  place: swarm.places,
  orient: () => {},
  pair: () => undefined,
}

// ---------------------------------------------------------------- input and camera

/** The way his body faces: A and D turn it. */
let bodyYaw = 0
const keysLine = document.querySelector<HTMLDivElement>('#keys')!
const KEYS_LINE = keysLine.textContent ?? ''
const MOVE: Record<string, [number, number]> = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }
const pressed = new Set<string>()
let paused = false
addEventListener('keydown', (event) => {
  if (event.code in MOVE) event.preventDefault()
  pressed.add(event.code)
  if (event.repeat) return
  if (rig.key?.(event.code)) return
  if (event.code === 'KeyC') useRig((rigs.indexOf(rig) + 1) % rigs.length)
  else if (event.code === 'KeyR' && !event.ctrlKey) restart(0)
  else if (/^Digit[0-5]$/.test(event.code)) restart(Number(event.code.slice(5)))
  else if (event.code === 'KeyP') paused = !paused
  else if (event.code === 'KeyV') {
    params.seeAll = !params.seeAll
    gui.controllersRecursive().forEach((c) => c.updateDisplay())
  } else if (event.code === 'KeyL') play.settings.everlasting = !play.settings.everlasting
})
addEventListener('keyup', (event) => pressed.delete(event.code))
addEventListener('blur', () => pressed.clear())

// The mouse, gathered between frames: dragged, or moved while locked to the page.
const pointer: Pointer = { dx: 0, dy: 0, panX: 0, panY: 0, wheel: 0 }
// The left button tilts it; the right moves it, across and up, the way it looks held.
let drag: { x: number; y: number; pan: boolean } | undefined
const canvas = renderer.domElement
canvas.addEventListener('contextmenu', (event) => event.preventDefault())
canvas.addEventListener('pointerdown', (event) => {
  if (rig.locksPointer && document.pointerLockElement !== canvas) {
    void canvas.requestPointerLock()
    return
  }
  drag = { x: event.clientX, y: event.clientY, pan: event.button === 2 }
  canvas.setPointerCapture(event.pointerId)
})
canvas.addEventListener('pointermove', (event) => {
  if (document.pointerLockElement === canvas) {
    pointer.dx += event.movementX
    pointer.dy += event.movementY
    return
  }
  if (!drag) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  if (drag.pan) {
    pointer.panX += dx
    pointer.panY += dy
  } else {
    pointer.dx += dx
    pointer.dy += dy
  }
  drag = { x: event.clientX, y: event.clientY, pan: drag.pan }
})
canvas.addEventListener('pointerup', () => (drag = undefined))
canvas.addEventListener('wheel', (event) => (pointer.wheel += event.deltaY), { passive: true })

/**
 * How the child turns: `tank`, how fast A and D turn him, rad/s; `turn`,
 * under the cameras that read the keys their own way, how fast his body comes
 * round to the way the keys send him, rad/s, walking along it as it turns, 0 at once.
 */
const turning = { tank: 2.4, turn: 0 }

/** The keys held, as (x, z): x the sideways keys, z ahead (-1) or back. */
function keys(): Point {
  let x = 0
  let z = 0
  for (const code of pressed) {
    const move = MOVE[code]
    if (move) {
      x += move[0]
      z += move[1]
    }
  }
  return { x, z }
}

/**
 * One step of the keys: with tank controls, the sideways keys turn him and ahead or back walks him the
 * way he faces, (sin yaw, -cos yaw); otherwise the keys walk him the way the
 * camera reads them, up the screen its yaw.
 */
function heading(dt: number): Point | null {
  const { x, z } = keys()
  const d = Math.hypot(x, z)
  if (rig.controls === 'tank') {
    if (!play.climbing) bodyYaw += x * turning.tank * dt
    if (z === 0) return null
    return { x: -z * Math.sin(bodyYaw), z: z * Math.cos(bodyYaw) }
  }
  const yaw = rig.inputYaw(d > 0)
  if (d === 0) return null
  const s = Math.sin(yaw)
  const c = Math.cos(yaw)
  const wx = c * x - s * z
  const wz = s * x + c * z
  if (turning.turn <= 0) {
    bodyYaw = Math.atan2(wx, -wz)
    const l = Math.hypot(wx, wz)
    return { x: wx / l, z: wz / l }
  }
  // His body comes round at the turn rate, the shorter way, and he walks the way it faces.
  const want = Math.atan2(Math.sin(Math.atan2(wx, -wz) - bodyYaw), Math.cos(Math.atan2(wx, -wz) - bodyYaw))
  bodyYaw += Math.sign(want) * Math.min(Math.abs(want), turning.turn * dt)
  return { x: Math.sin(bodyYaw), z: -Math.cos(bodyYaw) }
}

// ---------------------------------------------------------------- cameras

// The walls and the doors keep the cameras that ride near him out of the stone.
const stone = new Stone([named('walls'), ...meshesOf(hugeDoor), ...meshesOf(symbolDoor)].filter((o) => o !== undefined))
/** Where the fixed cameras may hang: every 4 m over the floor, kept off the walls. */
const places: Point[] = []
for (let z = map.level.bounds.minZ; z <= map.level.bounds.maxZ; z += 4) {
  for (let x = map.level.bounds.minX; x <= map.level.bounds.maxX; x += 4) {
    if ([[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]].every(([dx, dz]) => cellAt(map.grid, x + dx!, z + dz!) === 1)) places.push({ x, z })
  }
}
const rigs: CameraRig[] = [new Attached(), new Shoulder(stone), new Lazy(stone), new TopDown(), new Fixed(stone, places), new Vault(stone, SEWER_HINTS)]
let rig: CameraRig = rigs[0]!
const subject: Subject = { x: 0, y: 0, z: 0, yaw: 0, moving: false }

function readSubject(): Subject {
  subject.x = play.holder.x
  subject.y = stand
  subject.z = play.holder.z
  subject.yaw = bodyYaw
  subject.moving = play.going.x !== 0 || play.going.z !== 0
  return subject
}

// ---------------------------------------------------------------- panel

const gui = new GUI({ title: 'Sewers 3D' })
// The open arena's own controls first, as its panel has them: the rats' count, speeds, size and spacing, their run's
// pace, the light's strength and his pace, the character, and the pause.
/** The rats' size and spacing, the run's pace, whether every rat plays Run, and whether the character shows, as the panel edits them. */
const settings = { size: RAT_SIZE, sizeBySpeed: SIZE_BY_SPEED, spacing: 1, runAnimation: 1.7, alwaysRun: true, character: true }
/** The collision disc at the usual size: the rat scale and the spacing multiply it. */
const RAT_RADIUS = play.tuning.ratRadius / RAT_SIZE
// How many rats: at once, the new ones set down out of view and coming after him, the last ones dropped;
// and the play's budget, so a start again keeps it.
gui
  .add(play.settings, 'rats', 0, swarm.capacity, 50)
  .name('rats')
  .onChange((n: number) => swarm.setCount(n))
// The slowest never outruns the fastest; the play sends its tuning to the swarm each step.
keepOrdered(gui.add(play.tuning, 'minSpeed', 0.2, 12, 0.05).name('slowest m/s'), gui.add(play.tuning, 'maxSpeed', 0.2, 12, 0.05).name('fastest m/s'))
keepOrdered(gui.add(play.tuning, 'fleeMinSpeed', 0.2, 12, 0.05).name('flee slowest m/s'), gui.add(play.tuning, 'fleeMaxSpeed', 0.2, 12, 0.05).name('flee fastest m/s'))
// The rat is drawn at its size, and collides as a disc that size times the spacing.
const sizeChanged = () => {
  rats.setSize(settings.size)
  rats.setSizeBySpeed(settings.sizeBySpeed)
  play.tuning.ratRadius = RAT_RADIUS * settings.size * settings.spacing
}
gui.add(settings, 'size', 0.5, 3, 0.05).name('rat scale').onChange(sizeChanged)
gui.add(settings, 'sizeBySpeed', 1, 3, 0.05).name('fastest ÷ slowest size').onChange(sizeChanged)
gui.add(settings, 'spacing', 0.5, 3, 0.05).name('spacing').onChange(sizeChanged)
gui.add(settings, 'runAnimation', 0.1, 4, 0.05).name('run animation speed').onChange((v: number) => rats.setSpeed(v))
gui.add(settings, 'alwaysRun').name('always run')
// The rats' lunges: how often each, a second, how much faster than its pace, and how long.
gui.add(swarm, 'dashRate', 0, 3, 0.05).name('dashes a second')
gui.add(swarm, 'dashSpeed', 1, 6, 0.1).name('dash × pace')
gui.add(swarm, 'dashTime', 0.03, 0.5, 0.01).name('dash s')
// How far either way off the line to him each rat swerves as it comes, rad.
gui.add(swarm, 'weave', 0, 1.5, 0.05).name('weave rad')
// The light's strength, 0 to 1: the torch's reach as a share of the light's full hard radius, as the arena's page has it.
const lightStrength = {
  get strength() {
    return play.runTuning.torchReach / play.tuning.ringMax
  },
  set strength(value: number) {
    play.runTuning.torchReach = Math.round(value * play.tuning.ringMax * 100) / 100
  },
}
const strengthSlider = gui.add(lightStrength, 'strength', 0, 1, 0.01).name('light strength (Q / E)')
gui.add(play.pace, 'walk', 0.2, 12, 0.1).name('walk speed m/s')
gui.add(play.pace, 'run', 0.2, 12, 0.1).name('run speed m/s')
gui.add(settings, 'character').name('show character').onChange((on: boolean) => (kid.visible = on))
gui.add({ pause: () => (paused = !paused) }, 'pause').name('pause / resume (P)')
gui.add(params, 'gain', 0, 10, 0.1).name('lights gain')
gui.add(params, 'spread', 1, 5, 0.1).name('pool / reach')
gui.add(params, 'shadows').name('torch shadows').onChange((v: boolean) => (torch.castShadow = v))
gui.add(params, 'seeAll').name('see everything (V)')
const lampFolder = gui.addFolder('torch lamp')
// The light a full torch holds the rats off to, and its pool with it: both shrink from here to nothing as it burns.
lampFolder.add(play, 'torchSeconds', 3, 60, 0.1).name('duration, s')
lampFolder.add(play.runTuning, 'torchReach', 0.1, play.tuning.ringMax, 0.01).name('max light, m')
lampFolder.add(play.runTuning, 'torchLeast', 0, play.tuning.ringMax, 0.01).name('min light, m')
lampFolder.add(play.runTuning, 'fadeCurve', 0.2, 4, 0.05).name('shrink curve (<1 later, >1 sooner)')
lampFolder.add(torchEdge, 'value', 0, 1, 0.01).name('edge (0 hard, 1 soft)')
lampFolder.addColor(look.lamp, 'color').onChange(lookChanged)
lampFolder.add(look.lamp, 'intensity', 0, 150, 1).onChange(lookChanged)
lampFolder.add(look.lamp, 'reach', 0, 30, 0.1).name('reach m, full torch')
lampFolder.add(look.lamp, 'falloff', 0, 3, 0.05).onChange(lookChanged)
const placedFolder = gui.addFolder('placed lights')
placedFolder.addColor(COLOURS, 'lamp').name('lanterns')
placedFolder.addColor(COLOURS, 'brazier').name('braziers')
placedFolder.addColor(COLOURS, 'fire').name('hub fire')
placedFolder.addColor(COLOURS, 'chandelier').name('chandeliers')
const sunFolder = gui.addFolder('moon')
sunFolder.add(look.sun, 'enabled').name('on').onChange(lookChanged)
sunFolder.add(look.sun, 'shadows').onChange(lookChanged)
sunFolder.addColor(look.sun, 'color').onChange(lookChanged)
sunFolder.add(look.sun, 'intensity', 0, 10, 0.1).onChange(lookChanged)
sunFolder.add(look.sun, 'softness', 0, 6, 0.1).onChange(lookChanged)
sunFolder.add(look.sun, 'darkness', 0, 1, 0.01).name('shadow darkness').onChange(lookChanged)
const fillFolder = gui.addFolder('fill')
fillFolder.addColor(look.fill, 'sky').onChange(lookChanged)
fillFolder.addColor(look.fill, 'ground').onChange(lookChanged)
fillFolder.add(look.fill, 'intensity', 0, 3, 0.05).onChange(lookChanged)
const fogFolder = gui.addFolder('fog round him')
fogFolder.add(look.fog, 'enabled').name('on').onChange(lookChanged)
fogFolder.addColor(look.fog, 'color').onChange(lookChanged)
fogFolder.add(look.fog, 'near', 0, 20, 0.1).name('near, m').onChange(lookChanged)
fogFolder.add(look.fog, 'far', 0.5, 30, 0.1).name('far, m').onChange(lookChanged)
fogFolder.add(look.fog, 'density', 1, 6, 0.1).onChange(lookChanged)
fogFolder.add(look.fog, 'wisp', 0, 3, 0.05).name('wisp, m').onChange(lookChanged)
// The frame's effects and the lens, every folder the arena page has (panel.ts), in its postprocessing folder.
const postFolder = gui.addFolder('postprocessing')
for (const folder of [...addFrameEffects(postFolder, look.post), ...addLens(postFolder, look.post)]) folder.onChange(lookChanged)
// The environment map, from three's examples as the dev server serves them (envmaps.ts), lighting the shells.
const envMaps = await listEnvMaps()
addEnvFolder(gui, look.env, envMaps.map((entry) => entry.name)).onChange(envChanged)
const ditherFolder = gui.addFolder('dither in the way')
const ditherChanged = () => see.set(seeLook)
ditherFolder.add(seeLook, 'enabled').name('on').onChange(ditherChanged)
ditherFolder.add(seeLook, 'strength', 0, 1, 0.01).name('how much goes').onChange(ditherChanged)
ditherFolder.add(seeLook, 'radius', 0.2, 5, 0.05).name('radius round him, m').onChange(ditherChanged)
ditherFolder.add(seeLook, 'inner', 0, 0.99, 0.01).name('clear core, share').onChange(ditherChanged)
ditherFolder.add(seeLook, 'bias', 0, 3, 0.05).name('nearer than him by, m').onChange(ditherChanged)
ditherFolder.add(seeLook, 'ditherScale', 1, 8, 1).name('dither cell, px').onChange(ditherChanged)
ditherFolder.add(params, 'ditherHeight', 0, 1.6, 0.05).name('centred up him, m')
ditherFolder.add({ copy: () => {
  const text = JSON.stringify({ ...seeLook, height: params.ditherHeight })
  console.log(text)
  void navigator.clipboard?.writeText(text)
} }, 'copy').name('copy dither values')
params.rig = rig.name
const rigChoice = gui.add(params, 'rig', rigs.map((r) => r.name)).name('camera (C)').onChange((name: string) => useRig(rigs.findIndex((r) => r.name === name)))
/** The rigs' tunings by name in the panel; the attached camera's lags are times, the others' lerps rates. */
const LABELS: Record<string, string> = {
  distance: 'distance, m',
  pitch: 'tilt, rad',
  height: 'pivot height, m',
  side: 'off his shoulder, m',
  ahead: 'aim ahead, m',
  fov: 'field of view, deg',
  back: 'out-from-wall lerp /s (0 none)',
  steer: 'steer-behind lerp /s',
  track: 'look lerp /s (0 none)',
  move: 'glide between cams /s (0 cut)',
}
const FRAMING_LABELS: Record<keyof Framing, string> = {
  right: 'view right, m (him left)',
  up: 'view up, m (him lower)',
  minAzimuth: 'horizontal min, deg (0 behind, < 0 left)',
  maxAzimuth: 'horizontal max, deg',
  minPolar: 'vertical min, deg (0 above, 90 level)',
  maxPolar: 'vertical max, deg',
}
const LERPS: Record<string, string> = { follow: 'follow lerp /s (0 none)', turn: 'turn lerp /s (0 none)' }
const LAGS: Record<string, string> = { follow: 'follow lag, s', turn: 'turn lag, s' }
const rigFolders = rigs.map((r) => {
  const folder = gui.addFolder(`camera: ${r.name}`)
  for (const [key, value] of Object.entries(r.tunings)) {
    if (typeof value === 'boolean') folder.add(r.tunings as Record<string, boolean>, key)
    else {
      const [min, max, step] = r.ranges[key]!
      const label = (r instanceof Attached ? LAGS[key] : LERPS[key]) ?? LABELS[key] ?? key
      folder.add(r.tunings as Record<string, number>, key, min, max, step).name(label).listen()
    }
  }
  const framed = folder.addFolder('framing')
  for (const key of r.framed ?? (Object.keys(FRAMING_RANGES) as (keyof Framing)[])) {
    const [min, max, step] = FRAMING_RANGES[key]
    framed.add(r.framing, key, min, max, step).name(FRAMING_LABELS[key])
  }
  // The camera as it now stands, to the clipboard and the console: to keep once it feels right.
  folder.add({ copy: () => {
    const text = JSON.stringify({ ...r.tunings, framing: r.framing })
    console.log(text)
    void navigator.clipboard?.writeText(text)
  } }, 'copy').name('copy camera values')
  folder.hide()
  return folder
})

/** Switch to rig `k`: its panel shown, its keys on the key line, settled round him at once. */
function useRig(k: number): void {
  rig = rigs[k]!
  params.rig = rig.name
  rigChoice.updateDisplay()
  rigFolders.forEach((folder, j) => (j === k ? folder.show() : folder.hide()))
  if (!rig.locksPointer && document.pointerLockElement) document.exitPointerLock()
  keysLine.textContent = `C camera: ${rig.name} · ${rig.help} | ${KEYS_LINE}`
  camera.fov = 50
  camera.updateProjectionMatrix()
  rig.snap(readSubject())
}
useRig(rigs.findIndex((r) => r instanceof Shoulder))
const playerFolder = gui.addFolder('player')
playerFolder.add(turning, 'tank', 0.5, 8, 0.1).name('tank turn, rad/s')
playerFolder.add(turning, 'turn', 0, 30, 0.5).name('body turn, rad/s (0 instant)')
// The stone's tile and turn on each surface; the crowd as the open arena's page tunes it, the play's own tuning, sent to the swarm each step.
for (const { name, look, apply } of stones) {
  const folder = gui.addFolder(`${name} stone`)
  folder.add(look, 'tile', 0.2, 6, 0.05).name('tile, m').onChange(apply)
  folder.add(look, 'rotation', -180, 180, 1).name('turn, degrees').onChange(apply)
}
addCrowd(gui, play.tuning)
// Their look, the arena page's folder: colours, variants, eyes and trails, shell, strokes, toon steps and the far crowd's
// staggered steps; their levels of detail, a folder beside it.
addRatsFolder(gui, ratsLook, trailsLook).onChange(ratsChanged)
addLevelsFolder(gui, ratsLook.levels).onChange(ratsChanged)
// The pumpkin kid and his torch's flame, with its embers and smoke, as the arena page's folders edit them.
addCharacterFolder(gui, meatLook).onChange(() => meat.set(meatLook))
addFlameFolder(gui, flameLook).onChange(() => {
  flameFull.height = flameLook.height
  flameFull.width = flameLook.width
  flame.set(flameLook)
  embers.set(flameLook.embers)
  smoke.set(flameLook.smoke)
})
gui.add(play.settings, 'everlasting').name('endless light (L)')

// Every folder starts folded, a reset at its foot putting its values back as the page started them.
for (const folder of gui.foldersRecursive()) {
  folder.add({ reset: () => folder.reset() }, 'reset')
  folder.close()
}

// ---------------------------------------------------------------- splits

const splits: [string, number][] = []
const split = (name: string, happened: boolean) => {
  if (happened && !splits.some(([n]) => n === name)) splits.push([name, play.t])
}
function track(): void {
  split('stick lit', play.lit)
  split('hub', play.stage >= 1)
  split('gas lever', play.pulled.gas)
  split('key', play.key)
  split('chest', play.chest)
  split('water lever', play.pulled.water)
  split('hub lever', play.pulled.hub)
  split('canal', !Number.isNaN(play.canalAt))
  split('cistern', play.stage >= 2)
  split('symbol door', play.symbolOpen)
  split('ladder', play.climbing)
  split('out', play.won)
}

function restart(point: number): void {
  play.skipTo(point)
  splits.length = 0
  end.style.display = 'none'
  track()
  for (const entry of splits) entry[1] = Number.NaN
  // Facing up the run from wherever it starts again, the camera there at once.
  bodyYaw = 0
  stand = 0
  rig.snap(readSubject())
}

// ---------------------------------------------------------------- the look

// The frame through the arena's effects: the scene once, then the occlusion, hatching, paper, vignette and bloom.
const post = createPost(renderer, scene, camera, { color: fogColor, amount: fogAmount })
post.seed(0, 0)

/** Everything the look's folders set. */
/** The map the environment folder last asked for: a newer ask while one loads wins. */
let envAsked = 'none'
/** The environment folder taken: the map, loaded once asked for, lighting the shells; behind the scene or not; its strength, blur and turn. */
function envChanged(): void {
  const env = look.env
  scene.environmentIntensity = env.intensity
  scene.backgroundBlurriness = env.blur
  scene.environmentRotation.y = scene.backgroundRotation.y = (env.rotation * Math.PI) / 180
  const behind = () => (scene.background = env.background && scene.environment ? scene.environment : sky)
  if (env.map === envAsked) return void behind()
  envAsked = env.map
  const entry = envMaps.find((candidate) => candidate.name === env.map)
  if (!entry) {
    scene.environment = null
    return void behind()
  }
  void loadEnvMap(entry).then((texture) => {
    if (envAsked !== entry.name) return
    scene.environment = texture
    behind()
  })
}

function lookChanged(): void {
  torch.color.set(look.lamp.color)
  torch.decay = look.lamp.falloff
  sun.visible = look.sun.enabled && !DBG.has("nomoon")
  sun.castShadow = look.sun.shadows
  sun.color.set(look.sun.color)
  sun.intensity = look.sun.intensity
  sun.shadow.radius = (look.sun.softness * SUN_SHADOW_SIZE) / SOFTNESS_TEXELS
  sun.shadow.intensity = look.sun.darkness
  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity
  fogColor.value.set(look.fog.color)
  sky.set(look.fog.color)
  // Off, its ring pushed out of reach.
  fogNear.value = look.fog.enabled ? look.fog.near : 1e6
  fogFar.value = look.fog.enabled ? Math.max(look.fog.far, look.fog.near + 0.5) : 1e6 + 1
  fogDensity.value = Math.max(look.fog.density, 1)
  fogWisp.value = look.fog.wisp
  fogScale.value = Math.max(look.fog.scale, 0.1)
  fogDrift.value = look.fog.drift
  post.set(look.post)
}
lookChanged()

// ---------------------------------------------------------------- the frame

const sunk = { huge: 0, symbol: 0 }
/** How fast Q and E dial the torch's reach, m/s. */
const DIAL_RATE = 1.2
let last = performance.now()
let fps = 60
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05
  if (!paused && !play.won) {
    let left = dt
    while (left > 1e-6) {
      const step = Math.min(left, STEP)
      play.frame(step, { heading: heading(step), run: pressed.has('ShiftLeft') || pressed.has('ShiftRight'), interact: pressed.has('KeyF') })
      left -= step
    }
    track()
    elapsed += dt
  }
  // Q and E dial the light's strength while held, as on the arena's page.
  const dial = (pressed.has('KeyQ') ? 1 : 0) - (pressed.has('KeyE') ? 1 : 0)
  if (dial !== 0) {
    play.runTuning.torchReach = Math.min(play.tuning.ringMax, Math.max(0, play.runTuning.torchReach + dial * DIAL_RATE * dt))
    strengthSlider.updateDisplay()
  }
  draw(dt)
  if (!unseenBuilt) buildUnseen()
  if (DBG.has("nopost")) renderer.render(scene, camera)
  else post.render()
  drawHud()
})

/** Whether every light and flame has been drawn once, to build the shaders with every light in them. */
let unseenBuilt = false
/**
 * A light at nought when a material is first built is left out of its shader
 * for good on three's WebGPU build, and a light hidden or shown has every lit
 * material built again: so the lights are dimmed, never hidden, and the first
 * frame draws them all on, and every flame, under the frame it shows.
 */
function buildUnseen(): void {
  unseenBuilt = true
  const torchWas = torch.intensity
  torch.intensity = look.lamp.intensity
  for (const part of [flame.object, embers.object, smoke.object]) part.visible = true
  const were = pointLights.map((p) => p.intensity)
  for (const p of pointLights) p.intensity = params.gain
  for (const placedFlame of placedFlames) if (placedFlame) placedFlame.flame.object.visible = true
  if (DBG.has("nopost")) renderer.render(scene, camera)
  else post.render()
  torch.intensity = torchWas
  for (const part of [flame.object, embers.object, smoke.object]) part.visible = play.run.torch.lit && settings.character
  pointLights.forEach((p, k) => (p.intensity = were[k]!))
  placedFlames.forEach((placedFlame, k) => placedFlame && (placedFlame.flame.object.visible = map.lights[k]!.on))
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const ease = (from: number, to: number, rate: number, dt: number) => from + (to - from) * (1 - Math.exp(-rate * dt))

let dbgFrames = 0
function draw(dt: number): void {
  // TEMP bisect: every level material built again once, a second in.
  ++dbgFrames
  if (DBG.has('nudge')) level.position.y = (dbgFrames % 2) * 1e-5
  if (DBG.has('nudgeonce') && dbgFrames === 400) level.position.y = 1e-5
  if (DBG.has('latefog') && dbgFrames > 60) fogNear.value = 1 + (dbgFrames % 2) * 1e-4
  if (DBG.has('rebuild') && dbgFrames === 60) level.traverse((o) => { const m = (o as Mesh).material as Material | undefined; if (m) m.needsUpdate = true })
  const holder = play.holder

  // The child: on the ladder he climbs as the cover gives; in the canal, on its bed.
  stand = play.climbing ? 0.6 + Math.min(1, play.cover / 3) * 3.6 : play.wading ? CANAL_BED : 0
  kid.position.set(holder.x, stand, holder.z)
  kid.rotation.set(0, Math.PI - bodyYaw, 0)
  // He runs by how fast he went, facing the way the group turns him; held while paused.
  const vx = dt > 0 ? (holder.x - was.x) / dt : 0
  const vz = dt > 0 ? (holder.z - was.z) / dt : 0
  was.x = holder.x
  was.z = holder.z
  meat.pose(elapsed, 0, Math.hypot(vx, vz))

  // The torch: the flame on its end, as on the open arena's page; its light there, its pool as far as the play's reach.
  const lit = play.run.torch.lit
  for (const part of [flame.object, embers.object, smoke.object]) part.visible = lit && settings.character
  // The flame as big as the light is strong: full with a full torch, smaller as its reach shrinks.
  const strength = play.runTuning.torchReach > 0 ? play.run.torch.reach / play.runTuning.torchReach : 0
  flameLook.height = flameFull.height * strength
  flameLook.width = flameFull.width * strength
  flame.shape(flameDraw, vx, vz)
  flame.place(meat.tip(torchEnd, flame.offset(flameOffset)))
  flame.centre(flameAt)
  // The lamp straight over him, as high as the flame burns in the idle, whatever the walk or the run swing the torch to:
  // its pool round him, not round his hand.
  meat.restTip(torchRest, flame.offset(flameOffset))
  torch.position.set(kid.position.x, torchRest.y + flameFull.height * 0.5, kid.position.z)
  // Out, dimmed rather than hidden: a light hidden or shown has every lit material's shader built again, a stall of
  // most of a second each time he lights it (2026-10-20). A light at nought when a material is first built is left out
  // of it for good on three's WebGPU build, so the first frame draws every light on (`buildUnseen`).
  torch.intensity = lit ? look.lamp.intensity : 0
  // The lamp's pool follows the torch's reach as it burns down, as the arena's does.
  torch.distance = Math.max(DBG.has('torchdist') ? 5 : 0.01, (look.lamp.reach * play.run.torch.reach) / play.tuning.ringMax)
  // The fog ring round him, and the moon over him, its shadows covering the view.
  fogCentre.value.set(holder.x, holder.z)
  fogTime.value = elapsed
  sun.target.position.set(holder.x, 0, holder.z)
  sun.position.set(holder.x, look.sun.height, holder.z)

  // The placed lights: each as the play has it, the chandeliers swinging, or on the floor once fallen; out, dimmed, as the torch is.
  map.lights.forEach((light, k) => {
    const p = pointLights[k]!
    const fallen = light.look === 'chandelier' && play.fallen
    p.position.set(light.x, fallen ? 0.4 : HEIGHTS[light.look], light.z)
    p.intensity = light.on ? params.gain : 0
    p.color.set(COLOURS[light.look])
    p.distance = light.reach * params.spread
    const o = lightObjects[k]!
    o.position.x = light.x
    o.position.z = light.z
    let ringY: number | undefined
    if (light.look === 'chandelier') {
      const chain = o.children.find((c) => c.name.endsWith('chain'))
      const ring = o.children.find((c) => c.name.endsWith('ring'))
      if (chain) chain.visible = !fallen
      if (ring) ringY = ring.position.y = fallen ? 0.06 : ((ring.userData.restY as number | undefined) ??= ring.position.y)
    }
    // Its flame, burning while it is on, each wavering on channels of its own.
    const placedFlame = placedFlames[k]
    if (placedFlame) {
      placedFlame.flame.object.visible = light.on
      if (light.on) {
        placedFlame.flame.shape((channel) => flameDraw(channel + 7 * (k + 1)), 0, 0)
        if (placedFlame.part) placedFlame.part.getWorldPosition(placedFoot)
        else placedFoot.set(light.x, 0, light.z)
        placedFoot.y = (placedFlame.follows && ringY !== undefined ? ringY : 0) + placedFlame.foot
        placedFlame.flame.place(placedFoot)
      }
    }
  })

  // The symbol door sinks into the floor once open; the huge door too as a grey box, its rods drawing back as each
  // lever is pulled, while the modelled one is unbarred and swung open.
  const hugeOpen = play.doorsOpen[map.doors.findIndex((door) => door.name === 'huge door')] === true
  sunk.symbol = ease(sunk.symbol, play.symbolOpen ? 1 : 0, 2.5, dt)
  symbolDoor.position.y = rest.symbol - sunk.symbol * 3.6
  if (modelledDoor) {
    for (const name of ['gas', 'water'] as const) {
      worked[name] = play.pulled[name] ? Math.min(1, worked[name] + dt / 3) : 0
      const { hook, arm, sign } = latches[name]
      hook!.rotation.z = sign * 60 * DEG * stretch(worked[name], 0, 0.35)
      arm!.rotation.y = -sign * 140 * DEG * stretch(worked[name], 0.35, 1)
    }
    worked.hub = hugeOpen ? Math.min(1, worked.hub + dt / 4) : 0
    leaves.left!.rotation.y = 90 * DEG * smooth(worked.hub)
    leaves.right!.rotation.y = -90 * DEG * smooth(worked.hub)
  } else {
    sunk.huge = ease(sunk.huge, hugeOpen ? 1 : 0, 1.5, dt)
    hugeDoor.position.y = rest.huge - sunk.huge * 3.6
  }
  for (const name of ['gas', 'water', 'hub'] as const) {
    if (!modelledDoor) rods[name].position.x = rest.rods[name] + (play.pulled[name] ? 3.2 : 0)
    const lever = map.levers.find((l) => l.name === name)!
    const share = play.pulled[name] ? 1 : Math.min(1, play.leverHold[name] / lever.hold)
    handles[name].quaternion.setFromAxisAngle(swingAxis.set(0, 1, 0).cross(SWING[name]), share * 1.1)
  }

  // The jets' gas while they jet; the plates only in a light; the chest open.
  clouds.forEach((cloud, k) => (cloud.visible = play.jetting(k)))
  plates.forEach((plate, k) => (plate.visible = params.seeAll || play.platesSeen[k] === true))
  for (const mesh of chestMeshes) (mesh.material as MeshStandardMaterial).emissive.setHex(play.chest ? 0x806020 : 0x000000)

  seeAll.intensity = params.seeAll ? 2.5 : 0

  // The camera; the see-through's hole round him as it sees him.
  rig.update(dt, readSubject(), pointer, camera)
  pointer.dx = pointer.dy = pointer.panX = pointer.panY = pointer.wheel = 0
  see.subject.value.set(holder.x, kid.position.y + params.ditherHeight, holder.z)

  // The flame's smoke and embers on the clock; the rats where the play's swarm has them, at their levels.
  smoke.update(elapsed, flame.tip(flameTip), camera.position)
  embers.update(elapsed, flameAt)
  time.value = elapsed
  placed.count = swarm.count
  placed.ready = true
  placed.version++
  // Every rat plays Run, whatever its gait, unless the panel gives the gaits back.
  if (!DBG.has("nodraw")) rats.draw(placed, camera, !settings.alwaysRun)

  // The key to press, a small F over what it works, while he is within reach of it.
  const prompt = play.prompt()
  if (prompt) promptAt.set(prompt.x, PROMPT_HEIGHT, prompt.z).project(camera)
  const shown = prompt !== undefined && promptAt.z < 1
  promptEl.style.display = shown ? 'block' : 'none'
  if (shown) {
    promptEl.style.left = `${((promptAt.x + 1) / 2) * innerWidth}px`
    promptEl.style.top = `${((1 - promptAt.y) / 2) * innerHeight}px`
  }
}

/** How high over the floor the F is shown, m. */
const PROMPT_HEIGHT = 1.4
const promptAt = new Vector3()


const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

function drawHud(): void {
  const torchNow = play.run.torch
  const tick = (b: boolean) => (b ? 'x' : ' ')
  hud.textContent = [
    `${clock(play.t)}   torch ${torchNow.lit ? `${play.left.toFixed(1)} s` : 'out'}${play.settings.everlasting ? ' (endless)' : ''}${play.running ? '   running' : ''}${paused ? '   PAUSED' : ''}`,
    `checkpoint ${['start', 'hub', 'cistern'][play.stage]}   caught ${play.caught}`,
    `levers [${tick(play.pulled.gas)}] gas  [${tick(play.pulled.water)}] water  [${tick(play.pulled.hub)}] hub   key [${tick(play.key)}]  chest [${tick(play.chest)}]`,
    `camera ${rig.name}${rig.status ? ` · ${rig.status}` : ''}`,
    `rats ${swarm.count}, ${rats.drawn} drawn   step ${(play.report?.ms ?? 0).toFixed(1)} ms   ${fps.toFixed(0)} fps`,
  ].join('\n')
  splitsEl.textContent = ['splits', ...splits.map(([name, t]) => `${name.padEnd(13)} ${Number.isNaN(t) ? 'skipped' : clock(t)}`)].join('\n')
  said.textContent = play.line()
  if (play.won) {
    end.style.display = 'block'
    end.textContent = `Out.\n\n${clock(play.t)} · caught ${play.caught}${play.chest ? ' · the secret found' : ''}\n\nR to start again`
  }
}

Object.assign(window, { _dbg: { fogCentre, fogNear, fogFar, torch, play } }) // TEMP
