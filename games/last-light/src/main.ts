// Last Light: a swarm of rats held off by a light (ADR-0044). The page opens
// on the open arena: no level, a torch that never burns down, every rat
// running at the holder, and the debug keys on. `#game` plays the game: the
// woods (woods.ts), played by the play step (play.ts) the 2D page plays too,
// grey-boxed (scenery.ts) on the ground's height (#182), the child, the
// lights and the rats stood on it, the child on the pine's trunk over the
// ravine (#183); the page feeds it the keys and draws what it reports, and
// steps its swarm. While it rains, streaks fall round the child and splashes
// open on the river; each strike shows its bolt and flashes the scene, the
// rats' eyes flaring in it; crossing the pine, the camera rises high over the
// ravine and hands back to the orbit at the far side; and at the door the
// child goes in and the door shuts behind him (#185).
// Changing the address's hash loads the page again on the other. The swarm steps
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
// `?stop=0` plays without the stop motion.
// The fog round the light is on again since 2026-10-11; `?fog=0` takes it away.
// `#sewers` is the open arena's page on the sewers' first corridor (level.ts, corridor.ts): walls either side, under
// a dome or open, the panel moving them apart and raising them, the rats in its dark, its floor and walls in one
// surface the panel picks and switches the maps of (surfaces.ts). `?nocharacter` hides the character
// with its torch, flame, embers and smoke, as the panel can.
// `#hall` is the open arena's page on a round test room, a very simple maze (level.ts), to watch the rats take
// the way round the walls (ADR-0056), clean as a laboratory: an off-white floor, white bevelled walls, red rats,
// no character, no fog, no stop motion and no effects over the frame, at night so the lamp shows, the moon's
// shadows on and the walls cutting the lamp; a panel of its own for the rats' count, the moon, the fill, the
// lamp, the shadows, the bevel and the colours. The rats appear at once in the maze's corridors (level.ts), and
// can get out through the outer wall's holes. None is brought round, and every rat chases the holder, however far.
// `#goose` is the goose game (#187): the goose, the torch in her beak, crosses the night plain one way on the route
// laid on its 2D page (plain.ts, goose2d.html), from brazier to brazier to the pond, played by the goose play (gooseplay.ts), which the
// page feeds the keys and draws: her goslings waiting at the braziers and in her circle, as
// the goose in miniature (goslings.ts), and the pond, a hollow in the floor inside a noisy shore (pond.ts). For now its torch and its rats are the open
// arena's: the torch never burns down, and every rat notices her from anywhere; those left behind unseen are
// brought round ahead.
// In the woods the pointer is locked to the page with a click and turns the
// camera round the child; C crawls, on and off, and left Ctrl while held; the
// child says his lines in a caption. The page's own bring-round is off: the
// play sets its rats down itself.
//
// `?simulation` shows the swarm bare: no character, no torch, no fog, no stop
// motion; a paler, dimmer light alone, walking faster, and every rat left where
// it is: none is brought round ahead unseen. Under either, and `?loop`, the
// torch never burns down and no flame goes out.
//
// The look steps down where a device cannot keep up (quality.ts): `?step=N`
// starts on step N, and `?adapt=0`, or any of the measuring switches
// (`?ao=0`, `?dof=0`, `?dpr=N`, `?post=0`), holds it where it starts.
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Frustum,
  type Material,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
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
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { loadVAT } from 'three-vat'
import { getMaxTextureSize, type VATTimeUniform } from 'three-vat/tsl'
import { createPost, defaultAO, leaveUnshaded } from './post'
import { collapseBatchRuns } from './collapse'
import { defaultBedLook, defaultRoadLook, defaultWellGroundLook, floor, type FloorName } from './ground'
import { defaultRoadShape, roadField, roadLine } from './road'
import { archesOf, archStones, createArches, defaultArchLook, defaultArchWet, type ArchShell, type ArchStone } from './arches'
import { createDeadTrees, deadTrees, defaultBarkLook, shareInstancing, defaultDeadTreeShape, defaultLeafLook, trunkRadius, type DeadTree, type DeadTreeShape } from './deadtrees'
import { bushes, createBushes, defaultBushLeafLook, defaultBushShape } from './bushes'
import { createRoadWalls, defaultRoadWallLook, ROAD_WALL_STYLES, roadWallLines, roadWallsOf, roadWallStones, type RoadWallLook, type StoneBlock } from './roadwalls'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createPanel, createReadouts, lightAndPause, type Look, type Settings, type ShineLook } from './panel'
import { Run, defaultRunTuning } from './run'
import { ROOM_SPAWN, SEWER_WIDTH, arena, roundRoom, sewer, sewerRats } from './level'
import { createCorridor, type CorridorLook } from './corridor'
import { createSurface, type SurfaceLook } from './surfaces'
import { SEWER_THEMES, applyTheme } from './themes'
import { Play, type PlaySwarm } from './play'
import { PipelineSlices } from './pipelineslices'
import { GoosePlay, inZone, type FireScene } from './gooseplay'
import { createGoslings, defaultGoslingSpeeds, GOSLING_HEIGHT } from './goslings'
import { CAGE_FIRE_LIGHT, PIT_BOWL, PIT_LIGHT, RIGHT_WING, spawnPit, TREE_FIRE_BOWL, TREE_FIRE_LIGHT, TREE_LIGHT, WELL_LIGHT, createGooseScenes, type EditPiece, type SceneFireLook } from './goosescenes'
import { createEditMode } from './gooseedit'
import { createHoldHint } from './holdhint'
import { callAt, createCallHint } from './callhint'
import { FURTHEST, createPond, defaultPondLook, shoreAt, standingIn, swimmingIn, widestShore, type PondLook } from './pond'
import { ROUTE, WADE, laid, toSave, type Plain, type Route } from './plain'
import { defaultRollingLook, rollAgain, rollingGround } from './rolling'
import { createWater, defaultWaterLook } from './water'
import { BIG_FLAME, CART_FLAME, CROWN_FLAME, STEPS_LAMP, createScenery } from './scenery'
import { HeightGrid, standingAt } from './heights'
import { woods } from './woods'
import { loadVegetation } from './vegetation'
import { defaultTreeWindLook } from './treesway'
import { listEnvMaps, loadEnvMap } from './envmaps'
import type { ShellLook } from './shell'
import { createLights, litMask } from './lights'
import { createBlockout, defaultNoiseSeeThrough, defaultSeeThrough, noiseSeeThrough, seeThroughZone } from './blockout'
import { createWind } from './wind'
import { LitAreas } from './litareas'
import { seenTexture } from './seen'
import { WALL_THICKNESS, Walls, nearestWalls, type Wall } from './walls'
import { createFilm } from './film'
import { LEVELS, RAT, Rats } from './rats'
import { createMeat, defaultMeat, goose } from './meat'
import { createFlame, defaultFlame } from './flame'
import { createEmbers } from './embers'
import { createSmoke } from './smoke'
import { defaultTuning, loopPoint, shoreLight, type Dark, type FixedLight, type Ground, type Light, type ViewPlane } from './swarm'
import { createTiltShift, mountTiltControls } from './tiltshift.prototype'
import { createFallingLeaves, mountFallControls } from './fallingleaves.prototype'
import { createFakeLamps } from './fakelamps'
import { gooseThemeOf, layInto } from './goosethemes'
import { RemoteSwarm } from './swarm-remote'
import { GpuSwarm } from './gpuswarm'
import { Quality, ladder, startingStep } from './quality'
import { CROWD, LIGHT_SPEED, NOTICE, RATS, RAT_SIZE, RAT_SPEEDS, RESTART_ROOM, SIZE_BY_SPEED } from './gameplay'
import { createRain } from './rain'
import { createRiver } from './river'
import { createLightning } from './lightning'
import { RainAmount, flashAt, strikesOf } from './weather'
import { ShotBlend, blendPoses, endShot, pineShare, pineShot, type Pose } from './shots'
import { DOOR_AJAR, ending, type EndingPose } from './ending'
import { createToonGradient } from './toon'

// What runs for the light: the rat.
const creature = RAT
/** How fast the light walks under `?film`, m/s: a take covers more ground in its few seconds. */
const FILM_LIGHT_SPEED = 2
/** The count's top, where the device's textures allow it: a playback row a rat. */
const MAX_RATS = 16384
/** The sewers' rats to start: a thousand fill its corridor's dark without carpeting it. */
const SEWER_RATS = 1000
/** The round room's rats to start, as the flow field's prototype had them. */
const HALL_RATS = 1500
/** How high the hall's walls stand, m: low enough that the camera behind the holder sees over them. */
const HALL_WALL_HEIGHT = 1.4
/** The hall's walls' bevel at every edge: how far in, m, and in how many flat steps, 1 a plain chamfer. Its panel sets both. */
const hallBevel = { size: 0.04, steps: 1 }
const SEED = 7
const url = new URLSearchParams(location.search)
/** The game, `#game`; the open arena without it. The page loads again on the other when the hash changes. */
const game = location.hash === '#game'
/** The sewers' first corridor, `#sewers`: the open arena's page, walled. */
const sewers = location.hash === '#sewers'
/** The flow field's hall, `#hall`: the open arena's page, the rats coming in from outside. */
const hallPage = location.hash === '#hall'
/** The levels of detail shown, `#lod`: the open arena's page, every rat out, keys 1 to 4 to compare (ADR-0057). */
const lodPage = location.hash === '#lod'
/** The goose game, `#goose`: the open arena's page on the route laid by hand. */
const goosePage = location.hash === '#goose'
/**
 * The environment pass, for now (2026-10-11): the woods without their strikes
 * or the level's fires, and without the opening's wait: the child walks from
 * the start, his torch lit and never going out, whatever the rain, and the
 * rats come at once, so the place itself is worked on. `?full` plays it all.
 */
const environment = game && !url.has('full')
addEventListener('hashchange', () => location.reload())
/** The light's height above the ground where its holder carries it, when it is not in the torch. */
const LIGHT_HEIGHT = 1.1
/** The hall's lamp, how high it hangs over the light, m: its panel moves it. */
const hallLamp = { height: LIGHT_HEIGHT }
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
/** In the woods: further back and higher, to see the rats chasing the child; how far over the ground the camera always stays, m; and how far a pixel of the locked pointer turns it, radians. */
const WOODS_CAMERA = new Vector3(0, 3.4, 7.2)
const WOODS_TARGET = new Vector3(0, 1, -0.6)
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
  stylized_grass_01: stylizedFloor('stylized_grass_01', { lightness: 0.25, saturation: 0.39, hue: 32, scale: 4.6, relief: 3 }),
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
/**
 * A sewer surface's look to start: set `texture`, `scale` metres a tile,
 * shaded PBR so every map shows, each map on, a little parallax; for the toon
 * shading, the flagstones' highlight, lighter strokes and three steps.
 */
