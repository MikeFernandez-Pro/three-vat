// Last Light: a swarm of rats held off by a light (ADR-0044). The swarm steps
// in a worker, at a fixed rate; each frame the crowd stands every rat where the
// swarm had it a step ago, between two steps; the light walks where the keys
// send it, its chicken hops on the space bar, and the camera, which the mouse
// moves freely, follows it.
//
// The URL sets the start: `?webgl` draws through WebGPURenderer's WebGL 2
// backend, `?rats=8192` starts with that many rats, `?shadows` with the lamp's
// shadows on, and `?loop` has the light walk a fixed loop instead of the keys,
// so two runs can be measured against each other.
//
// The look steps down where a device cannot keep up (quality.ts): `?step=N`
// starts on step N, and `?adapt=0`, or any of the measuring switches
// (`?ao=0`, `?dof=0`, `?dpr=N`, `?post=0`), holds it where it starts.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  type Mesh,
  type NodeMaterial,
  VSMShadowMap,
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
import { createPost, defaultAO, leaveUnshaded } from './post'
import { collapseBatchRuns } from './collapse'
import { floor } from './ground'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createPanel, createReadouts, type Look, type Settings } from './panel'
import { RAT, Rats, SCARAB, TRAIL_LAYER } from './rats'
import { createMeat, defaultMeat } from './meat'
import { createFlame, defaultFlame } from './flame'
import { createEmbers } from './embers'
import { createSmoke } from './smoke'
import { defaultTuning, loopPoint, walkLight, type Light } from './swarm'
import { RemoteSwarm } from './swarm-remote'
import { Quality, ladder, startingStep } from './quality'

const RATS = 2000
// What runs for the light: the rat; `?scarab` runs the scarab in its place.
const creature = new URLSearchParams(location.search).has('scarab') ? SCARAB : RAT
/** How fast the light walks to start, m/s: a brisk walk, as fast as the quickest rat. */
const LIGHT_SPEED = 1.2
/** The count's top, where the device's textures allow it: a playback row a rat. */
const MAX_RATS = 16384
const SEED = 7
const url = new URLSearchParams(location.search)
/** The light's height above the ground where its holder carries it, when it is not in the torch. */
const LIGHT_HEIGHT = 1.1
/**
 * Where the camera starts from the light, and its field of view: high and
 * close behind, as the panel's zoom left it, chosen by eye. From there the
 * mouse moves it freely, and it keeps wherever it was put from the light as
 * the light walks.
 */
const CAMERA_OFFSET = new Vector3(0, 3.6, 2.8)
const CAMERA_FOV = 42
/**
 * How far behind the light the camera's follow runs, in seconds: it closes
 * most of the gap in this long, so a key pressed or released reaches the
 * camera as a glide rather than a step. Slight, so the light never nears
 * the edge of the view.
 */
const CAMERA_FOLLOW = 0.15
/**
 * How far the sun's shadows reach around the light it follows, in metres:
 * enough to cover the view, so no shadow ends on screen. And how deep they
 * reach: past the ground from the furthest place the panel can put the sun.
 */
const SUN_SHADOW_REACH = 16
const SUN_SHADOW_DEPTH = 80
/** How far past the fog's far edge the swarm may move a rat unseen, m: a rat's length at the panel's usual scale, and a step's run. */
const DARK_MARGIN = 0.5

/**
 * How the scene looks to start; the panel's look folders edit it. Saved from
 * the panel on 2026-10-05, chosen by eye.
 */
