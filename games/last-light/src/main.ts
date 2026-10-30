// Last Light: a swarm of rats held off by a light (ADR-0044), and the goose game, the one page it keeps since
// 2026-10-30 (the woods, the sewers, the hall, the levels of detail's page and the bare arena are at the tag
// last-light-before-goose-only). The goose, the torch in her beak, crosses the night plain one way on the route
// laid on its 2D page (plain.ts, goose2d.html), from brazier to brazier to the pond, played by the goose play
// (gooseplay.ts), which the page feeds the keys and draws: her goslings waiting at the braziers and in her circle,
// as the goose in miniature (goslings.ts), and the pond, a hollow in the floor inside a noisy shore (pond.ts).
// The swarm steps at a fixed rate, on the GPU on WebGPU and in a worker on WebGL 2 (ADR-0053); each frame the
// crowd stands every rat where the swarm had it a step ago, between two steps. The run (run.ts), the play's own,
// holds the torch: it burns down and a fire refills it. The swarm is handed the torch and the lights as the run
// has them. Each light's lit area is worked out on the page for the drawing and the GPU step, and in the worker
// for its own (ADR-0054).
//
// The URL sets the start: `?webgl` draws through WebGPURenderer's WebGL 2
// backend, `?batch` draws the rats as the page-culled batch on WebGPU too, for
// measuring against the GPU's cull, `?cpustep` steps the swarm in the worker
// on WebGPU too, for measuring against the GPU's step, `?timestamps` reads the
// GPU's step time into the readouts, `?rats=8192` starts with that many rats,
// `?shadows` with the lamp's shadows on. `?film` is for recording:
// no panel, no readouts, no cursor (film.ts).
// The fog round the light is on again since 2026-10-11; `?fog=0` takes it away.
//
// The look steps down where a device cannot keep up (quality.ts): `?step=N`
// starts on step N, and `?adapt=0`, or any of the measuring switches
// (`?ao=0`, `?dof=0`, `?dpr=N`, `?post=0`), holds it where it starts.
import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Frustum,
  Sphere,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  type Node,
  type NodeMaterial,
  type Object3D,
  VSMShadowMap,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  RingGeometry,
  Scene,
  Spherical,
  Timer,
  Vector2,
  SRGBColorSpace,
  Vector3,
  Vector4,
  WebGPURenderer,
} from 'three/webgpu'
import { Fn, Loop, cameraPosition, float, fog, getViewPosition, int, mix, mx_noise_float, normalWorldGeometry, pointShadow, positionWorld, renderGroup, screenUV, shadow, smoothstep, uniform, uniformArray, vec3, vec4 } from 'three/tsl'
import { loadVAT } from 'three-vat'
import { getMaxTextureSize, type VATTimeUniform } from 'three-vat/tsl'
import { createPost, defaultAO, defaultDark, leaveUnshaded } from './post'
import { defaultBedLook, defaultRoadLook, defaultWellGroundLook, floor, type FloorName } from './ground'
import { defaultRoadShape, leadIn, roadField, roadLine } from './road'
import { archesOf, archStones, createArches, defaultArchLook, defaultArchWet, type ArchShell, type ArchStone } from './arches'
import { createDeadTrees, deadTrees, defaultBarkLook, defaultGrassLook, offWay, defaultDeadTreeShape, defaultLeafLook, treeVariantOf, trunkRadius, type DeadTree, type DeadTreeShape } from './deadtrees'
import { bushes, createBushes, defaultBushLeafLook, defaultBushShape } from './bushes'
import { createRoadWalls, defaultRoadWallLook, ROAD_WALL_STYLES, roadWallLines, roadWallsOf, roadWallStones, type RoadWallLook, type StoneBlock } from './roadwalls'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createPanel, createReadouts, lightAndPause, type Look, type Settings, type ShineLook } from './panel'
import type { PlaySwarm } from './play'
import { PipelineSlices } from './pipelineslices'
import { GoosePlay, eased, inZone, type FireScene, type SceneState, type Zone } from './gooseplay'
import { createGoslingBadge, mountBadgeControls } from './goslingbadge.prototype'
import { createGoslings, defaultGoslingSpeeds, GOSLING_HEIGHT } from './goslings'
import { BURNING_LIGHT, BURNING_MODEL, CAGE_FIRE_LIGHT, PIT_BOWL, PIT_LIGHT, RIGHT_WING, spawnTree, TREE_FIRE_BOWL, TREE_FIRE_LIGHT, TREE_LIGHT, WELL_LIGHT, createGooseScenes, type EditPiece, type SceneFireLook } from './goosescenes'
import { createEditMode, layPieces } from './gooseedit'
import { createHoldHint } from './holdhint'
import { createGooseSounds, type Loop as SoundLoop } from './goosesounds'
import { mountSoundPanel, mountTakesPanel } from './soundpanel'
import { createGooseMusic } from './goosemusic'
import { callAt, createCallHint, createPeepWords } from './callhint'
import { FURTHEST, createPond, defaultPondLook, groundOf, islandMiddle, islandShoreAt, shoreAt, standingIn, swimmingIn, widestShore, type PondLook } from './pond'
import { createNest, defaultNeedleLook, defaultNestLeafLook, defaultNestLook } from './nest'
import { createTent } from './tent'
import { createIslandGeese, type IslandCue } from './islandgeese'
import { DRAIN, OUTRO, aimOf, dawnOf, fadeOf, ganderAt, goslingOf, layOutro, motherAt, outroDue, peepsOf, planAt, pullOf, titleOf, type Island, type Stage } from './gooseoutro'
import { ROUTE, WADE, keptShown, laid, shownOf, toSave, type Plain, type Point, type Route } from './plain'
import { defaultRollingLook, rollAgain, rollingGround } from './rolling'
import { createWater, defaultWaterLook, WATER_LOOKS } from './water'
import { defaultTreeWindLook } from './treesway'
import { createLights, litMask } from './lights'
import { createBlockout, defaultNoiseSeeThrough, noiseSeeThrough, seeThroughZone } from './blockout'
import { createWind } from './wind'
import { LitAreas } from './litareas'
import { seenTexture } from './seen'
import { Walls, nearestWalls, type Wall } from './walls'
import { createFilm } from './film'
import { LEVELS, RAT, Rats } from './rats'
import { createMeat, defaultMeat, goose } from './meat'
import { createFlame, createFlames, defaultFlame, type Flame } from './flame'
import { createEmbers } from './embers'
import { createSmoke } from './smoke'
import { defaultTuning, shoreLight, sightEdge, type Dark, type FixedLight, type Ground, type Light, type ViewPlane } from './swarm'
import { createTiltShift } from './tiltshift'
import { createFallingLeaves, defaultFallLook, mountFallControls } from './fallingleaves.prototype'
import { FakeLamp, createFakeLamps, shown as drawnInScene } from './fakelamps'
import { createFireShadow, defaultFireShadowLook } from './fireshadow'
import { createGhosts, mountGhostControls } from './ghosts.prototype'
import { defaultGraveLook, ghostAt, inGraveyard, layGraveyard } from './graveyard.prototype'
import { createGraves, mountGraveControls, scatterGravePumpkins, type GraveGround } from './graves.prototype'
import { gooseThemeOf, layInto } from './goosethemes'
import { RemoteSwarm } from './swarm-remote'
import { GpuSwarm } from './gpuswarm'
import { Quality, ladder, maxPixelRatio, startingStep } from './quality'
import { CROWD, LIGHT_SPEED, RAT_SPEEDS, RESTART_ROOM, SIZE_BY_SPEED } from './gameplay'
import { createLightning } from './lightning'
import { flashAt } from './weather'
import { CHAT, INTRO, afterglow, roadAheadOf, cowering, flameGrown, goslingAt, litShare, ratsOut, shakeAt, startled, walkAt, walkOf } from './gooseintro'

// What runs for the light: the rat.
const creature = RAT
/** How fast the light walks under `?film`, m/s: a take covers more ground in its few seconds. */
const FILM_LIGHT_SPEED = 2
/** The count's top, where the device's textures allow it: a playback row a rat. */
const MAX_RATS = 16384
const SEED = 7
const url = new URLSearchParams(location.search)
/**
 * A trial, on by default in the goose game since 2026-10-30 (the tilt, the graveyard, the marker, the cheap bloom),
 * `?key=0` turning it off.
 */
const trialOn = (key: string) => url.get(key) !== '0'
/** The light's height above the ground where its holder carries it, when it is not in the torch. */
const LIGHT_HEIGHT = 1.1
/**
 * Where the camera starts from the light, and its field of view: a third
 * person's view, behind and a little above the holder, looking at its head
 * (2026-10-10; before, high and close, (0, 3.6, 2.8) at the feet).
 * From there the mouse moves it freely, and it keeps wherever it was put
 * from the light as the light walks.
 */
const CAMERA_OFFSET = new Vector3(0, 2.3, 4.6)
const CAMERA_TARGET = new Vector3(0, 0.9, -0.4)
/** Where the camera starts from the light when filming, and where it looks, from the light: a take's start, copied from the Film panel, since removed, on 2026-10-08. */
const FILM_CAMERA = new Vector3(-0.07, 1.97, 3.94)
const FILM_TARGET = new Vector3(-0.03, -0.13, -0.54)
/** How far over the ground the camera always stays, m; and how far a pixel of the locked pointer turns it, radians. */
const CAMERA_ABOVE = 0.6
const LOOK_SPEED = 0.0025
/**
 * The goose game's cameras, V going round them (?orbit, ?locked or ?chase starts in one) (2026-10-24). The fixed one,
 * the page's own: GOOSE_CAMERA from her feet, looking at GOOSE_TARGET, the chosen framing, captured on the panel on
 * 2026-10-24, 22 degrees down from 5.5 m (or the panel's capture kept since); nothing the mouse does turns it, but the
 * pointer's place on the screen slides it a little, as Portfolio2024's camera does: up to PARALLAX m across
 * and up, eased over PARALLAX_EASE s, the way it looks unchanged. The orbit, free, from the same framing. The locked
 * one, the same framing, never turned across; the drag tilts it only, between LOCKED_TILT's angles down from the
 * horizon. The chase, from CHASE_LOOK m over her, CHASE_CAMERA back and up, turning on the locked pointer, she turning
 * to it as she stands.
 */
const GOOSE_CAMERA = new Vector3(0.4, 2.67, 4.94)
const GOOSE_TARGET = new Vector3(0.02, 0.58, -0.12)
const PARALLAX = { x: 0.5, y: 0.3 }
const PARALLAX_EASE = 0.35
const LOCKED_TILT = [15, 80] as const
const CHASE_CAMERA = new Vector3(0, 1.6, 4)
const CHASE_LOOK = 0.9
type GooseCamera = 'fixed' | 'orbit' | 'locked' | 'chase'
const GOOSE_CAMERAS: readonly GooseCamera[] = ['fixed', 'orbit', 'locked', 'chase']
/** Where the camera captured on the panel is kept between loads. */
const GOOSE_CAMERA_KEPT = 'last-light.goose-camera'
/** A captured camera: where it stands and where it looks, m from her feet; and the follow's lag, s. */
interface CapturedCamera {
  camera: [number, number, number]
  target: [number, number, number]
  lag: number
  /** The field of view, degrees: none in a capture from before it was kept. */
  fov?: number
}
const CAMERA_FOV = 42
/**
 * How far behind the light the camera's follow runs, in seconds: it closes
 * most of the gap in this long, so a key pressed or released reaches the
 * camera as a glide rather than a step. Slight, so the light never nears
 * the edge of the view.
 */
const CAMERA_FOLLOW = 0.15
const GOOSE_CAMERA_FOLLOW = 0.6
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
/** How far past the goose game's plain the floor runs, m: out of sight in the fog from anywhere she can stand. */
const FLOOR_PAST = 20
/** How far past the fog's far edge the swarm may set a rat down, m, before the walk's own margin: a rat's length at the panel's usual scale, and the placing step's run. */
const DARK_MARGIN = 0.5

/**
 * How the scene looks to start; the panel's look folders edit it. Saved from
 * the panel on 2026-10-05, chosen by eye; turned to Halloween on 2026-10-08,
 * a purple night round a pumpkin-orange torch, the rats' eyes blood red; and
 * from Halloween to a forest at night on 2026-10-11: a cold, waning moon
 * low in the sky, a dark blue night, nothing purple.
 */
/**
 * Each floor's look, as last saved from the panel: picking a floor in the
 * floor folder lays its look with it, since a hue, a tile size or a relief
 * set for one painting is wrong for the other.
 */
/**
 * A stylized floor's look to start: as painted, a tile two and a half metres
 * wide, unturned, its normal map as authored; no highlight; the earth's
 * strokes; three steps; and over that, `own`.
 */
const stylizedFloor = (texture: FloorName, own: Partial<Look['floor']> = {}): Look['floor'] => ({
  texture,
  lightness: 1,
  saturation: 1,
  hue: 0,
  scale: 2.5,
  relief: 1,
  rotation: 0,
  shell: { sheen: 0, specular: 0, shininess: 53, softness: 0, specularColor: 0xffffff, rim: false, rimStrength: 0.25, rimWidth: 0, rimSoftness: 0, rimColor: 0xe7febe },
  paint: { strength: 4, density: 0.7, size: 3.35, rounding: 0.01 },
  toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
  ...own,
})
const FLOOR_LOOKS: Record<FloorName, Look['floor']> = {
  // Set from the panel on 2026-10-05: the floor as painted, a little richer, on small tiles, its normal map as
  // authored; a hard white highlight; wide, deep strokes over the map's relief; three steps from a grey shade.
  // Halloween's purple turn taken off again on 2026-10-11.
  flagstones: {
    texture: 'flagstones',
    lightness: 1,
    saturation: 1.09,
    hue: 0,
    scale: 1.15,
    relief: 1,
    rotation: 0,
    shell: { sheen: 0, specular: 0.85, shininess: 53, softness: 0, specularColor: 0xffffff, rim: false, rimStrength: 0.25, rimWidth: 0, rimSoftness: 0, rimColor: 0xe7febe },
    paint: { strength: 10, density: 0.5, size: 2, rounding: 0.09 },
    toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
  },
  // Set from the panel on 2026-10-11: darker, a little drier and turned a touch red, a tile eight metres wide,
  // flat, all but no highlight, broad strokes.
  earth: {
    texture: 'earth',
    lightness: 0.59,
    saturation: 0.9,
    hue: -13,
    scale: 8,
    relief: 0,
    rotation: 0,
    shell: { sheen: 0, specular: 0.02, shininess: 114, softness: 0, specularColor: 0x4d7cf5, rim: false, rimStrength: 3, rimWidth: 0.01, rimSoftness: 0.08, rimColor: 0x4a271c },
    paint: { strength: 4, density: 0.7, size: 3.35, rounding: 0.01 },
    toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
  },
  // A first try, 2026-10-11: the painting as painted, a tile three metres wide, so a leaf is a leaf's size;
  // no highlight; the earth's strokes, over a flat normal map; three steps.
  dirt: {
    texture: 'dirt',
    lightness: 1,
    saturation: 1,
    hue: 0,
    scale: 3,
    relief: 0,
    rotation: 0,
    shell: { sheen: 0, specular: 0, shininess: 53, softness: 0, specularColor: 0xffffff, rim: false, rimStrength: 0.25, rimWidth: 0, rimSoftness: 0, rimColor: 0xe7febe },
    paint: { strength: 4, density: 0.7, size: 3.35, rounding: 0.01 },
    toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
  },
  // The goose game's stylized sets, each set from the panel on 2026-10-21: the grass dark and turned to a warmer green,
  // in deep relief; the dirt dark and nearly grey; the sand dark, a little warmer, flat; the stones grey, on smaller
  // tiles, in deep relief.
  // Paler and yellower, on bigger tiles: set from the panel on 2026-10-25, the goose game's floor.
  stylized_grass_01: stylizedFloor('stylized_grass_01', { lightness: 0.25, saturation: 0.6, hue: 32, scale: 4.6, relief: 3 }),
  // On 2026-10-21 the dirt, the goose game's floor, on wide tiles: lighter and warmer, in deep relief, with a broad
  // grey-blue highlight and a faint grey rim, as the panel set it.
  stylized_dirt_01: stylizedFloor('stylized_dirt_01', {
    lightness: 0.4,
    saturation: 0.71,
    hue: -22,
    scale: 10,
    relief: 3,
    shell: { sheen: 0, specular: 1.21, shininess: 10, softness: 0.28, specularColor: 0x41595d, rim: true, rimStrength: 0.06, rimWidth: 0, rimSoftness: 0, rimColor: 0xc7c7c7 },
  }),
  stylized_sand_01: stylizedFloor('stylized_sand_01', { lightness: 0.32, saturation: 0.63, hue: 14, relief: 0 }),
  stylized_stones_02: stylizedFloor('stylized_stones_02', { lightness: 0.52, saturation: 0, hue: 1, scale: 1.5, relief: 2.57 }),
}
/** `source` copied into `target` in place, nested objects and arrays included, so the panel's controls stay on them. */
function copyInto<T extends object>(target: T, source: T): void {
  for (const key of Object.keys(source) as (keyof T)[]) {
    const value = source[key]
    if (Array.isArray(value)) (target[key] as unknown[]).splice(0, Infinity, ...value)
    else if (typeof value === 'object' && value !== null) copyInto(target[key] as object, value)
    else target[key] = value
  }
}
const look: Look = {
  // A hot lamp with no falloff, its intensity whatever the strength, its reach at full strength; at the strength
  // the light starts at it ends well inside the light's hard radius, so the
  // holder stands in a pool, and the front presses on from the dark.
  // On trial: the lamp burns in the meat's torch, half a metre up, rather than hanging over it. The warm orange
  // the torch had before Halloween (2026-10-11): the pumpkin orange clipped to flat red on the earth.
  lamp: { color: 0xff8442, intensity: 13, reach: 6.9, falloff: 0, lag: 0.08, inFlame: true },
  // The light and the fog as it was on 2026-10-08 before the pumpkin kid (01304fa^), brought back on 2026-10-11, under the
  // effects as they stood before the 3D game (4aa332e): the look of the
  // goose's screenshots. A bright moon straight overhead, its shadows fairly sharp and not quite black, over the
  // ambient occlusion that carries the mass's volume.
  sun: { color: 0xb9c0bd, intensity: 3.2, x: 0, y: 23, z: 0, shadows: true, softness: 1.5, darkness: 0.9, shadowColor: 0x000000 },
  // A green fill, and a green fog to match it: the dark has a colour.
  fill: { sky: 0x268265, ground: 0x324d44, intensity: 0.7 },
  // Round the light, not the camera: the dark closes in on the holder from every side, further out than the lamp
  // reaches; on to start, a plain ring, its density 1 and no wisps (`?fog=0` or the folder's switch for none).
  fog: { enabled: url.get('fog') !== '0', color: 0x141916, near: 1, far: 5.5, density: 1, wisp: 0, scale: 2.75, drift: 0.6, lit: 0, litColor: 0xff7a2e, litSpread: 1.5 },
  // Matt rats in the creature's own colours, with a wide, soft, green-tinted
  // highlight: the mass is one body that glints.
  // Its parts' colours are the model's own, read once it is loaded. Set from
  // the panel on 2026-10-05: a broad soft highlight, long light strokes,
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
    // Drawn simpler the fewer pixels long a rat stands, on WebGPU (ADR-0057); `?lod=0` starts with every rat whole.
    levels: { on: url.get('lod') !== '0', show: false, split: 'none', blur: 1, levels: LEVELS.map((level) => ({ ...level })) },
    // The far crowd's staggered steps, on trial (2026-10-16): off to start, `?stagger=4&staggerFrom=5` starts with them.
    stagger: { n: url.has('stagger') ? Number(url.get('stagger')) || 4 : 1, from: Number(url.get('staggerFrom') ?? 5), show: false },
  },
  // The floor the page starts on, with its own look.
  floor: structuredClone(FLOOR_LOOKS.stylized_grass_01),
  // Ambient occlusion on, at half resolution, a deep green in the creases, reaching far and falling off hard: set from the panel on 2026-10-05.
  ao: { ...defaultAO(), color: 0x174f3e, radius: 1.73, thickness: 4, distanceExponent: 3.95, distanceFallOff: 2 },
  // Outlines off, set up pale and thin for when they are tried: from the panel on 2026-10-05.
  outline: { enabled: false, color: 0xe5fff4, thickness: 0.5, depth: 0.05, normal: 0.6 },
  // Hatching, faint ink in the deepest shade only, nine pixels apart at the grout's slant, crossed: set from the panel on 2026-10-05.
  hatch: { enabled: true, color: 0x06110c, below: 0.02, cross: true, spacing: 9, angle: 45, width: 0.35, strength: 0.2 },
  // The palette off, at nineteen levels for when it is tried.
  palette: { enabled: false, levels: 19 },
  // Paper in full, fine fibres; a faint grain that holds still: the strength set from the panel on 2026-10-10.
  grain: { grain: true, grainStrength: 0.08, grainSize: 1, grainOnBeat: false, grainSpeed: 0, paper: true, paperStrength: 1, paperScale: 2.5 },
  // A light vignette from near the centre: set from the panel on 2026-10-05.
  vignette: { enabled: true, strength: 0.21, inner: 0.18, outer: 1.16, own: false, colour: 0x000000 },
  // The frame as drawn, the screen folder washing it out or richer.
  screen: { saturation: 1 },
  // Stop motion on twos: the rats step twelve times a second, run and places
  // alike; the camera and the light stay smooth. Between beats, the strokes
  // and the paper move; the rest is off, set as the panel left it on 2026-10-05.
  stopMotion: {
    // On again (2026-10-11, the effects as they were before the 3D game): `?stop=0` for a smooth take.
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
  // A halo round the eyes, at half the frame's resolution: on everywhere, it costs a fixed slice of the frame (benched 2026-10-10).
  // A halo round the eyes, at half the frame's resolution: on everywhere, it costs a fixed slice of the frame (benched 2026-10-10).
  bloom: { enabled: true, strength: 1, radius: 0.5, resolution: 0.5, cheap: trialOn('cheapbloom'), blurGlow: 0.6 },
  // The eyes' trails on, as the panel left them on 2026-10-08: a quarter second long, a centimetre and a half wide, needle-tapered,
  // swaying hard and fading fast; smooth, wiggling wide and slow at the tail. In the eyes' own colour.
  // The meat at the light, half a metre high, in its own colours, shaded as the rats start.
  meat: defaultMeat(),
  flame: defaultFlame(),
  // The eyes' trails as the panel left them on 2026-10-07: short, a centimetre wide, needle-tapered, swaying hard, bright amber; no wiggle yet.
  trails: { enabled: true, seconds: 0.11, width: 0.01, strength: 4, wave: 2, taper: 1.9, fade: 6, wiggle: 0, wiggleSpeed: 1.6, color: 0xffbe0a, eyeColour: false },
}

// The goose game plays smooth: no stop motion. Its lamp hangs over her, not in the flame at her beak, so her light is
// centred on her and her goslings.
look.stopMotion.enabled = false
look.lamp.inFlame = false
// Its night as the panel was set on 2026-10-24: a dimmer lamp, a blue moon low in the
// west over a blue sky and brown ground, a teal fog ring, wide; the rats lit in teal-green, their eyes cyan
// (set once their parts are read), their trails taking the eyes' colour.
Object.assign(look.lamp, { intensity: 5, reach: 6.9, falloff: 0, lag: 0.08 })
Object.assign(look.sun, { color: 0x67a8fe, intensity: 1.6, x: -30, y: 23, z: 0, shadows: true, softness: 1.5, darkness: 0.9 })
Object.assign(look.fill, { sky: 0x67a8fe, ground: 0x633618, intensity: 0.75 })
Object.assign(look.fog, { color: 0x0e6a7c, band: 15, near: 0, far: 15.75, density: 1, wisp: 0, scale: 0.5, drift: 0, lit: 0, litColor: 0xcc682e, litSpread: 0.8 })
Object.assign(look.rats, { glow: 1.4, sheen: 0, specular: 0.27, shininess: 30, softness: 0.28, specularColor: 0x3acb9a, rim: true, rimStrength: 0.82, rimWidth: 0.24, rimSoftness: 0.34, rimColor: 0x58937f })
Object.assign(look.trails, { enabled: true, seconds: 0.11, width: 0.01, taper: 1.9, wave: 2, strength: 4, fade: 6, wiggle: 0, wiggleSpeed: 1.6, eyeColour: true })
/** The goose game's rats' eyes, as the panel was set on 2026-10-24. */
const GOOSE_EYES = 0x0aefff
/** How much paler the goose game's fog is toward the horizon, in lightness from 0 to 1. */
const HORIZON_LIFT = 0.12
/** `color` with its lightness raised by `lift`, as the eye sees it. */
function paler(color: number, lift: number): number {
  const hsl = new Color(color).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace)
  return new Color().setHSL(hsl.h, hsl.s, Math.min(hsl.l + lift, 1), SRGBColorSpace).getHex()
}
// LOOK TRIALS: `#goose?theme=<name>` lays one of goosethemes.ts's moods over the look above; with none, the rainy
// night under a street lamp, put back on 2026-10-25 after the Halloween round (`00-current` the look above alone).
const GOOSE_THEME = '18-rainy-street-lamp'
const gooseTheme = gooseThemeOf(url.get('theme') ?? GOOSE_THEME)
if (gooseTheme) layInto(look, gooseTheme.look)
// The goose game's rats matt, whatever the theme, as asked for on 2026-10-26: no highlight and no rim.
Object.assign(look.rats, { specular: 0, rim: false })
// For now, as asked for on 2026-10-26: no fog, a pale violet moon, a mauve fill, and the rats all one dusty
// mauve; the lamp, the moon and the fill as set from the panel, the lamp's light reaching less far.
look.fog.enabled = false
Object.assign(look.lamp, { color: 0xf09a60, intensity: 7, reach: 4.7, falloff: 0, lag: 0.08, inFlame: false })
Object.assign(look.sun, { color: 0xa094ff, intensity: 2.5, x: -23.5, y: 27, z: 25, shadows: true, softness: 1.5, darkness: 0.64, shadowColor: 0x241d3a })
Object.assign(look.fill, { sky: 0x754b8b, ground: 0x221a28, intensity: 0.8 })
look.rats.variants = [{ tint: 0x5c4d5a, share: 1 }]
// The fog paler toward the horizon (2026-10-25), whatever the theme: a soft gradient down the frame, the top of which
// looks out nearly level. Its own colour lifted, so the horizon stays in the fog's family.
look.fog.horizon ??= paler(look.fog.color, HORIZON_LIFT)

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
// The most the pixel ratio is drawn at, held to a 4K frame; the quality's steps take it lower, or `?dpr=N` sets it.
const maxDpr = Number(url.get('dpr')) || maxPixelRatio(devicePixelRatio, innerWidth, innerHeight)
renderer.setPixelRatio(maxDpr)
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
await renderer.init()
const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU' : 'WebGL 2'
// Ready for the sun and the lamp to cast, each while its shadows toggle is on.
// Variance shadow maps, blurred before they are read, so the sun's softness
// smooths the rats' shadows instead of graining them: three's WebGPU build has
// no soft PCF, and its PCF takes five samples. The lamp, a point light, cannot
// use them and keeps three's PCF.
renderer.shadowMap.enabled = true
renderer.shadowMap.type = VSMShadowMap