const sewerSurface = (texture: string, scale: number): SurfaceLook => ({
  texture,
  shading: 'pbr',
  scale,
  lightness: 1,
  saturation: 1,
  hue: 0,
  color: true,
  normal: true,
  normalDirectX: false,
  relief: 1,
  roughness: true,
  roughnessValue: 0.8,
  metallic: true,
  metalnessValue: 0,
  ao: true,
  aoStrength: 1,
  height: true,
  heightDepth: 0.04,
  shell: { sheen: 0, specular: 0.85, shininess: 53, softness: 0, specularColor: 0xffffff, rim: false, rimStrength: 0.25, rimWidth: 0, rimSoftness: 0, rimColor: 0xe7febe },
  paint: { strength: 4, density: 0.5, size: 2, rounding: 0.05 },
  toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
})
/** A shell with no sheen, highlight or rim, the floor's highlight colour and the rats' rim set up for when they are turned on. */
const matt = (): ShellLook => ({ sheen: 0, specular: 0, shininess: 53, softness: 0, specularColor: 0xdfe8ff, rim: false, rimStrength: 0.17, rimWidth: 0.24, rimSoftness: 0.34, rimColor: 0xb8c8ff })
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
  // The floor the page starts on, with its own look: the earth in the woods, the flagstones in the arena.
  floor: structuredClone(FLOOR_LOOKS[game ? 'earth' : goosePage ? 'stylized_grass_01' : 'flagstones']),
  // The sewers' floor and walls in rough stone, two metres a tile; under a dome three metres up, a half circle on
  // straight sides.
  sewer: sewers
    ? { theme: Object.keys(SEWER_THEMES)[0]!, seeThrough: defaultSeeThrough(), corridor: { width: SEWER_WIDTH, height: 3, shape: 'dome' }, surface: sewerSurface('stone_wall_01', 2) }
    : undefined,
  // The modelled pines and bushes, set from the panel on 2026-10-11. The pines at two thirds of the grey box's
  // trees, a rose trunk under green foliage, a faint highlight and a thin blue rim, broad strokes, five steps; the
  // bushes at two thirds of the domes, bright green leaves round a green core, matt and unpainted.
  vegetation: {
    pines: {
      scale: 0.69,
      trunk: 0xd4686a,
      foliage: 0x41af69,
      shell: { ...matt(), specular: 0.19, shininess: 33, specularColor: 0xffffff, rim: true, rimStrength: 0.02, rimWidth: 0.39, rimSoftness: 0.01, rimColor: 0x5e82f7 },
      paint: { strength: 2.9, density: 1, size: 4, rounding: 0 },
      toon: { steps: 5, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
    },
    bushes: {
      scale: 0.65,
      leaves: 0x95fe5d,
      core: 0x479c2b,
      shell: { ...matt(), rimStrength: 0 },
      paint: { strength: 0, density: 2, size: 0.25, rounding: 0 },
      toon: { steps: 3, three: [0.3, 0.51, 1], five: [0.2, 0.4, 0.6, 0.8, 1] },
    },
  },
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
  vignette: { enabled: true, strength: 0.21, inner: 0.18, outer: 1.16 },
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
  bloom: { enabled: true, strength: 1, radius: 0.5, resolution: 0.5 },
  // No environment map to start: the night's own colour behind, the fill and the moon alone lighting.
  env: { map: 'none', intensity: 1, background: false, blur: 0, rotation: 0 },
  // The eyes' trails on, as the panel left them on 2026-10-08: a quarter second long, a centimetre and a half wide, needle-tapered,
  // swaying hard and fading fast; smooth, wiggling wide and slow at the tail. In the eyes' own colour.
  // The meat at the light, half a metre high, in its own colours, shaded as the rats start.
  meat: defaultMeat(),
  flame: defaultFlame(),
  // The eyes' trails as the panel left them on 2026-10-07: short, a centimetre wide, needle-tapered, swaying hard, bright amber; no wiggle yet.
  trails: { enabled: true, seconds: 0.11, width: 0.01, strength: 4, wave: 2, taper: 1.9, fade: 6, wiggle: 0, wiggleSpeed: 1.6, color: 0xffbe0a, eyeColour: false },
}

// The sewers in their theme (themes.ts): the first to start, the corridor folder picking another.
if (look.sewer) applyTheme(look, look.sewer.theme)
// The hall is plain, to read the rats' ways round the walls: smooth, as the flow field's prototype played
// (`?stop=1` holds it on the beat again), no fog, nothing over the frame, the lamp hanging over the light, and
// red rats shaded plainly.
if (hallPage) {
  look.stopMotion.enabled = false
  look.fog.enabled = false
  for (const effect of [look.ao, look.outline, look.hatch, look.palette, look.vignette, look.dof, look.bloom]) effect.enabled = false
  Object.assign(look.grain, { grain: false, paper: false })
  // Night, so the lamp shows, in neutral greys: a dim moon and fill, a near-black sky, and a clean white lamp.
  Object.assign(look.lamp, { color: 0xfff4e8, intensity: 30, lag: 0, inFlame: false })
  Object.assign(look.sun, { color: 0xe4eaf2, intensity: 0.3 })
  Object.assign(look.fill, { sky: 0xc8d0dc, ground: 0x1a1c20, intensity: 0.15 })
  look.fog.color = 0x0c0e11
  look.rats.variants = [{ tint: 0xd42a2a, share: 1 }]
  Object.assign(look.rats, { specular: 0, rim: false })
  look.rats.paint.strength = 0
  look.rats.toon.steps = 0
}
// The levels of detail's page: the fog solid from 8 m, and the frame still; the depth of field kept, as the levels count it.
if (lodPage) {
  look.fog.far = 8
  look.stopMotion.enabled = false
}
// The goose game plays smooth: no stop motion. Its lamp hangs over her, not in the flame at her beak, so her light is
// centred on her and her goslings.
if (goosePage) {
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
}
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
const gooseTheme = goosePage ? gooseThemeOf(url.get('theme') ?? GOOSE_THEME) : undefined
if (gooseTheme) layInto(look, gooseTheme.look)
// The goose game's rats matt, whatever the theme, as asked for on 2026-10-26: no highlight and no rim.
if (goosePage) Object.assign(look.rats, { specular: 0, rim: false })
// For now, as asked for on 2026-10-26: no fog, a pale violet moon, a mauve fill, and the rats all one dusty
// mauve; the lamp, the moon and the fill as set from the panel, the lamp's light reaching less far.
if (goosePage) {
  look.fog.enabled = false
  Object.assign(look.lamp, { color: 0xf09a60, intensity: 7, reach: 4.7, falloff: 0, lag: 0.08, inFlame: false })
  Object.assign(look.sun, { color: 0xa094ff, intensity: 2.5, x: -15, y: 25, z: 25, shadows: true, softness: 1.5, darkness: 0.9 })
  Object.assign(look.fill, { sky: 0x754b8b, ground: 0x221a28, intensity: 0.8 })
  look.rats.variants = [{ tint: 0x5c4d5a, share: 1 }]
}
// The fog paler toward the horizon (2026-10-25), whatever the theme: a soft gradient down the frame, the top of which
// looks out nearly level. Its own colour lifted, so the horizon stays in the fog's family.
if (goosePage) look.fog.horizon ??= paler(look.fog.color, HORIZON_LIFT)

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
/** The night's colour behind the scene, the fog's: the background, unless an environment map stands there. */
const sky = new Color()
scene.background = sky
// The environment maps three's examples offer, which the dev server serves (envmaps.ts); none off it, and none in the goose game.
const envMaps = goosePage ? [] : await listEnvMaps()
/** The map the folder last asked for: a newer ask while one loads wins. */
let envAsked = 'none'
/** The environment folder taken: the map, loaded once asked for, lighting the shells; behind the scene or not; its strength, blur and turn. */
function envChanged() {
  const env = look.env
  scene.environmentIntensity = env.intensity
  scene.backgroundBlurriness = env.blur
  scene.environmentRotation.y = scene.backgroundRotation.y = (env.rotation * Math.PI) / 180
  const behind = () => {
    const map = env.background && scene.environment
    scene.background = map ? scene.environment : sky
    // The sky's gradient where the look has a horizon; a map behind the scene stands in front of it.
    scene.backgroundNode = !map && look.fog.horizon !== undefined ? skyBehind : null
  }
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
// The goose (meat.ts, `#lod`) burns its torch at the cup's top: the flame sunk into it, as the panel set it on 2026-10-08.
if (goose) Object.assign(look.flame, { lift: -0.09, offsetX: -0.009, offsetZ: 0.022 })
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
  slopes: goosePage,
  bed: goosePage ? bedLook : undefined,
  wellGround: goosePage ? wellGroundLook : undefined,
  road: goosePage && ROAD ? roadLook : undefined,
})
const meat = await createMeat()
scene.add(meat.object)
// The panel starts the meat's parts at the colours its character or its file has.
look.meat.parts = meat.parts.map((part) => ({ ...part }))
// The kid's parts in the sewers' theme, now they are known.
if (look.sewer) applyTheme(look, look.sewer.theme)
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
// The hall's floor plain off-white, a little glossy, the shadows falling on it.
if (hallPage) {
  ground.mesh.material = new MeshStandardNodeMaterial({ color: 0xeceef0, roughness: 0.55 })
  ground.mesh.receiveShadow = true
}
// The frame goes through one scene pass and the effects after it: the ambient occlusion under its fog, the outlines, the palette.
// PROTOTYPE (`?tilt`): the tilt-shift, the depth of field's blur by a band across the screen (tiltshift.prototype.ts).
const tilt = url.has('tilt') ? createTiltShift() : undefined
// With the tilt, the depth of field off as the page opens: the tilt's band is the blur (the dof folder still turns it on).
if (tilt) look.dof.enabled = false
const post = createPost(renderer, scene, camera, { color: skyOnScreen, amount: fogAmount }, tilt)