const look: Look = {
  // A hot lamp with no falloff whose reach ends well inside the light's hard
  // radius: the holder stands in a pool, and the front presses on from the dark.
  // On trial: the lamp burns in the meat's torch, half a metre up, rather than hanging over it.
  lamp: { color: 0xff8442, intensity: 117, reach: 1.8, falloff: 0, lag: 0.08, inFlame: true },
  // A bright moon straight overhead, its shadows fairly sharp and not quite
  // black, over the ambient occlusion that carries the mass's volume.
  sun: { color: 0xb9c0bd, intensity: 3.2, x: 0, y: 23, z: 0, shadows: true, softness: 1.5, darkness: 0.9 },
  // A green fill, and a green fog to match it: the dark has a colour.
  fill: { sky: 0x268265, ground: 0x324d44, intensity: 0.7 },
  // Round the light, not the camera: the dark closes in on the holder from
  // every side, further out than the lamp reaches.
  fog: { color: 0x141916, near: 1, far: 4.5 },
  // Matt rats in the creature's own colours, with a wide, soft, green-tinted
  // highlight: the mass is one body that glints.
  // Its parts' colours are the model's own, read once it is loaded. Set from
  // the panel on 2026-10-05: a broad soft green highlight, long light strokes,
  // and three steps from a black shade to a dim half-light.
  rats: {
    color: creature.color,
    parts: [],
    // Four kinds of rat, each a tint over the white fur and pale skin: the
    // fur's own near black and a warm dark grey make up most of the swarm,
    // with a few cool dark greys and a rare pale one among them. Set from
    // the panel on 2026-10-07.
    variants: [
      { tint: 0x282426, share: 0.25 },
      { tint: 0x313335, share: 0.05 },
      { tint: 0x3a3135, share: 0.23 },
      { tint: 0x7e7777, share: 0.02 },
    ],
    // The eyes glow twice their colour, points of light in the dark.
    glow: 2,
    sheen: 0,
    specular: 0.27,
    shininess: 30,
    softness: 0.17,
    specularColor: 0x1c401c,
    rim: true,
    // Faint, wide and very soft, pale green: set from the panel on 2026-10-05, it slides over the boil rather than flashing.
    rimStrength: 0.17,
    rimWidth: 0.24,
    rimSoftness: 0.34,
    rimColor: 0xbefecd,
    toon: { steps: 3, three: [0, 0.38, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
    paint: { strength: 1.3, density: 2.5, size: 1.75, rounding: 0 },
  },
  // Set from the panel on 2026-10-05: the floor as painted, a little richer,
  // on small tiles, its normal map as authored; a hard white highlight; wide,
  // deep strokes over the map's relief; three steps from a grey shade.
  floor: {
    lightness: 1,
    saturation: 1.09,
    scale: 1.15,
    relief: 1,
    shell: { sheen: 0, specular: 0.85, shininess: 53, softness: 0, specularColor: 0xffffff, rim: false, rimStrength: 0.25, rimWidth: 0, rimSoftness: 0, rimColor: 0xe7febe },
    paint: { strength: 10, density: 0.5, size: 2, rounding: 0.09 },
    toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
  },
  // Ambient occlusion on, at half resolution, a deep green in the creases, reaching far and falling off hard: set from the panel on 2026-10-05.
  ao: { ...defaultAO(), color: 0x174f3e, radius: 1.73, thickness: 4, distanceExponent: 3.95, distanceFallOff: 2 },
  // Outlines off, set up pale and thin for when they are tried: from the panel on 2026-10-05.
  outline: { enabled: false, color: 0xe5fff4, thickness: 0.5, depth: 0.05, normal: 0.6 },
  // Hatching, faint ink in the deepest shade only, nine pixels apart at the grout's slant, crossed: set from the panel on 2026-10-05.
  hatch: { enabled: true, color: 0x06110c, below: 0.02, cross: true, spacing: 9, angle: 45, width: 0.35, strength: 0.2 },
  // The palette off, at nineteen levels for when it is tried.
  palette: { enabled: false, levels: 19 },
  // Paper in full, fine fibres; a strong grain that holds still: set from the panel on 2026-10-05.
  grain: { grain: true, grainStrength: 0.5, grainSize: 1, grainOnBeat: false, grainSpeed: 0, paper: true, paperStrength: 1, paperScale: 2.5 },
  // A light vignette from near the centre: set from the panel on 2026-10-05.
  vignette: { enabled: true, strength: 0.21, inner: 0.18, outer: 1.16 },
  // Stop motion on twos: the rats step twelve times a second, run and places
  // alike; the camera and the light stay smooth. Between beats, the strokes
  // and the paper move; the rest is off, set as the panel left it on 2026-10-05.
  stopMotion: {
    enabled: true,
    fps: 12,
    run: true,
    swarm: true,
    light: true,
    camera: false,
    shadeWobble: false,
    shadeAmount: 0.2,
    lightFlicker: false,
    lightAmount: 0.04,
    strokeJitter: true,
    strokeAmount: 0.01,
    frameJitter: false,
    frameAmount: 2.4,
    paperOnBeat: true,
    uneven: false,
    unevenShare: 0,
    stagger: false,
    // The boil, half a centimetre over bumps six to the metre; poses blended, not snapped: set from the panel on 2026-10-05.
    boil: true,
    boilAmount: 0.005,
    boilScale: 6,
    snap: false,
  },
  // A tabletop's focus on the light, soft five metres past it: set from the panel on 2026-10-05.
  dof: { enabled: true, onLight: true, focus: 7.8, focal: 5, bokeh: 1.7 },
  // The eyes' trails on, as the panel left them on 2026-10-07: short, a centimetre wide, needle-tapered, swaying hard, in the eyes' own colour.
  // The meat at the light, half a metre high, in its own colours, shaded as the rats start.
  meat: defaultMeat(),
  flame: defaultFlame(),
  trails: { enabled: true, seconds: 0.11, width: 0.01, strength: 4, wave: 2, taper: 1.9, fade: 6, color: 0xffbe0a, eyeColour: true },
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
// The most the pixel ratio is drawn at; the quality's steps take it lower, or `?dpr=N` sets it.
const maxDpr = Number(url.get('dpr')) || Math.min(devicePixelRatio, 2)
renderer.setPixelRatio(maxDpr)
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
await renderer.init()
// The batch, one draw (ADR-0023): three's WebGPU backend draws it rat by rat.
// The WebGL 2 backend has multi-draw, and needs none.
collapseBatchRuns(renderer)
const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2'
// Ready for the sun and the lamp to cast, each while its shadows toggle is on.
// Variance shadow maps, blurred before they are read, so the sun's softness
// smooths the rats' shadows instead of graining them: three's WebGPU build has
// no soft PCF, and its PCF takes five samples. The lamp, a point light, cannot
// use them and keeps three's PCF.
renderer.shadowMap.enabled = true
renderer.shadowMap.type = VSMShadowMap

const scene = new Scene()
scene.background = new Color()
// The fog is a ring round the light: how thick it is at a point is how far
// that point is from the light on the ground, not from the camera. Every
// material reads the one node, so the uniforms move it without a recompile.
const fogColor = uniform(new Color())
const fogNear = uniform(0)
const fogFar = uniform(1)
const fogCentre = uniform(new Vector2())
const fogAmount = smoothstep(fogNear, fogFar, positionWorld.xz.distance(fogCentre))
scene.fogNode = fog(fogColor, fogAmount)

const camera = new PerspectiveCamera(CAMERA_FOV, innerWidth / innerHeight, 0.1, 100)
// The eyes' trails, and the torch's flame and embers, draw on a layer of their own, which the frame's pre-pass leaves out.
camera.layers.enable(TRAIL_LAYER)
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
// The frame renders the scene twice, through two cameras, and three renders a
// shadow once per camera per frame: asked for by hand each frame, it renders once.
sun.shadow.autoUpdate = lamp.shadow.autoUpdate = false
lamp.shadow.camera.near = 0.05
lamp.shadow.camera.far = 30
scene.add(lamp)

const ground = await floor()
const meat = await createMeat()
scene.add(meat.object)
const flame = createFlame()
scene.add(flame.object)
const embers = createEmbers()
scene.add(embers.object)
// The smoke: a trail of the flame's tip, in the world as the embers are.
const smoke = createSmoke()
scene.add(smoke.object)
// None of the torch casts a shadow, and all of it draws on the trails' layer, out of the pre-pass, and unshaded: the flame is light,
// and darkens nothing round it by its occlusion; and the occlusion and the outlines of what stands behind it are not drawn over it.
for (const torch of [flame.object, embers.object, smoke.object]) {
  torch.traverse((o) => {
    o.layers.set(TRAIL_LAYER)
    o.castShadow = false
    if ((o as Mesh).isMesh) leaveUnshaded((o as Mesh).material as NodeMaterial)
  })
}
/** Where the torch's end and its flame's light are, this frame. */
const torchEnd = new Vector3()
const flameAt = new Vector3()
const flameTip = new Vector3()
const flameOffset = new Vector3()
/**
 * The flame's draws, by channel: on the beat, the beat's own, past the
 * channels the look's variations take; smooth, two waves on the clock at a
 * pace of the channel's own, so it wavers rather than jumps.
 */
const FLAME_CHANNELS = 100
const flameDraw = (channel: number) => {
  if (beat >= 0) return beatDraw(beat, FLAME_CHANNELS + channel)
  const rate = 4 + ((channel * 1.37) % 5)
  return Math.sin(clock * rate + channel * 1.7) * 0.6 + Math.sin(clock * rate * 2.3 + channel) * 0.4
}
scene.add(ground.mesh)
// The frame goes through one scene pass and the effects after it: the ambient occlusion under its fog, the outlines, the palette.
const post = createPost(renderer, scene, camera, { color: fogColor, amount: fogAmount }, TRAIL_LAYER)

// ---------------------------------------------------------------- swarm
const tuning = defaultTuning()
/** The collision disc at the usual size: the rat scale and the spacing multiply it. */
const RAT_RADIUS = tuning.ratRadius
const maxTextureSize = getMaxTextureSize(renderer)
/** The count's top: 16,384, or what this device's textures hold. */
const capacity = Math.min(MAX_RATS, maxTextureSize)
/** The count the address asks for, ?rats=N: zero included. */
const askedRats = Math.round(Number(url.get('rats') ?? RATS))
// The start, saved from the panel on 2026-10-05: rats three quarters again
// as big, a dim light that walks as fast as they run, and the run played at
// the rat's own pace, not the scarab's. Since 2026-10-06 they run from 3 to
// 5 m/s, each as big as it is fast.
const settings: Settings = {
  rats: Math.min(Math.max(Number.isNaN(askedRats) ? RATS : askedRats, 0), capacity),
  minSpeed: 3,
  maxSpeed: 5,
  size: 1.75,
  sizeBySpeed: 1.2,
  spacing: 1,
  strength: 0.26,
  on: true,
  shadows: url.has('shadows'),
  runAnimation: 1.7,
  lightSpeed: LIGHT_SPEED,
  paused: false,
  bringRound: true,
}
tuning.minSpeed = settings.minSpeed
tuning.maxSpeed = settings.maxSpeed
tuning.ratRadius = RAT_RADIUS * settings.size * settings.spacing
const swarm = new RemoteSwarm(capacity, SEED, settings.rats)
const light: Light = { x: 0, z: 0, strength: settings.strength, on: settings.on }

const vat = await loadVAT(creature.url)
const time: VATTimeUniform = uniform(0)
const rats = new Rats(vat, creature, capacity, maxTextureSize, time, settings.runAnimation)
rats.setSize(settings.size)
rats.setSizeBySpeed(settings.sizeBySpeed)
scene.add(rats.object)
// The panel starts each part at the colour the model was made in.
look.rats.parts = rats.parts.map((part) => ({ ...part }))

// ---------------------------------------------------------------- panel

/**
 * mulberry32 on the beat and a channel: the same draw for the same beat, so a
 * beat is the same photograph every time it comes round; -1 to 1.
 */
function beatDraw(beat: number, channel: number): number {
  let a = (beat * 1013 + channel * 7919 + 0x9e3779b9) >>> 0
  a = (a + 0x6d2b79f5) >>> 0
  let t = a
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1
}

/** The stop motion's current beat, -1 with it off; when it began; and when the next begins. */
let beat = -1
let beatAt = 0
let nextBeatAt = 0

/** A between-beats variation, by `channel`: this beat's draw, or 0 with the stop motion off. */
const vary = (channel: number) => (beat < 0 ? 0 : beatDraw(beat, channel))

/** Everything the look folders set, with this beat's variation where the stop motion asks for it; the lamp's intensity also follows the light's strength. */
function lookChanged() {
  const stop = look.stopMotion
  const flicker = (channel: number) => (stop.lightFlicker ? 1 + stop.lightAmount * vary(channel) : 1)
  const shade = (channel: number) => (stop.shadeWobble ? stop.shadeAmount * vary(channel) : 0)
  rats.setBoil(stop.enabled && stop.boil ? stop.boilAmount : 0, stop.boilScale, beat)
  const nudge = (channel: number) => (stop.strokeJitter ? stop.strokeAmount * vary(channel) : 0)

  light.strength = settings.strength
  light.on = settings.on
  lamp.color.set(look.lamp.color)
  // The lamp's flicker drifts its hue a little too, warm to cool, as a flame's photographs do.
  if (stop.lightFlicker) lamp.color.offsetHSL(0.02 * stop.lightAmount * vary(4), 0, 0)
  lamp.intensity = (settings.on ? look.lamp.intensity * settings.strength : 0) * flicker(1)
  lamp.distance = look.lamp.reach
  lamp.decay = look.lamp.falloff

  sun.color.set(look.sun.color)
  sun.intensity = look.sun.intensity * flicker(2)
  sun.castShadow = look.sun.shadows
  sun.shadow.radius = look.sun.softness
  // A uniform the shadow reads: the slider recompiles nothing.
  sun.shadow.intensity = look.sun.darkness

  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity * flicker(3)

  fogColor.value.set(look.fog.color)
  ;(scene.background as Color).set(look.fog.color)
  fogNear.value = look.fog.near
  fogFar.value = Math.max(look.fog.far, look.fog.near + 0.5)

  rats.material.color.set(look.rats.color)
  rats.material.set(look.rats)
  rats.material.setToon(look.rats.toon)
  rats.material.setPaint(look.rats.paint)
  rats.material.setBeat(shade(5), nudge(6), nudge(7))
  look.rats.parts.forEach((part, i) => rats.setPartColor(i, part.color))
  rats.setVariants(look.rats.variants)
  rats.setGlow('eyes', look.rats.glow)
  // The trails belong to the stop motion: a held frame's streak. Smooth, there are none.
  rats.setTrails({ ...look.trails, enabled: look.trails.enabled && stop.enabled })
  ground.set(look.floor)
  ground.material.set(look.floor.shell)
  ground.material.setPaint(look.floor.paint)
  ground.material.setToon(look.floor.toon)
  meat.set(look.meat)
  flame.set(look.flame)
  embers.set(look.flame.embers)
  smoke.set(look.flame.smoke)
  // The light put out puts the torch out: its flame, its smoke and its embers go with it.
  flame.object.visible &&= settings.on
  embers.object.visible &&= settings.on
  smoke.object.visible &&= settings.on
  ground.material.setBeat(shade(8), nudge(9), nudge(10))
  // The frame's jitter: the camera nudged a pixel or two, as a camera between photographs.
  if (stop.frameJitter && beat >= 0) {
    camera.setViewOffset(innerWidth, innerHeight, stop.frameAmount * vary(11), stop.frameAmount * vary(12), innerWidth, innerHeight)
  } else if (camera.view !== null) {
    camera.clearViewOffset()
  }
  // The quality's step takes the depth of field and the AO away, never the panel's own settings.
  const ao = { ...look.ao, enabled: look.ao.enabled && quality.step.ao }
  const dof = { ...look.dof, enabled: look.dof.enabled && quality.step.dof }
  post.set({ ao, outline: look.outline, hatch: look.hatch, palette: look.palette, grain: look.grain, vignette: look.vignette, dof })
}

/**
 * The lamp's shadows: a cube of six passes, so a toggle to measure. The rats
 * are culled by `rats.draw` either way, never by three, so every pass draws
 * the same rats (see rats.ts).
 */
function shadowsChanged() {
  lamp.castShadow = settings.shadows
}

// Switches for measuring on a phone, where the panel covers the readouts:
// ?nopanel, ?dpr=1, ?ao=0, ?dof=0, and ?post=0 for every effect after the scene.
const post0 = url.get('post') === '0'
if (post0 || url.get('ao') === '0') look.ao.enabled = false
if (post0 || url.get('dof') === '0') look.dof.enabled = false
if (post0) {
  look.outline.enabled = look.hatch.enabled = look.palette.enabled = look.vignette.enabled = false
  look.grain.grain = look.grain.paper = false
}

// The quality: a phone starts without depth of field or AO, anything else with
// the whole look, and the step moves as the frames come. A measuring switch
// holds it, so what is measured is what was asked for.
const steps = ladder(maxDpr)
const phone = matchMedia('(pointer: coarse)').matches
const askedStep = Number(url.get('step'))
const quality = new Quality(steps, Number.isInteger(askedStep) && url.has('step') ? Math.min(Math.max(askedStep, 0), steps.length - 1) : startingStep(steps, phone))
const adapt = url.get('adapt') !== '0' && !['ao', 'dof', 'dpr', 'post'].some((key) => url.has(key))
/** Draw at the quality's step: its pixel ratio, its look; its share of the rats is read where the count is sent. */
function qualityChanged() {
  if (renderer.getPixelRatio() !== quality.step.dpr) renderer.setPixelRatio(quality.step.dpr)
  lookChanged()
}

// The crowd folder edits the swarm's own tuning: the next step reads it.
if (!url.has('nopanel')) createPanel(settings, tuning, look, capacity, {
  count() {
    // Sent with the next frame's input; the swarm grows at the arena's edge, so the rats on screen stay where they are.
  },
  size() {
    // The rat is drawn at its size, and collides as a disc that size times
    // the spacing: the swarm keeps bigger, or more spaced, rats further apart.
    rats.setSize(settings.size)
    rats.setSizeBySpeed(settings.sizeBySpeed)
    tuning.ratRadius = RAT_RADIUS * settings.size * settings.spacing
  },
  speeds() {
    tuning.minSpeed = settings.minSpeed
    tuning.maxSpeed = settings.maxSpeed
  },
  animation() {
    rats.setSpeed(settings.runAnimation)
  },
  light: lookChanged,
  shadows: shadowsChanged,
  look: lookChanged,
})
qualityChanged()
shadowsChanged()
// After the backend, the step and what it, or the address, turned off: so a phone shows what it draws.
const readouts = createReadouts(() =>
  [
    backend,
    `step ${quality.level}/${steps.length - 1}${adapt ? '' : ' held'}`,
    `dpr ${renderer.getPixelRatio()}`,
    look.ao.enabled && quality.step.ao ? '' : 'no AO',
    look.dof.enabled && quality.step.dof ? '' : 'no DOF',
    post0 ? 'no post' : '',
    quality.step.rats < 1 ? `rats x${quality.step.rats}` : '',
  ]
    .filter(Boolean)
    .join(' · '),
)

// ---------------------------------------------------------------- keys
// WASD or the arrows walk the light, as the camera sees the ground: up the
// screen is -z. The light walks only while a key is held. The space bar hops
// the chicken: juice, which the swarm never sees.
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
    if (event.target instanceof HTMLInputElement) return
    if (event.code === 'Space') {
      // Whatever in the panel was last clicked keeps the focus, and would answer the space too: a toggle would flip.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      event.preventDefault()
      if (!event.repeat) meat.jump()
      return
    }
    if (!(event.code in KEYS)) return
    event.preventDefault()
    held.add(event.code)
  },
  { capture: true },
)
addEventListener('keyup', (event) => held.delete(event.code), { capture: true })
// Keys released while the page had no focus never send their keyup.
addEventListener('blur', () => held.clear())

// The camera: the mouse turns it round the light (left button), slides it
// (right), and brings it in and out (wheel), as far as it likes; only the
// ground stops it.
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2 - 0.05
controls.minDistance = 0.5
controls.maxDistance = 80

/**
 * A point a metre past the light the way the held keys point, as the camera
 * sees the ground wherever it is turned, or null when none do.
 */
function heading(): { x: number; z: number } | null {
  let x = 0
  let z = 0
  for (const code of held) {
    x += KEYS[code][0]
    z += KEYS[code][1]
  }
  // Up the screen is the camera's forward along the ground; right is to its right.
  let fx = controls.target.x - camera.position.x
  let fz = controls.target.z - camera.position.z
  const f = Math.hypot(fx, fz) || 1
  fx /= f
  fz /= f
  const wx = -fz * x - fx * z
  const wz = fx * x - fz * z
  const d = Math.hypot(wx, wz)
  return d === 0 ? null : { x: light.x + wx / d, z: light.z + wz / d }
}

// ---------------------------------------------------------------- loop
const timer = new Timer()
/** Game time, s: what the run plays by, before the stop motion holds it. */
let clock = 0
/** Where the camera's follow of the light has got to: it eases after the light, CAMERA_FOLLOW behind. */
const followed = new Vector3(light.x, 0, light.z)
const moved = new Vector3()

/**
 * Carry the lamp, the fog's centre and the sun's aim to the light, and the
 * camera after it: by a share of how far the light has got ahead of it, so
 * the camera keeps wherever the mouse put it from the light, and glides. An
 * infinite `dt` snaps it there, for the first frame.
 */
/** The light as shown: where the lamp, its pool and the fog ring stand, a beat behind the light when the stop motion holds it. */
const shown = { x: light.x, z: light.z }
/** The camera's follow owed since it last moved, s, while the stop motion holds the camera. */
let owed = 0
/** Where the lamp hangs: easing after the light's shown place by the lamp's lag, the held frames' worth of it on the beat. */
const lampAt = { x: light.x, z: light.z }
let lampOwed = 0
/** The light's own pace, m/s, as of the last frame: the meat runs by it. */
const lightPace = { x: 0, z: 0, wasX: light.x, wasZ: light.z }
function follow(dt: number, newBeat: boolean) {
  const stop = look.stopMotion
  if (!(stop.enabled && stop.light) || newBeat) {
    shown.x = light.x
    shown.z = light.z
  }
  if (dt > 0) {
    lightPace.x = (light.x - lightPace.wasX) / dt
    lightPace.z = (light.z - lightPace.wasZ) / dt
  }
  lightPace.wasX = light.x
  lightPace.wasZ = light.z
  lampOwed += dt
  if (!(stop.enabled && stop.light) || newBeat) {
    const k = look.lamp.lag > 0 && Number.isFinite(lampOwed) ? 1 - Math.exp(-lampOwed / look.lamp.lag) : 1
    lampAt.x += (shown.x - lampAt.x) * k
    lampAt.z += (shown.z - lampAt.z) * k
    lampOwed = 0
  }
  meat.object.position.set(shown.x, 0, shown.z)
  // The flame drawn again on the beat, or every frame smooth, where it wavers on the clock.
  if (!stop.enabled || newBeat) flame.shape(flameDraw, lightPace.x, lightPace.z)
  flame.place(meat.tip(torchEnd, flame.offset(flameOffset)))
  flame.centre(flameAt)
  // In the torch, the lamp burns in the flame, wherever the meat has carried it; else it hangs over the meat, easing after it.
  if (look.lamp.inFlame) lamp.position.copy(flameAt)
  else lamp.position.set(lampAt.x, LIGHT_HEIGHT, lampAt.z)
  fogCentre.value.set(shown.x, shown.z)
  // The sun stays over the light, so its shadows always cover the view.
  sun.target.position.set(shown.x, 0, shown.z)
  sun.position.copy(sun.target.position).add(look.sun)
  // The same share of the gap a second whatever the frame rate; held, the frames' worth of it comes on the beat.
  owed += dt
  if (!(stop.enabled && stop.camera) || newBeat) {
    moved.set(light.x, 0, light.z).sub(followed).multiplyScalar(1 - Math.exp(-owed / CAMERA_FOLLOW))
    followed.add(moved)
    camera.position.add(moved)
    controls.target.add(moved)
    owed = 0
  }
  controls.update()
}
camera.position.set(light.x, 0, light.z).add(CAMERA_OFFSET)
controls.target.set(light.x, 0, light.z - 0.6)
follow(Infinity, true)

renderer.setAnimationLoop(() => {
  const start = performance.now()
  timer.update()
  const frame = timer.getDelta()
  // Paused, no time passes for the run, the light's walk or the camera's follow; the mouse still moves the camera.
  const dt = settings.paused ? 0 : Math.min(frame, 1 / 30)
  clock += dt
  // Stop motion: time posterized to its beats. The run plays the clock as of
  // the last beat, and the rats' places are read only when a beat begins and
  // held until the next; the light, the fog and the camera move every frame.
  // A beat lasts a frame at the rate, or half as long again when uneven; and
  // on each new beat, with any variation asked for, the look is set again
  // with that beat's draw, so each beat is a photograph of its own.
  const stop = look.stopMotion
  let newBeat = false
  if (!stop.enabled) {
    if (beat !== -1) {
      beat = -1
      lookChanged()
    }
    beatAt = nextBeatAt = clock
  } else {
    while (clock >= nextBeatAt) {
      beat++
      beatAt = nextBeatAt
      const longer = stop.uneven && beatDraw(beat, 13) < stop.unevenShare * 2 - 1
      nextBeatAt = beatAt + (longer ? 1.5 : 1) / stop.fps
      newBeat = true
    }
  }
  // The first beat after the stop motion comes on sets the look again too, for what belongs to it.
  if (newBeat && (beat === 0 || stop.shadeWobble || stop.lightFlicker || stop.strokeJitter || stop.frameJitter || stop.boil)) lookChanged()
  // The run's time: held on the beat, and on a baked frame of the clip when snapping, so a held pose is a pose and not a blend.
  let held = stop.enabled && stop.run ? beatAt : clock
  if (stop.enabled && stop.snap) held = Math.floor(held / rats.poseStep) * rats.poseStep
  time.value = held
  meat.pose(held, lightPace.x, lightPace.z)
  post.seed(stop.enabled && look.grain.grainOnBeat ? beat : Math.floor(clock * look.grain.grainSpeed), stop.enabled && stop.paperOnBeat ? beat : 0)

  if (loop) {
    loopTime += dt
    walkLight(swarm.arena, light, loopPoint(swarm.arena, loopTime), dt, settings.lightSpeed)
  } else {
    const to = heading()
    if (to !== null) walkLight(swarm.arena, light, to, dt, settings.lightSpeed)
  }

  // What the fog hides, a rat's length past its far edge: where rats left behind are brought round ahead unseen.
  const dark = settings.bringRound ? { x: fogCentre.value.x, z: fogCentre.value.y, radius: fogFar.value + DARK_MARGIN } : undefined
  swarm.send(Math.round(settings.rats * quality.step.rats), light, tuning, settings.paused, dark)
  // The places: every frame when smooth; on the beat when held; and the first time a state is there, whatever the beat.
  if (!(stop.enabled && stop.swarm) || !swarm.ready) swarm.sample(performance.now())
  else if (stop.stagger) swarm.sampleStaggered(performance.now(), clock, stop.fps)
  else if (newBeat) swarm.sample(performance.now())
  follow(dt, newBeat)
  flame.face(camera)
  // The smoke on the run's held time too, trailing from the flame's tip as the camera now sees it.
  smoke.update(held, flame.tip(flameTip), camera.position)
  // The embers on the run's held time, so they hold on the beat; born where the flame burns.
  embers.update(held, flameAt)
  // The gaits belong to the stop motion: cut on the beat they read as frames; smooth, every rat runs, as before them.
  rats.draw(swarm, camera, stop.enabled)
  if (look.dof.enabled && quality.step.dof && look.dof.onLight) post.focusAt(camera.position.distanceTo(lamp.position))
  sun.shadow.needsUpdate = lamp.shadow.needsUpdate = true
  post.render()
  // The view's vertices: every rat on screen, and the ground. The shadow passes draw the rats again, off screen.
  const vertices = rats.drawn * rats.vertices + ground.mesh.geometry.getAttribute('position').count
  // Every draw of the frame: the view's and the shadow passes'.
  const drawCalls = renderer.info.render.drawCalls
  readouts({ drawn: rats.drawn, count: swarm.count, vertices, drawCalls, steeringMs: swarm.ms, pageMs: performance.now() - start, frameMs: frame * 1000 })
  if (adapt && quality.frame(frame * 1000, start)) qualityChanged()
})