const scene = new Scene()
/** The night's colour behind the scene, the fog's. */
const sky = new Color()
scene.background = sky
/** The sky behind the scene: its gradient where the look has a horizon. */
function skyChanged() {
  scene.backgroundNode = look.fog.horizon !== undefined ? skyBehind : null
}
/** How many lights light the fog, the torch among them: the nearest her. */
const FOG_LIGHTS = 8
// The fog is a ring round the light: how thick it is at a point is how far
// that point is from the light on the ground, not from the camera. Every
// material reads the one node, so the uniforms move it without a recompile.
// The ring's edge is frayed by noise: two octaves over the point's place in
// the world, blown along the ground and churned over time, push the point's
// distance from the light in and out by up to the wisp, so patches of thicker
// fog drift through the ring and over the rats. The time is the run's held
// time, so the stop motion steps the drift on the beat with everything else.
// Every fog uniform is in the render's group, uploaded every frame: in the object group, a mesh that never moves
// keeps the values it was first drawn with, and the well stood out of the fog as the ring moved on without it.
const fogColor = uniform(new Color()).setGroup(renderGroup)
const fogNear = uniform(0).setGroup(renderGroup)
const fogFar = uniform(1).setGroup(renderGroup)
const fogCentre = uniform(new Vector2()).setGroup(renderGroup)
/**
 * How dense the fog is between near and far: 1 the plain ramp; more bends it
 * up, so the fog is thick soon past near and only creeps to solid at far.
 */
const fogDensity = uniform(1).setGroup(renderGroup)
/** How far the noise pushes the edge, m, 0 for a plain ring. */
const fogWisp = uniform(0).setGroup(renderGroup)
/** How wide one wisp is, m. */
const fogScale = uniform(1).setGroup(renderGroup)
/** How fast the wisps blow along the ground, m/s. */
const fogDrift = uniform(0).setGroup(renderGroup)
const fogTime = uniform(0).setGroup(renderGroup)
const fogWind = fogDrift.mul(fogTime)
// Blown across x and z at the drift, and rising through the noise's third axis at a third of it, so a wisp changes shape as it goes.
const fogPoint = vec3(positionWorld.x.add(fogWind), positionWorld.z.add(fogWind.mul(0.6)), positionWorld.y.add(fogWind.mul(0.3))).div(fogScale)
const fogNoise = mx_noise_float(fogPoint).add(mx_noise_float(fogPoint.mul(2.1).add(vec3(7.3, 1.9, 4.1))).mul(0.5))
const fogRamp = smoothstep(fogNear, fogFar, positionWorld.xz.distance(fogCentre).add(fogNoise.mul(fogWisp)))
// The ramp bent by the density: `1 - (1 - ramp)^density` keeps its ends and lifts its middle.
const fogAmount = fogRamp.oneMinus().pow(fogDensity).oneMinus()
// The fog lit by the lights in it: round each lit light, the torch first, the fog takes on the lit colour, full at the
// light and gone a `spread` of its reach out, the lights summed and capped at one, by the strength. So a far light reads
// as a warm haze in the dark, where it stands and about how far it reaches, and never shows the ground under it. Only
// the FOG_LIGHTS nearest her; the rest are the page's sparks alone.
const fogLights = uniformArray(Array.from({ length: FOG_LIGHTS }, () => new Vector4()), 'vec4').setGroup(renderGroup)
const fogLit = uniform(0).setGroup(renderGroup)
const fogLitColor = uniform(new Color()).setGroup(renderGroup)
const fogLitSpread = uniform(1).setGroup(renderGroup)
/** How lit the fog is at `at` on the ground, x and z, before its lit strength. */
const glowAt = (at: Node<'vec2'>) =>
  Fn(() => {
    const glow = float(0).toVar()
    Loop(FOG_LIGHTS, ({ i }) => {
      // x, z, reach, and 1 lit or 0.
      const one = fogLights.element(i) as unknown as Node<'vec4'>
      const near = float(1).sub(smoothstep(0, one.z.mul(fogLitSpread).max(0.01), at.distance(one.xy)))
      glow.addAssign(near.mul(near).mul(one.w))
    })
    return glow.min(1)
  })() as unknown as Node<'float'>
const fogGlow = glowAt(positionWorld.xz).mul(fogLit)
// The fog's colour by where the eye looks: the horizon's where the look runs level, turning to the fog's own over
// the band as it tips down to the ground or up overhead. The sky behind the scene takes the same, so the fog's far
// edge melts into it; on the goose's fixed camera the frame's top looks out nearly level and her feet well down.
const skyHorizon = uniform(new Color()).setGroup(renderGroup)
/** How far the look tips from level before the colour is the fog's own: the sine of the angle. */
const skyBand = uniform(1).setGroup(renderGroup)
const skyAt = (along: Node<'vec3'>) => mix(skyHorizon as unknown as Node<'vec3'>, fogColor as unknown as Node<'vec3'>, smoothstep(0, skyBand, along.y.abs()))
/** The sky along the look at this fragment, for what the scene draws. */
const skyHere = skyAt(positionWorld.sub(cameraPosition).normalize())
/** The sky behind the scene: three's background sphere, its normals the look. */
const skyBehind = skyAt(normalWorldGeometry)
// The sky along the look through this pixel, for the passes over the frame: the scene camera's matrices, not the quad's.
const lookInverse = uniform(new Matrix4()).setGroup(renderGroup).onRenderUpdate(() => camera.projectionMatrixInverse)
const lookWorld = uniform(new Matrix4()).setGroup(renderGroup).onRenderUpdate(() => camera.matrixWorld)
const skyOnScreen = skyAt(lookWorld.mul(vec4(getViewPosition(screenUV, float(0.5), lookInverse), 0)).xyz.normalize())
scene.fogNode = fog(skyHere.add((fogLitColor as unknown as Node<'vec3'>).mul(fogGlow)) as unknown as typeof fogColor, fogAmount)
// The goose (meat.ts) burns its torch at the cup's top: the flame sunk into it, as the panel set it on 2026-10-08;
// and as bright as the plain's fires (`fireLook`), asked for on 2026-10-29.
if (goose) Object.assign(look.flame, { lift: -0.09, offsetX: -0.009, offsetZ: 0.022, glow: 2.8 })
/** Where the fog goes solid, m from the light, as the panel has it: the ring the swarm brings rats round past, fog or no fog. */
let fogEdge = 1

const camera = new PerspectiveCamera(CAMERA_FOV, innerWidth / innerHeight, 0.1, 100)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// A faint night-sky fill, a low waning moon, and the one warm light.
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
// The sun's shadow in a colour: three's own shadow, 0 in it and 1 out of it as far as the darkness has it, taken from
// the colour to white, so black is three's shadow as it was and any other colour lets that much of the sun's light in.
const sunShadowColor = uniform(new Color(0x000000)).setGroup(renderGroup)
sun.shadow.shadowNode = mix(sunShadowColor, vec3(1), shadow(sun) as unknown as Node<'float'>)
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

// The goose game's pond bed: the floor gives way to sand down its bank (ground.ts), as the pond folder's bed edits it.
const bedLook = defaultBedLook()
// And the ground under its wells, fading into the dirt round each, as the well folder's texture edits it.
const wellGroundLook = defaultWellGroundLook()
// And the old road up the plain from fire to fire, in stone (road.ts), as the road folder edits its way and its look.
// Set ROAD false to lay the floor without it: laying it then does nothing, and its folder is left out.
const ROAD = true
const roadShape = defaultRoadShape()
const roadLook = defaultRoadLook()
const ground = await floor(look.floor.texture, {
  slopes: true,
  bed: bedLook,
  wellGround: wellGroundLook,
  road: ROAD ? roadLook : undefined,
})
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
/** Where the torch rests this frame, the arm's sway left out: the swarm's light stands there. */
const torchRest = new Vector3()
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
// With `?tilt` (the goose game's default), the tilt-shift: the depth of field's blur by a band across the screen (tiltshift.ts).
const tilt = trialOn('tilt') ? createTiltShift() : undefined
// With the tilt, the depth of field off as the page opens: the tilt's band is the blur (the dof folder still turns it on).
if (tilt) look.dof.enabled = false
const post = createPost(renderer, scene, camera, { color: skyOnScreen, amount: fogAmount }, tilt)

// ---------------------------------------------------------------- swarm
const tuning = defaultTuning()
// The game's crowd (gameplay.ts), which the 2D page plays by too.
Object.assign(tuning, CROWD)
/** How far off the goose game's rats notice her, m: short of every theme's fog, so the rats further off are seen wandering.
 * 6 since 2026-10-29 (4.5 from 2026-10-27), set from the rats' pull folder. */
const GOOSE_NOTICE = 6
// The goose game's rats notice her within GOOSE_NOTICE m, her goslings drawing them from as far as she does, each running
// at the nearest of them; the rats further off ignore her and run about at their own pace, bending back her way only as they
// roam more than 16 m past that (2026-10-26).
Object.assign(tuning, { notice: GOOSE_NOTICE, wander: 1, roam: 16 })
// The goose game's rats pile up a rat's height, as the open arena's nearly do, since 2026-10-29 (0.3 from 2026-10-22
// read as too tame); and since 2026-10-25 they lunge and weave as the sewers' did, but softer, the
// sewers' read too aggressive here; a little more since 2026-10-26: about once in 3.5 s each, at 2.1 times its pace
// for 0.13 s, swerving up to 0.4 rad.
Object.assign(tuning, { pull: tuning.notice, pile: 1, dashRate: 1 / 3.5, dashSpeed: 2.1, dashTime: 0.13, weave: 0.4 })
// The goose game's rats as quick to answer as the open arena's since 2026-10-29, the calmer answer of 2026-10-25 read
// as too tame; but still no bolt at once, from the light or into a lunge.
Object.assign(tuning, { reaction: 0.25, turnRate: 10, fleeReaction: 0.3, fleeTurn: 1.5 })
/** The collision disc at the usual size: the rat scale and the spacing multiply it. */
const RAT_RADIUS = tuning.ratRadius
const maxTextureSize = getMaxTextureSize(renderer)
/** The count's top: 16,384, or what this device's textures hold. */
const capacity = Math.min(MAX_RATS, maxTextureSize)
/** The goose game's rats to start, 500 since 2026-10-29: ?rats=N asks for others. */
const GOOSE_RATS = 500
/** The count the address asks for, ?rats=N: zero included. */
// The goose game's rats as set from the panel on 2026-10-26: quicker to come on, and quicker still from the light, bigger; bigger again, 2.2, since 2026-10-29, and spaced 1.2 the same day (1.8 read as too tame).
const GOOSE_SPEEDS = { minSpeed: 3, maxSpeed: 4, fleeMinSpeed: 4, fleeMaxSpeed: 4.5 }
const GOOSE_RAT_SIZE = 2.2
const GOOSE_SPACING = 1.2
/** How far off the goose game's rats out of view come round from, m, with no fog to hide them nearer, set on 2026-10-26. */
const GOOSE_ROUND_PAST = 30
const askedRats = Math.round(Number(url.get('rats') ?? GOOSE_RATS))
// The start, saved from the panel on 2026-10-05: the game's rats, their size and speeds (gameplay.ts), each as
// big as it is fast, a dim light that walks as fast as they run, and the run played at the rat's own pace.
const settings: Settings = {
  rats: Math.min(Math.max(Number.isNaN(askedRats) ? GOOSE_RATS : askedRats, 0), capacity),
  ...RAT_SPEEDS,
  ...GOOSE_SPEEDS,
  size: GOOSE_RAT_SIZE,
  sizeBySpeed: SIZE_BY_SPEED,
  spacing: GOOSE_SPACING,
  on: true,
  debug: true,
  shadows: url.has('shadows'),
  runAnimation: 1.7,
  lightSpeed: url.has('film') ? FILM_LIGHT_SPEED : LIGHT_SPEED,
  paused: false,
  bringRound: true,
  // The goose game's rats come round from out of the camera's view or past GOOSE_ROUND_PAST m, the fog nearer where it is on.
  roundPast: GOOSE_ROUND_PAST,
  // ?nocharacter starts with the character hidden, its torch, flame, embers and smoke with it, as the panel's toggle does.
  character: !url.has('nocharacter'),
}
tuning.minSpeed = settings.minSpeed
tuning.maxSpeed = settings.maxSpeed
tuning.fleeMinSpeed = settings.fleeMinSpeed
tuning.fleeMaxSpeed = settings.fleeMaxSpeed
tuning.ratRadius = RAT_RADIUS * settings.size * settings.spacing

// ---------------------------------------------------------------- run
// The ground each light sees against the walls: worked out here for the drawing, and on WebGPU read by the
// swarm's step from the same texture. The worker works out its own the same way. Its walls are the level's,
// once there is one.
const areas = new LitAreas(new Walls([]))
const seen = seenTexture(areas)
const vat = await loadVAT(creature.url)
const time: VATTimeUniform = uniform(0)
/** The goose game's plain as its play lays it, known before the play is, so the rats can be made on its ground. */
const goosePlain = laid(ROUTE)
/** How far the pond was moved by hand from where it falls past home, m (the pond folder's, 2026-10-29; z 2026-10-30). */
const POND_MOVED = { x: 3.37, z: -0.7 }
/** How far off the island's waterline the 6 debug key stands her, m. */
const ISLAND_BY = 1
// The goose game's pond, as the pond folder edits it: past the last brazier, at the end of the route, the water the
// rats are held off.
const pondLook = pondPastHome(goosePlain)
/**
 * The pond drawn where the plain has it, past the last brazier: on along the last leg, its shore toward her WADE short
 * of home, so she is home as she wades in. The drawn pond is wider than the play's, so it lies further on.
 */
function pondPastHome(p: Plain): PondLook {
  const look = defaultPondLook(p.pond)
  const way = Math.atan2(p.pond.z - p.home.z, p.pond.x - p.home.x)
  const reach = shoreAt(look, way + Math.PI) - WADE
  // Its island's shore turned across her way.
  const island = { ...look.island, turn: (way * 180) / Math.PI + 90 }
  return { ...look, x: p.home.x + Math.cos(way) * reach + POND_MOVED.x, z: p.home.z + Math.sin(way) * reach + POND_MOVED.z, island }
}
/** The box the goose game's floor is laid over: the plain's, and round the drawn pond at its widest shore, which lies on past the play's, FLOOR_PAST more. */
const gooseFloorBox = (() => {
  const b = goosePlain.bounds
  const r = pondLook.radius * FURTHEST
  return {
    minX: Math.min(b.minX, pondLook.x - r) - FLOOR_PAST,
    maxX: Math.max(b.maxX, pondLook.x + r) + FLOOR_PAST,
    minZ: Math.min(b.minZ, pondLook.z - r) - FLOOR_PAST,
    maxZ: Math.max(b.maxZ, pondLook.z + r) + FLOOR_PAST,
  }
})()
/** How the goose game's plain rolls, as the ground folder edits it; and where the pond is, flat round it. */
const rollingLook = defaultRollingLook()
const pondPlace = { x: pondLook.x, z: pondLook.z, widest: widestShore(pondLook) }
/** The goose game's rolling ground (rolling.ts) over its floor: what the floor is laid on, and the rats, the goose and the scenes stand on. */
const gooseGround = rollingGround(goosePlain, pondPlace, gooseFloorBox, rollingLook)
// Leaves falling round her, to the rolling ground (fallingleaves.prototype.ts), with a panel of their own.
const fallingLeaves = createFallingLeaves(gooseGround, defaultFallLook())
scene.add(fallingLeaves.object)
// On WebGPU the rats are culled and drawn on the GPU (ADR-0052); WebGL 2, or `?batch`, draws them as the batch.
const rats = new Rats(vat, creature, capacity, maxTextureSize, time, settings.runAnimation, backend === 'WebGPU' && !url.has('batch') ? renderer : undefined, gooseGround)
// The rats' depth laid first, so each pixel is shaded for the nearest rat alone; `?prepass=0` shades them all, to measure against.
rats.setPrepass(url.get('prepass') !== '0')
// The swarm steps on the GPU where the GPU culls the rats (ADR-0053); in the worker on WebGL 2, under `?batch` or `?cpustep`.
const arenaScale = 1
const gpuCull = url.has('cpustep') ? undefined : rats.gpuCull
/** The page's swarm made on `ground`, the goose play's to set its rats down in and the page's to step. */
const playSwarm = (ground: Ground) =>
  (gpuCull ? new GpuSwarm(gpuCull, renderer, capacity, SEED, 0, arenaScale, undefined, ground, seen.texture) : new RemoteSwarm(capacity, SEED, 0, arenaScale, ground))
/**
 * The goose game, on the route saved from its 2D page, its rats the panel's budget and `?seed`'s, walking at the panel's pace. The
 * dead tree stands where the route has it, or `?tree=N` m ahead of her start.
 */
const treeAhead = Number(url.get('tree')) || null
const goosePlay = new GoosePlay<GpuSwarm | RemoteSwarm>(
  { rats: settings.rats, pace: settings.lightSpeed, seed: Math.round(Number(url.get('seed') ?? 1)) || 1, treeAhead, lastGuides: true },
  { tuning, swarm: playSwarm },
)
/** The ground's height under (x, z): the goose game's rolling plain. */
const groundAt = (x: number, z: number) => gooseGround.at(x, z)

// The level and its rules, the goose play's. Its torch, as on its 2D page: it burns down, its light shrinking with the
// fuel in a straight line to nothing, and grows back as she fills it at a fire. A and E (Q and E on a QWERTY keyboard)
// turn its reach up and down; F gives it a light that never burns down, and puts it out again.
const level = goosePlay.level
const runTuning = goosePlay.runTuning
/** The run, the goose play's. */
const run = goosePlay.run
/**
 * The opening (gooseintro.ts): in the goose game, unless `?intro=0` or the page films; its own clock, s, on with the
 * play's and held by its pause; Space held SKIP_HOLD s skips to its end.
 */
const introOn = goosePlay !== undefined && !url.has('film') && url.get('intro') !== '0'
let introT = introOn ? 0 : INTRO.end
const introRunning = () => introT < INTRO.end
const SKIP_HOLD = 0.8
/** Whether Space is held to skip the opening, and how long it has been, s: let go, it drains twice as fast. */
let skipHeld = false
let skipHolding = 0
/** The opening over at once: she where her walk ends, the rest the play's from the next frame. */
function skipIntro() {
  introT = INTRO.end
  skipHeld = false
  skipHolding = 0
  walkIntro()
}
/** The road she walks up in the opening, to where she starts. */
const introWalk = introOn ? walkOf(goosePlay!.plain.start, goosePlay!.plain.road) : []
/** The way on up the road from where she starts, the goslings bolting along it. */
const introAhead = introOn ? roadAheadOf(goosePlay!.plain.start, goosePlay!.plain.road) : { x: 0, z: -1 }
walkIntro()
// The lit areas see every wall that stops the rats.
areas.setWalls(new Walls(run.walls()))
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
/**
 * The torch as the swarm and the lit areas read it: where the torch rests,
 * the arm's sway left out; `light` stands at
 * the holder, for the walk, the camera and the fog. Its reach and its lit
 * are the torch's.
 */
const swarmLight: Light = { x: light.x, z: light.z, strength: 0, on: false }
/** The swarm's time, which the lights' flames lean at, in the drawing as in the step. */
const swarmTime = uniform(0)
// The dead tree burns bare, high on its trunk (#190), the well's light in its lantern, the brazier by the tree, after
// the braziers, on its own bowl, and the cage's over its campfire's logs: their lamps alone, the page burning the
// torch's flame on each.
const looks = goosePlay.level.lights.map((_, k) => {
  const b = goosePlay.plain.braziers[k]
  if (goosePlay.wellFires.some(({ light }) => light === k)) return PIT_LIGHT
  return b === undefined ? TREE_FIRE_LIGHT : k === spawnTree(goosePlay.plain) ? BURNING_LIGHT : b.scene === 'tree' ? TREE_LIGHT : b.scene === 'well' ? WELL_LIGHT : b.scene === 'cage' ? CAGE_FIRE_LIGHT : undefined
})
// The braziers and ghosts lit as fake lamps (fakelamps.ts): one loop in each lit shader, not a point light written out
// in each; the torch's lamp stays a point light.
const fakeLamps = createFakeLamps()
scene.add(fakeLamps)
// The braziers' lamps are not cut to their lit areas: the plain has no walls (see the torch's lamp below).
const lights = createLights(level.lights, seen.texture, swarmTime, level.start, { looks, groundAt, masked: false, lamps: fakeLamps })
scene.add(lights.object)
/** The pond's water as drawn, the swarm's to hold the rats off: its shore, as the pond folder last laid it. */
const pondWater = (look: PondLook) => shoreLight(look.x, look.z, (angle) => shoreAt(look, angle))
goosePlay.setWater(pondWater(pondLook))
// The goose game's goslings, afloat once out of their depth in the pond.
const goslingSpeeds = defaultGoslingSpeeds()
const goslingSize = { height: GOSLING_HEIGHT }
const goslings = goosePlay && pondLook && (await createGoslings(goosePlay, pondLook, goslingSpeeds, groundAt, goslingSize))
// PROTOTYPE (`?ghosts`, `=float`, `=rag` or `=ball`, `&ghostcount=`): ghost geese, cloth sheets on the GPU (ghosts.prototype.ts); WebGPU only.
// `?graveyard` (the goose game's default, long sheets): they walk the graveyard's chain behind the last fire as the 2D page
// lays it (graveyard.prototype.ts), on the play's clock, so they meet where and when they meet there.
const graveyard = (() => {
  if (!goosePlay || !trialOn('graveyard')) return undefined
  const k = goosePlay.plain.braziers.length - 1
  const fire = goosePlay.plain.braziers[k]
  const before = goosePlay.plain.braziers[k - 1]
  return fire && before ? layGraveyard(defaultGraveLook('chain'), fire, goosePlay.level.lights[k]?.reach ?? fire.reach, before) : undefined
})()
const ghosts = goosePlay && (url.has('ghosts') || graveyard) && backend === 'WebGPU'
  ? await createGhosts(
      renderer,
      goosePlay.holder,
      groundAt,
      url.get('ghosts') || 'long',
      Number(url.get('ghostcount') ?? 4),
      graveyard && { count: graveyard.ghosts.length, reach: graveyard.ghosts[0]?.light.reach ?? 1, speed: defaultGraveLook('chain').speed, at: (g, t) => ghostAt(graveyard.ghosts[g]!, t) },
      fakeLamps,
    )
  : undefined
if (ghosts) scene.add(ghosts.object)
/** The old road's middle as last laid, for the graves to keep off: none till it is, and they are laid again then. */
let gravesRoad: readonly { x: number; z: number }[] = []
// Its graves over its ground among the ghosts' paths (graves.prototype.ts), clear of the crossings, out of the pond, and off the
// road out to its faded edge, though not to the furthest its edge wavers out: close by it, as old graves stand by a way.
const graveGround: GraveGround | undefined = graveyard && {
  paths: graveyard.ghosts.map((g) => g.path.points),
  ground: graveyard.outline,
  keepClear: graveyard.meetings.map((m) => ({ ...m.at, radius: 1.1 })),
  wet: (x, z) => !!pondLook && Math.hypot(x - pondLook.x, z - pondLook.z) < shoreAt(pondLook, Math.atan2(z - pondLook.z, x - pondLook.x)) + 0.6,
  onRoad: (x, z, radius) => gravesRoad.length > 0 && offWay(gravesRoad, { x, z }) < roadLook.width / 2 + roadLook.edge + radius,
}
const graves = graveGround && goosePlay ? await createGraves(graveGround, groundAt) : undefined
if (graves) scene.add(graves.object)
// No last fire past it: the graveyard runs on to the pond, and the ghosts are its only light. Its light out for the
// swarm and the play, its stand and flame not drawn; its place still lays the graveyard.
if (graveyard && goosePlay) {
  const k = goosePlay.plain.braziers.length - 1
  const last = goosePlay.level.lights[k]
  if (last) last.on = false
  const drawn = lights.object.children[k]
  if (drawn) drawn.visible = false
}
if (ghosts && !url.has('nopanel'))
  mountGhostControls(
    ghosts,
    graves &&
      ((gui) =>
        mountGraveControls(graves, gui, () => {
          setStones()
          layGravePumpkins()
        })),
  )
/** How far round a graveyard pumpkin she keeps clear when they are scattered, m. */
const GRAVE_PUMPKIN_RADIUS = 0.4
/**
 * A few of the well's pumpkins in the graveyard by the road, clear of its graves, looking back down the road at her
 * coming (graves.prototype.ts): again whenever the road or the graves are laid again.
 */
function layGravePumpkins() {
  if (!graveyard || !graveGround || !gooseScenes) return
  const stones = (graves?.footprints() ?? []).map(({ at, outline }) => ({ ...at, radius: Math.max(...outline.map((p) => Math.hypot(p.x, p.z))) }))
  const back = { x: -graveyard.entrance.facing.x, z: -graveyard.entrance.facing.z }
  gooseScenes.layLoosePumpkins(scatterGravePumpkins(graveGround, gravesRoad, back, stones, gooseScenes.pumpkinKinds, GRAVE_PUMPKIN_RADIUS))
}
// The ghosts' lights handed to the swarm after the play's own, so the rats keep out of them as out of a brazier's:
// patched onto the play from here, to keep the prototype out of gooseplay.ts.
if (ghosts && goosePlay) {
  const playLights = goosePlay.lights.bind(goosePlay)
  goosePlay.lights = () => [...playLights(), ...ghosts.lights]
}
if (goslings) scene.add(goslings.object)
/** How far round a gosling's feet the camera's view must reach to draw it, m: the bird and its shadow on the ground. */
const GOSLING_SEEN = 1
// The goose game's scenes: the well and the dead tree (#190).
const gooseScenes =
  goosePlay &&
  (await createGooseScenes(
    goosePlay,
    (x, z) => groundAt(x, z) + (pondLook ? standingIn(pondLook, x, z, pondLook.goose) : 0),
  ))