// ---------------------------------------------------------------- swarm
const tuning = defaultTuning()
// The game's crowd (gameplay.ts), which the 2D prototype plays by too; the open arena's rats notice the holder from anywhere.
Object.assign(tuning, CROWD, { notice: game ? NOTICE : Infinity })
/** How far off the goose game's rats notice her, m: short of every theme's fog, so the rats further off are seen wandering. */
const GOOSE_NOTICE = 3
// The goose game's rats notice her within GOOSE_NOTICE m, her goslings drawing them from as far as she does, each running
// at the nearest of them; the rats further off ignore her and run about at their own pace, bending back her way only as they
// roam more than 16 m past that (2026-10-26).
if (goosePage) Object.assign(tuning, { notice: GOOSE_NOTICE, wander: 1, roam: 16 })
// The goose game's rats pile low, 0.3 of a rat's height, set on 2026-10-22; and since 2026-10-25 they lunge and weave
// as the sewers' do (sewerplay.ts), but softer, the sewers' read too aggressive here; a little more since 2026-10-26:
// about once in 3.5 s each, at 2.1 times its pace for 0.13 s, swerving up to 0.4 rad.
if (goosePage) Object.assign(tuning, { pull: tuning.notice, pile: 0.3, dashRate: 1 / 3.5, dashSpeed: 2.1, dashTime: 0.13, weave: 0.4 })
// The goose game's rats calmer to answer (2026-10-25), if a little less since 2026-10-26: slower to get going and to
// turn than the sewers', and no bolt at once, from the light or into a lunge.
if (goosePage) Object.assign(tuning, { reaction: 0.4, turnRate: 6.5, fleeReaction: 0.3, fleeTurn: 1.5 })
// The bare simulation's crowd, set from the panel on 2026-10-07: calmer, pressed right up to the light, piled high on a long slope.
if (simulation) Object.assign(tuning, { agitation: 0.5, lookAhead: 0, gap: 0.1, pile: 2, pileRamp: 8 })
// The levels of detail's page piles them high and steep, set from the panel on 2026-10-13.
if (lodPage) Object.assign(tuning, { pile: 3, pileRamp: 0.25 })
/** The collision disc at the usual size: the rat scale and the spacing multiply it. */
const RAT_RADIUS = tuning.ratRadius
const maxTextureSize = getMaxTextureSize(renderer)
/** The count's top: 16,384, or what this device's textures hold. */
const capacity = Math.min(MAX_RATS, maxTextureSize)
/** The goose game's rats to start, 1000 since 2026-10-26: ?rats=N asks for others. */
const GOOSE_RATS = 1000
/** The count the address asks for, ?rats=N: zero included. */
// The goose game's rats as set from the panel on 2026-10-26: quicker to come on, and quicker still from the light, bigger, and spaced wider.
const GOOSE_SPEEDS = { minSpeed: 3, maxSpeed: 4, fleeMinSpeed: 4, fleeMaxSpeed: 4.5 }
const GOOSE_RAT_SIZE = 2
const GOOSE_SPACING = 1.8
/** How far off the goose game's rats out of view come round from, m, with no fog to hide them nearer, set on 2026-10-26. */
const GOOSE_ROUND_PAST = 30
const askedRats = Math.round(Number(url.get('rats') ?? (sewers ? SEWER_RATS : goosePage ? GOOSE_RATS : hallPage ? HALL_RATS : lodPage ? MAX_RATS : RATS)))
// The start, saved from the panel on 2026-10-05: the game's rats, their size and speeds (gameplay.ts), each as
// big as it is fast, a dim light that walks as fast as they run, and the run played at the rat's own pace.
const settings: Settings = {
  rats: Math.min(Math.max(Number.isNaN(askedRats) ? RATS : askedRats, 0), capacity),
  ...RAT_SPEEDS,
  ...(goosePage && GOOSE_SPEEDS),
  size: goosePage ? GOOSE_RAT_SIZE : RAT_SIZE,
  sizeBySpeed: SIZE_BY_SPEED,
  // Packed tighter on the levels of detail's page, set from the panel on 2026-10-13.
  spacing: lodPage ? 0.5 : goosePage ? GOOSE_SPACING : 1,
  on: true,
  // On in the open arena, as they always were there, and in the environment pass; in the game, only with ?debug.
  debug: !game || environment || url.has('debug'),
  shadows: url.has('shadows'),
  runAnimation: 1.7,
  // The bare swarm walks the light faster, and keeps every rat where it is: none is brought round ahead.
  lightSpeed: simulation ? 2.5 : url.has('film') ? FILM_LIGHT_SPEED : LIGHT_SPEED,
  paused: false,
  bringRound: !simulation && !hallPage,
  // The goose game's rats come round from out of the camera's view or past GOOSE_ROUND_PAST m, the fog nearer where it is on.
  ...(goosePage && { roundPast: GOOSE_ROUND_PAST }),
  // ?nocharacter starts with the character hidden, its torch, flame, embers and smoke with it, as the panel's toggle does.
  character: !simulation && !hallPage && !url.has('nocharacter'),
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
/** How far apart the points of the grid the rats are stood on are, m. */
const RAT_GROUND_CELL = 0.5
/** The woods' ground, where the rats stand on it: read off a grid, on the GPU, or by the page under the batch. The flat arena has none. */
function ratGround(): HeightGrid {
  const map = woods()
  const b = map.level.bounds
  return new HeightGrid((x, z) => standingAt(map, x, z), { minX: b.minX - 1, maxX: b.maxX + 1, minZ: b.minZ - 1, maxZ: b.maxZ + 1 }, RAT_GROUND_CELL)
}
/** The woods' ground as a grid: what the rats stand on, and the rain falls to. */
const woodsGround = game ? ratGround() : undefined
/** The goose game's plain as its play lays it, known before the play is, so the rats can be made on its ground. */
const goosePlain = goosePage ? laid(ROUTE) : undefined
// The goose game's pond, as the pond folder edits it: past the last brazier, at the end of the route, the water the
// rats are held off.
const pondLook = goosePlain && pondPastHome(goosePlain)
/**
 * The pond drawn where the plain has it, past the last brazier: on along the last leg, its shore toward her WADE short
 * of home, so she is home as she wades in. The drawn pond is wider than the play's, so it lies further on.
 */
function pondPastHome(p: Plain): PondLook {
  const look = defaultPondLook(p.pond)
  const way = Math.atan2(p.pond.z - p.home.z, p.pond.x - p.home.x)
  const reach = shoreAt(look, way + Math.PI) - WADE
  return { ...look, x: p.home.x + Math.cos(way) * reach, z: p.home.z + Math.sin(way) * reach }
}
/** The box the goose game's floor is laid over: the plain's, and round the drawn pond at its widest shore, which lies on past the play's, FLOOR_PAST more. */
const gooseFloorBox = goosePlain && pondLook && (() => {
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
const pondPlace = pondLook && { x: pondLook.x, z: pondLook.z, widest: widestShore(pondLook) }
/** The goose game's rolling ground (rolling.ts) over its floor: what the floor is laid on, and the rats, the goose and the scenes stand on. */
const gooseGround = goosePlain && pondPlace && gooseFloorBox && rollingGround(goosePlain, pondPlace, gooseFloorBox, rollingLook)
// PROTOTYPE (`?leaves`): leaves falling round her, to the rolling ground (fallingleaves.prototype.ts), with a panel of their own.
const fallingLeaves = url.has('leaves') && gooseGround ? createFallingLeaves(gooseGround) : undefined
if (fallingLeaves) scene.add(fallingLeaves.object)
// On WebGPU the rats are culled and drawn on the GPU (ADR-0052); WebGL 2, or `?batch`, draws them as the batch.
const rats = new Rats(vat, creature, capacity, maxTextureSize, time, settings.runAnimation, backend === 'WebGPU' && !url.has('batch') ? renderer : undefined, woodsGround ?? gooseGround)
// The rats' depth laid first, so each pixel is shaded for the nearest rat alone; `?prepass=0` shades them all, to measure against.
rats.setPrepass(url.get('prepass') !== '0')
// The swarm steps on the GPU where the GPU culls the rats (ADR-0053); in the worker on WebGL 2, under `?batch` or `?cpustep`.
// The bare simulation runs on an arena twice as wide as the count asks, so the light has room to walk.
const arenaScale = simulation ? 2 : 1
const gpuCull = url.has('cpustep') ? undefined : rats.gpuCull
/** The woods' swarm, or the goose game's, the play's to set its rats down in and the page's to step: made on the ground the play gives it. */
let woodsSwarm: GpuSwarm | RemoteSwarm | undefined
/** The page's swarm made on `ground`, its rats the play's to set down. */
const playSwarm = (ground: Ground) =>
  (woodsSwarm = gpuCull ? new GpuSwarm(gpuCull, renderer, capacity, SEED, 0, arenaScale, undefined, ground, seen.texture) : new RemoteSwarm(capacity, SEED, 0, arenaScale, ground))
/** The woods under `#game`, played by the play step, which reads the swarm's tuning as the panel edits it. */
const play = game
  ? new Play<PlaySwarm>(environment ? { opening: false } : {}, SEED, { tuning, swarm: playSwarm })
  : undefined
/**
 * The goose game under `#goose`, on the route saved from its 2D page, its rats the panel's budget and `?seed`'s, walking at the panel's pace. The
 * dead tree stands where the route has it, or `?tree=N` m ahead of her start.
 */
const treeAhead = Number(url.get('tree')) || null
const goosePlay = goosePage
  ? new GoosePlay<PlaySwarm>(
      { rats: settings.rats, pace: settings.lightSpeed, seed: Math.round(Number(url.get('seed') ?? 1)) || 1, treeAhead },
      { tuning, swarm: playSwarm },
    )
  : undefined
/** The ground's height under (x, z): the woods' shapes and steps, the goose game's rolling plain, or the flat arena. */
const groundAt = (x: number, z: number) => (play ? standingAt(play.woods, x, z) : gooseGround ? gooseGround.at(x, z) : 0)

// The level and its rules: the woods under `#game`, the open arena without. The arena, the benchmark's loop,
// the bare swarm and the environment pass keep a torch that never burns down, and every flame lit.
const level = play?.woods.level ?? goosePlay?.level ?? (sewers ? sewer(look.sewer?.corridor.width) : hallPage ? roundRoom() : arena())
const runTuning = play?.runTuning ?? goosePlay?.runTuning ?? defaultRunTuning()
// The light at 0.62 of its strength on the levels of detail's page, set from the panel on 2026-10-13.
if (lodPage) runTuning.torchReach = Math.round(0.62 * tuning.ringMax * 100) / 100
// The goose game's torch is its play's, as on its 2D page: it burns down, its light shrinking with the fuel in a straight
// line to nothing, and grows back as she fills it at a fire. A and E (Q and E on a QWERTY keyboard) turn its reach up
// and down; F gives it a light that never burns down, and puts it out again.
if ((!game && !goosePage) || simulation || url.has('loop') || environment) {
  Object.assign(runTuning, { burnRate: 0, windDrain: 0, gustDrain: 0, everlasting: environment })
  for (const zone of level.wind) zone.gusts = []
  for (const light of level.lights) if (light.fragile !== undefined) light.fragile = {}
}
/** The run: the woods' own, a new one each time the play starts again from the opening. */
let run = play?.run ?? goosePlay?.run ?? new Run(level, runTuning)
// The woods' lit areas see every wall that stops the rats, where the swarm gets the nearest of them: near the child they agree.
areas.setWalls(new Walls(play?.ratWalls ?? run.walls()))
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
// In the woods the struck trees burn bare, the cart's fire on its coal pan, the steps' lanterns are the scenery's, and every
// light stands on the ground. In the goose game the dead tree burns bare, high on its trunk (#190), the well's light in its lantern,
// the brazier by the tree, after the braziers, on its own bowl, and the cage's over its campfire's logs: their
// lamps alone, the page burning the torch's flame on each.
const looks = play
  ? level.lights.map((_, k) =>
      k === play.woods.bigTree ? BIG_FLAME : k === play.woods.crown ? CROWN_FLAME : k === play.woods.brazier ? CART_FLAME : k === play.woods.stepsLight ? STEPS_LAMP : undefined,
    )
  : goosePlay?.level.lights.map((_, k) => {
      const b = goosePlay.plain.braziers[k]
      if (goosePlay.wellFires.some(({ light }) => light === k)) return PIT_LIGHT
      return b === undefined ? TREE_FIRE_LIGHT : k === spawnPit(goosePlay.plain) ? PIT_LIGHT : b.scene === 'tree' ? TREE_LIGHT : b.scene === 'well' ? WELL_LIGHT : b.scene === 'cage' ? CAGE_FIRE_LIGHT : undefined
    })
// The goose game's braziers and ghosts lit as fake lamps (fakelamps.ts): one loop in each lit shader, not a point
// light written out in each; the torch's lamp stays a point light.
const fakeLamps = goosePage ? createFakeLamps(renderer) : undefined
if (fakeLamps) scene.add(fakeLamps)
// In the goose game the braziers' lamps are not cut to their lit areas: the plain has no walls (see the torch's lamp below).
const lights = createLights(level.lights, seen.texture, swarmTime, level.start, { looks, groundAt, masked: !goosePage, lamps: fakeLamps })
scene.add(lights.object)
/** The pond's water as drawn, the swarm's to hold the rats off: its shore, as the pond folder last laid it. */
const pondWater = (look: PondLook) => shoreLight(look.x, look.z, (angle) => shoreAt(look, angle))
if (goosePlay && pondLook) goosePlay.setWater(pondWater(pondLook))
// The goose game's goslings, afloat once out of their depth in the pond.
const goslingSpeeds = defaultGoslingSpeeds()
const goslingSize = { height: GOSLING_HEIGHT }
const goslings = goosePlay && pondLook && (await createGoslings(goosePlay, pondLook, goslingSpeeds, groundAt, goslingSize))
if (goslings) scene.add(goslings.object)
// The goose game's scenes: the well and the dead tree (#190).
const gooseScenes =
  goosePlay &&
  (await createGooseScenes(
    goosePlay,
    (x, z) => groundAt(x, z) + (pondLook ? standingIn(pondLook, x, z, pondLook.goose) : 0),
  ))
if (gooseScenes) scene.add(gooseScenes.object)
// The old road's arches over it out in the dark between its fires (arches.ts), as the road folder edits them.
const archLook = defaultArchLook()
// Their slabs and their toon shell, as the doors folder edits them: the road's and the floor's as the page opens, the
// floor's glossy highlight making them wet as the road is; theirs from then. As the folder was set on 2026-10-25:
// smaller slabs than the road's; a theme's own shell over that. Their stone 0.68 light, and no highlight and no rim,
// whatever the theme, as asked for on 2026-10-26; the walls' the same.
const STONE_LIGHTNESS = 0.68
const matted = { specular: 0, rim: false }
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
const deadTreeLeaves = defaultLeafLook()
const deadTreeWind = defaultTreeWindLook()
// The dead trees' and bushes' kinds sharing a shader and a pipeline a material on WebGPU, room made in each for one
// matrix more than a uniform buffer holds (deadtrees.ts `shareInstancing`).
if (backend === 'WebGPU') {
  const capabilities = (renderer.backend as unknown as { capabilities: { getUniformBufferLimit(): number } }).capabilities
  shareInstancing(Math.floor(capabilities.getUniformBufferLimit() / 64) + 1)
}
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
        gooseSee.cut(m as NodeMaterial, m === deadTreesMesh?.trunk.material ? deadTreesMesh.trunk.kept : undefined)
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
 * A scene's fire as it starts: its flame's foot `foot` m up, `height` m tall and `width` m wide, in the torch's colours,
 * its lamp the lights' brazier lamp (lights.ts).
 */
const sceneFire = (foot: number, height: number, width: number): SceneFireLook => {
  const { color, body, core } = look.flame
  return { height, width, foot, x: 0, z: 0, color, body, core, lamp: 0xff7a28, intensity: 12 }
}
/**
 * Each scene's fire burns the torch's flame (flame.ts), in the fog, standing upright: the brazier by each dead tree in its
 * bowl, the cage's campfire on its logs. Each kind of scene's as its folder sets it, read live: the
 * flame's size, foot, offset off its fire and colours, and its lamp's colour and brightness; each wavering on channels of its own.
 */
const fireLooks: Record<FireScene, SceneFireLook> = {
  tree: sceneFire(TREE_FIRE_BOWL - 0.05, 0.5, 0.28),
  cage: sceneFire(0.24, 1.05, 0.55),
}
/** A flame for a fire on the plain, in the fog like everything else there, which flame.ts leaves the torch's out of. */
const plainFlame = () => {
  const fire = createFlame()
  fire.object.traverse((o) => {
    o.castShadow = false
    if (!(o as Mesh).isMesh) return
    const material = (o as Mesh).material as NodeMaterial
    leaveUnshaded(material)
    material.fog = true
  })
  scene.add(fire.object)
  return fire
}
/** Each scene's fire, a flame a scene. */
const sceneFires = (goosePlay?.scenes ?? []).flatMap((owner) => (owner.kind === 'well' ? [] : [{ owner, light: goosePlay!.fireLightOf(owner), fire: plainFlame() }]))
/** The fire pit's flame (goosescenes.ts), on its logs, its light's: the spawn brazier's, and the one by each well. */
const pitLight = goosePlay ? spawnPit(goosePlay.plain) : -1
const pitFires = [...(pitLight < 0 ? [] : [pitLight]), ...(goosePlay?.wellFires.map(({ light }) => light) ?? [])].map((light) => ({ light, fire: plainFlame() }))
const pitFireLook = sceneFire(PIT_BOWL - 0.04, 0.75, 0.42)
if (gooseTheme?.fireLamp !== undefined) for (const fire of [...Object.values(fireLooks), pitFireLook]) fire.lamp = gooseTheme.fireLamp
const sceneFireFoot = new Vector3()
// The ground laid under each well, where the play stands it.
if (goosePlay) ground.setWells(goosePlay.scenes.filter((s) => s.kind === 'well'))
/** The road as last laid, and the arches over it. */
let roadLaid: ReturnType<typeof roadLine> = { points: [] }
let archesLaid: ReturnType<typeof archesOf> = []
/** The walls beside the road as last laid, and as the rats keep out of them. */
let wallsLaid: StoneBlock[] = []
let roadRatWalls: Wall[] = []
/** Where she stood when the rats were last handed the walls nearest her: none yet, or walls laid again since. */
const ratWallsAt = { x: NaN, z: NaN }
/** How far she walks before the rats are handed the walls nearest her again, m: the GPU step reads MAX_WALLS at most. */
const RAT_WALLS_AGAIN = 3
/** The arches' stones on the ground, as big as the ground folder has them, and the walls, kept out of by her and her goslings. */
const setStones = () => goosePlay?.setStones([...archesLaid.flatMap((arch) => archStones(arch, archLook.scale)), ...roadWallStones(wallsLaid)])
/** The arches as the road and ground folders last set them: sized, raised and coloured, and their stones with them. */
const archesChanged = () => {
  arches?.set(archLook)
  setStones()
}
/** The arches over the road as last laid, as many as the road folder has them, again on a change to their number. */
const layArches = () => {
  if (!arches || !goosePlay) return
  archesLaid = archesOf(goosePlay.plain, roadLaid, archLook.count)
  arches.lay(archesLaid)
  layWalls()
}
/** The walls beside the road as last laid, as the walls folder has them, clear of the arches, again on every change to it, them or the road. */
function layWalls() {
  if (roadWalls && goosePlay) {
    wallsLaid = roadWallsOf(goosePlay.plain, roadLaid, roadWallLook, archesLaid)
    roadWalls.lay(wallsLaid)
    roadRatWalls = roadWallLines(wallsLaid)
    ratWallsAt.x = NaN
  }
  setStones()
  layTrees()
}
/** The dead trees as last laid: the bushes keep off their trunks. */
let treesLaid: DeadTree[] = []
/** The dead trees as the dead trees folder has them, along the road as last laid, behind its walls and clear of its arches; the bushes again round them. */
function layTrees() {
  if (!deadTreesMesh || !goosePlay) return
  deadTreesMesh.object.visible = deadTreeLook.show
  treesLaid = deadTreeLook.show ? deadTrees(goosePlay.plain, roadLaid.points, deadTreesMesh.variants, deadTreeShape, wallsLaid, archesLaid, treeGround) : []
  deadTreesMesh.lay(treesLaid)
  // Their trunks bodies she and her goslings keep out of; hidden, none.
  goosePlay.setTrunks(treesLaid.map((tree) => ({ at: tree, radius: trunkRadius(tree) })))
  layBushes()
}
/** The bushes as the bushes folder has them, scattered as the trees are, off their trunks. */
function layBushes() {
  if (!bushesMesh || !goosePlay) return
  bushesMesh.object.visible = bushLook.show
  bushesMesh.lay(bushLook.show ? bushes(goosePlay.plain, roadLaid.points, bushesMesh.variants, treesLaid, bushShape, wallsLaid, archesLaid, treeGround) : [])
}
/** The old road laid along the play's plain, and its arches over it, again on every change to its way. */
const layRoad = () => {
  if (!goosePlay) return
  roadLaid = roadLine(goosePlay.plain, roadShape)
  ground.setRoad(roadField(roadLaid))
  layArches()
}
layRoad()
// The goose game's plain runs far past the arena's floor, out to the black: the floor laid under the whole of it, its
// painting read in the world's own coordinates, so a bigger plane changes nothing where the old one was. The pond's
// shore is cut out of it, and its bank, in the floor's material, falls from there to the water (pond.ts).
// Its water depth-tinted, refracting and foaming (water.ts), as the pond folder's water edits it.
const waterLook = defaultWaterLook()
const water = goosePlay && (await createWater(waterLook))
const pond =
  goosePlay &&
  pondLook &&
  water &&
  gooseFloorBox &&
  createPond(ground.mesh, gooseFloorBox, pondLook, water.material, (field) => ground.setShore(field), gooseGround)
if (pond) scene.add(pond.object)
// The bed under the pond's water takes less light, as deep as the water lies.
if (pondLook) ground.setWaterLevel(pondLook.water)
// The environment pass puts out every flame the level places: its lit windows stay.
if (environment) lights.object.children.forEach((group, k) => (group.visible = !level.lights[k]!.flame))
// The woods' walls are its trees and rocks, and its gate swings in the estate wall, drawn as scenery: the blockout draws only its key.
// The sewers' walls are the corridor's, in their surface.
const walls = createBlockout(play ? { walls: [], gates: [], keys: level.keys, levers: level.levers } : sewers ? { ...level, walls: [] } : level)
scene.add(walls.object)
// The hall's walls plain white and bevelled, in place of the grey boxes, merged into one geometry: one draw for
// them all in each pass. Each a box as long as its line and a wall's thickness more, so the corners close, every
// edge bevelled as hallBevel has it: built one by one, since a bevelled box stretched to length stretches its
// bevel, and set in place before the merge. Flat shaded, so each face and each step of the bevel takes one shade,
// with no smoothing across them.
const hallWallMaterial = hallPage ? new MeshStandardNodeMaterial({ color: 0xf4f5f6, roughness: 0.45, flatShading: true }) : undefined
const hallWalls = new Mesh(undefined, hallWallMaterial)
hallWalls.castShadow = hallWalls.receiveShadow = true
/** The hall's walls built again at the bevel the panel now has. */
function bevelHallWalls() {
  // Rounded past half the thickness, the box comes apart.
  const size = Math.min(hallBevel.size, WALL_THICKNESS / 2 - 0.001)
  const steps = Math.max(1, Math.round(hallBevel.steps))
  const placed = new Matrix4()
  const turn = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const one = new Vector3(1, 1, 1)
  const shapes = level.walls.map(({ from, to }) => {
    const shape = new RoundedBoxGeometry(Math.hypot(to.x - from.x, to.z - from.z) + WALL_THICKNESS, HALL_WALL_HEIGHT, WALL_THICKNESS, steps, size)
    turn.setFromAxisAngle(up, -Math.atan2(to.z - from.z, to.x - from.x))
    return shape.applyMatrix4(placed.compose(new Vector3((from.x + to.x) / 2, HALL_WALL_HEIGHT / 2, (from.z + to.z) / 2), turn, one))
  })
  hallWalls.geometry.dispose()
  hallWalls.geometry = mergeGeometries(shapes)
  for (const shape of shapes) shape.dispose()
}
if (hallWallMaterial) {
  walls.object.visible = false
  bevelHallWalls()
  scene.add(hallWalls)
}
// The modelled pine and bush in place of the grey box's trees and domes, but under `?greybox` (vegetation.ts).
const vegetation = play && !url.has('greybox') ? await loadVegetation() : undefined
const scenery = play ? createScenery(play.woods, undefined, vegetation) : undefined
/** How high the child stands at (x, z): in the woods on the ground, the steps or the pine's trunk; on the flat arena, the floor. */
// In the goose game, for now, she walks down the pond's bank and into its water, afloat where it is too deep (pond.ts).
const standAt = (x: number, z: number) => scenery?.standAt(x, z) ?? (pondLook ? groundAt(x, z) + standingIn(pondLook, x, z, pondLook.goose) : 0)

/**
 * DEBUG: where things are done, as rings on the ground: orange, a flame's dip, or a scene's fire's zone, the interact
 * key held to fill the torch; red, where the interact key works a scene, the well's
 * winch, the dead tree's trunk, the cage and its key. `?zones`, or the run folder's switch.
 */
const refillZones = { show: url.has('zones') || url.has('refill') }
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
const workRings = (goosePlay?.scenes ?? []).map(() => refillRing(1, workRing))
const keyRings = (goosePlay?.scenes ?? []).flatMap((s) => (s.kind === 'cage' ? [refillRing(1, workRing)] : []))
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

if (scenery) {
  scene.add(scenery.object)
  ground.mesh.geometry.dispose()
  ground.mesh.geometry = scenery.ground
  ground.mesh.rotation.x = 0
}
// The sewers' corridor, its floor and walls in one look, in place of the arena's floor.
const sewerLook = look.sewer
// One look for both: the floor is a surface of its own only because the see-through cuts the walls and never the floor.
const sewerFloor = sewerLook && (await createSurface(sewerLook.surface))
const sewerWalls = sewerLook && (await createSurface(sewerLook.surface))
const corridor = sewerFloor && sewerWalls ? createCorridor(sewerFloor, sewerWalls) : undefined
/** The corridor as last built: its width, height and shape. */
const corridorBuilt: CorridorLook = { width: Number.NaN, height: Number.NaN, shape: 'open' }
if (corridor) {
  scene.add(corridor.object)
  ground.mesh.visible = false
}
/** The rat holes at the foot of the sewer's walls (level.ts), each a small black cube where the rats come through. */
const HOLE_MARK = 0.4
const holeMarks = new Group()
const holeBox = new BoxGeometry(HOLE_MARK, HOLE_MARK, HOLE_MARK)
const holeBlack = new MeshBasicNodeMaterial({ color: 0x000000 })
/** The holes put where they are for a corridor `width` m wide. */
function markHoles(width: number) {
  holeMarks.clear()
  for (const hole of sewerRats(width).holes) {
    const mark = new Mesh(holeBox, holeBlack)
    mark.position.set(hole.x, HOLE_MARK / 2, hole.z)
    holeMarks.add(mark)
  }
}
if (sewers) {
  markHoles(level.bounds.maxX - level.bounds.minX)
  scene.add(holeMarks)
}
/**
 * The corridor folder taken: built again if its height or shape moved; and
 * if its width did, the level's walls and box moved apart first, the swarm
 * and the lit areas handed them, the holder kept inside, and every rat placed
 * again in the new box.
 */
function corridorChanged(look: CorridorLook) {
  if (!corridor) return
  const { width, height, shape } = corridorBuilt
  if (look.width === width && look.height === height && look.shape === shape) return
  if (look.width !== width && !Number.isNaN(width)) {
    const moved = sewer(look.width)
    level.walls.splice(0, Infinity, ...moved.walls)
    Object.assign(level.bounds, moved.bounds)
    // Nothing stops the holder alone here: handing that again puts the run's walls together again from the level's.
    run.setHolderWalls([])
    const room = level.bounds.maxX - 0.35
    run.holder.x = Math.min(room, Math.max(-room, run.holder.x))
    torchChanged()
    wallsSeen = run.wallsVersion
    const standing = run.walls()
    areas.setWalls(new Walls(standing))
    swarm.setWalls(ratWalls(standing), sewerRats(look.width).bounds)
    markHoles(look.width)
    swarm.restart([...run.lights(), { x: light.x, z: light.z, reach: tuning.ringMax * light.strength + RESTART_ROOM, on: true }])
  }
  Object.assign(corridorBuilt, look)
  corridor.build(level.walls, level.bounds, look)
}
const wind = createWind(level.wind)
scene.add(wind.object)
// The rain, the strikes and the river (#185): the rain's streaks round the child, the strikes' bolts, and the river's water;
// and how hard it rains, eased after the play's rain.
const rainStreaks = woodsGround && createRain(woodsGround)
const lightning = play && !environment ? createLightning(2) : undefined
const river = play && createRiver(play.woods, createToonGradient())
for (const effect of [rainStreaks, lightning, river]) if (effect) scene.add(effect.object)
const rainAmount = new RainAmount()
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
lamp.castShadow = !goosePage
// The hall's floor and walls read the lit areas' texture too, for nothing: read only through the lamp's shadow node it
// is bound once and never refreshed, and the lamp is cut by a stale table (a square round the light).
if (hallPage) {
  for (const material of [ground.mesh.material as MeshStandardNodeMaterial, hallWallMaterial!]) {
    material.emissiveNode = vec3(torchSees.mul(0))
    material.needsUpdate = true
  }
}
/**
 * In the hall, whether the walls cut the lamp, a uniform its panel sets. The hall has no cube of shadows: three's
 * point shadow there shadowed all but the ground straight under the lamp, a square round the light.
 */
const hallWallsCut = uniform(1)
lamp.shadow.shadowNode = hallPage
  ? mix(float(1), torchSees, hallWallsCut)
  : settings.shadows
    ? torchSees.mul(pointShadow(lamp) as unknown as Node<'float'>)
    : torchSees

/**
 * The walls that stop the rats, of the walls that stand: in the sewers the corridor's own, holed at the foot where
 * the rats come through from the ground behind them, which is walled in (level.ts); the light still stops at the
 * walls whole.
 */
function ratWalls(standing: readonly Wall[]): readonly Wall[] {
  return sewers ? sewerRats(level.bounds.maxX - level.bounds.minX).walls : standing
}
/** The level's ground, as the swarm reads it: the walls that stop the rats, its box they start in, and the lights they start out of. */
const onGround = {
  // On the goose game's plain, the road's walls nearest where she starts.
  walls: goosePlay ? nearestWalls([...ratWalls(run.walls()), ...roadRatWalls], goosePlay.holder.x, goosePlay.holder.z) : ratWalls(run.walls()),
  bounds: sewers ? sewerRats(level.bounds.maxX - level.bounds.minX).bounds : game || hallPage ? level.bounds : undefined,
  lights: run.lights(),
  spawnRing: hallPage ? ROOM_SPAWN : undefined,
}
const swarm =
  woodsSwarm ??
  (gpuCull
    ? new GpuSwarm(gpuCull, renderer, capacity, SEED, settings.rats, arenaScale, undefined, onGround, seen.texture)
    : new RemoteSwarm(capacity, SEED, settings.rats, arenaScale, onGround))
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
if (goosePage) for (const part of look.rats.parts) if (part.name === 'eyes') part.color = gooseTheme?.eyes ?? GOOSE_EYES
// The rats' eyes in the sewers' theme, now they are known.
if (look.sewer) applyTheme(look, look.sewer.theme)

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
  sunShadowColor.value.set(look.sun.shadowColor)

  fill.color.set(look.fill.sky)
  fill.groundColor.set(look.fill.ground)
  fill.intensity = look.fill.intensity * flicker(3)

  fogColor.value.set(look.fog.color)
  skyHorizon.value.set(look.fog.horizon ?? look.fog.color)
  skyBand.value = Math.sin((Math.max(look.fog.band ?? 15, 1) * Math.PI) / 180)
  sky.set(look.fog.color)
  envChanged()
  fogEdge = Math.max(look.fog.far, look.fog.near + 0.5)
  fogNear.value = simulation ? 1e6 : look.fog.near
  fogFar.value = simulation ? 1e6 + 1 : fogEdge
  fogDensity.value = Math.max(look.fog.density, 1)
  fogWisp.value = simulation ? 0 : look.fog.wisp
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
  ground.material.set(look.floor.shell)
  ground.material.setPaint(look.floor.paint)
  ground.material.setToon(look.floor.toon)
  scenery?.setVegetation(look.vegetation)
  if (look.sewer) {
    corridorChanged(look.sewer.corridor)
    corridor?.setSeeThrough(look.sewer.seeThrough)
    sewerFloor?.set(look.sewer.surface)
    sewerWalls?.set(look.sewer.surface)
  }
  meat.set(look.meat)
  gooseScenes?.setShell(look.meat)
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
  // PROTOTYPE (`?tilt`): the deep output drawn for the tilt's band too; the glow, a bright point's lit disc, the depth of field's alone.
  const depthOn = look.dof.enabled && quality.step.dof
  const dof = { ...look.dof, enabled: depthOn || !!tilt?.look.enabled, glow: depthOn ? look.dof.glow : 0 }
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
// cage's and, on 5, the pond. Any other number, or 0 to 5 on the keypad, gives her that many goslings at
// once, 0 none (the key's place, so the AZERTY row needs no shift).
/** The goose game's torch held full each frame, its F debug key's. */
let torchEverlasting = false
if (goosePage) {
  addEventListener(
    'keydown',
    (event) => {
      if (event.repeat || !settings.debug || event.target instanceof HTMLInputElement) return
      const digit = /^(?:Digit|Numpad)(\d)$/.exec(event.code)
      if (event.code === 'KeyF') run.fuel = (torchEverlasting = !torchEverlasting) ? 1 : 0
      else if (event.code === 'Digit0') goosePlay?.standAtStart()
      else if (event.code === 'Digit1') goosePlay?.standBy('well')
      else if (event.code === 'Digit2') goosePlay?.standBy('tree')
      else if (event.code === 'Digit3') goosePlay?.standBy('cage')
      else if (event.code === 'Digit5') goosePlay?.standByPond()
      else if (digit) goosePlay?.giveGoslings(Number(digit[1]))
      else return
      event.preventDefault()
      event.stopImmediatePropagation()
    },
    { capture: true },
  )
}
// The crowd folder edits the swarm's own tuning: the next step reads it.
if (fallingLeaves && !url.has('nopanel')) mountFallControls(fallingLeaves)
if (tilt && !url.has('nopanel')) {
  // The diorama's camera put in place, or the kept one back, as the tilt's panel moves it or turns it off.
  mountTiltControls(tilt, () => lookChanged(), () => {
    if (!goosePlay) return
    setGooseCamera(gooseCamera, false)
    gooseLens.fov = keptGooseCamera()?.fov ?? CAMERA_FOV
    controls.update()
  })
}
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
const panel = url.has('nopanel') || filming || hallPage ? undefined : createPanel(settings, tuning, look, capacity, {
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
  theme() {
    if (look.sewer) applyTheme(look, look.sewer.theme)
  },
}, {
  tuning: runTuning,
  level,
  // The goose game's dark, and its rats' seed: a new seed sets the rats down afresh, the page loaded again on it.
  goose: goosePlay && {
    settings: goosePlay.settings,
    refillZones,
    // The pond folder lays the pond again on every change.
    pond: pondLook && { look: pondLook, changed: () => {
        pond?.set(pondLook)
        ground.setWaterLevel(pondLook.water)
        goosePlay.setWater(pondWater(pondLook))
      }, water: waterLook, waterChanged: () => water?.set(waterLook), bed: bedLook, bedChanged: () => ground.setBed(bedLook) },
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
    // The well's colours, a material at a time.
    well: gooseScenes && { colours: gooseScenes.wellColours, glows: gooseScenes.wellGlows, changed: gooseScenes.wellChanged, bucket: gooseScenes.bucketOffset, zone: goosePlay.settings.winchZone, fire: goosePlay.settings.wellFire, reach: goosePlay.settings, ground: { look: wellGroundLook, changed: () => ground.setWellGround(wellGroundLook) } },
    // The dead tree's colour, size and perch, read live; where she calls its gosling down, and where it lands; its brazier's
    // place, its flame and lamp, where she fills her torch at it and how far it holds the rats.
    tree: gooseScenes && { look: gooseScenes.tree, zone: goosePlay.settings.treeZone, landing: goosePlay.settings.treeLanding, jump: goosePlay.settings, fire: { at: goosePlay.settings.treeFire, ...sceneFirePanel('tree') } },
    // The cage: where she opens it, where its key lies by the body and where she picks it up; its campfire's place, flame and lamp,
    // where she fills her torch at it and how far it holds the rats.
    cage: { zone: goosePlay.settings.cageZone, hold: goosePlay.settings, key: { zone: goosePlay.settings.keyZone, beside: goosePlay.settings.keyBeside, inWing: gooseScenes?.keyInWing, bones: RIGHT_WING }, fire: { at: goosePlay.settings.cageFire, ...sceneFirePanel('cage') }, look: gooseScenes?.cage, colours: gooseScenes && { colours: gooseScenes.cageColours, changed: gooseScenes.cageChanged } },
    // The camera: its follow's lag; where it is from her, captured to the clipboard and kept for the next load.
    // The see-through round her: its hole and its noise, read live.
    seeThrough: gooseSee && { look: gooseSeeLook, changed: () => gooseSee.set(gooseSeeLook) },
    camera: { follow: cameraFollow, lens: gooseLens, capture: () => captureGooseCamera(), forget: () => localStorage.removeItem(GOOSE_CAMERA_KEPT) },
    reseed(seed) {
      url.set('seed', String(seed))
      location.search = url.toString()
    },
  },
  // In the woods, the start is the opening, and the gate's checkpoint the play's own past it. The goose game never starts
  // again: its start is the page loaded again.
  startAt: (checkpoint) => {
    if (goosePlay) return location.reload()
    if (!play) return run.startAt(checkpoint)
    if (checkpoint < 0) play.begin()
    else play.skipTo(2)
    run = play.run
  },
}, envMaps.map((entry) => entry.name))
// Without the panel, P still pauses, and F, a debug key, still puts the torch out.
if (!panel) lightAndPause(settings, () => torchChanged() && lookChanged())
// The hall's own panel: the moon, the fill, the lamp and the shadows, nothing else.
if (hallPage && !url.has('nopanel')) {
  const gui = new GUI({ title: 'Hall' })
  const moon = gui.addFolder('Directional light (moon)')
  moon.addColor(look.sun, 'color').onChange(lookChanged)
  moon.add(look.sun, 'intensity', 0, 5, 0.05).onChange(lookChanged)
  moon.add(look.sun, 'x', -30, 30, 0.5).name('from x m').onChange(lookChanged)
  moon.add(look.sun, 'y', 1, 40, 0.5).name('from y m').onChange(lookChanged)
  moon.add(look.sun, 'z', -30, 30, 0.5).name('from z m').onChange(lookChanged)
  const ambient = gui.addFolder('Ambient light')
  ambient.addColor(look.fill, 'sky').name('from above').onChange(lookChanged)
  ambient.addColor(look.fill, 'ground').name('from below').onChange(lookChanged)
  ambient.add(look.fill, 'intensity', 0, 3, 0.01).onChange(lookChanged)
  ambient.addColor(look.fog, 'color').name('sky').onChange(lookChanged)
  const torch = gui.addFolder('Torch light')
  torch.addColor(look.lamp, 'color').onChange(lookChanged)
  torch.add(look.lamp, 'intensity', 0, 150, 1).onChange(lookChanged)
  torch.add(look.lamp, 'reach', 0, 30, 0.1).name('reach m (0 = endless)').onChange(lookChanged)
  torch.add(look.lamp, 'falloff', 0, 3, 0.05).onChange(lookChanged)
  torch.add(hallLamp, 'height', 0.2, 3, 0.05).name('height m').onChange(lookChanged)
  const shadows = gui.addFolder('Shadows')
  shadows.add(look.sun, 'shadows').name('moon').onChange(lookChanged)
  shadows.add(look.sun, 'softness', 0, 20, 0.5).name('moon softness').onChange(lookChanged)
  shadows.add(look.sun, 'darkness', 0, 1, 0.01).name('moon darkness').onChange(lookChanged)
  shadows.add({ walls: true }, 'walls').name('torch stopped by walls').onChange((on: boolean) => (hallWallsCut.value = on ? 1 : 0))
  const hallBevelChanged = () => {
    bevelHallWalls()
    // The moon's shadows drawn again round the new edges.
    shadowed.dirty = true
  }
  gui.add(settings, 'rats', 0, capacity, 50).name('rats')
  const bevel = gui.addFolder('Wall bevel')
  bevel.add(hallBevel, 'size', 0, WALL_THICKNESS / 2, 0.005).name('size m').onChange(hallBevelChanged)
  bevel.add(hallBevel, 'steps', 1, 8, 1).name('steps (1 = chamfer)').onChange(hallBevelChanged)
  const colours = gui.addFolder('Colours')
  const hallColours = {
    walls: hallWallMaterial!.color.getHex(),
    rats: look.rats.variants[0]!.tint,
    floor: (ground.mesh.material as MeshStandardNodeMaterial).color.getHex(),
  }
  colours.addColor(hallColours, 'walls').onChange((value: number) => hallWallMaterial!.color.set(value))
  colours.addColor(hallColours, 'rats').onChange((value: number) => {
    look.rats.variants[0]!.tint = value
    lookChanged()
  })
  colours.addColor(hallColours, 'floor').onChange((value: number) => (ground.mesh.material as MeshStandardNodeMaterial).color.set(value))
}
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
    run.inWind < 0 ? '' : run.gusting(run.inWind) ? 'gust' : 'wind',
    play ? `light ${play.left.toFixed(1)} s` : '',
    goosePlay ? `light ${goosePlay.left.toFixed(1)} s · goslings ${goosePlay.circle}` : '',
    play?.crawling ? 'crawling' : '',
    // The woods' run starts afresh at a catch before the stick is lit: the play counts them all.
    (play?.caught ?? run.caught) > 0 ? `caught ${play?.caught ?? run.caught}` : '',
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
//
// On the levels of detail's page, 1 turns them on and off, 2 tints every rat
// by its level, 3 splits the view into the levels and the same tinted, 4 into
// the whole rat and the levels. A line splits the view.
if (lodPage) {
  const levels = look.rats.levels
  const divider = document.createElement('div')
  divider.style.cssText = 'position:fixed;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(255,255,255,0.7);pointer-events:none;z-index:10'
  document.body.append(divider)
  const showMode = () => {
    divider.style.display = levels.on && levels.split !== 'none' ? '' : 'none'
  }
  addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.repeat) return
    // 1 turns the levels on and off, back on plain; 2, 3 and 4 each pick their view, and pressed again keep it.
    if (event.code === 'Digit1') {
      levels.on = !levels.on
      levels.show = false
      levels.split = 'none'
    } else if (event.code === 'Digit2') {
      levels.on = true
      levels.show = true
      levels.split = 'none'
    } else if (event.code === 'Digit3' || event.code === 'Digit4') {
      levels.on = true
      levels.show = false
      levels.split = event.code === 'Digit3' ? 'tint' : 'whole'
    } else return
    lookChanged()
    panel?.refresh()
    showMode()
  })
  showMode()
}
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
/** In the woods, C crawls on and off, and left Ctrl while held; whether C was pressed since the last frame. */
const CRAWL = 'KeyC'
const CRAWL_HELD = 'ControlLeft'
let toggleCrawl = false
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
    const crawl = play !== undefined && (event.code === CRAWL || event.code === CRAWL_HELD)
    if (!(event.code in KEYS) && !(event.code in DIAL) && event.code !== INTERACT && !crawl) return
    // A panel button last clicked keeps the focus, and Space would press it.
    if (event.code === INTERACT && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    event.preventDefault()
    pressed.add(event.code)
    if (event.code === CRAWL && !event.repeat) toggleCrawl = true
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
// In the woods a click locks the pointer, and the pointer then turns the camera round the child, up and down as far as the
// orbit goes: the drag does not. Escape lets it go. The goose game's chase camera turns the same way round her.
// The environment pass keeps the plain orbit, dragged round the child as the arena's is round its light.
const woodsLock = play !== undefined && !environment
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
if (woodsLock) controls.enableRotate = false
if (woodsLock || goosePlay) {
  renderer.domElement.addEventListener('click', () => {
    if ((woodsLock || chasing) && document.pointerLockElement !== renderer.domElement) void renderer.domElement.requestPointerLock()
  })
  addEventListener('mousemove', (event) => {
    // A shot in holds the orbit where it was, to hand back to.
    if (!(woodsLock || chasing) || document.pointerLockElement !== renderer.domElement || shotIn()) return
    orbit.setFromVector3(orbitOffset.copy(camera.position).sub(controls.target))
    orbit.theta -= event.movementX * LOOK_SPEED
    orbit.phi = Math.min(controls.maxPolarAngle, Math.max(0.15, orbit.phi - event.movementY * LOOK_SPEED))
    camera.position.copy(controls.target).add(orbitOffset.setFromSpherical(orbit))
  })
}

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
/** The camera's follow owed since it last moved, s, while the stop motion holds the camera. */
let owed = 0
/** Where the lamp hangs: easing after the light's shown place by the lamp's lag, the held frames' worth of it on the beat. */
const lampAt = { x: light.x, z: light.z }
let lampOwed = 0
/** The light's own pace, m/s, as of the last frame: the meat runs by it. */
const lightPace = { x: 0, z: 0, wasX: light.x, wasZ: light.z }
/**
 * How far into the crawl the child is, 0 standing to 1 crawling, eased: the
 * placeholder crawl lowers him by CRAWL_DROP and tips him CRAWL_TILT forward,
 * his clips at CRAWL_RATE.
 */
let crawled = 0
const CRAWL_DROP = 0.12
const CRAWL_TILT = 1
const CRAWL_RATE = 0.5
const CRAWL_EASE = 0.15
/** How far into a push the child is, 0 to 1, eased as the crawl is: the placeholder push leans him PUSH_TILT forward into the cart. */
let pushed = 0
const PUSH_TILT = 0.3
/** How high the child stands, m: easing after the ground, the steps or the trunk under him, so a step up is a step, not a jump. */
let stood = Number.NaN
const STAND_EASE = 0.08
const tipAxis = new Vector3()
/** The camera's view, as the dead trees and bushes are culled to it. */
const plantsView = new Frustum()
const plantsMatrix = new Matrix4()
/** The way to the sun, as the dead trees and bushes are kept for the shadows they throw into the view. */
const plantsSunward = new Vector3()
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
  meat.object.position.set(shown.x, stood - CRAWL_DROP * crawled, shown.z)
  // The flame drawn again on the beat, or every frame smooth, where it wavers on the clock.
  if (!stop.enabled || newBeat) flame.shape(flameDraw, lightPace.x, lightPace.z)
  flame.place(meat.tip(torchEnd, flame.offset(flameOffset)))
  meat.restTip(torchRest, flameOffset)
  flame.centre(flameAt)
  // The scenes' fires burn while their lights are lit, drawn again as the torch's is, each in its own look, its lamp with it.
  sceneFires.forEach(({ owner, light, fire }, i) => {
    const own = fireLooks[owner.kind]
    lights.setLamp(light, own.lamp, own.intensity)
    const at = goosePlay!.level.lights[light]!
    fire.object.visible = look.flame.enabled && at.on
    if (!fire.object.visible) return
    fire.set({ ...look.flame, height: own.height, width: own.width, color: own.color, body: own.body, core: own.core, lean: 0 })
    if (!stop.enabled || newBeat) fire.shape((channel) => flameDraw(channel + 7 * (i + 1)), 0, 0)
    fire.place(sceneFireFoot.set(at.x + own.x, standAt(at.x + own.x, at.z + own.z) + own.foot, at.z + own.z))
  })
  pitFires.forEach(({ light, fire }, p) => {
    lights.setLamp(light, pitFireLook.lamp, pitFireLook.intensity)
    const at = goosePlay!.level.lights[light]!
    fire.object.visible = look.flame.enabled && at.on
    if (!fire.object.visible) return
    const { height, width, color, body, core, foot } = pitFireLook
    fire.set({ ...look.flame, height, width, color, body, core, lean: 0 })
    if (!stop.enabled || newBeat) fire.shape((channel) => flameDraw(channel + 7 * (sceneFires.length + 1 + p)), 0, 0)
    fire.place(sceneFireFoot.set(at.x, standAt(at.x, at.z) + foot, at.z))
  })
  // In the torch, the lamp burns where the torch rests, the arm's sway left out (2026-10-11): it moves with the child
  // and never swings with his arm. Else it hangs over the meat, easing after it.
  if (look.lamp.inFlame) lamp.position.copy(torchRest)
  else lamp.position.set(lampAt.x, hallPage ? hallLamp.height : LIGHT_HEIGHT + (goosePage ? stood : 0), lampAt.z)
  fogCentre.value.set(shown.x, shown.z)
  // The sun stays over the light, so its shadows always cover the view.
  sun.target.position.set(shown.x, 0, shown.z)
  sun.position.copy(sun.target.position).add(look.sun)
  // The same share of the gap a second whatever the frame rate; held, the frames' worth of it comes on the beat.
  owed += dt
  if (!(stop.enabled && stop.camera) || newBeat) {
    moved.set(light.x, stood, light.z).sub(followed).multiplyScalar(cameraFollow.lag > 0 ? 1 - Math.exp(-owed / cameraFollow.lag) : 1)
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
  const plantsReach = look.fog.enabled && !simulation ? fogEdge + 1.5 * look.fog.wisp + 0.5 : Infinity
  camera.updateMatrixWorld()
  plantsView.setFromProjectionMatrix(plantsMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem)
  const plantsSun = sun.castShadow ? plantsSunward.subVectors(sun.position, sun.target.position).normalize() : undefined
  deadTreesMesh?.cullPast(shown.x, shown.z, plantsReach, plantsView, plantsSun)
  bushesMesh?.cullPast(shown.x, shown.z, plantsReach, plantsView, plantsSun)
}
followed.y = standAt(light.x, light.z)
camera.position.set(light.x, followed.y, light.z).add(filming ? FILM_CAMERA : play ? WOODS_CAMERA : CAMERA_OFFSET)
if (filming) controls.target.set(light.x, followed.y, light.z).add(FILM_TARGET)
else controls.target.set(light.x, followed.y, light.z).add(play ? WOODS_TARGET : CAMERA_TARGET)
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
 * move and turn; saved as the route, the page loaded again on it.
 */
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
  const response = await fetch('/goose-route', { method: 'POST', body: JSON.stringify(toSave(route)) }).catch(() => undefined)
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
  // PROTOTYPE (`?tilt`): the diorama's camera, high over her, in place of any kept one.
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

/** The caption the child's lines show in; and the night the ending fades out to, with its last word. */
const said = document.getElementById('said')
const night = document.getElementById('end')
const endWords = night?.querySelector('span')
/** The colour the night goes in a strike's flash, and how many times brighter the rats' eyes glow at its height. */
const FLASH_COLOR = new Color(0xdfe4ff)
const EYES_FLASH = 4

/** The woods' frame past the play: the trees as the script has them, the rain, a strike's flash, the child crawling, and his line. */
function woodsFrame(dt: number) {
  if (!play) return
  // The environment pass strikes nothing: the big tree keeps its crown, the cracked one stands.
  scenery?.update(play.t, environment ? Number.NaN : play.fellAt, run, !environment)
  // The strikes: their bolts, and their flash, the night lit pale for a moment, flickering, the rats' eyes flaring in it.
  const strikes = environment ? [] : strikesOf(play)
  lightning?.update(play.t, strikes, run.holder, groundAt)
  flashFrame(Math.max(0, ...strikes.map((strike) => flashAt(play.t - strike.time))))
  // The rain: its streaks round the child, its splashes on the river.
  rainAmount.update(dt, play.raining)
  rainStreaks?.update(dt, rainAmount.amount, light.x, light.z)
  river?.update(clock, rainAmount.amount)
  // The placeholder crawl: lowered, tipped forward the way he faces, his clips slower. The placeholder push: leant into the
  // cart, walking.
  crawled += ((play.crawling ? 1 : 0) - crawled) * (1 - Math.exp(-dt / CRAWL_EASE))
  pushed += ((play.pushing ? 1 : 0) - pushed) * (1 - Math.exp(-dt / CRAWL_EASE))
  meat.object.quaternion.setFromAxisAngle(tipAxis.set(play.facing.z, 0, -play.facing.x), CRAWL_TILT * crawled + PUSH_TILT * pushed)
  meat.setRate(play.crawling ? CRAWL_RATE : 1)
  if (said) said.textContent = play.line()
}

/** A strike's flash, 0 to 1, laid on the night: the fog and sky gone pale, the fill and the sun up, the rats' eyes flaring. */
function flashFrame(flash: number) {
  fogColor.value.set(look.fog.color).lerp(FLASH_COLOR, flash * 0.7)
  sky.copy(fogColor.value)
  fill.intensity = look.fill.intensity * (1 + 6 * flash)
  sun.intensity = look.sun.intensity * (1 + 3 * flash)
  rats.setGlow('eyes', look.rats.glow * (1 + EYES_FLASH * flash))
}

/** A scene's fire as its folder edits it: its look, its fire zone and its reach, which holds the rats off. */
function sceneFirePanel(kind: FireScene) {
  const { fireZones, fireReach } = goosePlay!.settings
  return { look: fireLooks[kind], zone: fireZones[kind], reach: fireReach, kind }
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
    swarm.setWalls(nearestWalls([...ratWalls(run.walls()), ...roadRatWalls], holder.x, holder.z))
  }
  gooseScenes?.update(goosePlay, dt, gooseBone)
  if (gooseScenes) deadTreesMesh?.placeOwn(gooseScenes.ownTrees(goosePlay))
  goslings?.update(goosePlay, dt, held, gooseScenes && ((k) => gooseScenes.lift(goosePlay, k)))
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
  else if (goosePlay.atRefill) holdHint.update(at, goosePlay.run.torch.lit ? goosePlay.run.fuel : goosePlay.kindled, torchFilledOnce() ? 'hold to refill' : 'hold to light your torch')
  else if (unlit) holdHint.update(at, 0, 'light your torch', false)
  else holdHint.update(at, 0, 'find the key', false)
}

