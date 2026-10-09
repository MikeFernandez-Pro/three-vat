// Last Light: a swarm of rats held off by a light (ADR-0044). The swarm steps
// at a fixed rate, on the GPU on WebGPU and in a worker on WebGL 2 (ADR-0053);
// each frame the crowd stands every rat where the swarm had it a step ago,
// between two steps. The run (run.ts) holds the game's rules: the holder walks
// where the keys send it, its torch burns down, a brazier refuels it, and with
// the torch out the rats catch the player and the run starts again at the last
// checkpoint, the rats placed again. The swarm is handed the torch and the
// level's lights as the run has them, and its walls as they stand whenever a
// gate opens or shuts. Space is the interact key: it picks up a key and works
// a lever. Reaching the exit wins. The debug keys, off to start (`?debug`, or
// the run folder): Q and E turn the torch's reach up and down, F puts it out.
// The camera, which the mouse moves freely, follows the holder; T turns it a
// quarter round. The level (level.ts) is walls, lights, wind zones, gates,
// keys, levers and the exit, drawn as grey boxes; light stops at walls, and
// each light's lit area is worked out on the page for the drawing and the GPU
// step, and in the worker for its own (ADR-0054). The wind burns the torch
// faster and gusts, and a gust or its own trigger puts out a fragile flame, all
// as the level scripts them.
//
// The URL sets the start: `?webgl` draws through WebGPURenderer's WebGL 2
// backend, `?batch` draws the rats as the page-culled batch on WebGPU too, for
// measuring against the GPU's cull, `?cpustep` steps the swarm in the worker
// on WebGPU too, for measuring against the GPU's step, `?timestamps` reads the
// GPU's step time into the readouts, `?rats=8192` starts with that many rats,
// `?shadows` with the lamp's shadows on, and `?loop` has the light walk a
// fixed loop instead of the keys, so two runs can be measured against each other. `?film` is for recording:
// no panel, no readouts, no cursor, the light walking at 2 m/s, and T for the
// camera's turn (film.ts);
// `?stop=0` turns the stop motion off, for a smooth take, and `?nocharacter`
// hides the character with its torch, flame, embers and smoke, as the panel can.
// `?simulation` shows the swarm bare: no character, no torch, no fog, no stop
// motion; a paler, dimmer light alone, walking faster, and every rat left where
// it is: none is brought round ahead unseen. Under either, and `?loop`, the
// torch never burns down and no flame goes out.
//
// The look steps down where a device cannot keep up (quality.ts): `?step=N`
// starts on step N, and `?adapt=0`, or any of the measuring switches
// (`?ao=0`, `?dof=0`, `?dpr=N`, `?post=0`), holds it where it starts.
import {
  Color,
  DirectionalLight,
  HemisphereLight,
  type Mesh,
  type Node,
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
import { fog, int, pointShadow, positionWorld, smoothstep, uniform } from 'three/tsl'
import { loadVAT } from 'three-vat'
import { getMaxTextureSize, type VATTimeUniform } from 'three-vat/tsl'
import { createPost, defaultAO, leaveUnshaded } from './post'
import { collapseBatchRuns } from './collapse'
import { floor } from './ground'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createPanel, createReadouts, lightAndPause, type Look, type Settings } from './panel'
import { Run, defaultRunTuning } from './run'
import { blockout } from './level'
import { createLights, litMask } from './lights'
import { createBlockout } from './blockout'
import { createWind } from './wind'
import { LitAreas } from './litareas'
import { seenTexture } from './seen'
import { Walls } from './walls'
import { createFilm } from './film'
import { RAT, Rats } from './rats'
import { createMeat, defaultMeat } from './meat'
import { createFlame, defaultFlame } from './flame'
import { createEmbers } from './embers'
import { createSmoke } from './smoke'
import { defaultTuning, loopPoint, type Light } from './swarm'
import { RemoteSwarm } from './swarm-remote'
import { GpuSwarm } from './gpuswarm'
import { Quality, ladder, startingStep } from './quality'

const RATS = 2000
/** How far off a rat notices the holder, m: past the fog, so a rat that comes is never seen setting off, and short of the level, so the far rats seethe where they are. */
const NOTICE = 9
// What runs for the light: the rat.
const creature = RAT
/** How fast the light walks to start, m/s: a jog, as fast as under `?film`; set from the panel on 2026-10-08. */
const LIGHT_SPEED = 2
/** How fast the light walks under `?film`, m/s: a take covers more ground in its few seconds. */
const FILM_LIGHT_SPEED = 2
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
/** Where the camera starts from the light when filming, and where it looks, from the light: a take's start, copied from the Film panel, since removed, on 2026-10-08. */
const FILM_CAMERA = new Vector3(-0.07, 1.97, 3.94)
const FILM_TARGET = new Vector3(-0.03, -0.13, -0.54)
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
/**
 * The sun's shadow map, texels a side: three centimetres a texel over its
 * reach. Twice as fine cost up to 0.6 ms of a 4 ms frame at 8,192 rats on an
 * RTX 5080, redrawn every frame. The panel's softness is in texels of the
 * 2,048 the look was set at, so it blurs as far on the ground at any size.
 */