if (gooseScenes) scene.add(gooseScenes.object)
// Its shell laid now, before the panel reads the cart's and the corpse's highlight and rim, which start as it.
gooseScenes?.setShell(look.meat)
// The old road's arches over it out in the dark between its fires (arches.ts), as the road folder edits them.
const archLook = defaultArchLook()
// Their slabs and their toon shell, as the doors folder edits them: the road's and the floor's as the page opens, the
// floor's glossy highlight making them wet as the road is; theirs from then. As the folder was set on 2026-10-25:
// smaller slabs than the road's; a theme's own shell over that. Their stone 0.68 light, and no highlight, whatever the
// theme, as asked for on 2026-10-26, and a thin soft periwinkle rim, as set from the panel on 2026-10-27; the walls' the same.
const STONE_LIGHTNESS = 0.68
const matted = { specular: 0, rim: true, rimStrength: 0.32, rimWidth: 0.23, rimSoftness: 0.075, rimColor: 0x9097fe }
const { saturation: stoneSaturation, hue: stoneHue, rotation: stoneRotation, relief: stoneRelief } = roadLook
const archStone: ArchStone = { lightness: STONE_LIGHTNESS, saturation: stoneSaturation, hue: stoneHue, scale: 1.1, rotation: stoneRotation, relief: stoneRelief, wet: defaultArchWet() }
const archShell: ArchShell = structuredClone({ ...look.floor.shell, rim: true, rimStrength: 3, rimWidth: 0.31, rimSoftness: 0.075, paint: look.floor.paint, toon: look.floor.toon })
if (gooseTheme?.doors) Object.assign(archShell, gooseTheme.doors)
Object.assign(archShell, matted)
const arches = goosePlay && ROAD ? await createArches(archLook, archStone, groundAt) : undefined
if (arches) scene.add(arches.object)
// The old road's broken walls beside it (roadwalls.ts), as the walls folder edits them: of the arches' stone and in
// their shell as the page opens, or a theme's, their own from then; `?walls=<kind>` starts with another kind (field, lane, ruins,
// tumbled, none).
const roadWallLook = defaultRoadWallLook()
const wallsAsked = url.get('walls')
if (wallsAsked !== null && (ROAD_WALL_STYLES as readonly string[]).includes(wallsAsked)) roadWallLook.style = wallsAsked as RoadWallLook['style']
// Their tiles as the walls folder was set on 2026-10-25: a little bigger, square to the wall, slid along and up.
const wallStone = { ...structuredClone(archStone), scale: 1.35, rotation: 0, offsetX: 1.32, offsetY: 0.5 }
const wallShell = structuredClone(archShell)
if (gooseTheme?.walls) Object.assign(wallShell, gooseTheme.walls)
Object.assign(wallShell, matted)
const roadWalls = goosePlay && ROAD ? await createRoadWalls(wallStone, groundAt) : undefined
if (roadWalls) scene.add(roadWalls.object)
roadWalls?.setShell(wallShell)
// The dead trees either side of the road (deadtrees.ts), behind its walls where by one, as the dead trees folder edits
// them: scattered again on every change to it, the road, the arches or the walls; in the scenes' shell, their wood the
// user's of 2026-10-26, or a bark set the bark folder picks, laid as the floor is; swaying in the wind as
// justASimpleTree's trees do.
const deadTreeShape = defaultDeadTreeShape()
const deadTreeLook = { show: true, wood: 0xe4aff3, saturation: 0.64, y: -0.31, trunk: 0.09, rings: 6 }
/** The dead trees' highlight and rim, over the scenes' shell they share, as set from the panel on 2026-10-26: no highlight, a soft lilac rim. */
const deadTreeShine: ShineLook = {
  specular: 0,
  shininess: 30,
  softness: 0.17,
  specularColor: 0xc0d8f0,
  rim: true,
  rimStrength: 0.51,
  rimWidth: 0.37,
  rimSoftness: 0.1,
  rimColor: 0xc6c2ff,
}
const deadTreeBark = defaultBarkLook()
// The floor's grass up their feet, in the floor's look as the floor folder has it (lookChanged).
const deadTreeGrass = defaultGrassLook()
const deadTreeLeaves = defaultLeafLook()
const deadTreeWind = defaultTreeWindLook()
// The goose scenes' dead tree among them, drawn as one of theirs, its gosling riding its branch in their wind.
const deadTreesMesh = goosePlay && ROAD ? await createDeadTrees(deadTreeLook.wood, groundAt, gooseScenes?.treeWood) : undefined
deadTreesMesh?.setLeaves(deadTreeLeaves)
deadTreesMesh?.setBark(deadTreeBark)
deadTreesMesh?.setWind(deadTreeWind)
deadTreesMesh?.setWood(deadTreeLook.wood, deadTreeLook.saturation)
if (deadTreesMesh) {
  scene.add(deadTreesMesh.object)
  deadTreesMesh.object.position.setY(deadTreeLook.y)
  deadTreesMesh.setTrunk(deadTreeLook.trunk)
  deadTreesMesh.setRings(deadTreeLook.rings)
  scene.add(deadTreesMesh.own)
  if (gooseScenes) gooseScenes.swayTree = deadTreesMesh.swayOwn
}
// The falling leaves, where they fall, in the dead trees' leaf colours, as the leaves folder sets them: the mid, the
// shadow, the light and the mid again, so the mid falls most, as it shows most on the trees; as much of their own
// colour shown unlit as the trees'.
function leavesFallAsTrees(): void {
  if (!fallingLeaves || !deadTreesMesh?.leaves) return
  const { mid, shadow, light, glow } = deadTreeLeaves
  fallingLeaves.look.colours.splice(0, 4, mid, shadow, light, mid)
  fallingLeaves.look.glow = glow
  fallingLeaves.set()
}
leavesFallAsTrees()
// The bushes (bushes.ts), scattered as the trees are, nearer the road and off their trunks, as the bushes folder edits
// them; their leaves chosen on 2026-10-25, all of them sunk `y` m from where they stand, as set on the panel.
const bushShape = defaultBushShape()
const bushLook = { show: true, y: -0.15 }
const bushLeaves = defaultBushLeafLook()
const bushesMesh = goosePlay && ROAD ? await createBushes(bushLeaves, groundAt) : undefined
if (bushesMesh) {
  scene.add(bushesMesh.object)
  bushesMesh.object.position.setY(bushLook.y)
}
// The goose game's see-through (blockout.ts): the dead trees between the camera and her, and nothing else since the
// user's of 2026-10-26, dithered away round her by Perlin noise, as the see-through folder sets it: on 2026-10-26 a
// wide hole, 4 m round, cut from her on, in finer blots. A tree's trunk is kept whole
// (DeadTreesMesh.trunk), so it stands there whatever is dithered away above it: up to 0.09 of its height, under the
// first fork of any of the four, 0.155 of the height up the lowest (2026-10-26), its cut filled by its cross-section,
// never cut itself.
const gooseSeeLook = { ...defaultNoiseSeeThrough(), radius: 4, bias: 0, noiseScale: 0.19 }
const gooseSee = goosePlay ? noiseSeeThrough(gooseSeeLook) : undefined
// Its zone, for its debug: rings round her at the hole's radius and its clear core's.
const gooseSeeZone = gooseSee ? seeThroughZone() : undefined
if (gooseSeeZone) scene.add(gooseSeeZone.object)
const seenThrough = [deadTreesMesh?.object]
/** Where the burning tree stands, and how far round its trunk the see-through leaves it whole, m: its crown's reach. */
const burningAt = uniform(new Vector2(1e6, 1e6)).setGroup(renderGroup)
const BURNING_WHOLE = 3.5
const burningWhole = positionWorld.xz.sub(burningAt).length().lessThan(BURNING_WHOLE)
const cutThrough = new WeakSet<Material>()
/**
 * Cut every material under the see-through's objects not cut yet, a frame at a time: the trees are new meshes each time
 * they are laid. A material with a mask of its own keeps it, and one seen through, a glow or a flame, is not cut.
 */
function cutSeenThrough() {
  if (!gooseSee) return
  for (const object of seenThrough) {
    object?.traverse((child) => {
      if (!(child as Mesh).isMesh) return
      for (const m of [(child as Mesh).material].flat() as (Material & Partial<NodeMaterial>)[]) {
        if (cutThrough.has(m)) continue
        cutThrough.add(m)
        if (!m.isNodeMaterial || m.maskNode || m.transparent || m === deadTreesMesh?.trunk.whole) continue
        gooseSee.cut(m as NodeMaterial, m === deadTreesMesh?.trunk.material ? deadTreesMesh.trunk.kept.or(burningWhole) : burningWhole)
        m.needsUpdate = true
      }
    })
  }
}
/** How far past the pond's shore a dead tree stands at the least, m: off its bank. */
const TREE_OFF_POND = 2
/** Where a dead tree may stand: on the floor, a trunk's width in from its edge, and off the pond and its bank. */
const treeGround = (x: number, z: number) => {
  if (gooseFloorBox && (x < gooseFloorBox.minX + 1 || x > gooseFloorBox.maxX - 1 || z < gooseFloorBox.minZ + 1 || z > gooseFloorBox.maxZ - 1)) return false
  return !pondLook || Math.hypot(x - pondLook.x, z - pondLook.z) > shoreAt(pondLook, Math.atan2(z - pondLook.z, x - pondLook.x)) + TREE_OFF_POND
}
/** The arches' shell as the doors folder last set it. */
const archesShell = () => arches?.setShell(archShell)
archesShell()
/**
 * A scene's fire as it starts: its flame's foot `foot` m up, `height` m tall and `width` m wide, burning in the torch's
 * look; its lamp as bright as the lights' brazier lamp (lights.ts).
 */
const sceneFire = (foot: number, height: number, width: number): SceneFireLook => ({ height, width, foot, x: 0, z: 0, intensity: 12 })
/**
 * What every fire on the plain shares, the flames folder's: how bright its flame glows, times the torch's colours, the
 * torch glowing as its own, from as bright; and its lamp's colour, the lights' brazier lamp's, or the theme's.
 */
const fireLook = { glow: look.flame.glow, lamp: gooseTheme?.fireLamp ?? 0xff7a28 }
/**
 * Each scene's fire burns the torch's flame (flame.ts), in the fog, standing upright: the brazier by each dead tree in its
 * bowl, the cage's campfire on its logs. Each kind of scene's as its folder sets it, read live: the
 * flame's size, foot, offset off its fire and colours, and its lamp's colour and brightness; each wavering on channels of its own.
 */
const fireLooks: Record<FireScene, SceneFireLook> = {
  tree: sceneFire(TREE_FIRE_BOWL - 0.05, 0.5, 0.28),
  cage: sceneFire(0.24, 1.05, 0.55),
}
/**
 * The fires on the plain, drawn together (flame.ts), in the fog like everything else there, which flame.ts leaves the
 * torch's out of; and a flame for one of them.
 */
const plainFlames = createFlames()
plainFlames.object.traverse((o) => {
  o.castShadow = false
  if (!(o as Mesh).isMesh) return
  const material = (o as Mesh).material as NodeMaterial
  leaveUnshaded(material)
  material.fog = true
})
scene.add(plainFlames.object)
const plainFlame = () => plainFlames.add()
/** Each scene's fire, a flame a scene. */
const sceneFires = (goosePlay?.scenes ?? []).flatMap((owner) => (owner.kind === 'well' ? [] : [{ owner, light: goosePlay!.fireLightOf(owner), fire: plainFlame() }]))
/** The fire pit's flame (goosescenes.ts), on its logs, its light's: the one by each well. */
const pitLight = goosePlay ? spawnTree(goosePlay.plain) : -1
const pitFires = (goosePlay?.wellFires ?? []).map(({ brazier, light }) => ({ brazier, light, fire: plainFlame() }))
const pitFireLook = sceneFire(PIT_BOWL - 0.04, 0.75, 0.42)
/**
 * The burning tree's fires (goosescenes.ts): a flame on each cluster of its crown, each its own size, `crownFireLook`'s
 * times its own share; and one at its foot, a branch fallen burning, where she lights the torch, FOOT_FIRE m off its
 * trunk toward where she starts. Its lamp the crown's.
 */
const crownFireLook = sceneFire(-0.5, 1.9, 1.05)
const footFireLook = sceneFire(0.02, 0.5, 0.34)
const FOOT_FIRE = 0.45
const crownFires: { fire: Flame; size: number; drawnAt: number }[] = []
const crownAt: Vector3[] = []
/** The flames climbing its trunk, from the strike at its foot to its crown, each out on the trunk's side toward the camera. */
const trunkFireLook = sceneFire(-0.1, 0.95, 0.5)
const trunkFires: { fire: Flame; size: number; drawnAt: number }[] = []
const trunkAt: Vector3[] = []
const footFire = pitLight < 0 ? undefined : plainFlame()
/**
 * How often each of the burning tree's flames is drawn again, a second: smooth, never the stop motion's held beats, each
 * on a beat of its own, so only some are drawn a frame. Drawn every frame at 240 Hz, the forty of them cost over 3 ms
 * a frame (2026-10-27), when each flame's shells were laid out on the page; the vertex shader lays them out now.
 */
const TREE_FLAME_RATE = 60
/** How far up the fire's climb the crown's lowest cluster is, 0 the tree's foot to 1 its crown's top. */
const CROWN_FROM = 0.4
/** How far the burning tree is turned, rad. */
const BURNING_TURN = 0.6
/** The burning tree as the dead trees lay it, with them. */
let burningTree: DeadTree | undefined
/** She walks up the road as the opening has her, facing the way she walks. */
function walkIntro() {
  if (!goosePlay || introWalk.length === 0) return
  // The lights as the settings have them, as the play will once it starts: the spawn brazier's strength the panel's.
  goosePlay.place()
  const { at, facing } = walkAt(introWalk, introT)
  Object.assign(goosePlay.holder, at)
  Object.assign(goosePlay.facing, facing)
}
/** Whether the opening has put the goslings where they wait, its last word on them: then the play has them. */
let introSettled = false
/** How to skip the opening, at the foot of the screen while it runs, in the hold hint's hand and key: "hold to skip" by a Space key filling as it is held. */
const SKIP_KEY = 'box-sizing:border-box;font-size:24px;line-height:1.2;padding:1px 14px;border:3px solid #f6ead0;border-radius:11px;background:#0007;box-shadow:0 3px 0 #f6ead099'
const skipHint = introOn ? document.createElement('div') : undefined
const skipFill = document.createElement('div')
if (skipHint) {
  skipHint.style.cssText = 'position:fixed;right:28px;bottom:24px;display:flex;align-items:center;gap:10px;opacity:0;transition:opacity 0.6s;font-family:Gaegu,cursive;font-weight:700;font-size:26px;color:#f6ead0;text-shadow:0 2px 4px #000c;pointer-events:none'
  const space = document.createElement('div')
  space.style.cssText = `${SKIP_KEY};position:relative;overflow:hidden;width:96px;text-align:center`
  skipFill.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:0;background:#e9a23b;opacity:0.6'
  const label = document.createElement('span')
  label.textContent = 'space'
  label.style.position = 'relative'
  space.append(skipFill, label)
  const word = (text: string) => Object.assign(document.createElement('span'), { textContent: text })
  skipHint.append(word('hold to skip'), space)
  document.body.append(skipHint)
}
/** Whether flame `k` of the burning tree is due to be drawn again: at TREE_FLAME_RATE, each flame's beat its own way round the second. Its first drawing at once. */
function treeFlameDue(own: { drawnAt: number }, k: number): boolean {
  const beat = Math.floor(clock * TREE_FLAME_RATE + ((k * 0.618034) % 1))
  if (beat === own.drawnAt) return false
  own.drawnAt = beat
  return true
}
/** The camera's view, the crown's flames out of it left alone. */
const crownView = new Frustum()
const crownMatrix = new Matrix4()
const crownSphere = new Sphere()
/** How far past the burning tree's crown and its flames the camera's view must reach to draw its fire, m. */
const TREE_FIRE_ROOM = 1
/** Whether the strike's flash showed last frame, to lay the night back once it is over. */
let introFlashing = false
const footFireAt = new Vector3()
/** The strike on the burning tree as the opening has it, its bolt and sparks the hollow log's of 2026-10-24, its sparks shorter-lived. */
const introLightning = introOn && pitLight >= 0 ? createLightning(1, { rising: false }) : undefined
if (introLightning) {
  Object.assign(introLightning.look.bolt, { foot: 0xffbb00, top: 0x34a4f9, fade: 8, brightness: 1.3, thickness: 0.15, height: 0.45, jagged: 1.15, seconds: 0.8, drift: 1.05, ease: 7.5 })
  Object.assign(introLightning.look.sparks, { near: 0xff822e, far: 0xff7b00, fade: 4, brightness: 2.6, count: 128, size: 0.055, seconds: 0.55, reach: 4.5, ease: 7.5, fall: 0.6, round: true })
  introLightning.look.flash = 0.73
}
/**
 * A soft light over her and her goslings through the opening, only to lead the eye to them: gentle, a pale
 * pool `height` m over her, coming up over its first `fadeIn` s and gone over its last `fadeOut` s; no shadow from it.
 */
const introLightLook = { show: true, color: 0xdde4ff, intensity: 2, reach: 5, height: 2.6, fadeIn: 1.5, fadeOut: 2 }
const introLight = introOn && fakeLamps ? fakeLamps.track(new FakeLamp(introLightLook.color, 0, introLightLook.reach, 0)) : undefined
if (introLight) {
  introLight.shadows = false
  scene.add(introLight)
}
/** The opening's light over her as the opening has it now, out once it is over. */
function introLightFrame() {
  if (!introLight || !goosePlay) return
  const { show, color, intensity, reach, height, fadeIn, fadeOut } = introLightLook
  const share = Math.min(1, introT / Math.max(fadeIn, 1e-3), (INTRO.end - introT) / Math.max(fadeOut, 1e-3))
  introLight.intensity = show && introRunning() ? intensity * Math.max(0, share) : 0
  if (!(introLight.intensity > 0)) return
  introLight.color.setHex(color)
  introLight.distance = reach
  const { x, z } = goosePlay.holder
  introLight.position.set(x, standAt(x, z) + height, z)
}
const sceneFireFoot = new Vector3()
// The ground laid under each well, where the play stands it.
if (goosePlay) ground.setWells(goosePlay.scenes.filter((s) => s.kind === 'well'))
/** The road as last laid, and the arches over it. */
let roadLaid: ReturnType<typeof roadLine> = { points: [] }
/**
 * How far the hand-laid road is drawn on back past its first point, m, so they come walking up it from out of view in
 * the opening; and that stretch, from its far end to the first point, which no tree or bush stands on.
 */
const ROAD_LEAD_IN = 20
let roadLead: { x: number; z: number }[] = []
let archesLaid: ReturnType<typeof archesOf> = []
/** The walls beside the road as last laid, and as the rats keep out of them. */
let wallsLaid: StoneBlock[] = []
let roadRatWalls: Wall[] = []
/** Where she stood when the rats were last handed the walls nearest her: none yet, or walls laid again since. */
const ratWallsAt = { x: NaN, z: NaN }
/** How far she walks before the rats are handed the walls nearest her again, m: the GPU step reads MAX_WALLS at most. */
const RAT_WALLS_AGAIN = 3
/** The arches' stones on the ground, as big as the ground folder has them, the walls, and the graves, kept out of by her and her goslings. */
const setStones = () =>
  goosePlay?.setStones([...archesLaid.flatMap((arch) => archStones(arch, archLook.scale)), ...roadWallStones(wallsLaid), ...(graves?.footprints() ?? [])])
/** The arches as the road and ground folders last set them: sized, raised and coloured, and their stones with them. */
const archesChanged = () => {
  arches?.set(archLook)
  setStones()
}
/** The arches over the road as last laid, as many as the road folder has them, again on a change to their number. */
const layArches = () => {
  if (!arches || !goosePlay) return
  // None on the ghosts' paths: their doorways would stand in the graveyard.
  archesLaid = archesOf(goosePlay.plain, roadLaid, archLook.count).filter((arch) => !graveyard || !inGraveyard(graveyard, arch, 5))
  arches.lay(archesLaid)
  layWalls()
}
/** The walls beside the road as last laid, as the walls folder has them, clear of the arches, again on every change to it, them or the road. */
function layWalls() {
  if (roadWalls && goosePlay) {
    // None in the graveyard, with room round it: its ghosts walk and she follows them where the walls would be.
    wallsLaid = roadWallsOf(goosePlay.plain, roadLaid, roadWallLook, archesLaid).filter((block) => !graveyard || !block.line.some((p) => inGraveyard(graveyard, p, 1)))
    roadWalls.lay(wallsLaid)
    roadRatWalls = roadWallLines(wallsLaid)
    ratWallsAt.x = NaN
  }
  setStones()
  layTrees()
}
/** The dead trees as last laid: the bushes keep off their trunks. */
let treesLaid: DeadTree[] = []
/**
 * The pond's own woods: trees and bushes either side of a line round it, its shore pushed POND_WOODS_OUT m out, as far
 * as POND_WOODS_BAND m either side of it, so wherever she swims some stand within sight; never in the water or on its
 * bank (`treeGround`), nor in the graveyard.
 */
const POND_WOODS_OUT = 6
const POND_WOODS_BAND = 14
/** How many points the line round the pond is drawn with. */
const POND_WOODS_POINTS = 96
/** The line round the pond its woods stand either side of, closed; none with no pond. */
function pondWoodsLine(): Point[] {
  if (!pondLook) return []
  const line = Array.from({ length: POND_WOODS_POINTS }, (_, j) => {
    const angle = (j / POND_WOODS_POINTS) * Math.PI * 2
    const r = shoreAt(pondLook, angle) + POND_WOODS_OUT
    return { x: pondLook.x + Math.cos(angle) * r, z: pondLook.z + Math.sin(angle) * r }
  })
  return [...line, line[0]!]
}
/** `shape` as the pond's woods scatter it: right up to their line, out to the band, on a seed of their own. */
const pondWoodsShape = (shape: DeadTreeShape): DeadTreeShape => ({ ...shape, clear: 0, band: POND_WOODS_BAND, seed: shape.seed + 50 })
/** Where the pond's woods may stand: where the road's may, off the walls, out of the graveyard, `spacing` m off any of `laid`. */
const pondWoodsGround = (laid: readonly Point[], spacing: number) => (x: number, z: number) =>
  treeGround(x, z) &&
  (!graveyard || !inGraveyard(graveyard, { x, z }, 1)) &&
  wallsLaid.every((wall) => offWay(wall.line, { x, z }) > wall.thick / 2 + 1) &&
  laid.every((p) => Math.hypot(p.x - x, p.z - z) >= spacing)
/** The dead trees as the dead trees folder has them, along the road as last laid, behind its walls and clear of its arches; the bushes again round them. */
/**
 * The opening's view kept clear: no tree by the road stands back down it from where her walk begins, between her and
 * the camera, within `back` m behind her and `side` m either side.
 */
const OPENING_CLEAR = { back: 10, side: 3 }
const inOpeningView = (from: { x: number; z: number }, tree: { x: number; z: number }) =>
  tree.z > from.z && tree.z - from.z < OPENING_CLEAR.back && Math.abs(tree.x - from.x) < OPENING_CLEAR.side
/** Whether `p` stands within `clear` m of the road drawn on back past its first point. */
const onRoadLead = (p: { x: number; z: number }, clear: number) => roadLead.length >= 2 && offWay(roadLead, p) < clear
function layTrees() {
  if (!deadTreesMesh || !goosePlay) return
  deadTreesMesh.object.visible = deadTreeLook.show
  const walkFrom = walkOf(goosePlay.plain.start, goosePlay.plain.road)[0]!
  const byRoad = deadTreeLook.show
    ? deadTrees(goosePlay.plain, roadLaid.points, deadTreesMesh.variants, deadTreeShape, wallsLaid, archesLaid, treeGround).filter((tree) => !inOpeningView(walkFrom, tree) && !onRoadLead(tree, deadTreeShape.clear))
    : []
  const byPond = deadTreeLook.show ? deadTrees(goosePlay.plain, pondWoodsLine(), deadTreesMesh.variants, pondWoodsShape(deadTreeShape), [], archesLaid, pondWoodsGround(byRoad, deadTreeShape.spacing)) : []
  treesLaid = [...byRoad, ...byPond]
  // The burning tree among them, on the spawn's light, as tall as the tallest.
  const variant = treeVariantOf(BURNING_MODEL)
  const spawn = goosePlay.plain.braziers[0]
  burningTree = spawn && !spawn.scene && variant >= 0 ? { x: spawn.x, z: spawn.z, variant, turn: BURNING_TURN, height: deadTreeShape.tallest, width: deadTreeShape.width } : undefined
  if (burningTree) treesLaid = [...treesLaid, burningTree]
  if (burningTree) burningAt.value.set(burningTree.x, burningTree.z)
  deadTreesMesh.lay(treesLaid)
  // Their trunks bodies she and her goslings keep out of; hidden, none.
  goosePlay.setTrunks(treesLaid.map((tree) => ({ at: tree, radius: trunkRadius(tree) })))
  layBushes()
}
/**
 * The island's own bushes, off its middle, m: one either side behind the tent and a small one past the bonfire, clear
 * of the tent, the fire and the goslings' play, as far up from the waterline as the crown leaves room; how tall, m, how
 * much wider than laid, how far turned, rad, and which kind.
 */
const ISLAND_BUSHES = [
  { x: -3.1, z: -1.2, height: 0.9, width: 1.6, turn: 0.4, variant: 1 },
  { x: 2.4, z: -2, height: 1.1, width: 1.9, turn: 2.2, variant: 2 },
  { x: 3.4, z: 0.3, height: 0.75, width: 1.4, turn: 4.1, variant: 3 },
]
/** How far round an island bush the goslings keep, m, of its width. */
const ISLAND_BUSH_KEEP = 0.35
/** The island's bushes as last laid; none with no island. */
let islandBushesLaid: DeadTree[] = []
/** The island's bushes where it now is, each lifted from the floor's ground to the island's. */
function islandBushes(variants: number): DeadTree[] {
  if (!pondLook?.island.show) return []
  const middle = islandMiddle(pondLook)
  return ISLAND_BUSHES.map((bush) => {
    const x = middle.x + bush.x
    const z = middle.z + bush.z
    return { ...bush, x, z, variant: bush.variant % variants, lift: groundOf(pondLook, x, z) - groundAt(x, z) }
  })
}
/** The bushes as the bushes folder has them, scattered as the trees are, off their trunks; and the island's own. */
function layBushes() {
  if (!bushesMesh || !goosePlay) return
  bushesMesh.object.visible = bushLook.show
  islandBushesLaid = bushLook.show ? islandBushes(bushesMesh.variants) : []
  if (!bushLook.show) return bushesMesh.lay([])
  const byRoad = bushes(goosePlay.plain, roadLaid.points, bushesMesh.variants, treesLaid, bushShape, wallsLaid, archesLaid, treeGround).filter((bush) => !onRoadLead(bush, bushShape.clear))
  const byPond = bushes(goosePlay.plain, pondWoodsLine(), bushesMesh.variants, treesLaid, pondWoodsShape(bushShape), [], archesLaid, pondWoodsGround(byRoad, bushShape.spacing))
  bushesMesh.lay([...byRoad, ...byPond, ...islandBushesLaid])
}
/** The old road laid along the play's plain, and its arches over it, again on every change to its way. */
const layRoad = () => {
  if (!goosePlay) return
  roadLaid = roadLine(goosePlay.plain, roadShape)
  const { road } = goosePlay.plain
  const drawn = road && road.length >= 2 ? leadIn(road, ROAD_LEAD_IN) : undefined
  roadLead = drawn ? drawn.slice(0, 2) : []
  ground.setRoad(roadField(drawn ? roadLine({ ...goosePlay.plain, road: drawn }, roadShape) : roadLaid))
  gravesRoad = roadLaid.points
  graves?.set()
  layGravePumpkins()
  layArches()
}
layRoad()
// The goose game's plain runs far past the arena's floor, out to the black: the floor laid under the whole of it, its
// painting read in the world's own coordinates, so a bigger plane changes nothing where the old one was. The pond's
// shore is cut out of it, and its bank, in the floor's material, falls from there to the water (pond.ts).
// Its water depth-tinted, refracting and foaming (water.ts), as the pond folder's water edits it.
const waterLook = defaultWaterLook()
// `?water=1` to `?water=5`: one of the lake looks to try (water.ts) over the default.
const waterAsked = WATER_LOOKS[Number(url.get('water')) - 1]
if (waterAsked) Object.assign(waterLook, waterAsked.look)
const water = goosePlay && (await createWater(waterLook))
const pond =
  goosePlay &&
  pondLook &&
  water &&
  gooseFloorBox &&
  createPond(ground.mesh, gooseFloorBox, pondLook, water.material, (field) => ground.setShore(field), gooseGround)