/** The nearest waiting gosling's call, over it or at the screen's edge on its side (callhint.ts); none in a take. */
const callHint = goosePlay && !filming ? createCallHint() : undefined
/** How near she comes before it stops calling, m; how high over its head the call sits, m. */
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
/**
 * The nearest gosling still waiting calling her, while she is further off than CALL_QUIET: only the nearest, so one
 * passed by falls quiet as she goes on, and she need not find them all.
 */
function callHintFrame(dt: number) {
  if (!goosePlay || !callHint) return
  const { holder } = goosePlay
  const away = (g: { x: number; z: number }) => Math.hypot(g.x - holder.x, g.z - holder.z)
  let next = -1
  goosePlay.goslings.forEach((g, k) => {
    if (g?.state === 'waiting' && (next < 0 || away(g) < away(goosePlay.goslings[next]!))) next = k
  })
  if (next < 0 || !torchFilledOnce() || away(goosePlay.goslings[next]!) < CALL_QUIET) {
    calling = -1
    return callHint.update(null, dt)
  }
  const g = goosePlay.goslings[next]!
  const off = away(g)
  if (next !== calling) {
    calling = next
    callUrgency = 0
  } else if (dt > 0) {
    const going = Math.min(1, Math.max(-1, (off - callAway) / dt / CALL_HURRY))
    callUrgency += (going - callUrgency) * (1 - Math.exp(-dt / CALL_SETTLE))
  }
  callAway = off
  // Over its head as drawn, up a tree or down a well; before the goslings are drawn, over its place.
  if (goslings) goslings.headOf(next, callFrom)
  else callFrom.set(g.x, standAt(g.x, g.z) + GOSLING_HEAD, g.z)
  callFrom.y += CALL_HEIGHT
  callFrom.project(camera)
  const far = Math.min(1, Math.max(0, (off - CALL_QUIET) / (CALL_FAR - CALL_QUIET)))
  const size = CALL_NEAREST + (CALL_LOUDEST - CALL_NEAREST) * far
  const box = renderer.domElement.getBoundingClientRect()
  callHint.update({ ...callAt(callFrom, box, CALL_MARGIN), size, far, urgency: callUrgency }, dt)
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
  const raining = rainStreaks?.object.visible ?? false
  if (rainStreaks) rainStreaks.object.visible = true
  lights.update(placed.map((light) => ({ ...light, on: true })))
  const fireShown = sceneFires.map(({ fire }) => fire.object.visible)
  for (const { fire } of sceneFires) fire.object.visible = true
  const pitShown = pitFires.map(({ fire }) => fire.object.visible)
  for (const { fire } of pitFires) fire.object.visible = true
  const torchParts = [flame.object, embers.object, smoke.object]
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
    if (rainStreaks) rainStreaks.object.visible = raining
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

/** The share built, 0 to 1, on the loading screen: its count, and its flame burning up. */
function showLoaded(share: number) {
  loadingScreen?.style.setProperty('--p', share.toFixed(3))
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
    whenBuilt(() => showLoaded((k + 1) / (frames + 1)))
    return
  }
  if (!swarm.ready || unseenBuilt) return
  buildUnseen(placed)
  post.render()
  whenBuilt(() => {
    showLoaded(1)
    loadingScreen?.classList.add('loaded')
    loaded = true
  })
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

/** When the child reached the door, s of the page's clock, NaN not yet; and where he stood. */
let wonAt = Number.NaN
const wonFrom = { x: 0, z: 0 }
/** The ending as it stands this frame, once the run is won: where the child walks in, the door, the night fading out. */
function endingNow(): EndingPose | undefined {
  if (!play || !run.won) {
    wonAt = Number.NaN
    return undefined
  }
  if (Number.isNaN(wonAt)) {
    wonAt = clock
    wonFrom.x = run.holder.x
    wonFrom.z = run.holder.z
  }
  return ending(play.woods, wonFrom, clock - wonAt)
}

/** Whether the child was out of sight through the door last frame: the look shows him again once the play starts over. */
let wentIn = false
/** The ending drawn: the child out of sight once through the door, the door swung, the night faded out and its word. */
function drawEnding(end: EndingPose | undefined) {
  scenery?.setDoor(end?.door ?? DOOR_AJAR)
  const gone = end !== undefined && !end.shown
  if (gone) for (const part of [meat.object, flame.object, embers.object, smoke.object]) part.visible = false
  else if (wentIn) lookChanged()
  wentIn = gone
  if (night) night.style.opacity = String(end?.fade ?? 0)
  if (endWords) endWords.style.opacity = String(end?.words ?? 0)
}

/**
 * The scripted shots over the orbit (#185): the pine's, in while the child is
 * on it; the end's, in once he reaches the door. Each comes in, and goes out,
 * over its seconds.
 */
const pineBlend = new ShotBlend(1.2)
const endBlend = new ShotBlend(1.2)
/** How high the child's chest is over where he stands, m, as the pine shot frames him. */
const CHEST = 0.9
const shotIn = () => pineBlend.weight > 0 || endBlend.weight > 0
/** The orbit as worked out this frame, the poses blended over it; and the orbit's camera kept, to put back once the frame is drawn. */
const orbitPose: Pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }
const pinePose: Pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }
const drawnPose: Pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }
const orbitAt = new Vector3()
const orbitTurn = new Quaternion()
const looking = new Vector3()