const SUN_SHADOW_SIZE = 1024
const SOFTNESS_TEXELS = 2048
/** The most game time a frame carries, s: a hitch moves the light, the clock and the camera no further than a frame at 30 would. */
const FRAME_CAP = 1 / 30
/** How far past the fog's far edge the swarm may set a rat down, m, before the walk's own margin: a rat's length at the panel's usual scale, and the placing step's run. */
const DARK_MARGIN = 0.5
/** How far past the torch's reach no rat is set down when the run starts again, m: room to breathe before the front comes. */
const RESTART_ROOM = 2

/**
 * How the scene looks to start; the panel's look folders edit it. Saved from
 * the panel on 2026-10-05, chosen by eye; turned to Halloween on 2026-10-08:
 * a purple night round a pumpkin-orange torch, the rats' eyes blood red.
 */
const look: Look = {
  // A hot lamp with no falloff, its intensity whatever the strength, its reach at full strength; at the strength
  // the light starts at it ends well inside the light's hard radius, so the
  // holder stands in a pool, and the front presses on from the dark.
  // On trial: the lamp burns in the meat's torch, half a metre up, rather than hanging over it.
  lamp: { color: 0xff6418, intensity: 15, reach: 6.9, falloff: 0, lag: 0.08, inFlame: true },
  // A bright lavender moon straight overhead, its shadows fairly sharp and not quite
  // black, over the ambient occlusion that carries the mass's volume.
  sun: { color: 0xa99ce8, intensity: 2.8, x: 0, y: 23, z: 0, shadows: true, softness: 1.5, darkness: 0.9 },
  // A violet fill, and a near-black purple fog to match it: the dark has a colour.
  fill: { sky: 0x6a2ca8, ground: 0x2c1640, intensity: 0.8 },
  // Round the light, not the camera: the dark closes in on the holder from
  // every side, further out than the lamp reaches.
  fog: { color: 0x150a1f, near: 1, far: 5.5 },
  // Matt rats in the creature's own colours, with a wide, soft, purple-tinted
  // highlight: the mass is one body that glints.
  // Its parts' colours are the model's own, read once it is loaded. Set from
  // the panel on 2026-10-05: a broad soft highlight, long light strokes,
  // and three steps from a black shade to a dim half-light.
  rats: {
    color: creature.color,
    parts: [],
    // Four kinds of rat, each a tint over the white fur and pale skin: a
    // near black and a dark plum grey make up most of the swarm, with a few
    // cool slate greys and a rare pale mauve one among them. Shares set from
    // the panel on 2026-10-07; the tints leant purple for Halloween.
    variants: [
      { tint: 0x231d29, share: 0.25 },
      { tint: 0x2c2a38, share: 0.05 },
      { tint: 0x352838, share: 0.23 },
      { tint: 0x8a7a8e, share: 0.02 },
    ],
    // The eyes glow twice their colour, points of light in the dark.
    glow: 2,
    sheen: 0,
    specular: 0.27,
    shininess: 30,
    softness: 0.17,
    specularColor: 0x3a1c48,
    rim: true,
    // Faint, wide and very soft, pale lavender: set from the panel on 2026-10-05, it slides over the boil rather than flashing.
    rimStrength: 0.17,
    rimWidth: 0.24,
    rimSoftness: 0.34,
    rimColor: 0xd9b8ff,
    toon: { steps: 3, three: [0, 0.38, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
    paint: { strength: 1.3, density: 2.5, size: 1.75, rounding: 0 },
  },
  // Set from the panel on 2026-10-05: the floor a little richer, on small
  // tiles, its normal map as authored; a hard warm highlight; wide, deep
  // strokes over the map's relief; three steps from a grey shade. Its painted
  // teal turned 110 degrees to purple and darkened a little, for Halloween.
  floor: {
    lightness: 0.85,
    saturation: 1.09,
    hue: 110,
    scale: 1.15,
    relief: 1,
    shell: { sheen: 0, specular: 0.85, shininess: 53, softness: 0, specularColor: 0xffc890, rim: false, rimStrength: 0.25, rimWidth: 0, rimSoftness: 0, rimColor: 0xe7febe },
    paint: { strength: 10, density: 0.5, size: 2, rounding: 0.09 },
    toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
  },
  // Ambient occlusion on, at half resolution, a deep purple in the creases, reaching far and falling off hard: set from the panel on 2026-10-05.
  ao: { ...defaultAO(), color: 0x3a1052, radius: 1.73, thickness: 4, distanceExponent: 3.95, distanceFallOff: 2 },
  // Outlines off, set up pale and thin for when they are tried: from the panel on 2026-10-05.
  outline: { enabled: false, color: 0xe5fff4, thickness: 0.5, depth: 0.05, normal: 0.6 },
  // Hatching, faint ink in the deepest shade only, nine pixels apart at the grout's slant, crossed: set from the panel on 2026-10-05.
  hatch: { enabled: true, color: 0x0e0516, below: 0.02, cross: true, spacing: 9, angle: 45, width: 0.35, strength: 0.2 },
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
  dof: { enabled: true, onLight: true, focus: 7.8, focal: 5, bokeh: 1.7, glow: 0.6 },
  // The eyes' trails on, as the panel left them on 2026-10-08: a quarter second long, a centimetre and a half wide, needle-tapered,
  // swaying hard and fading fast; smooth, wiggling wide and slow at the tail. In the eyes' own colour.
  // The meat at the light, half a metre high, in its own colours, shaded as the rats start.
  meat: defaultMeat(),
  flame: defaultFlame(),
  trails: { enabled: true, seconds: 0.27, width: 0.015, strength: 4, wave: 2, taper: 1.9, fade: 8.4, wiggle: 0.17, wiggleSpeed: 1.6, color: 0xff1a1a, eyeColour: true },
}

// ---------------------------------------------------------------- renderer
// A playback row a rat, and WebGPU's default limit is 8,192 rows: ask for what
// the adapter can give, so the count reaches its top.
const forceWebGL = url.has('webgl')
type Adapter = { limits: { maxTextureDimension2D: number } }
const gpu = (navigator as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu
const adapter = forceWebGL ? null : await gpu?.requestAdapter()
const requiredLimits = adapter ? { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } : undefined
const timestamps = url.has('timestamps')
const renderer = new WebGPURenderer({ antialias: true, forceWebGL, requiredLimits, trackTimestamp: timestamps })
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
// The simulation shows the swarm bare: the fog ring is pushed out of reach, and nothing is hidden.
const simulation = url.has('simulation')
if (simulation) {
  // The bare swarm is lit to be read, not to glow: a paler, far dimmer lamp (set from the panel
  // on 2026-10-07), and no stop motion, so the rats move as the step moves them. The lamp hangs
  // straight over the light, with no lag and out of the hidden torch, whose hand eases after the walk.
  // The rats and the floor shade plainly: no painted normals, no toon steps, no highlight, no rim.
  look.lamp.color = 0xfdc1a0
  look.lamp.intensity = 24
  look.lamp.lag = 0
  look.lamp.inFlame = false
  look.stopMotion.enabled = false
  look.dof.enabled = false
  look.rats.paint.strength = 0
  look.rats.toon.steps = 0
  look.rats.specular = 0
  look.rats.rim = false
  look.floor.paint.strength = 0
  look.floor.toon.steps = 0
  look.floor.shell.specular = 0
  look.floor.shell.rim = false
}
/** Where the fog goes solid, m from the light, as the panel has it: the ring the swarm brings rats round past, fog or no fog. */
let fogEdge = 1

const camera = new PerspectiveCamera(CAMERA_FOV, innerWidth / innerHeight, 0.1, 100)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// A dim violet fill, a far lavender moon, and the one warm light.
const fill = new HemisphereLight()
scene.add(fill)

const sun = new DirectionalLight()
sun.shadow.mapSize.set(SUN_SHADOW_SIZE, SUN_SHADOW_SIZE)
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
// shadow once per camera per frame: asked for by hand, it renders once, and
// only on the frames the loop asks (see `shadowed`). A frame not asked keeps
// the last map and the matrix it was drawn with, so the shadows hold still.
sun.shadow.autoUpdate = lamp.shadow.autoUpdate = false
lamp.shadow.camera.near = 0.05
lamp.shadow.camera.far = 30
scene.add(lamp)

const ground = await floor()
const meat = await createMeat()
scene.add(meat.object)
// The panel starts the meat's parts at the colours its character or its file has.
look.meat.parts = meat.parts.map((part) => ({ ...part }))
const flame = createFlame()
scene.add(flame.object)
const embers = createEmbers()
scene.add(embers.object)
// The smoke: a trail of the flame's tip, in the world as the embers are.
const smoke = createSmoke()
scene.add(smoke.object)
// None of the torch casts a shadow, and all of it is unshaded: the flame is light,
// and darkens nothing round it by its occlusion; and the occlusion and the outlines of what stands behind it are not drawn over it.
for (const torch of [flame.object, embers.object, smoke.object]) {
  torch.traverse((o) => {
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
const post = createPost(renderer, scene, camera, { color: fogColor, amount: fogAmount })

// ---------------------------------------------------------------- swarm
const tuning = defaultTuning()
// The crowd as the panel left it on 2026-10-08: the rats keep off the light by
// a fifth of a metre, writhe at a metre a second, and pile up high (2)
// over the mass behind the front, over five and a half gaps. The swarm's own defaults stay the ones its
// tests pin, where a writhe this hard leaves a few rats inside the light.
Object.assign(tuning, { gap: 0.2, agitation: 1, pile: 2, pileRamp: 5.5, notice: NOTICE })
// The bare simulation's crowd, set from the panel on 2026-10-07: calmer, pressed right up to the light, piled high on a long slope.
if (simulation) Object.assign(tuning, { agitation: 0.5, lookAhead: 0, gap: 0.1, pile: 2, pileRamp: 8 })
/** The collision disc at the usual size: the rat scale and the spacing multiply it. */
const RAT_RADIUS = tuning.ratRadius
const maxTextureSize = getMaxTextureSize(renderer)
/** The count's top: 16,384, or what this device's textures hold. */
const capacity = Math.min(MAX_RATS, maxTextureSize)
/** The count the address asks for, ?rats=N: zero included. */
const askedRats = Math.round(Number(url.get('rats') ?? RATS))
// The start, saved from the panel on 2026-10-05: rats three quarters again
// as big, a dim light that walks as fast as they run, and the run played at
// the rat's own pace. Since 2026-10-06 they run from 3 to
// 5 m/s, each as big as it is fast.
const settings: Settings = {
  rats: Math.min(Math.max(Number.isNaN(askedRats) ? RATS : askedRats, 0), capacity),
  minSpeed: 3,
  maxSpeed: 5,
  size: 1.75,
  sizeBySpeed: 1.2,
  spacing: 1,
  on: true,
  debug: url.has('debug'),
  shadows: url.has('shadows'),
  runAnimation: 1.7,
  // The bare swarm walks the light faster, and keeps every rat where it is: none is brought round ahead.
  lightSpeed: simulation ? 2.5 : url.has('film') ? FILM_LIGHT_SPEED : LIGHT_SPEED,
  paused: false,
  bringRound: !simulation,
  // ?nocharacter starts with the character hidden, its torch, flame, embers and smoke with it, as the panel's toggle does.
  character: !simulation && !url.has('nocharacter'),
}
tuning.minSpeed = settings.minSpeed
tuning.maxSpeed = settings.maxSpeed
tuning.ratRadius = RAT_RADIUS * settings.size * settings.spacing

// ---------------------------------------------------------------- run
// The level and its rules. The benchmark's loop and the bare swarm keep a torch that never burns down, and every flame lit.
const level = blockout()
const runTuning = defaultRunTuning()
if (simulation || url.has('loop')) {
  Object.assign(runTuning, { burnRate: 0, windDrain: 0, gustDrain: 0 })
  for (const zone of level.wind) zone.gusts = []
  for (const light of level.lights) if (light.fragile !== undefined) light.fragile = {}
}
const run = new Run(level, runTuning)
/** The torch as the swarm reads it: where the holder is, its reach as a share of the swarm's full light, and lit. */
const light: Light = { x: run.holder.x, z: run.holder.z, strength: 0, on: false }
/** Hand the swarm the torch as the run has it, and the debug switch: true if it went out or was relit. */
function torchChanged(): boolean {
  const torch = run.torch
  light.x = torch.x
  light.z = torch.z
  light.strength = torch.reach / tuning.ringMax
  const on = torch.lit && settings.on
  if (on === light.on) return false
  light.on = on
  return true
}
torchChanged()
// The ground each light sees against the walls: worked out here for the drawing, and on WebGPU read by the
// swarm's step from the same texture. The worker works out its own the same way.
const areas = new LitAreas(new Walls(run.walls()))
const seen = seenTexture(areas)
/** The swarm's time, which the lights' flames lean at, in the drawing as in the step. */
const swarmTime = uniform(0)
const lights = createLights(level.lights, seen.texture, swarmTime, level.start)
scene.add(lights.object)
const walls = createBlockout(level)
scene.add(walls.object)
const wind = createWind(level.wind)
scene.add(wind.object)
/** The run's walls and its starts as the swarm and the lit areas last had them: a gate opened or shut, or the run started again, since. */
let wallsSeen = run.wallsVersion
let startsSeen = run.starts
/** Where the see-through's hole is cut round: the holder, at its chest. */
const seeThroughAt = new Vector3()
// The torch's lamp lights only what the torch sees: its lamp's shadow is its lit area, the walls alone cutting it,
// its own falloff ending it. Under `?shadows`, the lamp's own cube of shadows as well.
const torchCentre = uniform(new Vector2(light.x, light.z))
const torchSees = litMask(seen.texture, int(0), torchCentre, uniform(0), swarmTime)
lamp.castShadow = true
lamp.shadow.shadowNode = settings.shadows ? torchSees.mul(pointShadow(lamp) as unknown as Node<'float'>) : torchSees

const vat = await loadVAT(creature.url)
const time: VATTimeUniform = uniform(0)
// On WebGPU the rats are culled and drawn on the GPU (ADR-0052); WebGL 2, or `?batch`, draws them as the batch.
const rats = new Rats(vat, creature, capacity, maxTextureSize, time, settings.runAnimation, backend === 'WebGPU' && !url.has('batch') ? renderer : undefined)
// The swarm steps on the GPU where the GPU culls the rats (ADR-0053); in the worker on WebGL 2, under `?batch` or `?cpustep`.
// The bare simulation runs on an arena twice as wide as the count asks, so the light has room to walk.
const arenaScale = simulation ? 2 : 1
const gpuCull = url.has('cpustep') ? undefined : rats.gpuCull
/** The level's ground, as the swarm reads it: its walls, its box the rats start in, and the lights they start out of. */
const onGround = { walls: run.walls(), bounds: level.bounds, lights: run.lights() }
const swarm = gpuCull
  ? new GpuSwarm(gpuCull, renderer, capacity, SEED, settings.rats, arenaScale, undefined, onGround, seen.texture)
  : new RemoteSwarm(capacity, SEED, settings.rats, arenaScale, onGround)
// Their buffers freed when the page leaves for good, the step's with them; one kept for going back to holds them.
addEventListener('pagehide', (event) => {
  if (event.persisted) return
  rats.dispose()
  if (swarm instanceof GpuSwarm) swarm.dispose(renderer)
})
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
/** How long a beat lasts, s: a frame at the rate, or half as long again for a `longer` one when the beats are uneven. */
const beatLength = (longer: boolean) => (longer ? 1.5 : 1) / look.stopMotion.fps

/**
 * What the shadows were last drawn from: the swarm's places and its state,
 * the run's time, where the sun and the lamp stood; and whether the look
 * changed since. They are drawn again only when one of those moved, and only
 * on a frame a new state of the swarm came in: held, on the beat; smooth, at
 * the swarm's own rate whatever the screen's, a step at most behind their rats.
 */
const shadowed = { version: -1, steps: -1, held: Number.NaN, sun: new Vector3(Number.NaN), lamp: new Vector3(Number.NaN), dirty: true }

/** A between-beats variation, by `channel`: this beat's draw, or 0 with the stop motion off. */
const vary = (channel: number) => (beat < 0 ? 0 : beatDraw(beat, channel))

/** Everything the look folders set, with this beat's variation where the stop motion asks for it; the lamp's reach also follows the light's strength. */
function lookChanged() {
  shadowed.dirty = true
  const stop = look.stopMotion
  const flicker = (channel: number) => (stop.lightFlicker ? 1 + stop.lightAmount * vary(channel) : 1)
  const shade = (channel: number) => (stop.shadeWobble ? stop.shadeAmount * vary(channel) : 0)
  rats.setBoil(stop.enabled && stop.boil ? stop.boilAmount : 0, stop.boilScale, beat)
  const nudge = (channel: number) => (stop.strokeJitter ? stop.strokeAmount * vary(channel) : 0)

  lamp.color.set(look.lamp.color)
  // The lamp's flicker drifts its hue a little too, warm to cool, as a flame's photographs do.
  if (stop.lightFlicker) lamp.color.offsetHSL(0.02 * stop.lightAmount * vary(4), 0, 0)
  // The intensity holds whatever the strength: the torch burning down pulls its reach in, not its glow.
  lamp.intensity = (light.on ? look.lamp.intensity : 0) * flicker(1)
  lamp.decay = look.lamp.falloff

  sun.color.set(look.sun.color)
  sun.intensity = look.sun.intensity * flicker(2)
  sun.castShadow = look.sun.shadows
  sun.shadow.radius = (look.sun.softness * SUN_SHADOW_SIZE) / SOFTNESS_TEXELS
  // A uniform the shadow reads: the slider recompiles nothing.
  sun.shadow.intensity = look.sun.darkness

  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity * flicker(3)

  fogColor.value.set(look.fog.color)
  ;(scene.background as Color).set(look.fog.color)
  fogEdge = Math.max(look.fog.far, look.fog.near + 0.5)
  fogNear.value = simulation ? 1e6 : look.fog.near
  fogFar.value = simulation ? 1e6 + 1 : fogEdge

  rats.material.color.set(look.rats.color)
  rats.material.set(look.rats)
  rats.material.setToon(look.rats.toon)
  rats.material.setPaint(look.rats.paint)
  rats.material.setBeat(shade(5), nudge(6), nudge(7))
  look.rats.parts.forEach((part, i) => rats.setPartColor(i, part.color))
  rats.setVariants(look.rats.variants)
  rats.setGlow('eyes', look.rats.glow)
  // The trails: on the beat a held frame's streak; smooth, a streak laid again every frame, and wiggling.
  rats.setTrails({ ...look.trails, wiggle: stop.enabled ? 0 : look.trails.wiggle })
  ground.set(look.floor)
  ground.material.set(look.floor.shell)
  ground.material.setPaint(look.floor.paint)
  ground.material.setToon(look.floor.toon)
  meat.set(look.meat)
  flame.set(look.flame)
  embers.set(look.flame.embers)
  smoke.set(look.flame.smoke)
  // The torch out, burnt down or put out: its flame, its smoke and its embers go with it.
  flame.object.visible &&= light.on
  embers.object.visible &&= light.on
  smoke.object.visible &&= light.on
  // The character hidden takes its torch with it: the lamp alone stays, burning where the flame would.
  meat.object.visible &&= settings.character
  flame.object.visible &&= settings.character
  embers.object.visible &&= settings.character
  smoke.object.visible &&= settings.character
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
 * The lamp's shadows: a cube of six passes, so a switch to measure, `?shadows`,
 * read at the start: the lamp's shadow is the torch's lit area either way. The
 * rats are culled by `rats.draw` either way, never by three, so every pass
 * draws the same rats (see rats.ts).
 */
function shadowsChanged() {
  shadowed.dirty = true
}

// For filming, ?stop=0 plays the full look smooth: no stop motion, and nothing else changed.
if (url.get('stop') === '0') look.stopMotion.enabled = false

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

// Filming: a take shows the scene alone. No panel, no readouts, and no cursor
// anywhere on the page, since the keys do everything a take needs.
const filming = url.has('film')
// The page's stylesheet hides the cursor everywhere under this class, over anything the orbit controls set on the canvas.
if (filming) document.documentElement.classList.add('film')

// The crowd folder edits the swarm's own tuning: the next step reads it.
const panel = url.has('nopanel') || filming ? undefined : createPanel(settings, tuning, look, capacity, {
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
  light() {
    if (torchChanged()) lookChanged()
  },
  shadows: shadowsChanged,
  look: lookChanged,
}, { tuning: runTuning, level, startAt: (checkpoint) => run.startAt(checkpoint) })
// Without the panel, P still pauses, and F, a debug key, still puts the torch out.
if (!panel) lightAndPause(settings, () => torchChanged() && lookChanged())
qualityChanged()
shadowsChanged()
// After the backend, the step and what it, or the address, turned off: so a phone shows what it draws.
const readouts = filming ? () => {} : createReadouts(() =>
  [
    backend,
    `step ${quality.level}/${steps.length - 1}${adapt ? '' : ' held'}`,
    `dpr ${renderer.getPixelRatio()}`,
    look.ao.enabled && quality.step.ao ? '' : 'no AO',
    look.dof.enabled && quality.step.dof ? '' : 'no DOF',
    post0 ? 'no post' : '',
    quality.step.rats < 1 ? `rats x${quality.step.rats}` : '',
    `torch ${Math.round(run.fuel * 100)}%`,
    run.inWind < 0 ? '' : run.gusting(run.inWind) ? 'gust' : 'wind',
    run.caught > 0 ? `caught ${run.caught}` : '',
    run.carrying.some(Boolean) ? `keys ${run.carrying.filter(Boolean).length}` : '',
    run.checkpoint >= 0 ? `checkpoint ${run.checkpoint + 1}` : '',
    run.won ? 'out: the run is won' : '',
  ]
    .filter(Boolean)
    .join(' · '),
)

// ---------------------------------------------------------------- keys
// WASD or the arrows walk the holder, as the camera sees the ground: up the
// screen is -z. The holder walks only while a key is held. Space is the
// interact key. Q and E, debug keys, turn the torch's reach up and down while
// held, as its slider does.
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
const pressed = new Set<string>()
/** The debug keys that turn the torch's reach up and down, and how many metres a second of one adds or takes. */
const DIAL: Record<string, number> = { KeyQ: 1, KeyE: -1 }
const DIAL_RATE = 1.2
/** The reach as dialled, before the slider's step rounds it. */
let dialled = runTuning.torchReach
/** The interact key. */
const INTERACT = 'Space'
// Captured on the way down: lil-gui stops keys from bubbling out of the panel.
addEventListener(
  'keydown',
  (event) => {
    if (event.target instanceof HTMLInputElement) return
    if (!(event.code in KEYS) && !(event.code in DIAL) && event.code !== INTERACT) return
    // A panel button last clicked keeps the focus, and Space would press it.
    if (event.code === INTERACT && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    event.preventDefault()
    pressed.add(event.code)
  },
  { capture: true },
)
addEventListener('keyup', (event) => pressed.delete(event.code), { capture: true })
// Keys released while the page had no focus never send their keyup.
addEventListener('blur', () => pressed.clear())

// The camera: the mouse turns it round the light (left button), slides it
// (right), and brings it in and out (wheel), as far as it likes; only the
// ground stops it.
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2 - 0.05
controls.minDistance = 0.5
controls.maxDistance = 80
// T turns the camera a quarter round the light.
const film = createFilm(camera, controls)

/**
 * A point a metre past the light the way the held keys point, as the camera
 * sees the ground wherever it is turned, or null when none do.
 */
function heading(): { x: number; z: number } | null {
  let x = 0
  let z = 0
  for (const code of pressed) {
    if (!(code in KEYS)) continue
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
  return d === 0 ? null : { x: run.holder.x + wx / d, z: run.holder.z + wz / d }
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
function follow(dt: number, newBeat: boolean, frame: number) {
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
  // The quarter turn, when T set one going: by the frame, so a paused scene still turns.
  film.update(frame)
  controls.update(frame)
}
camera.position.set(light.x, 0, light.z).add(filming ? FILM_CAMERA : CAMERA_OFFSET)
if (filming) controls.target.set(light.x, 0, light.z).add(FILM_TARGET)
else controls.target.set(light.x, 0, light.z - 0.6)
follow(Infinity, true, 0)

/**
 * How far past the fog's far edge, as drawn this frame, a rat brought round
 * is set down, m, so that it is first drawn past it: the fog's centre walks
 * on while the rat goes unseen, and the rat runs in meanwhile. The dark sent
 * this frame is read by the worker's next step, up to a step away, and that
 * step's state comes in a step after it: a step as the worker paces them,
 * longer than STEP when its steps overrun. The page places a moved rat at
 * that state on its next frame, and the light walks at most FRAME_CAP of its
 * speed in a frame. The stop motion adds a beat for each of its holds, at the
 * beat's longest: holding the light, the fog's centre at the send is up to a
 * beat behind the light; holding the swarm, the rat's state waits up to a
 * beat to be placed. At worst the light walks at its top speed all that
 * while, toward where the rat was set down. And while the swarm is held, the
 * rat runs in for the light at its own speed, the fastest rat's at worst, for
 * the beat it waits and the frame that then stands it at the latest state.
 */
function darkMargin(): number {
  const stop = look.stopMotion
  const lightHeld = stop.enabled && stop.light ? beatLength(stop.uneven) : 0
  const swarmHeld = stop.enabled && stop.swarm ? beatLength(stop.uneven) : 0
  const unseen = 2 * swarm.pace + FRAME_CAP + lightHeld + swarmHeld
  const running = swarmHeld > 0 ? swarmHeld + FRAME_CAP : 0
  return DARK_MARGIN + settings.lightSpeed * unseen + tuning.maxSpeed * running
}

renderer.setAnimationLoop(() => {
  const start = performance.now()
  timer.update()
  const frame = timer.getDelta()
  // Paused, no time passes for the run, the light's walk or the camera's follow; the mouse still moves the camera.
  const dt = settings.paused ? 0 : Math.min(frame, FRAME_CAP)
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
      nextBeatAt = beatAt + beatLength(longer)
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

  // Q and E, the debug keys, turn the torch's reach up and down: it moves at the dial's rate while one is held, and the panel shows it.
  let dial = 0
  if (settings.debug) for (const code of pressed) dial += DIAL[code] ?? 0
  if (dial !== 0 && dt > 0) {
    // Dialled smoothly, shown at the slider's own step; a slider moved by hand is picked up from where it was left.
    if (Math.abs(dialled - runTuning.torchReach) >= 0.01) dialled = runTuning.torchReach
    dialled = Math.min(tuning.ringMax, Math.max(0, dialled + dial * DIAL_RATE * dt))
    runTuning.torchReach = Math.round(dialled * 100) / 100
    panel?.showReach()
  }

  // The run, a frame of it: the holder walks where the keys or the loop send it, the torch burns, a flame refuels it,
  // and the rats the swarm last found at the holder catch the player once the torch is out. Paused, it holds.
  if (!settings.paused) {
    if (loop) loopTime += dt
    const toward = loop ? loopPoint(swarm.arena, loopTime) : heading()
    run.step({ dt, toward, speed: settings.lightSpeed, arena: swarm.arena, interact: pressed.has(INTERACT), reached: swarm.reached })
  }
  if (torchChanged()) lookChanged()
  wind.update(settings.paused ? 0 : dt, (zone) => run.gusting(zone))
  // The lamp's pool follows the torch's reach as it burns down, as the light's hard radius does.
  lamp.distance = look.lamp.reach * light.strength
  const placed = run.lights()
  // A gate opened or shut: the walls as they now stand, for the swarm and every light's lit area.
  if (run.wallsVersion !== wallsSeen) {
    wallsSeen = run.wallsVersion
    const standing = run.walls()
    areas.setWalls(new Walls(standing))
    swarm.setWalls(standing)
  }
  // Caught, or set down at a checkpoint: the rats placed again, out of the lights and the torch's room round the holder.
  if (run.starts !== startsSeen) {
    startsSeen = run.starts
    swarm.restart([...placed, { x: light.x, z: light.z, reach: tuning.ringMax * light.strength + RESTART_ROOM, on: true }])
  }
  walls.update(run, clock)
  // The ground each light sees: the torch's where it now is, the others' where they stand; the swarm reads the same, and the drawing at the swarm's time.
  areas.update(light, placed)
  seen.update()
  torchCentre.value.set(light.x, light.z)
  swarmTime.value = swarm.time
  lights.update(placed)
  // The lamp, the fog, the sun and the camera after the light, before the swarm is told what the fog hides: this frame's fog, not the last one's.
  follow(dt, newBeat, frame)
  walls.seeThroughTo(seeThroughAt.set(shown.x, 0.8, shown.z))

  // What the fog hides, past the far edge it is drawn at this frame by the walk's margin: where rats left behind are brought round ahead unseen.
  const dark = settings.bringRound ? { x: shown.x, z: shown.z, radius: fogEdge + darkMargin() } : undefined
  swarm.send(Math.round(settings.rats * quality.step.rats), light, tuning, settings.paused, dark, placed)
  // The places: every frame when smooth; on the beat when held; and the first time a state is there, whatever the beat.
  if (!(stop.enabled && stop.swarm) || !swarm.ready) swarm.sample(performance.now())
  else if (stop.stagger) swarm.sampleStaggered(performance.now(), clock, stop.fps)
  else if (newBeat) swarm.hold(performance.now())
  flame.face(camera)
  // The smoke on the run's held time too, trailing from the flame's tip as the camera now sees it.
  smoke.update(held, flame.tip(flameTip), camera.position)
  // The embers on the run's held time, so they hold on the beat; born where the flame burns.
  embers.update(held, flameAt)
  // The gaits belong to the stop motion: cut on the beat they read as frames; smooth, every rat runs, as before them.
  rats.draw(swarm, camera, stop.enabled)
  if (look.dof.enabled && quality.step.dof && look.dof.onLight) post.focusAt(camera.position.distanceTo(lamp.position))
  // The shadows again only if what casts them moved, on a new state of the swarm; a changed look at once.
  const casting =
    swarm.version !== shadowed.version ||
    held !== shadowed.held ||
    (sun.castShadow && !sun.position.equals(shadowed.sun)) ||
    (settings.shadows && !lamp.position.equals(shadowed.lamp))
  if (shadowed.dirty || (casting && swarm.steps !== shadowed.steps)) {
    sun.shadow.needsUpdate = lamp.shadow.needsUpdate = true
    shadowed.version = swarm.version
    shadowed.steps = swarm.steps
    shadowed.held = held
    shadowed.sun.copy(sun.position)
    shadowed.lamp.copy(lamp.position)
    shadowed.dirty = false
  }
  post.render()
  // The view's vertices: every rat on screen, and the ground. The shadow passes draw the rats again, off screen.
  const vertices = rats.drawn * rats.vertices + ground.mesh.geometry.getAttribute('position').count
  // Every draw of the frame: the view's and the shadow passes'.
  const drawCalls = renderer.info.render.drawCalls
  // The GPU's step time, from the timestamps once resolved; the render's resolved too, so its queries never pile up.
  if (timestamps && swarm instanceof GpuSwarm) {
    void renderer.resolveTimestampsAsync('compute').then(() => swarm.timeSteps(renderer))
    void renderer.resolveTimestampsAsync('render')
  }
  const steeringMs = swarm instanceof GpuSwarm ? swarm.gpuMs : swarm.ms
  readouts({ drawn: rats.drawn, count: swarm.count, vertices, drawCalls, steeringMs, states: swarm.steps, pageMs: performance.now() - start, frameMs: frame * 1000 })
  if (adapt && quality.frame(frame * 1000, start)) qualityChanged()
})