if (pond) scene.add(pond.object)
// The goose's nest on the island's crown, pine needle cards round a hollow (nest.ts), laid again with the pond.
const nestLook = defaultNestLook()
const nestLeaves = defaultNestLeafLook()
const nestNeedles = defaultNeedleLook()
const nest = pond && pondLook ? createNest(nestLeaves, nestNeedles) : undefined
/** The nest laid again where the island's crown now is, and only with an island. */
function layNest() {
  if (!nest || !pondLook) return
  const at = nestAt(new Vector3())
  nest.set({ ...nestLook, show: nestLook.show && pondLook.island.show }, at.x, at.y, at.z)
}
/** The nest's middle in `out`: off the island's middle as the nest folder has it, on the ground there. */
function nestAt(out: Vector3): Vector3 {
  if (!pondLook) return out.set(0, 0, 0)
  const middle = islandMiddle(pondLook)
  const x = middle.x + nestLook.x
  const z = middle.z + nestLook.z
  return out.set(x, groundOf(pondLook, x, z), z)
}
if (nest) {
  scene.add(nest.object)
  layNest()
}
/**
 * The bonfire on the island: the cage's campfire (goosescenes.ts) burning the cage's flame, and a lamp of its own over
 * it, as the island's bonfire folder places, turns and sizes it; `size` 1 the cage's campfire's own, `flame` its
 * flame's, each apart, the flame's foot on the logs as big as they are.
 */
const islandFireLook = { show: true, x: 2.17, z: 1.64, y: 0, turn: 0, size: 1.24, flame: 0.89, intensity: 12, reach: 7 }
/** The cage's campfire as drawn, a share of the set's own size; its lamp's height over it, CAGE_FIRE_LIGHT's. */
const CAMPFIRE_SIZE = 0.8
const islandFireModel = pondLook && gooseScenes ? gooseScenes.campfire() : undefined
const islandFireFlame = islandFireModel ? plainFlame() : undefined
const islandFireLamp = islandFireModel && fakeLamps ? fakeLamps.track(new FakeLamp(fireLook.lamp, islandFireLook.intensity, islandFireLook.reach, 0)) : undefined
const islandFireScale = islandFireModel?.scale.x ?? 1
if (islandFireModel) scene.add(islandFireModel)
if (islandFireLamp) scene.add(islandFireLamp)
/** Where the bonfire's foot is now: off the island's middle, on the ground there. */
const islandFireAt = new Vector3()
/** The bonfire stood again where the island and its folder have it. */
function layIslandFire() {
  if (!islandFireModel || !pondLook) return
  const middle = islandMiddle(pondLook)
  const x = middle.x + islandFireLook.x
  const z = middle.z + islandFireLook.z
  islandFireAt.set(x, groundOf(pondLook, x, z) + islandFireLook.y, z)
  islandFireModel.position.copy(islandFireAt)
  islandFireModel.rotation.y = (islandFireLook.turn * Math.PI) / 180
  islandFireModel.scale.setScalar(islandFireScale * CAMPFIRE_SIZE * islandFireLook.size)
  islandFireModel.visible = islandFireLook.show && pondLook.island.show
}
layIslandFire()
// The tent on the island's crown (tent.ts), stood again with the pond.
const tent = pond && pondLook ? await createTent() : undefined
if (tent && pondLook) {
  scene.add(tent.object)
  tent.set(pondLook)
}
/** How far above the water a gosling at play keeps to, m, and how far it keeps off the tent and the bonfire, m. */
const PLAY_DRY = 0.01
const PLAY_CLEAR = 0.25
/** The mother goose in the nest and goslings at play in front of the tent (islandgeese.ts), drawn only. */
const nestPlace = new Vector3()
const islandGeese = pondLook && pond
  ? await createIslandGeese(
      {
        shown: () => pondLook.island.show,
        island: () => islandMiddle(pondLook),
        nest: () => nestAt(nestPlace),
        ground: (x, z) => groundOf(pondLook, x, z),
        gooseScale: () => meat.modelScale(),
        free: (x, z) =>
          groundOf(pondLook, x, z) > pondLook.water + PLAY_DRY &&
          (!tent?.object.visible || Math.hypot(x - tent.object.position.x, z - tent.object.position.z) > tent.reach() + PLAY_CLEAR) &&
          (!islandFireModel?.visible || Math.hypot(x - islandFireAt.x, z - islandFireAt.z) > 0.5 * islandFireLook.size + PLAY_CLEAR) &&
          islandBushesLaid.every((bush) => Math.hypot(x - bush.x, z - bush.z) > ISLAND_BUSH_KEEP * bush.width + PLAY_CLEAR),
      },
      goslingSize,
    )
  : undefined
if (islandGeese) scene.add(islandGeese.object)

/**
 * The ending (gooseoutro.ts): once he swims near the island, unless `?outro=0`; its own clock, s, on with the play's,
 * -1 until it starts. Laid out once as it starts, from where they all are, and played to its end, the title staying.
 */
const outroOn = !!goosePlay && !!pondLook && !!islandGeese && url.get('outro') !== '0'
let outroT = -1
const outroRunning = () => outroT >= 0
let outroStage: Stage | undefined
/** His goslings as it starts, those in his circle, in the stage's order. */
let outroBrood: number[] = []
/** The island as it is drawn now, the ending's to read. */
const outroIsland: Island | undefined = pondLook && {
  get middle() {
    return islandMiddle(pondLook)
  },
  shoreAt: (angle) => islandShoreAt(pondLook.island, angle),
}
/** How far ahead of him the last gosling leads him, m, toward the island, out past his body as the camera sees him; and how far off its waterline it keeps. */
const GUIDE_AHEAD = 3.5
const GUIDE_OFF_ISLAND = 1
// The last gosling found leads him on to the island.
if (goosePlay && outroIsland) {
  goosePlay.guideTo = (holder) => {
    const { middle } = outroIsland
    const dx = middle.x - holder.x
    const dz = middle.z - holder.z
    const d = Math.hypot(dx, dz) || 1
    const keep = outroIsland.shoreAt(Math.atan2(-dz, -dx)) + GUIDE_OFF_ISLAND
    const lead = Math.min(GUIDE_AHEAD, Math.max(0, d - keep))
    return { x: holder.x + (dx * lead) / d, z: holder.z + (dz * lead) / d }
  }
}
/** How far the camera's follow looks off him, m: toward the middle of the two of them as the ending goes on. */
const outroAim = { x: 0, z: 0 }
/** The night's lights as the ending starts, to bring the dawn up from. */
let outroNight: DawnLook | undefined
/** The ending started: laid out from where he, the mother and every gosling are now. */
function startOutro() {
  const play = goosePlay!
  outroBrood = play.goslings.flatMap((g, k) => (g?.state === 'circle' || g?.state === 'guiding' ? [k] : []))
  const { mother, motherYaw, goslings: island } = islandGeese!.cast()
  const brood = outroBrood.map((k) => ({ x: play.goslings[k]!.x, z: play.goslings[k]!.z }))
  outroStage = layOutro(outroIsland!, { gander: { ...play.holder }, mother, door: tent?.object.visible ? tent.door() : undefined, motherYaw, island, brood })
  outroNight = dawnLookOf(look)
  outroT = 0
  outroHeard = -1
  gooseSounds?.play('outro')
}
/** He and his goslings where the ending has them, the camera's look with them. */
function walkOutro() {
  const stage = outroStage
  if (!goosePlay || !stage) return
  const { at, facing } = ganderAt(stage, outroT)
  Object.assign(goosePlay.holder, at)
  Object.assign(goosePlay.facing, facing)
  outroBrood.forEach((k, i) => Object.assign(goosePlay.goslings[k]!, planAt(stage.brood[i]!, outroT).at))
  const aim = aimOf(outroT)
  outroAim.x = (stage.pair.x - at.x) * aim
  outroAim.z = (stage.pair.z - at.z) * aim
}
/** The island's geese as the ending has them, or nothing before it. */
function outroCue(): IslandCue | undefined {
  const stage = outroStage
  if (!stage) return undefined
  return { mother: motherAt(stage, outroT), goslings: stage.island.map((_, j) => goslingOf(stage, false, j, outroT)) }
}
/** What his gosling `k` does in the ending, shaking dry or hopping, and the way it faces standing, if anything. */
function outroAct(k: number) {
  const i = outroBrood.indexOf(k)
  return outroStage && i >= 0 ? goslingOf(outroStage, true, i, outroT) : undefined
}
/** The lights the dawn brings up: the low sun, the sky's fill, and the fires', the torch's among them, dying down. */
interface DawnLook {
  sun: { color: number; intensity: number; x: number; y: number; z: number; shadowColor: number; darkness: number }
  fill: { sky: number; ground: number; intensity: number }
  lamp: { intensity: number }
  fires: number
}
/** The dawn: a low peach sun on the same side as the moon was, a rose sky, the fires a third of their night's. */
const DAWN: DawnLook = {
  sun: { color: 0xffc08a, intensity: 3.4, x: -28, y: 13, z: 27, shadowColor: 0x6a4a6a, darkness: 0.5 },
  fill: { sky: 0xffd2c8, ground: 0x4a3a40, intensity: 1.3 },
  lamp: { intensity: 2.5 },
  fires: 0.35,
}
const dawnLookOf = (from: typeof look): DawnLook => ({
  sun: { color: from.sun.color, intensity: from.sun.intensity, x: from.sun.x, y: from.sun.y, z: from.sun.z, shadowColor: from.sun.shadowColor, darkness: from.sun.darkness },
  fill: { sky: from.fill.sky, ground: from.fill.ground, intensity: from.fill.intensity },
  lamp: { intensity: from.lamp.intensity },
  fires: 1,
})
const dawnFrom = new Color()
const dawnTo = new Color()
/** How much of their night's light the fires give now, as the dawn comes up. */
let firesLeft = 1
/** The dawn brought up `share` of the way from the night it started at: into the look, and the lights set from it. */
function dawnFrame(share: number) {
  if (!outroNight) return
  const mixed = (a: number, b: number) => dawnFrom.setHex(a).lerp(dawnTo.setHex(b), share).getHex()
  const between = (a: number, b: number) => a + (b - a) * share
  const night = outroNight
  Object.assign(look.sun, {
    color: mixed(night.sun.color, DAWN.sun.color),
    intensity: between(night.sun.intensity, DAWN.sun.intensity),
    x: between(night.sun.x, DAWN.sun.x),
    y: between(night.sun.y, DAWN.sun.y),
    z: between(night.sun.z, DAWN.sun.z),
    shadowColor: mixed(night.sun.shadowColor, DAWN.sun.shadowColor),
    darkness: between(night.sun.darkness, DAWN.sun.darkness),
  })
  Object.assign(look.fill, { sky: mixed(night.fill.sky, DAWN.fill.sky), ground: mixed(night.fill.ground, DAWN.fill.ground), intensity: between(night.fill.intensity, DAWN.fill.intensity) })
  look.lamp.intensity = between(night.lamp.intensity, DAWN.lamp.intensity)
  firesLeft = between(night.fires, DAWN.fires)
  sun.color.set(look.sun.color)
  sun.intensity = look.sun.intensity
  sun.shadow.intensity = look.sun.darkness
  sunShadowColor.value.set(look.sun.shadowColor)
  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity
  lamp.intensity = light.on ? look.lamp.intensity : 0
}
/** The night fading out at the ending's end, and the game's title over it, in the hints' hand. */
const outroCard = outroOn ? document.createElement('div') : undefined
const outroTitle = outroOn ? document.createElement('div') : undefined
if (outroCard && outroTitle) {
  outroCard.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000;opacity:0;pointer-events:none;z-index:20'
  outroTitle.style.cssText = 'font-family:Gaegu,cursive;font-weight:700;font-size:min(13vw,128px);color:#f6ead0;opacity:0'
  outroTitle.textContent = 'A Goose Tale'
  outroCard.append(outroTitle)
  document.body.append(outroCard)
}
/** The ending a frame on: the dawn, the fade and the title. */
function outroFrame() {
  if (!outroRunning()) return
  dawnFrame(dawnOf(outroT))
  if (outroCard) outroCard.style.opacity = String(fadeOf(outroT))
  if (outroTitle) outroTitle.style.opacity = String(titleOf(outroT))
}
/** The swarm's lights with the dawn's first: reaching out from the two of them as it comes up, the rats draining off out of it. */
function withDawn(lights: FixedLight[]): FixedLight[] {
  if (!outroStage) return lights
  const reach = DRAIN * dawnOf(outroT)
  return reach > 0 ? [{ x: outroStage.pair.x, z: outroStage.pair.z, reach, on: true }, ...lights] : lights
}
// The bed under the pond's water takes less light, as deep as the water lies.
ground.setWaterLevel(pondLook.water)
const walls = createBlockout(level)
scene.add(walls.object)
/** How high she stands at (x, z): on the ground, down the pond's bank and into its water, afloat where it is too deep (pond.ts). */
const standAt = (x: number, z: number) => groundAt(x, z) + standingIn(pondLook, x, z, pondLook.goose)

/**
 * DEBUG: where things are done, as rings on the ground: orange, a flame's dip, or a scene's fire's zone, the interact
 * key held to fill the torch; red, where the interact key works a scene, the well's
 * winch, the dead tree's trunk, the cage and its key. `?zones`, or the run folder's switch.
 */
const refillZones = { show: url.has('zones') || url.has('refill') }

/** Her fall: the dark closing the rest of the way over the dark folder's `finish` s, her torch dying under it, then black DARK_HELD s, then she wakes. */
const DARK_HELD = 0.3
/** How her life's dark looks: the dark folder's. */
const darkLook = defaultDark()
goosePlay.settings.fall = { lasts: darkLook.finish + DARK_HELD, dims: darkLook.finish }
const refillRings = new Group()
scene.add(refillRings)
const dipRing = new MeshBasicNodeMaterial({ color: 0xff8a2a, fog: false, depthWrite: false })
/** A flat ring `radius` m round, its band a few centimetres wide, in `material`. */
const refillRing = (radius: number, material: MeshBasicNodeMaterial) => {
  const ring = new Mesh(new RingGeometry(Math.max(0, radius - 0.05), radius, 64).rotateX(-Math.PI / 2), material)
  ring.renderOrder = 10
  refillRings.add(ring)
  return ring
}
const dipRings = level.lights.map(() => refillRing(1, dipRing))
const workRing = new MeshBasicNodeMaterial({ color: 0xff2a2a, fog: false, depthWrite: false })
const workRings = goosePlay.scenes.map(() => refillRing(1, workRing))
const keyRings = goosePlay.scenes.flatMap((s) => (s.kind === 'cage' ? [refillRing(1, workRing)] : []))
/** Each scene's fire's light, by its index, to the scene: its dip drawn as its own zone. */
const fireOwners = new Map(sceneFires.map(({ owner, light }) => [light, owner]))
/** The rings where the torch is filled now: every lit flame's dip. */
function refillZonesFrame(placed: readonly FixedLight[]) {
  refillRings.visible = refillZones.show
  if (!refillZones.show) return
  placed.forEach((light, k) => {
    const ring = dipRings[k]!
    const own = level.lights[k]!
    ring.visible = own.flame && light.on
    if (!ring.visible) return
    const owner = fireOwners.get(k)
    const zone = owner ? goosePlay!.fireZoneOf(owner) : { x: light.x, z: light.z, rx: runTuning.dip + (own.pad ?? 0), rz: runTuning.dip + (own.pad ?? 0) }
    ring.scale.set(zone.rx, 1, zone.rz)
    ring.position.set(zone.x, standAt(zone.x, zone.z) + 0.03, zone.z)
  })
  goosePlay?.scenes.filter((s) => s.kind === 'cage').forEach((cage, c) => {
    if (cage.kind !== 'cage') return
    const { x, z, rx, rz } = goosePlay.keyZoneOf(cage)
    keyRings[c]!.scale.set(rx, 1, rz)
    keyRings[c]!.position.set(x, standAt(x, z) + 0.03, z)
  })
  goosePlay?.scenes.forEach((s, k) => {
    const { x, z, rx, rz } = goosePlay.zoneOf(s)
    workRings[k]!.scale.set(rx, 1, rz)
    workRings[k]!.position.set(x, standAt(x, z) + 0.03, z)
  })
}

const wind = createWind(level.wind)
scene.add(wind.object)
if (introLightning) scene.add(introLightning.object)
/** The run's walls and its starts as the swarm and the lit areas last had them: a gate opened or shut, or the run started again, since. */
let wallsSeen = run.wallsVersion
let startsSeen = run.starts
/** Where the see-through's hole is cut round: the holder, at its chest. */
const seeThroughAt = new Vector3()
// The torch's lamp lights only what the torch sees: its lamp's shadow is its lit area, the walls alone cutting it,
// its own falloff ending it. Under `?shadows`, the lamp's own cube of shadows as well. In the goose game no light but the
// sun casts or is cut (2026-10-21): the plain has no walls to cut a light, and the cut cost every rat's pixel a turn and
// two texture reads a light, about 1.2 ms of a 7 ms frame at 8,000 rats on a screen twice the pixels.
const torchCentre = uniform(new Vector2(light.x, light.z))
const torchSees = litMask(seen.texture, int(0), torchCentre, uniform(0), swarmTime)
lamp.castShadow = false
lamp.shadow.shadowNode = settings.shadows ? torchSees.mul(pointShadow(lamp) as unknown as Node<'float'>) : torchSees

/** The swarm, the goose play's, made on its ground (playSwarm). */
const swarm = goosePlay.swarm
// Their buffers freed when the page leaves for good, the step's with them; one kept for going back to holds them.
addEventListener('pagehide', (event) => {
  if (event.persisted) return
  rats.dispose()
  if (swarm instanceof GpuSwarm) swarm.dispose()
})
rats.setSize(settings.size)
rats.setSizeBySpeed(settings.sizeBySpeed)
scene.add(rats.object)
// The goose and her goslings shadow the fire she stands in, away from its flame, on the ground (fireshadow.ts): a
// projector's mask of them, drawn every frame, the floor's shader reading it.
const fireShadowLook = defaultFireShadowLook()
const fireShadow = createFireShadow(renderer, fakeLamps, fireShadowLook, [ground.mesh])
const fireCasters = [meat.object, ...(goslings ? [goslings.object] : [])]
const gooseMiddle = new Vector3()
function layFireShadows(): void {
  if (!fireShadow) return
  meat.object.getWorldPosition(gooseMiddle)
  const ground = groundAt(gooseMiddle.x, gooseMiddle.z)
  gooseMiddle.y = ground + look.meat.height * 0.5
  fireShadow.update(drawnInScene(meat.object) ? fireCasters : [], gooseMiddle, look.meat.height, ground)
}
// The panel starts each part at the colour the model was made in.
look.rats.parts = rats.parts.map((part) => ({ ...part }))
for (const part of look.rats.parts) if (part.name === 'eyes') part.color = gooseTheme?.eyes ?? GOOSE_EYES

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
const shadowed = { version: -1, steps: -1, held: Number.NaN, sun: new Vector3(Number.NaN), lamp: new Vector3(Number.NaN), at: -Infinity, dirty: true }
/** How often the shadows are drawn again while the intro holds the swarm, ms: as often as the swarm steps once it goes. */
const HELD_SHADOW_MS = 1000 / 60

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
  sunShadowColor.value.set(look.sun.shadowColor)

  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity * flicker(3)

  fogColor.value.set(look.fog.color)
  skyHorizon.value.set(look.fog.horizon ?? look.fog.color)
  skyBand.value = Math.sin((Math.max(look.fog.band ?? 15, 1) * Math.PI) / 180)
  sky.set(look.fog.color)
  skyChanged()
  fogEdge = Math.max(look.fog.far, look.fog.near + 0.5)
  fogNear.value = look.fog.near
  fogFar.value = fogEdge
  fogDensity.value = Math.max(look.fog.density, 1)
  fogWisp.value = look.fog.wisp
  fogScale.value = Math.max(look.fog.scale, 0.1)
  fogDrift.value = look.fog.drift
  fogLit.value = look.fog.lit ?? 0
  fogLitColor.value.set(look.fog.litColor ?? 0)
  fogLitSpread.value = look.fog.litSpread ?? 1

  rats.material.color.set(look.rats.color)
  rats.material.set(look.rats)
  rats.material.setToon(look.rats.toon)
  rats.material.setPaint(look.rats.paint)
  rats.material.setBeat(shade(5), nudge(6), nudge(7))
  look.rats.parts.forEach((part, i) => rats.setPartColor(i, part.color))
  rats.setVariants(look.rats.variants)
  rats.setGlow('eyes', look.rats.glow)
  rats.setLevels(look.rats.levels)
  // The far crowd's staggered steps: the swarm's tuning steps by them (the CPU step's alone), the rats tint by them.
  tuning.stagger = look.rats.stagger.n
  tuning.staggerFrom = look.rats.stagger.from
  rats.setStagger(look.rats.stagger)
  // The trails: on the beat a held frame's streak; smooth, a streak laid again every frame, and wiggling.
  rats.setTrails({ ...look.trails, wiggle: stop.enabled ? 0 : look.trails.wiggle })
  ground.set(look.floor)
  deadTreesMesh?.setGrass(deadTreeGrass, look.floor)
  ground.material.set(look.floor.shell)
  ground.material.setPaint(look.floor.paint)
  ground.material.setToon(look.floor.toon)
  meat.set(look.meat)
  // The goslings' down the goose's white, glowing as hers does.
  const white = look.meat.parts.find((part) => part.glow !== undefined)
  if (goslings && white) goslings.setDown(white.color, white.glow!)
  if (islandGeese && white) islandGeese.setDown(white.color, white.glow!)
  // Their rim hers.
  goslings?.setRim(look.meat)
  islandGeese?.setRim(look.meat)
  gooseScenes?.setShell(look.meat)
  graves?.setShell(look.meat)
  tent?.setShell(look.meat)
  // The dead trees in the scenes' shell, with a highlight and a rim of their own: none of either to start, matt, as the
  // user asked on 2026-10-26, the dead trees folder's to give them.
  deadTreesMesh?.setShell({ ...look.meat, ...deadTreeShine })
  bushesMesh?.setShell(look.meat)
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
  // The deep output drawn for the tilt's band too; the glow, a bright point's lit disc, the depth of field's alone.
  const depthOn = look.dof.enabled && quality.step.dof
  // With the cheap halo, the tilt's blur spreads them too, by its own glow.
  const blurGlow = look.bloom.enabled && look.bloom.cheap ? look.bloom.blurGlow : 0
  const dof = { ...look.dof, enabled: depthOn || !!tilt?.look.enabled, glow: depthOn ? look.dof.glow : blurGlow }
  post.set({ ao, outline: look.outline, hatch: look.hatch, palette: look.palette, grain: look.grain, vignette: look.vignette, screen: look.screen, dof, bloom: look.bloom })
  // No fog, for now: its ring pushed out of reach, as the bare simulation's is.
  if (!look.fog.enabled) {
    fogNear.value = 1e6
    fogFar.value = 1e6 + 1
  }
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

// ?stop=0 plays the full look smooth, for filming: no stop motion, and nothing else changed; ?stop=1 holds it on the beat.
if (url.has('stop')) look.stopMotion.enabled = url.get('stop') !== '0'
// On WebGL 2 the motion is smooth to start (2026-10-16); `?stop=1` asks for stop motion there.
else if (backend !== 'WebGPU') look.stopMotion.enabled = false

// Switches for measuring on a phone, where the panel covers the readouts:
// ?nopanel, ?dpr=1, ?ao=0, ?dof=0, ?bloom=0, and ?post=0 for every effect after the scene.
const post0 = url.get('post') === '0'
if (post0 || url.get('ao') === '0') look.ao.enabled = false
if (post0 || url.get('dof') === '0') look.dof.enabled = false
if (post0 || url.get('bloom') === '0') look.bloom.enabled = false
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
const adapt = url.get('adapt') !== '0' && !['ao', 'dof', 'bloom', 'dpr', 'post'].some((key) => url.has(key))
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

// In the goose game F, a debug key, gives the torch a light that never burns down, held full each frame; and puts it out
// again for real, its fuel gone, so nothing holds the rats off her circle until a fire fills it. Taken here first, before the panel's own F, which only hides the light from the rats. 0 to 5 on the
// top row, debug keys too, as on the 2D page, stand her back where she starts, by the well's zone, the dead tree's, the
// cage's and, on 5, the pond; on 6 in the water just off its island, facing it. Any other number, or 0 to 5 on the keypad, gives her that many goslings at
// once, 0 none (the key's place, so the AZERTY row needs no shift).
/** The goose game's torch held full each frame, its F debug key's. */
let torchEverlasting = false
addEventListener(
  'keydown',
  (event) => {
    if (event.repeat || !settings.debug || event.target instanceof HTMLInputElement) return
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)
    if (event.code === 'KeyF') run.fuel = (torchEverlasting = !torchEverlasting) ? 1 : 0
    else if (event.code === 'KeyK' && goosePlay && !goosePlay.down) {
      // K: her life gone where she stands, as if bitten away, to try her death.
      goosePlay.life = 0
      goosePlay.bittenAt = goosePlay.t
    }
    else if (event.code === 'Digit0') goosePlay?.standAtStart()
    else if (event.code === 'Digit1') goosePlay?.standBy('well')
    else if (event.code === 'Digit2') goosePlay?.standBy('tree')
    else if (event.code === 'Digit3') goosePlay?.standBy('cage')
    else if (event.code === 'Digit5') goosePlay?.standByPond()
    else if (event.code === 'Digit6' && pondLook && goosePlay) {
      // ISLAND_BY m off the island's waterline on the camera's side (+z), facing it.
      const middle = islandMiddle(pondLook)
      const { holder, facing } = goosePlay.run
      holder.x = middle.x
      holder.z = middle.z + islandShoreAt(pondLook.island, Math.PI / 2) + ISLAND_BY
      facing.x = 0
      facing.z = -1
    }
    else if (event.code === 'Digit4' && graveyard && goosePlay) {
      // PROTOTYPE: at the graveyard's entrance, facing in.
      const { holder, facing } = goosePlay.run
      holder.x = graveyard.entrance.x
      holder.z = graveyard.entrance.z
      facing.x = graveyard.entrance.facing.x
      facing.z = graveyard.entrance.facing.z
    }
    else if (digit) goosePlay?.giveGoslings(Number(digit[1]))
    else return
    event.preventDefault()
    event.stopImmediatePropagation()
  },
  { capture: true },
)
// The crowd folder edits the swarm's own tuning: the next step reads it.
if (fallingLeaves && !url.has('nopanel')) mountFallControls(fallingLeaves)
/**
 * How far behind the light the camera's follow runs, s: in the goose game, longer, a lazier glide after her, and set
 * on the panel's camera folder.
 */