/** The camera stood at the shots as far in as they are, over the orbit, for this frame's drawing: true if it moved, to be put back after. */
function standAtShots(dt: number): boolean {
  if (play) {
    pineBlend.update(dt, !run.won && play.onPine(run.holder))
    endBlend.update(dt, run.won)
  }
  const moved = shotIn()
  if (moved && play) {
    orbitAt.copy(camera.position)
    orbitTurn.copy(camera.quaternion)
    Object.assign(orbitPose.position, { x: camera.position.x, y: camera.position.y, z: camera.position.z })
    Object.assign(orbitPose.target, { x: controls.target.x, y: controls.target.y, z: controls.target.z })
    let pose = orbitPose
    if (pineBlend.weight > 0) pose = blendPoses(pose, pineShot(play.woods, pineShare(play.woods, run.holder), stood + CHEST), pineBlend.eased, pinePose)
    if (endBlend.weight > 0) pose = blendPoses(pose, endShot(play.woods), endBlend.eased, drawnPose)
    camera.position.set(pose.position.x, pose.position.y, pose.position.z)
    camera.lookAt(pose.target.x, pose.target.y, pose.target.z)
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

  // The run, a frame of it: the holder walks where the keys or the loop send it, the torch burns, a flame refuels it,
  // and the rats the swarm last found at the holder catch the player once the torch is out. Paused, it holds. In the
  // woods the play plays it, on the keys, and sets its rats down.
  if (!settings.paused && !loading) {
    if (play) {
      const toward = heading()
      const way = toward && { x: toward.x - run.holder.x, z: toward.z - run.holder.z }
      play.frame(dt, { heading: way, toggleCrawl, crawlHeld: pressed.has(CRAWL_HELD), interact: pressed.has(INTERACT) })
      toggleCrawl = false
      run = play.run
    } else if (goosePlay) {
      const toward = heading()
      // Slower in the water: her walking pace given way to her swimming one as she takes to it.
      const swimming = pondLook ? swimmingIn(pondLook, run.holder.x, run.holder.z, pondLook.goose) : 0
      goosePlay.settings.pace = settings.lightSpeed * (1 + (pondLook ? pondLook.goose.pace - 1 : 0) * swimming)
      if (torchEverlasting) run.fuel = 1
      goosePlay.frame(dt, {
        heading: toward && { x: toward.x - run.holder.x, z: toward.z - run.holder.z },
        interact: pressed.has(INTERACT),
        look: gooseCamera === 'chase' ? drawnForward : null,
      })
    } else {
      if (loop) loopTime += dt
      const toward = loop ? loopPoint(swarm.arena, loopTime) : heading()
      run.step({ dt, toward, speed: settings.lightSpeed, arena: swarm.arena, interact: pressed.has(INTERACT), reached: swarm.reached })
    }
  }
  if (play) woodsFrame(dt)
  if (goosePlay) gooseFrame(dt, held)
  if (torchChanged()) lookChanged()
  // The ending: the child walked in through the door, the light going with him.
  const end = endingNow()
  if (end) {
    light.x = end.x
    light.z = end.z
  }
  wind.update(settings.paused ? 0 : dt, (zone) => run.gusting(zone))
  // The lamp's pool follows the torch's reach as it burns down, as the light's hard radius does.
  lamp.distance = look.lamp.reach * light.strength
  const placed = run.lights()
  // What the swarm holds the rats off: the lights, and in the goose game the pond's water after them, drawn by nothing.
  const keptOff = goosePlay ? goosePlay.lights() : placed
  // A gate opened or shut: the walls as they now stand, for the swarm and every light's lit area. The woods' gate stops
  // the child alone, and the play hands its swarm the walls near him.
  if (!play && run.wallsVersion !== wallsSeen) {
    wallsSeen = run.wallsVersion
    const standing = run.walls()
    areas.setWalls(new Walls(standing))
    swarm.setWalls(ratWalls(standing))
    // The goose game's road walls handed over again with them, on its next frame.
    ratWallsAt.x = NaN
  }
  // Caught, or set down at a checkpoint: the rats placed again, out of the lights and the torch's room round the holder.
  // The play sets the woods' own down.
  if (!play && run.starts !== startsSeen) {
    startsSeen = run.starts
    swarm.restart([...keptOff, { x: swarmLight.x, z: swarmLight.z, reach: tuning.ringMax * light.strength + RESTART_ROOM, on: true }])
  }
  walls.update(run, clock)
  swarmTime.value = swarm.time
  lights.update(placed)
  lightTheFog(placed)
  refillZonesFrame(placed)
  // The lamp, the fog, the sun and the camera after the light, before the swarm is told what the fog hides: this frame's fog, not the last one's.
  follow(dt, newBeat, frame)
  holdHintFrame()
  callHintFrame(dt)
  editMode?.frame()
  orthoFrame()
  // The shots over the orbit, before anything reads the camera for this frame's drawing.
  const shot = standAtShots(dt)
  drawEnding(end)
  // Out of sight through the door, nothing is cut away round him.
  if (end && !end.shown) seeThroughAt.set(shown.x, -1000, shown.z)
  else seeThroughAt.set(shown.x, stood + 0.8, shown.z)
  walls.seeThroughTo(seeThroughAt)
  scenery?.seeThroughTo(seeThroughAt)
  gooseSee?.subject.value.set(seeThroughAt.x, end && !end.shown ? seeThroughAt.y : stood + gooseSeeLook.height, seeThroughAt.z)
  if (gooseSee) gooseSeeZone?.update(gooseSee.subject.value, camera, gooseSeeLook)
  cutSeenThrough()
  corridor?.seeThroughTo(seeThroughAt)
  // The swarm keeps the rats off the torch where it rests, the one place the loop is drawn round, not off the holder
  // and not off the swaying flame: a run's swing moved the edge by up to 38 cm at the stride. In the goose game, off
  // the goose herself, her light centred on her and her goslings, as her lamp is.
  const lightCentre = goosePage ? light : torchRest
  swarmLight.x = lightCentre.x
  swarmLight.z = lightCentre.z
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
    settings.bringRound && !play ? { x: shown.x, z: shown.z, radius: darkRadius() + margin, ...(goosePage && { view: groundView(margin) }) } : undefined
  const wanted = Math.round(settings.rats * quality.step.rats)
  // The goose game's goslings in the dark pull the rats near them (#188).
  swarm.send(play ? play.swarm.count : wanted, swarmLight, tuning, settings.paused || (loading && loadFrame !== STEP_FRAME), dark, keptOff, goosePlay?.targets)
  // The places: every frame when smooth; on the beat when held; and the first time a state is there, whatever the beat.
  if (!(stop.enabled && stop.swarm) || !swarm.ready) swarm.sample(performance.now())
  else if (stop.stagger) swarm.sampleStaggered(performance.now(), clock, stop.fps)
  else if (newBeat) swarm.hold(performance.now())
  flame.face(camera)
  for (const { fire } of sceneFires) fire.face(camera)
  for (const { fire } of pitFires) fire.face(camera)
  // The smoke on the run's held time too, trailing from the flame's tip as the camera now sees it.
  smoke.update(held, flame.tip(flameTip), camera.position)
  // The embers on the run's held time, so they hold on the beat; born where the flame burns.
  embers.update(held, flameAt)
  // The gaits belong to the stop motion: cut on the beat they read as frames; smooth, every rat runs, as before them.
  // The levels of detail count the depth of field: a rat it blurs is drawn no finer than it shows (ADR-0057).
  // The tilt's band blurs by the screen and not by distance: the rats drawn in full under it.
  const blurred = look.dof.enabled && quality.step.dof && !tilt?.look.enabled
  const focus = look.dof.onLight ? camera.position.distanceTo(lamp.position) : look.dof.focus
  rats.staggerCentre(light.x, light.z)
  rats.focusOn(focus, Math.max(0.05, look.dof.focal), blurred ? look.dof.bokeh * 2 * look.rats.levels.blur : 0)
  rats.draw(swarm, camera, stop.enabled)
  if (blurred && look.dof.onLight) post.focusAt(focus)
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
  // Before the first strike the child is alone: no rat, and no eye in the fog. Without the opening, the rats come at once.
  if (play) rats.object.visible = !(play.settings.opening && play.t < play.woods.strike)
  fallingLeaves?.update(dt, followed.x, followed.z)
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