const cameraFollow = { lag: goosePlay ? GOOSE_CAMERA_FOLLOW : CAMERA_FOLLOW }
/** The camera's field of view, degrees, as the panel's camera folder sets it. */
const gooseLens = {
  get fov() {
    return camera.fov
  },
  set fov(degrees: number) {
    camera.fov = degrees
    camera.updateProjectionMatrix()
  },
  ortho: false,
  orthoChanged: () => setOrtho(gooseLens.ortho),
}
/**
 * TEST: a near orthographic camera, as the panel's switch asks: not an orthographic camera, which every pass, the rats'
 * cull and the hints would have to learn, but a long lens from far off: ORTHO_FOV degrees, backed off so she stays the
 * size she was, the clip planes kept round her (orthoFrame) for the depth's sake. Off, the lens and distance as they were.
 */
const ORTHO_FOV = 2
const ORTHO_DEPTH = 80
const unOrtho = { fov: CAMERA_FOV, minDistance: 0.5, maxDistance: 80 }
function setOrtho(on: boolean) {
  const offset = new Vector3().subVectors(camera.position, controls.target)
  const half = (fov: number) => Math.tan((fov * Math.PI) / 360)
  const to = on ? ORTHO_FOV : unOrtho.fov
  if (on) Object.assign(unOrtho, { fov: camera.fov, minDistance: controls.minDistance, maxDistance: controls.maxDistance })
  offset.multiplyScalar(half(camera.fov) / half(to))
  camera.position.copy(controls.target).add(offset)
  controls.minDistance = on ? unOrtho.minDistance * (half(unOrtho.fov) / half(to)) : unOrtho.minDistance
  controls.maxDistance = on ? unOrtho.maxDistance * (half(unOrtho.fov) / half(to)) : unOrtho.maxDistance
  if (!on) {
    camera.near = 0.1
    camera.far = 100
  }
  gooseLens.fov = to
}
/** The clip planes round her while the lens is near orthographic, as far off as the camera now is. */
function orthoFrame() {
  if (!gooseLens.ortho) return
  const distance = camera.position.distanceTo(controls.target)
  camera.near = Math.max(0.1, distance - ORTHO_DEPTH)
  camera.far = distance + ORTHO_DEPTH
  camera.updateProjectionMatrix()
}
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
    tuning.fleeMinSpeed = settings.fleeMinSpeed
    tuning.fleeMaxSpeed = settings.fleeMaxSpeed
  },
  animation() {
    rats.setSpeed(settings.runAnimation)
  },
  light() {
    if (torchChanged()) lookChanged()
  },
  shadows: shadowsChanged,
  look: lookChanged,
  floor() {
    copyInto(look.floor, FLOOR_LOOKS[look.floor.texture])
  },
}, {
  tuning: runTuning,
  level,
  // The goose game's dark, and its rats' seed: a new seed sets the rats down afresh, the page loaded again on it.
  goose: {
    settings: goosePlay.settings,
    refillZones,
    dark: darkLook,
    introLight: introLight && introLightLook,
    // The pond folder lays the pond again on every change.
    pond: pondLook && { look: pondLook, changed: () => {
        pond?.set(pondLook)
        layNest()
        tent?.set(pondLook)
        layIslandFire()
        // The trees and bushes out of the water as it lies now, its own woods round it.
        layTrees()
        ground.setWaterLevel(pondLook.water)
        goosePlay.setWater(pondWater(pondLook))
      }, water: waterLook, waterChanged: () => water?.set(waterLook), bed: bedLook, bedChanged: () => ground.setBed(bedLook), nest: nest && { look: nestLook, changed: layNest, needles: nestNeedles, needlesChanged: () => nest.setNeedles(nestNeedles), leaves: nestLeaves, leavesChanged: () => nest.setLeaves(nestLeaves) }, tent: tent && { look: tent.look, changed: () => tent.set(pondLook), recolour: tent.recolour, shineChanged: tent.shineChanged }, bonfire: islandFireModel && { look: islandFireLook, changed: layIslandFire }, geese: islandGeese?.look },
    // The ground folder lays the plain's swells again on every change: the grid in place, the rats' copy, the floor.
    ground: gooseGround && goosePlain && pondPlace && pondLook && { look: rollingLook, changed: () => {
        rollAgain(gooseGround, goosePlain, pondPlace, rollingLook)
        rats.groundChanged()
        pond?.set(pondLook)
        // The arches and the walls stood on the ground as it rolls now.
        arches?.set(archLook)
        roadWalls?.lay(wallsLaid)
        layTrees()
      }, arches: arches && { look: archLook, changed: archesChanged } },
    // The doors, the road's arches: their stone and their own toon shell.
    doors: arches && { stone: archStone, stoneChanged: () => arches.setStone(archStone), shell: archShell, shellChanged: archesShell },
    // The walls beside the road: their kind, number, place and size, laid again on every change; their stone and toon shell.
    walls: roadWalls && {
      look: roadWallLook,
      changed: layWalls,
      stone: wallStone,
      stoneChanged: () => roadWalls.setStone(wallStone),
      shell: wallShell,
      shellChanged: () => roadWalls.setShell(wallShell),
    },
    // The dead trees: shown or not and their wood, and how they are scattered, again on every change.
    trees: deadTreesMesh && {
      look: deadTreeLook,
      shape: deadTreeShape as DeadTreeShape,
      changed: layTrees,
      woodChanged: () => deadTreesMesh.setWood(deadTreeLook.wood, deadTreeLook.saturation),
      yChanged: () => deadTreesMesh.object.position.setY(deadTreeLook.y),
      trunkChanged: () => {
        deadTreesMesh.setTrunk(deadTreeLook.trunk)
        deadTreesMesh.setRings(deadTreeLook.rings)
      },
      bark: deadTreeBark,
      barkChanged: () => deadTreesMesh.setBark(deadTreeBark),
      grass: deadTreeGrass,
      grassChanged: () => deadTreesMesh.setGrass(deadTreeGrass, look.floor),
      leaves: deadTreesMesh.leaves ? deadTreeLeaves : undefined,
      leavesChanged: () => {
        deadTreesMesh.setLeaves(deadTreeLeaves)
        leavesFallAsTrees()
      },
      wind: deadTreeWind,
      windChanged: () => deadTreesMesh.setWind(deadTreeWind),
      shine: deadTreeShine,
      shineChanged: lookChanged,
    },
    // The bushes: shown or not and their leaves, and how they are scattered, again on every change.
    bushes: bushesMesh && {
      look: bushLook,
      shape: bushShape as DeadTreeShape,
      changed: layBushes,
      leaves: bushLeaves,
      leavesChanged: () => bushesMesh.setLeaves(bushLeaves),
      yChanged: () => bushesMesh.object.position.setY(bushLook.y),
    },
    // The goslings' clip speeds, read live.
    goslings: goslingSpeeds,
    // Their height, read live.
    goslingSize: goslings ? goslingSize : undefined,
    // The old road: its way laid again on a change, its look read live.
    road: ROAD
      ? {
          shape: roadShape,
          shapeChanged: layRoad,
          look: roadLook,
          changed: () => ground.setRoadLook(roadLook),
          arches: arches && { look: archLook, countChanged: layArches },
        }
      : undefined,
    // How far the spawn's brazier holds the rats off, if the plain starts by one.
    spawn: pitLight < 0 ? undefined : goosePlay.settings,
    // Every fire's own size, place and lamp, in the flames folder with the look they share, read live.
    fires: {
      look: fireLook,
      shadows: fakeLamps && { look: fireShadowLook },
      each: [
        { name: "dead tree's brazier", look: fireLooks.tree, lamp: true, offset: true },
        { name: "cage's campfire", look: fireLooks.cage, lamp: true, offset: true },
        { name: 'fire pit', look: pitFireLook, lamp: true },
        { name: 'burning tree crown', look: crownFireLook, lamp: true },
        { name: 'burning tree trunk', look: trunkFireLook },
        { name: 'burning tree foot', look: footFireLook },
      ],
    },
    // The well's colours, a material at a time.
    well: gooseScenes && { colours: gooseScenes.wellColours, glows: gooseScenes.wellGlows, changed: gooseScenes.wellChanged, bucket: gooseScenes.bucketOffset, zone: goosePlay.settings.winchZone, fire: goosePlay.settings.wellFire, reach: goosePlay.settings, ground: { look: wellGroundLook, changed: () => ground.setWellGround(wellGroundLook) }, shine: { look: gooseScenes.wellShine, changed: lookChanged }, pit: { look: gooseScenes.pitLook, changed: gooseScenes.pitChanged, shine: gooseScenes.pitShine, shineChanged: lookChanged } },
    // The dead tree's colour, size and perch, read live; where she calls its gosling down, and where it lands; its brazier's
    // place, its flame and lamp, where she fills her torch at it and how far it holds the rats.
    tree: gooseScenes && { look: gooseScenes.tree, zone: goosePlay.settings.treeZone, jump: goosePlay.settings, fire: { at: goosePlay.settings.treeFire, ...sceneFirePanel('tree') } },
    // The cage: where she opens it, where its key lies by the body and where she picks it up; its campfire's place, flame and lamp,
    // where she fills her torch at it and how far it holds the rats.
    cage: { zone: goosePlay.settings.cageZone, hold: goosePlay.settings, key: { zone: goosePlay.settings.keyZone, beside: goosePlay.settings.keyBeside, inWing: gooseScenes?.keyInWing, bones: RIGHT_WING }, fire: { at: goosePlay.settings.cageFire, ...sceneFirePanel('cage') }, look: gooseScenes?.cage, colours: gooseScenes && { colours: gooseScenes.cageColours, glows: gooseScenes.cageGlows, changed: gooseScenes.cageChanged }, shine: gooseScenes && { cart: gooseScenes.cartShine, skull: gooseScenes.skullShine, changed: lookChanged }, wood: gooseScenes && { look: gooseScenes.cartWood, changed: gooseScenes.cartWoodChanged } },
    // The camera: its follow's lag; where it is from her, captured to the clipboard and kept for the next load.
    // The see-through round her: its hole and its noise, read live.
    seeThrough: gooseSee && { look: gooseSeeLook, changed: () => gooseSee.set(gooseSeeLook) },
    camera: { follow: cameraFollow, lens: gooseLens, capture: () => captureGooseCamera(), forget: () => localStorage.removeItem(GOOSE_CAMERA_KEPT) },
    reseed(seed) {
      url.set('seed', String(seed))
      location.search = url.toString()
    },
  },
  // The goose game never starts again: its start is the page loaded again.
  startAt: () => location.reload(),
}, tilt && {
  shift: tilt,
  // The diorama's camera put in place, or the kept one back, as the tilt's folder moves it or turns it off.
  placed() {
    setGooseCamera(gooseCamera, false)
    gooseLens.fov = keptGooseCamera()?.fov ?? CAMERA_FOV
    controls.update()
  },
})
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
    look.bloom.enabled ? '' : 'no bloom',
    post0 ? 'no post' : '',
    quality.step.rats < 1 ? `rats x${quality.step.rats}` : '',
    // Rats in view at each level of detail, and each level's triangles.
    rats.levels.length > 0 && look.rats.levels.on ? `levels ${rats.levels.map(({ drawn, triangles }) => `${drawn} x ${triangles}`).join(' / ')} tris` : '',
    `torch ${Math.round(run.fuel * 100)}%`,
    `light ${goosePlay.left.toFixed(1)} s · goslings ${goosePlay.circle}`,
  ]
    .filter(Boolean)
    .join(' · '),
)

// ---------------------------------------------------------------- keys
// WASD or the arrows walk the holder, as the camera sees the ground: up the
// screen is -z. The holder walks only while a key is held. Space is the
// interact key. Q and E, debug keys, turn the torch's reach up and down while
// held, as its slider does.
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
    // In the opening, Space held skips it, and never reaches the play.
    if (introRunning() && event.code === INTERACT) {
      event.preventDefault()
      skipHeld = true
      return
    }
    if (!(event.code in KEYS) && !(event.code in DIAL) && event.code !== INTERACT) return
    // A panel button last clicked keeps the focus, and Space would press it.
    if (event.code === INTERACT && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    event.preventDefault()
    pressed.add(event.code)
  },
  { capture: true },
)
addEventListener(
  'keyup',
  (event) => {
    pressed.delete(event.code)
    if (event.code === INTERACT) skipHeld = false
  },
  { capture: true },
)
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
// The chase camera: a click locks the pointer, and the pointer then turns the camera round her, up and down as far as
// the orbit goes: the drag does not. Escape lets it go.
/** The goose game's camera, and whether it turns on the locked pointer, as all but the orbit do. */
let gooseCamera: GooseCamera = 'fixed'
/** The pointer's place on the screen, -1 to 1 across and down; the fixed camera's parallax as now slid, m. */
const pointerShare = { x: 0, y: 0 }
const parallax = new Vector3()
const parallaxAcross = new Vector3()
const parallaxWanted = new Vector3()
const parallaxStep = new Vector3()
let chasing = false
const orbit = new Spherical()
const orbitOffset = new Vector3()
renderer.domElement.addEventListener('click', () => {
  if (chasing && document.pointerLockElement !== renderer.domElement) void renderer.domElement.requestPointerLock()
})
addEventListener('mousemove', (event) => {
  // A shot in holds the orbit where it was, to hand back to.
  if (!chasing || document.pointerLockElement !== renderer.domElement || shotIn()) return
  orbit.setFromVector3(orbitOffset.copy(camera.position).sub(controls.target))
  orbit.theta -= event.movementX * LOOK_SPEED
  orbit.phi = Math.min(controls.maxPolarAngle, Math.max(0.15, orbit.phi - event.movementY * LOOK_SPEED))
  camera.position.copy(controls.target).add(orbitOffset.setFromSpherical(orbit))
})

/**
 * Up the screen along the ground as the keys read it: the drawn camera's
 * forward, but while a shot is in, as of the last frame no key was held, so a
 * shot cutting in or out never turns a key already held; and the drawn
 * camera's forward, last frame.
 */
const keysForward = { x: 0, z: -1 }
const drawnForward = { x: 0, z: -1 }

/**
 * A point a metre past the light the way the held keys point, as the camera
 * sees the ground wherever it is turned, or null when none do.
 */
function heading(): { x: number; z: number } | null {
  let x = 0
  let z = 0
  let held = false
  for (const code of pressed) {
    if (!(code in KEYS)) continue
    x += KEYS[code][0]
    z += KEYS[code][1]
    held = true
  }
  if (!held || !shotIn()) {
    keysForward.x = drawnForward.x
    keysForward.z = drawnForward.z
  }
  // Up the screen is the camera's forward along the ground; right is to its right.
  const fx = keysForward.x
  const fz = keysForward.z
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
/** Whether a circle of `radius` m round (x, z) comes within `reach` m of her, where she is drawn. */
const within = (x: number, z: number, radius: number, reach: number) => Math.hypot(x - shown.x, z - shown.z) - radius < reach
/** The camera's follow owed since it last moved, s, while the stop motion holds the camera. */
let owed = 0
/** Where the lamp hangs: easing after the light's shown place by the lamp's lag, the held frames' worth of it on the beat. */
const lampAt = { x: light.x, z: light.z }
let lampOwed = 0
/** The light's own pace, m/s, as of the last frame: the meat runs by it. */
const lightPace = { x: 0, z: 0, wasX: light.x, wasZ: light.z }
/** How high she stands, m: easing after the ground under her, so a step up is a step, not a jump. */
let stood = Number.NaN
const STAND_EASE = 0.08
/** The camera's view, as the dead trees and bushes are culled to it. */
const plantsView = new Frustum()
const plantsMatrix = new Matrix4()
/** The way to the sun, as the dead trees and bushes are kept for the shadows they throw into the view. */
const plantsSunward = new Vector3()
const viewSphere = new Sphere()
/** Whether the ground round (x, z), `radius` m out, is in the camera's view as last laid; or round (x, y, z), given `y`. */
const inView = (x: number, z: number, radius: number, y = groundAt(x, z)) => plantsView.intersectsSphere(viewSphere.set(viewSphere.center.set(x, y, z), radius))
if (goslings) goslings.seen = (x, y, z) => inView(x, z, GOSLING_SEEN, y)
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
  const under = standAt(shown.x, shown.z)
  stood = Number.isNaN(stood) ? under : stood + (under - stood) * (1 - Math.exp(-dt / STAND_EASE))
  meat.object.position.set(shown.x, stood, shown.z)
  // The flame drawn again on the beat, or every frame smooth, where it wavers on the clock.
  if (!stop.enabled || newBeat) flame.shape(flameDraw, lightPace.x, lightPace.z)
  flame.place(meat.tip(torchEnd, flame.offset(flameOffset)))
  meat.restTip(torchRest, flameOffset)
  flame.centre(flameAt)
  // The scenes' fires burn while their lights are lit, drawn again as the torch's is, each in its own look, its lamp with it.
  sceneFires.forEach(({ owner, light, fire }, i) => {
    const own = fireLooks[owner.kind]
    lights.setLamp(light, fireLook.lamp, own.intensity)
    const at = goosePlay!.level.lights[light]!
    fire.object.visible = look.flame.enabled && at.on
    if (!fire.object.visible) return
    // Raised and sized with its brazier as the edit mode draws it.
    const { y, size } = shownOf(goosePlay!.plain.braziers[owner.brazier], 'fire')
    fire.set({ ...look.flame, height: own.height * size, width: own.width * size, glow: fireLook.glow, lean: 0 })
    if (!stop.enabled || newBeat) fire.shape((channel) => flameDraw(channel + 7 * (i + 1)), 0, 0)
    fire.place(sceneFireFoot.set(at.x + own.x, standAt(at.x + own.x, at.z + own.z) + own.foot * size + y, at.z + own.z))
  })
  pitFires.forEach(({ brazier, light, fire }, p) => {
    lights.setLamp(light, fireLook.lamp, pitFireLook.intensity)
    const at = goosePlay!.level.lights[light]!
    fire.object.visible = look.flame.enabled && at.on
    if (!fire.object.visible) return
    const { height, width, foot } = pitFireLook
    const { y, size } = shownOf(goosePlay!.plain.braziers[brazier], 'fire')
    fire.set({ ...look.flame, height: height * size, width: width * size, glow: fireLook.glow, lean: 0 })
    if (!stop.enabled || newBeat) fire.shape((channel) => flameDraw(channel + 7 * (sceneFires.length + 1 + p)), 0, 0)
    fire.place(sceneFireFoot.set(at.x, standAt(at.x, at.z) + foot * size + y, at.z))
  })
  // The island's bonfire, always lit while it shows, its lamp with it.
  if (islandFireFlame) {
    const lit = !!islandFireModel?.visible
    islandFireFlame.object.visible = look.flame.enabled && lit
    if (islandFireLamp) {
      islandFireLamp.color.setHex(fireLook.lamp)
      islandFireLamp.intensity = lit ? islandFireLook.intensity * firesLeft : 0
      islandFireLamp.distance = islandFireLook.reach
      islandFireLamp.position.set(islandFireAt.x, islandFireAt.y + (CAGE_FIRE_LIGHT.height ?? 0) * islandFireLook.size, islandFireAt.z)
    }
    if (islandFireFlame.object.visible) {
      const own = fireLooks.cage
      const { size, flame: flameSize } = islandFireLook
      islandFireFlame.set({ ...look.flame, height: own.height * flameSize, width: own.width * flameSize, glow: fireLook.glow, lean: 0 })
      if (!stop.enabled || newBeat) islandFireFlame.shape((channel) => flameDraw(channel + 7 * (sceneFires.length + pitFires.length + 2)), 0, 0)
      islandFireFlame.place(sceneFireFoot.set(islandFireAt.x, islandFireAt.y + own.foot * size, islandFireAt.z))
    }
  }
  burningTreeFrame(newBeat)
  introLightFrame()
  // In the torch, the lamp burns where the torch rests, the arm's sway left out (2026-10-11): it moves with the child
  // and never swings with his arm. Else it hangs over the meat, easing after it.
  if (look.lamp.inFlame) lamp.position.copy(torchRest)
  else lamp.position.set(lampAt.x, LIGHT_HEIGHT + stood, lampAt.z)
  fogCentre.value.set(shown.x, shown.z)
  // The sun stays over the light, so its shadows always cover the view.
  sun.target.position.set(shown.x, 0, shown.z)
  sun.position.copy(sun.target.position).add(look.sun)
  // The same share of the gap a second whatever the frame rate; held, the frames' worth of it comes on the beat.
  owed += dt
  if (!(stop.enabled && stop.camera) || newBeat) {
    moved.set(light.x + outroAim.x, stood, light.z + outroAim.z).sub(followed).multiplyScalar(cameraFollow.lag > 0 ? 1 - Math.exp(-owed / cameraFollow.lag) : 1)
    followed.add(moved)
    camera.position.add(moved)
    controls.target.add(moved)
    owed = 0
  }
  parallaxFrame(dt)
  // The quarter turn, when T set one going: by the frame, so a paused scene still turns.
  film.update(frame)
  controls.update(frame)
  // Never into the ground.
  const above = groundAt(camera.position.x, camera.position.z) + CAMERA_ABOVE
  if (camera.position.y < above) camera.position.y = above
  // The dead trees' and bushes' stretches past the fog's solid edge, its wisps and all, left undrawn: they would draw as
  // the fog. Those out of the camera's view too, now it has moved, unless their shadow is in it.
  const plantsReach = look.fog.enabled ? fogEdge + 1.5 * look.fog.wisp + 0.5 : Infinity
  camera.updateMatrixWorld()
  plantsView.setFromProjectionMatrix(plantsMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem)
  const plantsSun = sun.castShadow ? plantsSunward.subVectors(sun.position, sun.target.position).normalize() : undefined
  deadTreesMesh?.cullPast(shown.x, shown.z, plantsReach, plantsView, plantsSun)
  bushesMesh?.cullPast(shown.x, shown.z, plantsReach, plantsView, plantsSun)
}
followed.y = standAt(light.x, light.z)
camera.position.set(light.x, followed.y, light.z).add(filming ? FILM_CAMERA : CAMERA_OFFSET)
if (filming) controls.target.set(light.x, followed.y, light.z).add(FILM_TARGET)
else controls.target.set(light.x, followed.y, light.z).add(CAMERA_TARGET)
follow(Infinity, true, 0)

/**
 * The goose game's camera set to `to`. The fixed one put back at the framing, kept or the page's, the mouse doing
 * nothing to it but the parallax. The locked one put back where it stands over her, held to its one way across
 * and its tilts. The chase looks at her from behind as the camera now faces, CHASE_CAMERA back and up, the locked
 * pointer turning it round her; the drag neither turns nor slides it, the wheel still brings it in and out. The orbit
 * free again. `lock`: asked on a key, the chase's pointer locked at once; else on the first click.
 */
function setGooseCamera(to: GooseCamera, lock: boolean) {
  gooseCamera = to
  chasing = to === 'chase'
  if (!chasing && document.pointerLockElement === renderer.domElement) document.exitPointerLock()
  const locked = to === 'locked'
  controls.enabled = to !== 'fixed'
  controls.enableRotate = !chasing
  controls.enablePan = to === 'orbit'
  controls.minAzimuthAngle = locked ? 0 : -Infinity
  controls.maxAzimuthAngle = locked ? 0 : Infinity
  controls.minPolarAngle = locked ? ((90 - LOCKED_TILT[1]) * Math.PI) / 180 : 0
  controls.maxPolarAngle = locked ? ((90 - LOCKED_TILT[0]) * Math.PI) / 180 : Math.PI / 2 - 0.05
  parallax.set(0, 0, 0)
  if (to === 'fixed') {
    const kept = keptGooseCamera()
    controls.target.copy(followed).add(kept ? new Vector3(...kept.target) : GOOSE_TARGET)
    camera.position.copy(followed).add(kept ? new Vector3(...kept.camera) : GOOSE_CAMERA)
    return
  }
  if (locked) {
    controls.target.copy(followed).add(GOOSE_TARGET)
    camera.position.copy(followed).add(GOOSE_CAMERA).setX(controls.target.x)
    return
  }
  if (!chasing) return
  controls.target.set(followed.x, followed.y + CHASE_LOOK, followed.z)
  orbit.setFromVector3(orbitOffset.copy(camera.position).sub(controls.target))
  const chase = new Spherical().setFromVector3(CHASE_CAMERA)
  orbit.radius = chase.radius
  orbit.phi = chase.phi
  camera.position.copy(controls.target).add(orbitOffset.setFromSpherical(orbit))
  if (lock) void renderer.domElement.requestPointerLock()
}
if (goosePlay && !filming) {
  addEventListener('keydown', (event) => {
    if (event.code !== 'KeyV' || event.repeat || event.target instanceof HTMLInputElement) return
    setGooseCamera(GOOSE_CAMERAS[(GOOSE_CAMERAS.indexOf(gooseCamera) + 1) % GOOSE_CAMERAS.length]!, true)
  })
  addEventListener('mousemove', (event) => {
    pointerShare.x = (event.clientX / innerWidth) * 2 - 1
    pointerShare.y = (event.clientY / innerHeight) * 2 - 1
  })
  setGooseCamera(url.has('orbit') ? 'orbit' : url.has('locked') ? 'locked' : url.has('chase') ? 'chase' : 'fixed', false)
  // The fixed camera and the free orbit start where a capture left them, else at the chosen framing.
  if (gooseCamera === 'fixed' || gooseCamera === 'orbit') {
    const kept = keptGooseCamera()
    controls.target.copy(followed).add(kept ? new Vector3(...kept.target) : GOOSE_TARGET)
    camera.position.copy(followed).add(kept ? new Vector3(...kept.camera) : GOOSE_CAMERA)
    if (kept) cameraFollow.lag = kept.lag
    if (kept?.fov !== undefined) gooseLens.fov = kept.fov
    controls.update()
  }
}

/**
 * The goose game's edit mode, E on and off (gooseedit.ts): the play paused and the camera the free orbit while it is
 * on, both put back as they were after; the scenes' pieces, and each plain brazier and its waiting gosling, to pick,
 * move, turn, raise and size; saved as the route, the page loaded again on it. The pieces raised and sized as the
 * route keeps them, edit mode or not.
 */
if (goosePlay && gooseScenes) layPieces([...gooseScenes.pieces(goosePlay), ...plainPieces()])
// The tree's gosling lands a little ahead of where it is drawn sitting.
if (goosePlay && gooseScenes) goosePlay.landingOf = (tree) => gooseScenes.landingOf(goosePlay, tree)
let editWasPaused = false
let editWasCamera: GooseCamera = 'fixed'
const editMode =
  goosePlay && gooseScenes && !filming
    ? createEditMode({
        camera,
        dom: renderer.domElement,
        scene,
        pieces: () => [...gooseScenes.pieces(goosePlay), ...plainPieces()],
        entered() {
          editWasPaused = settings.paused
          settings.paused = true
          editWasCamera = gooseCamera
          setGooseCamera('orbit', false)
          panel?.refresh()
        },
        left() {
          settings.paused = editWasPaused
          setGooseCamera(editWasCamera, false)
          panel?.refresh()
        },
        cameraTakes(takes) {
          controls.enableZoom = takes
        },
        save: saveEditedRoute,
      })
    : undefined
if (editMode) {
  addEventListener('keydown', (event) => {
    if (event.code !== 'KeyE' || event.repeat || event.target instanceof HTMLInputElement) return
    editMode.toggle()
  })
}

/** The plain braziers, those with no scene, and their goslings while waiting, and the fire pit by each well, as edit pieces: moved only. */
function plainPieces(): EditPiece[] {
  if (!goosePlay) return []
  const play = goosePlay
  // The well's fire pit saved where it stands before the settings' offset, as the dead tree's brazier is.
  const wellPits = play.wellFires.flatMap(({ brazier, place }, w): EditPiece[] => {
    const object = gooseScenes?.wellPits[w]
    if (!object) return []
    return [
      {
        name: `well fire ${brazier + 1}`,
        object,
        shown: keptShown(play.plain.braziers[brazier]!, 'fire'),
        move(dx, dz) {
          place.x += dx
          place.z += dz
        },
        save(braziers) {
          braziers[brazier]!.fire = { ...place }
        },
      },
    ]
  })
  return [...wellPits, ...plainBraziers(play)]
}

/** The plain braziers, those with no scene, and their goslings while waiting, as edit pieces. */
function plainBraziers(play: GoosePlay<PlaySwarm>): EditPiece[] {
  return play.plain.braziers.flatMap((b, k): EditPiece[] => {
    if (b.scene) return []
    const light = play.level.lights[k]!
    const stand = (k === pitLight ? gooseScenes?.pit : undefined) ?? lights.object.children[k]
    const g = play.goslings[k]
    const bird = goslings?.object.children[k]
    const pieces: EditPiece[] = []
    if (stand) {
      pieces.push({
        name: `brazier ${k + 1}`,
        object: stand,
        shown: keptShown(b, 'fire'),
        move(dx, dz) {
          light.x += dx
          light.z += dz
        },
        save(braziers) {
          braziers[k]!.x = light.x
          braziers[k]!.z = light.z
        },
      })
    }
    if (bird && g?.state === 'waiting') {
      pieces.push({
        name: `gosling ${k + 1}`,
        object: bird,
        shown: keptShown(b, 'gosling'),
        move(dx, dz) {
          g.x += dx
          g.z += dz
          play.waitsAt[k]!.x += dx
          play.waitsAt[k]!.z += dz
        },
        // Where it waits, not where a searching gosling has paced to.
        save(braziers) {
          braziers[k]!.gosling = { ...play.waitsAt[k]! }
        },
      })
    }
    return pieces
  })
}

/**
 * The route the edited pieces now make, written over src/gooseroute.json by the dev server, as the 2D page saves it,
 * and the page loaded again on it; or why not. Not with a debug placement on, which would be saved with it.
 */
async function saveEditedRoute(pieces: EditPiece[]): Promise<string | undefined> {
  if (!goosePlay) return 'no goose game here'
  if (goosePlay.settings.treeAhead !== null || goosePlay.settings.wellAhead !== null) return 'not saved: a debug placement (?tree) is on'
  const { start, pond } = goosePlay.plain
  const braziers = structuredClone(goosePlay.plain.braziers)
  for (const piece of pieces) piece.save?.(braziers)
  // The road as the route laid it, by hand or not at all: the edit mode moves none of it.
  const { road } = goosePlay.plain
  const route: Route = { start: { ...start }, braziers, pond: { ...pond }, ...(road ? { road: structuredClone(road) } : {}) }
  // To the millimetre, as the 2D page saves it.
  const body = JSON.stringify(toSave(route), (_, v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))
  const response = await fetch('/goose-route', { method: 'POST', body }).catch(() => undefined)
  if (!response?.ok) return `not saved: ${response ? await response.text() : 'no dev server'}`
  location.reload()
  return undefined
}

/**
 * The fixed camera slid after the pointer: toward where it is on the screen, -1 to 1 each way, up to PARALLAX m along
 * the camera's own across and up, camera and target together, so the way it looks never changes.
 */
function parallaxFrame(dt: number) {
  if (gooseCamera !== 'fixed' || !(dt > 0) || !Number.isFinite(dt)) return
  parallaxAcross.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize()
  parallaxWanted.copy(parallaxAcross).multiplyScalar(pointerShare.x * PARALLAX.x)
  parallaxWanted.y = -pointerShare.y * PARALLAX.y
  parallaxStep.subVectors(parallaxWanted, parallax).multiplyScalar(1 - Math.exp(-dt / PARALLAX_EASE))
  parallax.add(parallaxStep)
  camera.position.add(parallaxStep)
  controls.target.add(parallaxStep)
}

/** The camera captured on an earlier load, if one is kept and reads right. */
function keptGooseCamera(): CapturedCamera | undefined {
  // With the tilt on, the diorama's camera, high over her, in place of any kept one.
  if (tilt?.look.enabled) return tilt.camera(GOOSE_CAMERA_FOLLOW)
  try {
    const kept = JSON.parse(localStorage.getItem(GOOSE_CAMERA_KEPT) ?? 'null') as CapturedCamera | null
    return kept && kept.camera?.length === 3 && kept.target?.length === 3 && Number.isFinite(kept.lag) ? kept : undefined
  } catch {
    return undefined
  }
}

/**
 * Where the camera now is from her feet, where it looks, its angle and distance, and the follow's lag: kept for the next
 * load, copied to the clipboard and logged, as the text the panel shows.
 */
function captureGooseCamera(): string {
  const round = (v: number) => Math.round(v * 100) / 100
  const from = (v: Vector3): [number, number, number] => [round(v.x - followed.x), round(v.y - followed.y), round(v.z - followed.z)]
  const captured: CapturedCamera = { camera: from(camera.position), target: from(controls.target), lag: cameraFollow.lag, fov: camera.fov }
  localStorage.setItem(GOOSE_CAMERA_KEPT, JSON.stringify(captured))
  const at = new Spherical().setFromVector3(orbitOffset.copy(camera.position).sub(controls.target))
  const text = JSON.stringify({
    ...captured,
    distance: round(at.radius),
    down: round(90 - (at.phi * 180) / Math.PI),
    turn: round((at.theta * 180) / Math.PI),
  })
  console.info('goose camera', text)
  void navigator.clipboard?.writeText(text).catch(() => {})
  return text
}

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
/** How far off the dark starts, m, before the walk's margin: the fog's far edge, or with `roundPast` that distance, the fog nearer where it is on. */
function darkRadius(): number {
  if (settings.roundPast === undefined) return fogEdge
  return look.fog.enabled ? Math.min(fogEdge, settings.roundPast) : settings.roundPast
}

function darkMargin(): number {
  const stop = look.stopMotion
  const lightHeld = stop.enabled && stop.light ? beatLength(stop.uneven) : 0
  const swarmHeld = stop.enabled && stop.swarm ? beatLength(stop.uneven) : 0
  const unseen = 2 * swarm.pace + FRAME_CAP + lightHeld + swarmHeld
  const running = swarmHeld > 0 ? swarmHeld + FRAME_CAP : 0
  return DARK_MARGIN + settings.lightSpeed * unseen + tuning.maxSpeed * running
}

const viewFrustum = new Frustum()
const viewMatrix = new Matrix4()
const viewPlanes: ViewPlane[] = viewFrustum.planes.map(() => ({ a: 0, b: 0, c: 0 }))
/**
 * The camera's frustum met with the ground, each plane pushed `margin` m out, so a rat set down past it shows no
 * part of itself: the goose game's dark, where the rats left behind are set down as near her as the view allows.
 */
function groundView(margin: number): ViewPlane[] {
  camera.updateMatrixWorld()
  viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  viewFrustum.setFromProjectionMatrix(viewMatrix, camera.coordinateSystem)
  viewFrustum.planes.forEach(({ normal, constant }, k) => Object.assign(viewPlanes[k]!, { a: normal.x, b: normal.z, c: constant + margin }))
  return viewPlanes
}

/** The colour the night goes in a strike's flash, and how many times brighter the rats' eyes glow at its height. */
const FLASH_COLOR = new Color(0xdfe4ff)
const EYES_FLASH = 4

/** A strike's flash, 0 to 1, laid on the night: the fog and sky gone pale, the fill and the sun up, the rats' eyes flaring. */
function flashFrame(flash: number) {
  fogColor.value.set(look.fog.color).lerp(FLASH_COLOR, flash * 0.7)
  sky.copy(fogColor.value)
  fill.intensity = look.fill.intensity * (1 + 6 * flash)
  sun.intensity = look.sun.intensity * (1 + 3 * flash)
  rats.setGlow('eyes', look.rats.glow * (1 + EYES_FLASH * flash))
}

/** A scene's fire as its folder edits it: its fire zone and its reach, which holds the rats off; its flame the flames folder's. */
function sceneFirePanel(kind: FireScene) {
  const { fireZones, fireReach } = goosePlay!.settings
  return { zone: fireZones[kind], reach: fireReach, kind }
}

/** The goose's bones by name, the cage's key carried on one of them. */
const gooseBone = (name: string) => meat.bone(name)

/** The goose game's frame past the play, `dt` of play on, at the held time `held`: the goslings where it has them. */
function gooseFrame(dt: number, held: number) {
  if (!goosePlay) return
  // The road's walls nearest her handed to the rats, as she walks on or they are laid again.
  const { holder } = goosePlay
  if (!(Math.hypot(holder.x - ratWallsAt.x, holder.z - ratWallsAt.z) < RAT_WALLS_AGAIN)) {
    ratWallsAt.x = holder.x
    ratWallsAt.z = holder.z
    swarm.setWalls(nearestWalls([...run.walls(), ...roadRatWalls], holder.x, holder.z))
  }
  gooseScenes?.update(goosePlay, dt, gooseBone)
  // The dead trees' pumpkins where the tree folder and the edit mode have them now, for her and her goslings to keep out of.
  if (gooseScenes) goosePlay.setPumpkins(gooseScenes.pumpkinBodies(goosePlay))
  if (gooseScenes) deadTreesMesh?.placeOwn(gooseScenes.ownTrees(goosePlay))
  // Calm until the strike: she and her goslings walk. Struck, she jumps in fright and they cower, till they bolt.
  const calm = introRunning() && introT < INTRO.strike
  meat.setCalm(calm)
  meat.setStartle(introRunning() ? startled(introT) : undefined)
  if (goslings) {
    goslings.calm = calm
    goslings.scared = introRunning() && cowering(introT)
  }
  shoutFrame()
  gooseSoundsFrame(dt)
  islandGeese?.direct(outroCue())
  outroFrame()
  if (introOn && !introSettled) introGoslings()
  // Bolting in the opening, none is in its scene yet: up its tree or down its well.
  if (islandGeese) {
    islandGeese.object.visible = outroRunning() || islandNear()
    if (islandGeese.object.visible) islandGeese.update(dt, held)
  }
  goslings?.update(goosePlay, dt, held, gooseScenes && (!introOn || introSettled) ? (k) => gooseScenes.lift(goosePlay, k) : undefined, outroRunning() ? outroAct : undefined)
  skipHintFrame()
}

/** How far past the island's waterline the camera's view wakes its geese, m: their shadows and a little more. */
const ISLAND_SHADOWS = 2
/** Whether the island, its widest waterline round and ISLAND_SHADOWS more, is in the camera's view: else its geese are neither played nor drawn. */
function islandNear(): boolean {
  if (!pondLook) return false
  const middle = islandMiddle(pondLook)
  let widest = 0
  for (let k = 0; k < 16; k++) widest = Math.max(widest, islandShoreAt(pondLook.island, (k / 16) * Math.PI * 2))
  return inView(middle.x, middle.z, widest + ISLAND_SHADOWS)
}

/**
 * The goslings as the opening has them: walking round her back, bolting up the plain, then where each waits; the
 * spawn's own, freezing, running only to its place at the light's edge. Over or skipped, each where it waits.
 */
function introGoslings() {
  const play = goosePlay!
  const found = play.goslings.flatMap((g, k) => (g ? [k] : []))
  found.forEach((k, index) => Object.assign(play.goslings[k]!, goslingAt(introT, k, index, found.length, play.holder, play.facing, introAhead, play.waitsAt[k]!, k === pitLight)))
  introSettled = !introRunning()
}

/** Her shouts after her goslings as they bolt: HONK! over her head, one at each of INTRO.shouts, popping up and rising off it, SHOUT_SHOWS s each. */
const SHOUT_SHOWS = 0.9
const shouts = introOn
  ? INTRO.shouts.map(() => {
      const word = document.createElement('div')
      word.textContent = 'HONK!'
      word.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;opacity:0;white-space:nowrap;font-family:Gaegu,cursive;font-weight:700;font-size:46px;line-height:1;color:#f6ead0;text-shadow:0 2px 4px #000c'
      document.body.append(word)
      return word
    })
  : []
const shoutAt = new Vector3()
/** The last of her shouts heard. */
let shoutsHeard = -1
function shoutFrame() {
  shouts.forEach((word, k) => {
    const age = introT - INTRO.shouts[k]!
    const shown = introRunning() && age >= 0 && age < SHOUT_SHOWS
    if (shown && k > shoutsHeard) {
      shoutsHeard = k
      gooseSounds?.play('honk', herAt())
    }
    word.style.opacity = shown ? String(Math.min(1, age / 0.06) * Math.min(1, (SHOUT_SHOWS - age) / 0.35)) : '0'
    if (!shown) return
    shoutAt.set(meat.object.position.x, meat.object.position.y + 1.05, meat.object.position.z).project(camera)
    const box = renderer.domElement.getBoundingClientRect()
    const x = box.left + ((shoutAt.x + 1) / 2) * box.width + (k % 2 ? 34 : -34)
    const y = box.top + ((1 - shoutAt.y) / 2) * box.height - 46 * Math.min(1, age / 0.45)
    const pop = age < 0.1 ? 0.6 + (age / 0.1) * 0.75 : Math.max(1, 1.35 - (age - 0.1) * 1.2)
    word.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%) rotate(${k % 2 ? 9 : -9}deg) scale(${pop})`
  })
}

/** Whether the rats have rushed in yet. */
let rushed = false
/**
 * How far past the edge of the view the rats are set down for the rush, m, at the nearest and the farthest: fewest
 * near it and more the further out, so they come in one by one at first, then thicker, never as a block.
 */
const RUSH_FROM = [0.6, 18] as const
/** Every rat set down out of view, on every side of her, to rush in: few just past its edge, more and more behind. */
function rushIn(dark: Dark, count: number) {
  const [near, far] = RUSH_FROM
  for (let i = 0; i < count; i++) {
    const way = Math.random() * 2 * Math.PI
    const ux = Math.cos(way)
    const uz = Math.sin(way)
    // More the further out: the nearest share s of the way out holds s² of them.
    const r = sightEdge(dark, ux, uz) + near + Math.sqrt(Math.random()) * (far - near)
    swarm.setDown(i, dark.x + ux * r, dark.z + uz * r)
  }
}

function skipHintFrame() {
  if (!skipHint) return
  const shown = introRunning() && introT > 0.8 && introT < INTRO.end - 0.6
  skipHint.style.opacity = shown ? '0.8' : '0'
  skipFill.style.width = `${Math.round(Math.min(1, skipHolding / SKIP_HOLD) * 100)}%`
}
/** Space held through `frame` s of the page: skipped once held SKIP_HOLD s. */
function skipHoldFrame(frame: number) {
  if (!introRunning()) return
  skipHolding = skipHeld ? skipHolding + frame : Math.max(0, skipHolding - 2 * frame)
  if (skipHolding >= SKIP_HOLD) skipIntro()
}

/**
 * The burning tree: its lamp as lit as the opening has it; a flame on each cluster of its crown, grown in as the fire
 * reaches it from the top down, swaying with its branch; one at its foot once the fire is down to its lowest; and the
 * strike that lights it, its bolt on the crown's top and its flash on the night.
 */
function burningTreeFrame(newBeat: boolean) {
  if (!goosePlay || !gooseScenes || pitLight < 0) return
  const stop = look.stopMotion
  lights.setLamp(pitLight, fireLook.lamp, crownFireLook.intensity * litShare(introT))
  const { height, width, foot } = crownFireLook
  if (!burningTree) return
  camera.updateMatrixWorld()
  crownView.setFromProjectionMatrix(crownMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem)
  // The whole tree out of the camera's view, its flames' height round it: none of its fire drawn, placed or shaped.
  const { x: treeX, z: treeZ, height: treeHeight, width: treeWidth } = burningTree
  const treeMiddle = sceneFireFoot.set(treeX, groundAt(treeX, treeZ) + treeHeight / 2, treeZ)
  const treeSeen = crownView.intersectsSphere(crownSphere.set(treeMiddle, Math.hypot(treeHeight, treeWidth) / 2 + crownFireLook.height + TREE_FIRE_ROOM))
  if (!treeSeen) for (const own of [...crownFires, ...trunkFires]) if (own) own.fire.object.visible = false
  ;(treeSeen ? gooseScenes.burningFlames(burningTree, crownAt) : []).forEach(({ up }, k) => {
    const own = (crownFires[k] ??= { fire: plainFlame(), size: 0.7 + 0.6 * ((k * 0.618034) % 1), drawnAt: -Infinity })
    const size = own.size * flameGrown(introT, CROWN_FROM + (1 - CROWN_FROM) * up)
    // Out of the camera's view, neither drawn nor shaped: the crown is mostly over the game's frame.
    const seen = crownView.intersectsSphere(crownSphere.set(crownAt[k]!, crownFireLook.height * own.size))
    own.fire.object.visible = look.flame.enabled && size > 0 && seen
    if (!own.fire.object.visible) return
    own.fire.set({ ...look.flame, height: height * size, width: width * size, glow: fireLook.glow, lean: 0 })
    if (treeFlameDue(own, k)) own.fire.shape((channel) => flameDraw(channel + 7 * (40 + k)), 0, 0)
    own.fire.place(sceneFireFoot.copy(crownAt[k]!).setY(crownAt[k]!.y + foot * size))
  })
  ;(treeSeen ? gooseScenes.burningTrunk(burningTree, trunkAt) : []).forEach(({ radius }, k, all) => {
    const own = (trunkFires[k] ??= { fire: plainFlame(), size: 0.8 + 0.4 * ((k * 0.618034 + 0.3) % 1), drawnAt: -Infinity })
    const size = own.size * flameGrown(introT, (CROWN_FROM * (k + 1)) / (all.length + 1))
    own.fire.object.visible = look.flame.enabled && size > 0
    if (!own.fire.object.visible) return
    // Out on the trunk's side toward the camera, wrapping it.
    const at = trunkAt[k]!
    const away = Math.hypot(camera.position.x - at.x, camera.position.z - at.z) || 1
    const side = ((k % 2) * 2 - 1) * 0.5
    const ox = (camera.position.x - at.x) / away
    const oz = (camera.position.z - at.z) / away
    sceneFireFoot.set(at.x + (ox + oz * side) * radius * 0.85, at.y + trunkFireLook.foot * size, at.z + (oz - ox * side) * radius * 0.85)
    own.fire.set({ ...look.flame, height: trunkFireLook.height * size, width: trunkFireLook.width * size, glow: fireLook.glow, lean: 0 })
    if (treeFlameDue(own, 40 + k)) own.fire.shape((channel) => flameDraw(channel + 7 * (80 + k)), 0, 0)
    own.fire.place(sceneFireFoot)
  })
  if (footFire) {
    const at = goosePlay.level.lights[pitLight]!
    const { start } = goosePlay.plain
    const d = Math.hypot(start.x - at.x, start.z - at.z) || 1
    const x = at.x + ((start.x - at.x) / d) * FOOT_FIRE
    const z = at.z + ((start.z - at.z) / d) * FOOT_FIRE
    const grown = flameGrown(introT, 0)
    footFire.object.visible = look.flame.enabled && grown > 0 && treeSeen
    if (footFire.object.visible) {
      footFire.set({ ...look.flame, height: footFireLook.height * grown, width: footFireLook.width * grown, glow: fireLook.glow, lean: 0 })
      if (!stop.enabled || newBeat) footFire.shape((channel) => flameDraw(channel + 7 * 39), 0, 0)
      footFire.place(footFireAt.set(x, standAt(x, z) + footFireLook.foot, z))
    }
  }
  if (introLightning) {
    const struck = introT >= INTRO.strike ? INTRO.strike : Number.NaN
    introLightning.update(introT, [{ at: burningTree, due: INTRO.strike, time: struck }], goosePlay.holder, standAt)
    const flash = Math.max(flashAt(introT - INTRO.strike), afterglow(introT)) * introLightning.look.flash
    if (flash > 0 || introFlashing) flashFrame(flash)
    introFlashing = flash > 0
  }
}

/** The goose game's sounds (goosesounds.ts): none in a take, or with `?mute`; M mutes them. */
const gooseSounds = goosePlay && !filming && !url.has('mute') ? createGooseSounds(camera) : undefined
/**
 * Its music: the track looped under it all (goosesounds.ts' `music`); or, with `?lullaby`, the lullaby made as it plays
 * (goosemusic.ts), growing with her goslings, `?music=N` holding it at layer N. Neither with `?nomusic`.
 */
const lullaby = url.has('lullaby') || url.has('music')
const gooseMusic = gooseSounds && lullaby && !url.has('nomusic') ? createGooseMusic(gooseSounds) : undefined
if (gooseMusic && url.has('music')) gooseMusic.layers = Number(url.get('music'))
const backgroundMusic = gooseSounds && !lullaby && !url.has('nomusic') ? gooseSounds.loop('music') : undefined
/**
 * The track silent through the opening, its strike and its quake; once the game is hers, coming up from its start over
 * MUSIC_FADE s, slow at first, only while it can be heard (not paused, loaded, the page clicked); going down over
 * MUSIC_FADE_OUT s as the ending starts, its own music (`outro`) played once in its place. `musicIn` how far up.
 */
const MUSIC_FADE = 8
const MUSIC_FADE_OUT = 3
let musicIn = 0
if (gooseSounds) {
  addEventListener('keydown', (event) => {
    if (event.code !== 'KeyM' || event.repeat || event.target instanceof HTMLInputElement) return
    gooseSounds.muted = !gooseSounds.muted
  })
  if (!url.has('nopanel')) {
    mountSoundPanel(gooseSounds, gooseMusic)
    // The takes as ElevenLabs gave them come from the dev server alone.
    if (import.meta.env.DEV) mountTakesPanel()
  }
}
/** Where she is heard from: her middle, where the play has her. */
const herAt = () => {
  const { x, z } = goosePlay!.holder
  return { x, y: standAt(x, z) + 0.4, z }
}
/** Whether the strike's fright has been heard; which goslings were with her last frame. */
let frightHeard = false
const withHer: boolean[] = []
/**
 * A gosling seeing her come: the nearest still waiting, once she is EXCITED_FROM m off, peeps happily now and then,
 * the pause between, s, shrinking from its calmest to its quickest as she comes to EXCITED_NEAR m, slowly at first
 * and then faster, each drawn EXCITED_JITTER times it, never on a beat; now and then two peeps close together,
 * EXCITED_TWICE of the time; louder as she comes. Found, as it comes back to her, it peeps FOUND_PEEPS times
 * running, each FOUND_GAP s after the last; a happy peep is written over it, small (`createPeepWords`).
 */
const EXCITED_FROM = 7
const EXCITED_NEAR = 1.2
const EXCITED_PAUSE = [2.4, 0.8] as const
const EXCITED_JITTER = [0.6, 1.6] as const
const EXCITED_TWICE = 0.2
const EXCITED_GAIN = [0.6, 1] as const
const FOUND_PEEPS = [4, 5] as const
const FOUND_GAP = [0.09, 0.32] as const
const peepWords = goosePlay && !filming ? createPeepWords() : undefined
/** How far over a gosling's head its *peep* is written, m. */
const PEEP_OVER = 0.06
const peepHead = new Vector3()
/** A happy peep from gosling `k`, `after` s from now: heard and written over its head as drawn, up a tree or down a well. */
function happyPeep(k: number, gain: number, after = 0) {
  const g = goosePlay?.goslings[k]
  if (!g) return
  if (goslings) goslings.headOf(k, peepHead)
  else peepHead.set(g.x, standAt(g.x, g.z) + GOSLING_HEAD, g.z)
  peepAt({ x: peepHead.x, y: peepHead.y, z: peepHead.z }, gain, after)
}
/** A happy peep from a gosling whose head is at `at`, `after` s from now: heard and written over it. */
function peepAt(at: { x: number; y: number; z: number }, gain: number, after = 0) {
  gooseSounds?.play('happy_peep', at, gain, after)
  peepWords?.peep({ x: at.x, y: at.y + PEEP_OVER, z: at.z }, after)
}
/** How loud each gosling's peeps are as it hops for joy in the ending's ring, many at once; and how far into the ending they have been heard, s. */
const OUTRO_PEEP_GAIN = 0.7
let outroHeard = -1
/**
 * The island's goslings seeing their father come: once he is within ISLAND_SEES m of its waterline, one of them, any,
 * peeps now and then, the pause between, s, shrinking as he nears the shore, each drawn ISLAND_JITTER times it, never
 * on a beat, and louder; on through the ending at its quickest, his goslings with them, as they run down to meet
 * him and round the two of them, until they settle in the ring, where each peeps a run of its own (`outroPeepsFrame`).
 */
const ISLAND_SEES = 12
const ISLAND_PAUSE = [1.8, 0.45] as const
const ISLAND_JITTER = [0.6, 1.4] as const
const ISLAND_GAIN = [0.45, 0.75] as const
let islandCallWait = 0
function islandCallsFrame(dt: number) {
  if (!goosePlay || !islandGeese || !outroIsland || !pondLook?.island.show || introRunning()) return
  const stage = outroStage
  let close = 1
  if (stage) {
    if (outroT >= OUTRO.settle) return
  } else {
    const { holder } = goosePlay
    const { middle } = outroIsland
    const dx = holder.x - middle.x
    const dz = holder.z - middle.z
    const off = Math.hypot(dx, dz) - outroIsland.shoreAt(Math.atan2(dz, dx))
    if (off > ISLAND_SEES) {
      islandCallWait = 0
      return
    }
    close = Math.min(1, Math.max(0, (ISLAND_SEES - off) / (ISLAND_SEES - OUTRO.near)))
  }
  islandCallWait -= dt
  if (islandCallWait > 0) return
  islandCallWait = (ISLAND_PAUSE[0] + (ISLAND_PAUSE[1] - ISLAND_PAUSE[0]) * close) * (ISLAND_JITTER[0] + Math.random() * (ISLAND_JITTER[1] - ISLAND_JITTER[0]))
  const island = stage ? [...outroBrood.map((k) => goosePlay.goslings[k]!), ...stage.island.map((_, j) => goslingOf(stage, false, j, outroT).at)] : islandGeese.cast().goslings
  const at = island[Math.floor(Math.random() * island.length)]
  if (at) peepAt({ x: at.x, y: standAt(at.x, at.z) + GOSLING_HEAD, z: at.z }, ISLAND_GAIN[0] + (ISLAND_GAIN[1] - ISLAND_GAIN[0]) * close)
}
/** Every gosling in the ending's ring, his and the island's, peep peep peep as it hops for joy: those due since the last frame. */
function outroPeepsFrame() {
  const stage = outroStage
  if (!stage || !outroRunning()) return
  const from = outroHeard
  outroHeard = outroT
  const due = (brood: boolean, k: number) => peepsOf(stage, brood, k).some((t) => t > from && t <= outroT)
  outroBrood.forEach((k, i) => due(true, i) && happyPeep(k, OUTRO_PEEP_GAIN))
  stage.island.forEach((_, j) => {
    if (!due(false, j)) return
    const { at, act } = goslingOf(stage, false, j, outroT)
    peepAt({ x: at.x, y: standAt(at.x, at.z) + (act?.lift ?? 0) + GOSLING_HEAD, z: at.z }, OUTRO_PEEP_GAIN)
  })
}
const peepOn = new Vector3()
/** The peeps' words laid out where the camera sees their goslings, `dt` s on. */
function peepWordsFrame(dt: number) {
  if (!peepWords) return
  const box = renderer.domElement.getBoundingClientRect()
  peepWords.update(dt, (at) => {
    peepOn.set(at.x, at.y, at.z).project(camera)
    if (peepOn.z > 1 || Math.abs(peepOn.x) > 1 || Math.abs(peepOn.y) > 1) return null
    return { x: box.left + ((peepOn.x + 1) / 2) * box.width, y: box.top + ((1 - peepOn.y) / 2) * box.height }
  })
}
let excitedWait = 0
/** The nearest gosling still waiting, if she has lit her torch once and it is within EXCITED_FROM m, peeping the quicker the nearer she comes. */
function excitedFrame(dt: number) {
  if (!gooseSounds || !goosePlay || introRunning() || dt <= 0 || !torchFilledOnce()) return
  const { holder } = goosePlay
  let near = -1
  let off = EXCITED_FROM
  goosePlay.goslings.forEach((g, k) => {
    const d = g?.state === 'waiting' ? Math.hypot(g.x - holder.x, g.z - holder.z) : Infinity
    if (d < off) {
      near = k
      off = d
    }
  })
  if (near < 0) return
  excitedWait -= dt
  if (excitedWait > 0) return
  const close = Math.min(1, Math.max(0, (EXCITED_FROM - off) / (EXCITED_FROM - EXCITED_NEAR)))
  const eased = close * close
  excitedWait = (EXCITED_PAUSE[0] + (EXCITED_PAUSE[1] - EXCITED_PAUSE[0]) * eased) * (EXCITED_JITTER[0] + Math.random() * (EXCITED_JITTER[1] - EXCITED_JITTER[0]))
  const gain = EXCITED_GAIN[0] + (EXCITED_GAIN[1] - EXCITED_GAIN[0]) * close
  happyPeep(near, gain)
  if (Math.random() < EXCITED_TWICE) happyPeep(near, gain * 0.9, FOUND_GAP[0] + Math.random() * (FOUND_GAP[1] - FOUND_GAP[0]))
}
/**
 * The last gosling waiting ahead for her to follow: once it has stood GUIDE_CALLS_AFTER s, a small peep, quieter than
 * its happy ones, and another every GUIDE_CALL_PAUSE s or so for as long as she keeps it waiting.
 */
const GUIDE_CALLS_AFTER = 1.5
const GUIDE_CALL_PAUSE = [2.5, 5] as const
const GUIDE_CALL_GAIN = 0.6
let guideCallWait = 0
function guideCallFrame(dt: number) {
  if (!goosePlay || outroRunning() || goosePlay.guideWaits < GUIDE_CALLS_AFTER) {
    guideCallWait = 0
    return
  }
  guideCallWait -= dt
  if (guideCallWait > 0) return
  guideCallWait = GUIDE_CALL_PAUSE[0] + Math.random() * (GUIDE_CALL_PAUSE[1] - GUIDE_CALL_PAUSE[0])
  happyPeep(goosePlay.guide, GUIDE_CALL_GAIN)
}
/**
 * The goslings' fright in the opening: at the strike each peeps twice as they cower, at its own times, s after it;
 * bolting, each peeps over and over as it runs, every so often, s: heard going off
 * every way into the dark. A gosling runs while it goes faster than PANIC_PACE m/s, and slower than a jump to its place.
 */
const COWER_PEEPS = [
  [0.05, 0.35],
  [0.45, 0.8],
] as const
const PANIC_PEEPS = [0.16, 0.28] as const
const PANIC_PACE = [1.5, 20] as const
const panicWait: number[] = []
const goslingWas: ({ x: number; z: number } | undefined)[] = []
/**
 * Her honks after her shouts, heard only, s into the opening and how loud: she goes on calling after her goslings
 * once they are out of sight, a little quieter.
 */
const CALLS_AFTER = [{ at: INTRO.rush + 1, gain: 0.85 }] as const
/**
 * The opening's chatter as they walk (CHAT): a gosling's happy peep, written over it, or her soft answer, heard and
 * written over her head as small as a peep, HER_WORD; how loud the goslings are, and how far over her the word goes, m.
 */
const HER_WORD = '*honk*'
const CHAT_GAIN = 0.75
const HER_HEAD = 0.95
let chatHeard = 0
function chatFrame() {
  for (let line = CHAT[chatHeard]; line && introT >= line.at; line = CHAT[++chatHeard]) {
    // Skipped past, or come to the strike: unsaid.
    if (!introRunning() || introT >= INTRO.strike) continue
    if (typeof line.who === 'number') {
      const found = goosePlay!.goslings.flatMap((g, k) => (g ? [k] : []))
      if (found.length) happyPeep(found[line.who % found.length]!, CHAT_GAIN)
      continue
    }
    gooseSounds?.play(line.who, herAt())
    const { position } = meat.object
    peepWords?.peep({ x: position.x, y: position.y + HER_HEAD, z: position.z }, 0, HER_WORD)
  }
}
/** The opening's own clock, s, run on past its end for her last honks; whether it was skipped, which hushes them. */
let openingClock = 0
let openingSkipped = false
let callsAfterHeard = 0
/** The pause between her sounds of her own as she walks, s, and the share of them that are a soft questioning honk, the rest muttered grunts. */
const MUTTER_PAUSE = [14, 32] as const
const QUERIES = 0.35
let mutterWait = MUTTER_PAUSE[1]
/** The fires as heard: the burning tree's crackle, every other lit fire's calm burning, her torch's; the pond; the wind and the leaves everywhere. */
const fireLoops: SoundLoop[] = []
const torchLoop = gooseSounds?.loop('torch')
const pondLoop = gooseSounds?.loop('river_calm')
const windLoop = gooseSounds?.loop('wind')
const leavesLoop = gooseSounds?.loop('leaves')
/**
 * Her sounds, `dt` s on: her feet on land and her paddling in the pond, her goslings' after hers; the fright as the
 * strike lands and her calls after them once they bolt; a gosling's happy peeps as she comes to it, and as it comes
 * back to her; a sound of her own now and then; the fires, the pond, the wind and the leaves; the rats. Paused or
 * loading, all hushed.
 */
function gooseSoundsFrame(dt: number) {
  if (!gooseSounds || !goosePlay) return
  gooseSounds.hushed = settings.paused || !loaded
  gooseMusic?.frame(!introRunning(), goosePlay.circle, goosePlay.goslings.filter(Boolean).length)
  if (backgroundMusic) {
    if (outroRunning()) musicIn = Math.max(0, musicIn - dt / MUSIC_FADE_OUT)
    else if (!introRunning() && !gooseSounds.hushed && gooseSounds.context.state === 'running') musicIn = Math.min(1, musicIn + dt / MUSIC_FADE)
    backgroundMusic.set(musicIn * musicIn)
  }
  const at = herAt()
  gooseSounds.walk(at, dt, pondLook ? swimmingIn(pondLook, at.x, at.z, pondLook.goose) : 0, meat.footfalls)
  goosePlay.goslings.forEach((g, k) => {
    if (!g) return
    const here = { x: g.x, y: standAt(g.x, g.z) + 0.1, z: g.z }
    gooseSounds.patter(k, here, dt, pondLook ? swimmingIn(pondLook, g.x, g.z, pondLook.gosling) : 0)
    const back = g.state !== 'waiting'
    // Back with her: a run of happy peeps, each after the last at a gap of its own.
    if (back && withHer[k] === false && !introRunning()) {
      const [least, most] = FOUND_PEEPS
      const peeps = least + Math.floor(Math.random() * (most - least + 1))
      for (let p = 0, after = 0; p < peeps; p++, after += FOUND_GAP[0] + Math.random() * (FOUND_GAP[1] - FOUND_GAP[0])) happyPeep(k, 1, after)
    }
    withHer[k] = back
  })
  excitedFrame(dt)
  guideCallFrame(dt)
  islandCallsFrame(dt)
  outroPeepsFrame()
  chatFrame()
  if (introOn && !openingSkipped) {
    openingClock += dt
    if (!introRunning() && openingClock < INTRO.end - 0.1) openingSkipped = true
  }
  if (introRunning() && !frightHeard && introT >= INTRO.strike) {
    frightHeard = true
    gooseSounds.play('fright', at)
    const tree = run.lights()[pitLight]
    if (tree) gooseSounds.play('thunder', { x: tree.x, y: standAt(tree.x, tree.z) + 2, z: tree.z })
    goosePlay.goslings.forEach((g) => {
      if (!g) return
      const here = { x: g.x, y: standAt(g.x, g.z) + 0.2, z: g.z }
      for (const [soonest, latest] of COWER_PEEPS) gooseSounds.play('cower_peep', here, 1, soonest + Math.random() * (latest - soonest))
    })
  }
  goosePlay.goslings.forEach((g, k) => {
    const was = goslingWas[k]
    goslingWas[k] = g && { x: g.x, z: g.z }
    if (!g || !was || dt <= 0 || !introRunning() || introT < INTRO.bolt) return
    const pace = Math.hypot(g.x - was.x, g.z - was.z) / dt
    if (pace < PANIC_PACE[0] || pace > PANIC_PACE[1]) return
    panicWait[k] = (panicWait[k] ?? Math.random() * PANIC_PEEPS[0]) - dt
    if (panicWait[k]! > 0) return
    panicWait[k] = PANIC_PEEPS[0] + Math.random() * (PANIC_PEEPS[1] - PANIC_PEEPS[0])
    gooseSounds.play('panic_peep', { x: g.x, y: standAt(g.x, g.z) + 0.2, z: g.z })
  })
  const after = CALLS_AFTER[callsAfterHeard]
  if (after && !openingSkipped && openingClock >= after.at) {
    callsAfterHeard++
    gooseSounds.play('honk', at, after.gain)
  }
  if (!introRunning() && dt > 0) {
    mutterWait -= dt
    if (mutterWait <= 0) {
      mutterWait = MUTTER_PAUSE[0] + Math.random() * (MUTTER_PAUSE[1] - MUTTER_PAUSE[0])
      gooseSounds.play(Math.random() < QUERIES ? 'query' : 'mutter', at)
    }
  }
  run.lights().forEach((light, k) => {
    const loop = (fireLoops[k] ??= gooseSounds.loop(k === pitLight ? 'fire_crackling' : 'fire_calm'))
    loop.set(k === pitLight ? litShare(introT) : light.on ? 1 : 0, { x: light.x, y: standAt(light.x, light.z) + 0.6, z: light.z })
  })
  torchLoop?.set(goosePlay.run.torch.lit ? 1 : 0, { x: at.x, y: at.y + 0.5, z: at.z })
  if (pondLook) {
    // From the shore nearest her, or from her once she is in.
    const dx = at.x - pondLook.x
    const dz = at.z - pondLook.z
    const off = Math.hypot(dx, dz) || 1
    const shore = Math.min(off, shoreAt(pondLook, Math.atan2(dz, dx)))
    pondLoop?.set(1, { x: pondLook.x + (dx / off) * shore, y: at.y, z: pondLook.z + (dz / off) * shore })
  }
  windLoop?.set(1)
  leavesLoop?.set(1)
  ratsHeardFrame()
  scenesHeardFrame(dt, at)
}
/** How far from her a ghost is heard, m, and the pause between its moans, s. */
const GHOST_HEARD = 18
const GHOST_PAUSE = [5, 11] as const
let ghostWait = GHOST_PAUSE[0]
/** How far past the graveyard's ground the camera's view wakes its ghosts, m: woken out of sight, their cloth settles before it shows. */
const GHOST_SETTLE = 3
/**
 * Whether the graveyard's ghosts may be seen or heard: its ground, their lamps' reach and GHOST_SETTLE round it, in
 * the camera's view, or within earshot of her. Else they are neither walked nor drawn, and walk on from where the
 * play's clock has them once woken. Without the graveyard they walk round her, always awake.
 */
function ghostsNear(): boolean {
  if (!graveyard) return true
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of graveyard.outline) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  const x = (minX + maxX) / 2
  const z = (minZ + maxZ) / 2
  const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2
  return within(x, z, radius, GHOST_HEARD) || (!!ghosts && inView(x, z, radius + ghosts.look.reach + GHOST_SETTLE))
}
/** Now and then, the ghost nearest her moans, from where it walks, if near enough. */
function ghostsHeardFrame(dt: number) {
  if (!ghosts || !gooseSounds || !goosePlay || introRunning() || dt <= 0) return
  ghostWait -= dt
  if (ghostWait > 0) return
  ghostWait = GHOST_PAUSE[0] + Math.random() * (GHOST_PAUSE[1] - GHOST_PAUSE[0])
  const { holder } = goosePlay
  const away = (g: { x: number; z: number }) => Math.hypot(g.x - holder.x, g.z - holder.z)
  const nearest = ghosts.lights.reduce<(typeof ghosts.lights)[number] | undefined>((best, g) => (!best || away(g) < away(best) ? g : best), undefined)
  if (nearest && away(nearest) < GHOST_HEARD) gooseSounds.play('moan', { x: nearest.x, y: standAt(nearest.x, nearest.z) + 1, z: nearest.z })
}
/**
 * Her torch catching, heard once each time: as it lights, out, at a fire; and lit, as she starts holding to top it up
 * there, not quite full. The well's winch, heard while its bucket winds up, and quicker as it drops back; the cage's padlock giving
 * and its door creaking open as it unlocks.
 */
let litWas = true
let toppingWas = false
const winchUp = gooseSounds?.loop('winch')
const winchDown = gooseSounds?.loop('winch', 1.8)
const woundWas: number[] = []
const unlockedWas: boolean[] = []
function scenesHeardFrame(dt: number, at: { x: number; y: number; z: number }) {
  if (!gooseSounds || !goosePlay || dt <= 0) return
  const lit = goosePlay.run.torch.lit
  const topping = lit && goosePlay.atRefill && pressed.has(INTERACT)
  if ((lit && !litWas) || (topping && !toppingWas && goosePlay.run.fuel < 0.98)) gooseSounds.play('ignite', { x: at.x, y: at.y + 0.5, z: at.z })
  litWas = lit
  toppingWas = topping
  let up = 0
  let down = 0
  let well = at
  goosePlay.scenes.forEach((scene, s) => {
    const here = { x: scene.x, y: standAt(scene.x, scene.z) + 0.8, z: scene.z }
    if (scene.kind === 'well') {
      const turned = scene.wound - (woundWas[s] ?? scene.wound)
      woundWas[s] = scene.wound
      if (turned > 0) up = 1
      if (turned < 0) down = 1
      if (turned !== 0) well = here
    } else if (scene.kind === 'cage') {
      const unlocked = !Number.isNaN(scene.unlockedAt)
      if (unlocked && unlockedWas[s] === false) gooseSounds.play('padlock', here)
      unlockedWas[s] = unlocked
    }
  })
  winchUp?.set(up, well)
  winchDown?.set(down, well)
}
/**
 * The swarm heard in its three rings (goosesounds.ts), all as the rats in view are many, RATS_LOUD and more the most;
 * none before the rush: the far ring first, full at a share FAR_FULL of that; the near ring as they are many. And as
 * A Plague Tale's rats tell the player of their state, the edge, the rats running hardest at her light's edge: a little,
 * EDGE[0] of it, while her torch burns well, the more as it burns down past DANGER_FROM of its fuel, all of it once out.
 */
const RATS_LOUD = 300
const FAR_FULL = 0.4
const EDGE = [0.1, 1] as const
const DANGER_FROM = 0.3
const swarmFar = gooseSounds?.loop('swarm_far')
const swarmNear = gooseSounds?.loop('swarm_near')
const swarmEdge = gooseSounds?.loop('swarm_edge')
function ratsHeardFrame() {
  if (!gooseSounds) return
  const many = rats.object.visible ? Math.min(1, rats.drawn / RATS_LOUD) : 0
  const torch = goosePlay?.run.torch
  const danger = !torch || !torch.lit ? 1 : Math.max(0, 1 - goosePlay!.run.fuel / DANGER_FROM)
  swarmFar?.set(Math.min(1, many / FAR_FULL))
  swarmNear?.set(many)
  swarmEdge?.set(many * (EDGE[0] + (EDGE[1] - EDGE[0]) * danger))
}

/**
 * The goose game's hold indicator, over the goose while she is at the well or the dead tree (#190), at the cage's skull
 * or the cage (#191); none in a take. A scene the key works now before a fire's dip it overlaps. Where the key does nothing yet, what to do first: at the dead tree with her torch out,
 * at the cage without its key.
 */
const holdHint = goosePlay && !filming ? createHoldHint() : undefined
/** Whether her torch has been full once: starting with it out, she lights it first, and nothing calls her till then. */
let torchFilled = false
const torchFilledOnce = () => (torchFilled ||= (goosePlay?.run.fuel ?? 0) >= 0.99)
/** How high over the ground she stands on the indicator's foot, m: over her head. */
const HINT_HEIGHT = 1.15
const hintAt = new Vector3()
/**
 * The hold indicator over her as the camera now sees her: filling as the bucket comes up at the well, as the dead tree
 * catches, as the torch fills at a fire; hidden elsewhere.
 */
function holdHintFrame() {
  if (!goosePlay || !holdHint) return
  if (introRunning() || outroRunning() || goosePlay.down) return holdHint.update(null, 0)
  const well = goosePlay.scenes.find((s) => s.kind === 'well' && s.near)
  const winching = well?.kind === 'well'
  const tree = goosePlay.scenes.find((s) => s.kind === 'tree' && s.near)
  const lighting = tree?.kind === 'tree'
  // At the cage with its key, a hold; at the key: one press.
  const cage = goosePlay.scenes.find((s) => s.kind === 'cage' && s.near && s.carried)
  const unlocking = cage?.kind === 'cage'
  const pressing = !unlocking && goosePlay.scenes.some((s) => s.kind === 'cage' && s.near)
  // In a scene's zone, its gosling still in it, the key doing nothing yet.
  const { holder } = goosePlay
  const waiting = (s: { brazier: number }) => goosePlay.goslings[s.brazier]!.state === 'waiting'
  const unlit = goosePlay.scenes.some((s) => s.kind === 'tree' && waiting(s) && Number.isNaN(s.calledAt) && !goosePlay.run.torch.lit && inZone(goosePlay.zoneOf(s), holder))
  const keyless = goosePlay.scenes.some((s) => s.kind === 'cage' && waiting(s) && !s.carried && inZone(goosePlay.zoneOf(s), holder))
  if (!winching && !lighting && !unlocking && !pressing && !unlit && !keyless && !goosePlay.atRefill) return holdHint.update(null, 0)
  hintAt.set(shown.x, stood + HINT_HEIGHT, shown.z).project(camera)
  const box = renderer.domElement.getBoundingClientRect()
  const at = { x: box.left + ((hintAt.x + 1) / 2) * box.width, y: box.top + ((1 - hintAt.y) / 2) * box.height }
  if (winching) holdHint.update(at, well.wound)
  else if (lighting) holdHint.update(at, tree.catching, 'hold to call it down')
  else if (unlocking) holdHint.update(at, cage.unlocking, 'hold to unlock')
  else if (pressing) holdHint.update(at, 0, 'press to pick up the key')
  else if (goosePlay.atRefill) holdHint.update(at, goosePlay.run.torch.lit ? goosePlay.run.fuel : goosePlay.kindled, torchFilledOnce() ? 'hold to refill' : 'light your torch')
  else if (unlit) holdHint.update(at, 0, 'light your torch', false)
  else holdHint.update(at, 0, 'find the key', false)
}

/**
 * Her fall and wake: black as she falls; waking, the black lifting over WAKE_BLACK s
 * of it, the fire she wakes by flaring, its light reaching WAKE_FLARE more at its height, up and back over
 * WAKE_FLARE_AT s, and her colour coming back over WAKE_COLOUR s. Her torch catches between (gooseplay.ts RISE_CATCH).
 */
const fallenBlack = document.getElementById('fallen')
const WAKE_BLACK = [0.15, 0.7] as const
const WAKE_FLARE = 0.8
const WAKE_FLARE_AT = [0.1, 0.55, 1.6] as const
const WAKE_COLOUR = [1, 2.2] as const
/** How many times she had fallen as of the last frame: one more, she has woken, and the camera is put on her at once. */
let fallsSeen = 0

/** Where she is on the screen, 0 to 1 from its top left: where her life's dark closes on. */
const darkOn = new Vector3()

/** Her life, shown on the frame alone: its colour draining with it, grey as it runs out; her death's dark swirling in as she falls, black, coming back as she wakes; in full colour and clear through the opening and the ending. */
function lifeFrame() {
  if (!goosePlay) return
  const { fallen, woken } = goosePlay
  const scripted = introRunning() || outroRunning()
  const { finish, progress } = darkLook
  // The fall as long as the dark takes to close, read live.
  goosePlay.settings.fall.lasts = finish + DARK_HELD
  goosePlay.settings.fall.dims = finish
  let black = 0
  if (fallen >= finish) black = 1
  else if (!Number.isNaN(woken)) black = 1 - eased(woken, ...WAKE_BLACK)
  if (fallenBlack) fallenBlack.style.opacity = String(black)
  const colour = Number.isNaN(woken) ? goosePlay.life : eased(woken, ...WAKE_COLOUR)
  post.colour(scripted ? 1 : colour)
  // Her death's dark: swirling in over `finish` s as she falls, from the bite; or held at the folder's progress, to see it.
  const falling = !Number.isNaN(fallen)
  const dark = progress >= 0 ? progress : falling && !scripted ? Math.min(1, fallen / Math.max(finish, 1e-3)) : 0
  darkOn.set(meat.object.position.x, meat.object.position.y + 0.4, meat.object.position.z).project(camera)
  post.dark(dark, (darkOn.x + 1) / 2, (1 - darkOn.y) / 2, falling ? fallen : clock, darkLook)
}

/** The lights as drawn, the fire she wakes by flaring while she wakes: the lit flame nearest where she wakes. */
function wakeFlare(placed: readonly FixedLight[]): readonly FixedLight[] {
  const woken = goosePlay?.woken ?? Number.NaN
  if (Number.isNaN(woken)) return placed
  const [from, top, to] = WAKE_FLARE_AT
  const up = woken < top ? eased(woken, from, top) : 1 - eased(woken, top, to)
  const { restAt, level } = goosePlay!
  let nearest = -1
  let best = Number.POSITIVE_INFINITY
  level.lights.forEach((one, k) => {
    const off = Math.hypot(one.x - restAt.x, one.z - restAt.z)
    if (one.flame && one.on && off < best) [nearest, best] = [k, off]
  })
  return placed.map((one, k) => (k === nearest ? { ...one, reach: one.reach * (1 + WAKE_FLARE * up) } : one))
}

/**
 * Trial, `?marker` (the goose game's default), or `?marker=doodle`: the calling gosling's badge (goslingbadge.prototype.ts), there all the time it
 * calls and on over its head as she comes, quiet, till she has it; its honks small, said rather than shouted, over
 * the gosling's head in view alone, none by the badge, and heard barely far off, louder as she comes; and her torch
 * out, or at the cage with its key, what to do written over where it is done (aheadFrame).
 */
const callBadge = goosePlay && !filming && trialOn('marker') ? createGoslingBadge(url.get('marker') === 'doodle' ? 'doodle' : 'portrait') : undefined
if (callBadge && url.get('marker') !== 'doodle' && !url.has('nopanel')) mountBadgeControls()
/** The badge's honk, as said, and how big it is written; whether its gosling is in view, for it to be written at all. */
const BADGE_WORD = '*honk*'
const BADGE_CALL = 0.5
let callSeen = false
/** How loud the badge's gosling calls, far off (CALL_FAR m) and near (CALL_QUIET m): barely heard, then louder as she comes. */
const BADGE_HEARD = [0.08, 1] as const
/** The nearest waiting gosling's call, over it or at the screen's edge on its side (callhint.ts); none in a take. */
const callHint =
  goosePlay && !filming
    ? createCallHint(
        (far) => {
          const heard = callBadge ? BADGE_HEARD[1] + (BADGE_HEARD[0] - BADGE_HEARD[1]) * far : CALL_HEARD[0] + (CALL_HEARD[1] - CALL_HEARD[0]) * far
          gooseSounds?.play('call', callHeard, heard)
          callBadge?.pop()
        },
        // Out of view, written nowhere.
        callBadge && (() => (callSeen ? BADGE_WORD : '')),
      )
    : undefined
/** Where the gosling calling is heard from, m; how loud it calls, near and far: louder far, as its word is bigger. */
const callHeard = new Vector3()
const CALL_HEARD = [0.7, 1.3] as const
/** How near she comes for it to call its smallest, m. */
const CALL_QUIET = 3
/** How big it calls at CALL_QUIET m off, growing to CALL_LOUDEST at CALL_FAR m off or further: a far gosling calls louder for her. */
const CALL_NEAREST = 0.85
const CALL_LOUDEST = 1.5
const CALL_FAR = 20
/** How fast she walks away from it for it to call its most urgently, m/s; how long its urgency takes to follow her, s. */
const CALL_HURRY = 1
const CALL_SETTLE = 0.4
/** How far in from the screen's edge a call out of view sits, px, whatever its size. */
const CALL_MARGIN = 120
const CALL_HEIGHT = 0.05
const GOSLING_HEAD = 0.3
const callFrom = new Vector3()
/** The gosling calling, how far off she was last frame, m, and how urgently it calls, -1 she comes to 1 she goes. */
let calling = -1
let callAway = 0
let callUrgency = 0
/** How long the calls rest after a gosling is found, s; how long is left of it; and how many goslings were still waiting. */
const CALL_REST = 4
let callRest = 0
let stillWaiting = -1
/**
 * The nearest gosling still waiting calling her, till she finds it: only the nearest, so one passed by falls quiet as
 * she goes on, and she need not find them all. Once she is within EXCITED_FROM m it stops calling: it has seen her
 * coming, and peeps happily instead (excitedFrame).
 */
function callHintFrame(dt: number) {
  if (!goosePlay || !callHint || introRunning()) return
  if (outroRunning()) {
    callBadge?.update(null, 0, dt)
    return callHint.update(null, dt)
  }
  // One just found, the rest wait CALL_REST s before the next calls: she has it back first.
  const waiting = goosePlay.goslings.filter((g) => g?.state === 'waiting').length
  if (stillWaiting >= 0 && waiting < stillWaiting) callRest = CALL_REST
  stillWaiting = waiting
  callRest = Math.max(0, callRest - dt)
  const { holder } = goosePlay
  const away = (g: { x: number; z: number }) => Math.hypot(g.x - holder.x, g.z - holder.z)
  let next = -1
  goosePlay.goslings.forEach((g, k) => {
    if (g?.state === 'waiting' && (next < 0 || away(g) < away(goosePlay.goslings[next]!))) next = k
  })
  const g = goosePlay.goslings[next]
  const off = g ? away(g) : Infinity
  if (!g || callRest > 0 || !torchFilledOnce()) {
    calling = -1
    callBadge?.update(null, 0, dt)
    return callHint.update(null, dt)
  }
  // Over its head as drawn, up a tree or down a well; before the goslings are drawn, over its place.
  if (goslings) goslings.headOf(next, callFrom)
  else callFrom.set(g.x, standAt(g.x, g.z) + GOSLING_HEAD, g.z)
  callFrom.y += CALL_HEIGHT
  callHeard.copy(callFrom)
  callFrom.project(camera)
  const box = renderer.domElement.getBoundingClientRect()
  const at = callAt(callFrom, box, CALL_MARGIN)
  // Seen her, it peeps instead; its badge stays over it till she has it.
  if (off < EXCITED_FROM) {
    calling = -1
    callBadge?.update(at, 1, dt, next)
    return callHint.update(null, dt)
  }
  if (next !== calling) {
    calling = next
    callUrgency = 0
  } else if (dt > 0) {
    const going = Math.min(1, Math.max(-1, (off - callAway) / dt / CALL_HURRY))
    callUrgency += (going - callUrgency) * (1 - Math.exp(-dt / CALL_SETTLE))
  }
  callAway = off
  const far = Math.min(1, Math.max(0, (off - CALL_QUIET) / (CALL_FAR - CALL_QUIET)))
  const size = CALL_NEAREST + (CALL_LOUDEST - CALL_NEAREST) * far
  if (!callBadge) return callHint.update({ ...at, size, far, urgency: callUrgency }, dt)
  callBadge.update(at, 1, dt, next)
  callSeen = !at.out
  callHint.update({ x: at.x, y: at.y, size: BADGE_CALL, far, urgency: callUrgency }, dt)
}

/**
 * Trial, `?marker`: what to do, written over where it is done, at the screen's edge on its side out of view, only
 * where the badge does not already say it: near the well, over its winch; near the dead tree, over where it is called
 * down, or with her torch out, over its fire; at the cage with its key, over the cage. Never over a fire for her torch out: the hold indicator over her says it once she is at one.
 * Gone once she can work it, the hold indicator over her then.
 */
const aheadHint = callBadge ? createHoldHint() : undefined
/** How near its gosling she is for it, m; how high over the ground it is written, m. */
const AHEAD_FROM = EXCITED_FROM + 1
const AHEAD_HEIGHT = 0.9
const aheadAt = new Vector3()
function aheadFrame() {
  if (!goosePlay || !aheadHint) return
  if (introRunning() || outroRunning() || goosePlay.atRefill || goosePlay.scenes.some((s) => s.near)) return aheadHint.update(null, 0)
  const { holder } = goosePlay
  const box = renderer.domElement.getBoundingClientRect()
  const scene = goosePlay.scenes.find((s) => {
    const g = goosePlay.goslings[s.brazier]
    return g?.state === 'waiting' && Math.hypot(g.x - holder.x, g.z - holder.z) < AHEAD_FROM
  })
  const ahead = scene && aheadOf(scene)
  if (!ahead) return aheadHint.update(null, 0)
  const { x, z } = ahead.zone
  aheadAt.set(x, standAt(x, z) + AHEAD_HEIGHT, z).project(camera)
  aheadHint.update(callAt(aheadAt, box, CALL_MARGIN), 0, ahead.word, false)
}
/**
 * What to do at `scene` now, and where, where the badge does not say it: the well's winch; the dead tree, from where
 * it is called down, or its fire with her torch out; the cage with its key.
 */
function aheadOf(scene: SceneState): { zone: Zone; word: string } | undefined {
  const play = goosePlay!
  if (scene.kind === 'well') return { zone: play.zoneOf(scene), word: 'winch it up' }
  if (scene.kind === 'tree') {
    if (!Number.isNaN(scene.calledAt)) return undefined
    return play.run.torch.lit ? { zone: play.zoneOf(scene), word: 'call it down' } : { zone: play.fireZoneOf(scene), word: 'light your torch' }
  }
  if (scene.kind === 'cage' && scene.carried && !scene.open) return { zone: play.zoneOf(scene), word: 'unlock it' }
  return undefined
}

/** Whether what the woods and the goose game hide until its moment has been drawn once unseen, to build its pipelines. */
let unseenBuilt = false
/** Whether the page has loaded: every pipeline built, the GPU done building them, and the loading screen fading. */
let loaded = false
/**
 * Show what is hidden until its moment, and draw what stands out of sight;
 * the function returned puts it all back. Hidden until their moment, the rats,
 * the rain's streaks, the flames of the lights not yet lit, the torch's flame,
 * embers and smoke while it starts out, would build their pipelines only then,
 * and stall the strike, the rain's coming or the torch's first lighting (108 ms
 * on the goose game, 2026-10-27); and what stands out of the cameras' sight at
 * the start, the sun's shadow camera's too, stalls her arrival where it stands
 * (150-200 ms at the goose game's well, cage and pond).
 */
function showUnseen(placed: readonly FixedLight[]): () => void {
  const ratsShown = rats.object.visible
  rats.object.visible = true
  lights.update(placed.map((light) => ({ ...light, on: true })))
  const fireShown = sceneFires.map(({ fire }) => fire.object.visible)
  for (const { fire } of sceneFires) fire.object.visible = true
  const pitShown = pitFires.map(({ fire }) => fire.object.visible)
  for (const { fire } of pitFires) fire.object.visible = true
  const torchParts = [flame.object, embers.object, smoke.object, ...crownFires.map(({ fire }) => fire.object), ...trunkFires.map(({ fire }) => fire.object), ...(footFire ? [footFire.object] : [])]
  const torchShown = torchParts.map((part) => part.visible)
  for (const part of torchParts) part.visible = true
  const culled: Object3D[] = []
  scene.traverse((object) => {
    if (!object.frustumCulled) return
    object.frustumCulled = false
    culled.push(object)
  })
  return () => {
    for (const object of culled) object.frustumCulled = true
    lights.update(placed)
    sceneFires.forEach(({ fire }, i) => (fire.object.visible = fireShown[i]!))
    pitFires.forEach(({ fire }, p) => (fire.object.visible = pitShown[p]!))
    torchParts.forEach((part, i) => (part.visible = torchShown[i]!))
    rats.object.visible = ratsShown
  }
}

/** Draw everything at once, shown and in sight, shadows and all, under the frame the page shows: the last of the loading. */
function buildUnseen(placed: readonly FixedLight[]) {
  unseenBuilt = true
  const back = showUnseen(placed)
  sun.shadow.needsUpdate = lamp.shadow.needsUpdate = true
  post.render()
  back()
  shadowed.dirty = true
}

/** The loading screen, index.html's: the share of the scene built so far on it, and gone once all of it is. */
const loadingScreen = document.getElementById('loading')
const loadingShare = loadingScreen?.querySelector<HTMLElement>('.share')
loadingScreen?.addEventListener('transitionend', (event) => {
  if (event.target === loadingScreen && loadingScreen.classList.contains('loaded')) loadingScreen.remove()
})
/** How many pipelines' objects a frame of the loading draws: a couple, so a frame takes a fifth of a second or so. */
const PIPELINES_A_SLICE = 2
/** The share of the loading screen's count the scene pass's pipelines take, built all at once before the slices. */
const COMPILED_SHARE = 0.6
/** Whether the scene pass's pipelines are built: undefined until asked for, false while they build (Post.compileScene). */
let sceneCompiled: boolean | undefined
/** The loading's frames with nothing of the scene drawn: the post's own pipelines built on the first, the step's on the second. */
const EMPTY_FRAMES = 2
/** The loading's one frame the swarm steps on, to build the step's pipelines: a step or two, which moves no rat to speak of. */
const STEP_FRAME = 1
/** The scene's drawn objects in slices, made on the loading's first frame, the scene all there by then. */
let loadSlices: PipelineSlices | undefined
/** How many frames the loading has drawn. */
let loadFrame = 0
/**
 * The GPU's queue, on WebGPU: Chrome takes a pipeline at once and builds it
 * on the GPU's side after, so a frame drawn is not a pipeline built. Without
 * waiting for it the loading screen went at 6 s and the game stood 6 s more
 * (2026-10-27).
 */
const gpuQueue = (renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } }).device?.queue
/** Whether the loading's last frame is still being built on the GPU: no more is drawn until it is. */
let loadWaiting = false

/** Once the GPU has done all that is drawn so far, `then`; at once without a queue to ask. */
function whenBuilt(then: () => void) {
  if (!gpuQueue) return then()
  loadWaiting = true
  void gpuQueue.onSubmittedWorkDone().then(() => {
    loadWaiting = false
    then()
  })
}

/** The share built, 0 to 1, on the loading screen: its count. */
function showLoaded(share: number) {
  if (loadingShare) loadingShare.textContent = `${Math.round(share * 100)} %`
}

/**
 * A frame of the loading, drawn behind its screen in place of the game's:
 * shown and in sight as for `buildUnseen`, but one slice of the scene alone,
 * so its pipelines are built a couple a frame, each frame is shown, and the
 * screen counts them, each once the GPU has built it; past the slices, once
 * the rats stand, everything at once for what no slice drew, the game's first
 * frame over it, and once the GPU has built that, the screen fades.
 */
function loadSlice(placed: readonly FixedLight[]) {
  if (loadWaiting) return
  // First the scene pass's pipelines, everything shown and in sight for the call, built many at once while the
  // screen goes on being drawn; then the slices, for what that cannot build: the shadows, the post, the step.
  if (sceneCompiled === undefined) {
    sceneCompiled = false
    loadWaiting = true
    const back = showUnseen(placed)
    const built = post.compileScene((done, of) => showLoaded((COMPILED_SHARE * done) / of))
    back()
    void built
      .catch((error: unknown) => console.warn('the scene pass was not built ahead', error))
      .then(() => {
        sceneCompiled = true
        loadWaiting = false
      })
    return
  }
  loadSlices ??= new PipelineSlices(scene, PIPELINES_A_SLICE)
  const frames = EMPTY_FRAMES + loadSlices.slices.length
  const k = loadFrame
  if (k < frames) {
    loadFrame++
    const back = showUnseen(placed)
    const backSlice = loadSlices.only(k - EMPTY_FRAMES)
    sun.shadow.needsUpdate = lamp.shadow.needsUpdate = true
    post.render()
    backSlice()
    back()
    shadowed.dirty = true
    whenBuilt(() => showLoaded(COMPILED_SHARE + ((1 - COMPILED_SHARE) * (k + 1)) / (frames + 1)))
    return
  }
  if (!swarm.ready || unseenBuilt) return
  buildUnseen(placed)
  post.render()
  whenBuilt(() => {
    showLoaded(1)
    enterWhenAsked(() => {
      loadingScreen?.classList.add('loaded')
      loaded = true
    })
  })
}

/**
 * The goose game, built, waits on its loading screen for the player to enter, by its button, Enter or space: their
 * click or key is what lets the browser play sounds, so the opening is heard from its first moment.
 * Filmed or driven by a tool, it goes straight in.
 */
const askToEnter = !!gooseSounds && !filming && !navigator.webdriver
function enterWhenAsked(go: () => void) {
  if (!askToEnter || !loadingScreen) return go()
  // In the share's place, so the title stays where it is.
  const slot = loadingShare?.parentElement ?? loadingScreen
  loadingShare?.remove()
  const enter = document.createElement('button')
  enter.className = 'enter'
  enter.textContent = 'Enter'
  let entered = false
  const once = () => {
    if (entered) return
    entered = true
    removeEventListener('keydown', byKey)
    enter.disabled = true
    go()
  }
  const byKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') once()
  }
  enter.addEventListener('click', once)
  addEventListener('keydown', byKey)
  slot.append(enter)
  enter.focus()
}

/** The lights by the fog's lights' order: the torch, then the lit lights nearest her. */
const fogNearest: FixedLight[] = []
/** Light the fog round the torch and the lit lights nearest her, FOG_LIGHTS in all, the rest left dark. Water is no light. */
function lightTheFog(placed: readonly FixedLight[]) {
  const torch = run.torch
  fogNearest.length = 0
  for (const one of placed) if (one.on && one.reach > 0 && !one.shore) fogNearest.push(one)
  const off = (one: FixedLight) => Math.hypot(one.x - torch.x, one.z - torch.z)
  fogNearest.sort((a, b) => off(a) - off(b))
  const slots = fogLights.array as Vector4[]
  slots[0]!.set(torch.x, torch.z, torch.reach, torch.lit && settings.on ? 1 : 0)
  for (let k = 1; k < FOG_LIGHTS; k++) {
    const one = fogNearest[k - 1]
    slots[k]!.set(one?.x ?? 0, one?.z ?? 0, one?.reach ?? 0, one ? 1 : 0)
  }
}

/** Whether a shot is in over the orbit: the opening's or the ending's. */
const shotIn = () => introRunning() || outroRunning()
/** The orbit's camera kept, to put back once the frame is drawn. */
const orbitAt = new Vector3()
const orbitTurn = new Quaternion()
const looking = new Vector3()

/** The camera stood at the shots as far in as they are, over the orbit, for this frame's drawing: true if it moved, to be put back after. */
function standAtShots(): boolean {
  const moved = shotIn()
  if (moved && introRunning()) {
    orbitAt.copy(camera.position)
    orbitTurn.copy(camera.quaternion)
    // The game's own camera, thrown about by the strike.
    const shake = shakeAt(introT)
    camera.position.add(looking.set(shake.x, shake.y, shake.z))
    camera.lookAt(controls.target.x + shake.x * 0.6, controls.target.y + shake.y * 0.6, controls.target.z + shake.z * 0.6)
  } else if (moved && outroRunning()) {
    orbitAt.copy(camera.position)
    orbitTurn.copy(camera.quaternion)
    // The game's own camera, drawn back along its look as the ending closes.
    looking.subVectors(camera.position, controls.target).normalize().multiplyScalar(pullOf(outroT))
    camera.position.add(looking)
    camera.lookAt(controls.target)
  }
  camera.getWorldDirection(looking)
  const along = Math.hypot(looking.x, looking.z)
  if (along > 1e-3) {
    drawnForward.x = looking.x / along
    drawnForward.z = looking.z / along
  }
  return moved
}

renderer.setAnimationLoop(() => {
  const start = performance.now()
  timer.update()
  const frame = timer.getDelta()
  // Paused, no time passes for the run, the light's walk or the camera's follow; the mouse still moves the camera.
  // Loading, none either: the scene is being built behind the loading screen, a slice a frame (loadSlice).
  const loading = !loaded
  const dt = settings.paused || loading ? 0 : Math.min(frame, FRAME_CAP)
  clock += dt
  if (introRunning()) introT = Math.min(INTRO.end, introT + dt)
  if (outroRunning()) outroT = Math.min(OUTRO.end, outroT + dt)
  if (!loading) skipHoldFrame(frame)
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
  fogTime.value = held
  water?.update(held)
  // In the pond she swims, afloat, her water clips taking over from her land ones.
  meat.setSwimming(pondLook ? swimmingIn(pondLook, shown.x, shown.z, pondLook.goose) : 0)
  // The goose, standing, turned the way the play has her face: to the chase camera's look.
  meat.pose(held, lightPace.x, lightPace.z, goosePlay && Math.atan2(goosePlay.facing.x, goosePlay.facing.z))
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

  // The play, a frame of it: she walks where the keys send her, the torch burns, a fire refills it. Paused, it holds.
  if (!settings.paused && !loading) {
    if (outroRunning()) {
      walkOutro()
    } else if (!introRunning()) {
      const toward = heading()
      // Slower in the water: her walking pace given way to her swimming one as she takes to it.
      const swimming = swimmingIn(pondLook, run.holder.x, run.holder.z, pondLook.goose)
      goosePlay.settings.pace = settings.lightSpeed * (1 + (pondLook.goose.pace - 1) * swimming)
      if (torchEverlasting) run.fuel = 1
      goosePlay.frame(dt, {
        heading: toward && { x: toward.x - run.holder.x, z: toward.z - run.holder.z },
        interact: pressed.has(INTERACT),
        look: gooseCamera === 'chase' ? drawnForward : null,
      })
      if (outroOn && outroDue(outroIsland!, goosePlay.holder)) startOutro()
      // Woken at a fire, under the black: the camera, the lamp and her height there at once, not gliding after her.
      if (goosePlay.deaths !== fallsSeen) {
        fallsSeen = goosePlay.deaths
        owed = lampOwed = Number.POSITIVE_INFINITY
        stood = Number.NaN
      }
    } else {
      walkIntro()
    }
  }
  gooseFrame(dt, held)
  if (torchChanged()) lookChanged()
  wind.update(settings.paused ? 0 : dt, (zone) => run.gusting(zone))
  // The lamp's pool follows the torch's reach as it burns down, as the light's hard radius does.
  lamp.distance = look.lamp.reach * light.strength
  const placed = run.lights()
  // What the swarm holds the rats off: the lights, and in the goose game the pond's water after them, drawn by nothing.
  const keptOff = withDawn(goosePlay.lights())
  // A gate opened or shut: the walls as they now stand, for the swarm and every light's lit area.
  if (run.wallsVersion !== wallsSeen) {
    wallsSeen = run.wallsVersion
    const standing = run.walls()
    areas.setWalls(new Walls(standing))
    swarm.setWalls(standing)
    // The goose game's road walls handed over again with them, on its next frame.
    ratWallsAt.x = NaN
  }
  // Caught, or set down at a checkpoint: the rats placed again, out of the lights and the torch's room round the holder.
  if (run.starts !== startsSeen) {
    startsSeen = run.starts
    swarm.restart([...keptOff, { x: swarmLight.x, z: swarmLight.z, reach: tuning.ringMax * light.strength + RESTART_ROOM, on: true }])
  }
  walls.update(run, clock)
  swarmTime.value = swarm.time
  const drawn = wakeFlare(introRunning() && pitLight >= 0 ? placed.map((p, k) => (k === pitLight ? { ...p, reach: p.reach * litShare(introT) } : p)) : placed)
  lights.update(drawn)
  lightTheFog(drawn)
  refillZonesFrame(drawn)
  // The lamp, the fog, the sun and the camera after the light, before the swarm is told what the fog hides: this frame's fog, not the last one's.
  follow(dt, newBeat, frame)
  holdHintFrame()
  lifeFrame()
  aheadFrame()
  callHintFrame(dt)
  peepWordsFrame(dt)
  editMode?.frame()
  orthoFrame()
  // The shots over the orbit, before anything reads the camera for this frame's drawing.
  const shot = standAtShots()
  seeThroughAt.set(shown.x, stood + 0.8, shown.z)
  walls.seeThroughTo(seeThroughAt)
  gooseSee?.subject.value.set(seeThroughAt.x, stood + gooseSeeLook.height, seeThroughAt.z)
  if (gooseSee) gooseSeeZone?.update(gooseSee.subject.value, camera, gooseSeeLook)
  cutSeenThrough()
  // The swarm keeps the rats off the goose herself, her light centred on her and her goslings, as her lamp is.
  swarmLight.x = light.x
  swarmLight.z = light.z
  swarmLight.strength = light.strength
  swarmLight.on = light.on
  // The ground each light sees: the torch's where it now is, the others' where they stand; the swarm reads the same, and the drawing at the swarm's time.
  areas.update(swarmLight, keptOff)
  seen.update()
  torchCentre.value.set(swarmLight.x, swarmLight.z)

  // What the fog hides, past the far edge it is drawn at this frame by the walk's margin: where rats left behind are brought round ahead unseen.
  // In the goose game, what the camera leaves out too, so they come back as near her as the view allows, and the
  // swarm seems to have no end.
  const margin = darkMargin()
  const dark: Dark | undefined =
    settings.bringRound ? { x: shown.x, z: shown.z, radius: darkRadius() + margin, view: groundView(margin) } : undefined
  const wanted = Math.round(settings.rats * quality.step.rats)
  // The goose game's goslings in the dark pull the rats near them (#188).
  // Held till the strike, but stepped once on the loading screen with the rest, so its first step builds nothing.
  const ratsHeld = introOn && !ratsOut(introT) && !loading
  if (introOn && !rushed && ratsOut(introT) && dark) {
    rushed = true
    rushIn(dark, wanted)
    // The ground rumbles under them.
    gooseSounds?.play('quake')
  }
  swarm.send(wanted, swarmLight, tuning, settings.paused || (loading && loadFrame !== STEP_FRAME) || ratsHeld, dark, keptOff, goosePlay?.targets)
  // The places: every frame when smooth; on the beat when held; and the first time a state is there, whatever the beat.
  if (!(stop.enabled && stop.swarm) || !swarm.ready) swarm.sample(performance.now())
  else if (stop.stagger) swarm.sampleStaggered(performance.now(), clock, stop.fps)
  else if (newBeat) swarm.hold(performance.now())
  // The smoke on the run's held time too, trailing from the flame's tip.
  smoke.update(held, flame.tip(flameTip), camera.position)
  // The embers on the run's held time, so they hold on the beat; born where the flame burns.
  embers.update(held, flameAt)
  // The gaits belong to the stop motion: cut on the beat they read as frames; smooth, every rat runs, as before them.
  // The levels of detail count the depth of field: a rat it blurs is drawn no finer than it shows (ADR-0057).
  // The tilt's band blurs by the screen and not by distance: the levels count it by where a rat stands on the screen.
  const banded = tilt?.look.enabled ? tilt.look : undefined
  const blurred = look.dof.enabled && quality.step.dof && !banded
  const focus = look.dof.onLight ? camera.position.distanceTo(lamp.position) : look.dof.focus
  rats.staggerCentre(light.x, light.z)
  const smear = banded ? banded.blur : blurred ? look.dof.bokeh * 2 : 0
  rats.focusOn(focus, Math.max(0.05, look.dof.focal), smear * look.rats.levels.blur, banded)
  rats.draw(swarm, camera, stop.enabled)
  if (blurred && look.dof.onLight) post.focusAt(focus)
  // The shadows again only if what casts them moved, on a new state of the swarm, or as often as it would step while
  // the intro holds it, the goose and her goslings moving all the same; a changed look at once. The fire's shadow,
  // its mask, every frame.
  const now = performance.now()
  layFireShadows()
  const casting =
    swarm.version !== shadowed.version ||
    held !== shadowed.held ||
    (sun.castShadow && !sun.position.equals(shadowed.sun)) ||
    (settings.shadows && !lamp.position.equals(shadowed.lamp))
  if (shadowed.dirty || (casting && (swarm.steps !== shadowed.steps || (ratsHeld && now - shadowed.at >= HELD_SHADOW_MS)))) {
    sun.shadow.needsUpdate = lamp.shadow.needsUpdate = true
    shadowed.version = swarm.version
    shadowed.steps = swarm.steps
    shadowed.held = held
    shadowed.sun.copy(sun.position)
    shadowed.lamp.copy(lamp.position)
    shadowed.at = now
    shadowed.dirty = false
  }
  // In the opening, none till the strike brings them.
  if (introOn) rats.object.visible = ratsOut(introT)
  fallingLeaves?.update(dt, followed.x, followed.z)
  if (ghosts) {
    ghosts.object.visible = ghostsNear()
    if (ghosts.object.visible) ghosts.update(dt, goosePlay?.t)
  }
  ghostsHeardFrame(dt)
  plainFlames.update()
  if (loading) loadSlice(placed)
  else post.render()
  // The orbit's camera put back, for the mouse, the keys and the next frame's follow.
  if (shot) {
    camera.position.copy(orbitAt)
    camera.quaternion.copy(orbitTurn)
  }
  // The view's triangles: every rat on screen at its level of detail, and the ground. The shadow passes draw the rats again, off screen.
  const groundGeometry = ground.mesh.geometry
  const triangles = rats.triangles + (groundGeometry.getIndex()?.count ?? groundGeometry.getAttribute('position').count) / 3
  // Every draw of the frame: the view's and the shadow passes'.
  const drawCalls = renderer.info.render.drawCalls
  // The GPU's step time, from the timestamps once resolved; the render's resolved too, so its queries never pile up.
  if (timestamps && swarm instanceof GpuSwarm) {
    void renderer.resolveTimestampsAsync('compute').then(() => swarm.timeSteps(renderer))
    void renderer.resolveTimestampsAsync('render')
  }
  const steeringMs = swarm instanceof GpuSwarm ? swarm.gpuMs : swarm.ms
  readouts({ drawn: rats.drawn, count: swarm.count, triangles, drawCalls, steeringMs, states: swarm.steps, pageMs: performance.now() - start, frameMs: frame * 1000 })
  // The loading's frames are slow by design, and say nothing of the device.
  if (adapt && !loading && quality.frame(frame * 1000, start)) qualityChanged()
})
