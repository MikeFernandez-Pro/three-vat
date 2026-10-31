// The settings panel and the readouts: what makes the swarm tunable and
// measurable. The panel is three's own copy of lil-gui, so the game installs
// nothing for it; the readouts are one line of text, top-left.
import { Controller, GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import type { AOLook, BloomLook, DarkLook, DofLook, GrainLook, HatchLook, OutlineLook, PaletteLook, PostLook, ScreenLook, VignetteLook } from './post'
import { PAINTED_FLOORS, STYLIZED_FLOORS, type BedLook, type FloorLook, type RoadLook, type WellGroundLook } from './ground'
import type { RoadShape } from './road'
import type { ArchLook, ArchShell, ArchStone } from './arches'
import { ROAD_WALL_STYLES, type RoadWallLook } from './roadwalls'
import { BARKS, type BarkLook, type DeadTreeShape, type GrassLook, type LeafLook } from './deadtrees'
import { CART_WOODS, type CartWoodLook } from './cartwood'
import type { TreeWindLook } from './treesway'
import { MAX_EMBERS } from './embers'
import type { FlameLook } from './flame'
import type { FireShadowLook } from './fireshadow'
import type { FeatherLook } from './feathers'
import { characterLabel, swims, type MeatLook, type MeatPart } from './meat'
import type { PaintLook, ShellLook } from './shell'
import type { LevelsLook, Part, StaggerLook, TrailLook, Variant } from './rats'
import type { ToonLook } from './toon'
import type { NoiseSeeThrough } from './blockout'
import { FLEE_REACTION, FLEE_TURN, type Tuning } from './swarm'
import type { Level, RunTuning } from './run'
import type { FireScene, GooseSettings, ZoneSetting } from './gooseplay'
import type { CageLook, KeyInWing, SceneFireLook, TreeLook } from './goosescenes'
import type { GoslingSpeeds } from './goslings'
import { NEEDLE_DEFAULTS, NEEDLE_TEXTURES, type NeedleLook, type NestLook } from './nest'
import type { TentLook } from './tent'
import { MOST_GOSLINGS, type IslandGeeseLook } from './islandgeese'
import type { PondLook } from './pond'
import type { RollingLook } from './rolling'
import type { WaterLook } from './water'
import { addTiltFolder, type TiltShift } from './tiltshift'

/** What the panel edits. The page reads it, and is told when a group of it changes. */
export interface Settings {
  rats: number
  /** The slowest and fastest rat, m/s, running in for the light. */
  minSpeed: number
  maxSpeed: number
  /** And with its back to the light, whatever turned it, by how squarely it is turned. */
  fleeMinSpeed: number
  fleeMaxSpeed: number
  /** How big a rat is: 1 at its usual size, a body about 0.25 m long. It scales the collision disc with it. */
  size: number
  /** How many times the slowest rat's size the fastest is: 1 all one size. The mean rat stays at `size`, and so does the collision disc. */
  sizeBySpeed: number
  /** How much room a rat keeps round it, on top of its size: 1 as drawn, 2 a disc twice as wide, so half as many fit the same ground. */
  spacing: number
  /** The torch lit, as far as the debug switch goes: out, it is out whatever its fuel. */
  on: boolean
  /** The debug keys: Q and E turn the torch's reach up and down, F puts it out and relights it. Off, they do nothing. */
  debug: boolean
  shadows: boolean
  /** How fast every rat's Run plays: 1 the clip as authored, a 0.5 m bound every half second. */
  runAnimation: number
  /** How fast the light walks, m/s. */
  lightSpeed: number
  /** Paused: the swarm, the run and the light's walk all hold; the camera still moves. */
  paused: boolean
  /** Rats left behind in the fog are brought round ahead of a walking light, in the fog still: the crowd it walks into never thins. */
  bringRound: boolean
  /** How far off a rat out of the camera's view is still near enough not to be brought round, m, the fog nearer where it is on: the goose game's. */
  roundPast?: number
  /** The character drawn, with the torch it carries: its flame, embers and smoke. Off, the light alone stays, burning where the flame would. */
  character: boolean
}

/**
 * How the scene looks, every control in the panel's look folders. Colours are
 * hex numbers; angles are degrees; distances metres.
 */
export interface Look {
  /**
   * The warm light the holder carries: its reach is where it fades to nothing
   * at full strength, and shrinks with the strength as the light's hard radius
   * does; its falloff how fast it gets there, its lag how many seconds it
   * eases after the holder; and whether it burns in the torch's flame, or
   * hangs where a holder's hand would carry it.
   */
  lamp: { color: number; intensity: number; reach: number; falloff: number; lag: number; inFlame: boolean }
  /**
   * The one light from far away: where it sits from the light it follows, in
   * metres, which sets the way it shines; and how soft its shadows' edges are.
   */
  sun: {
    color: number
    intensity: number
    x: number
    y: number
    z: number
    shadows: boolean
    softness: number
    /** How dark its shadows fall: 0 none, 1 none of the sun's light gets in. */
    darkness: number
    /** The colour of the sun's light that gets into its shadows, as far as `darkness` keeps it out: black, none, as three draws a shadow. */
    shadowColor: number
  }
  /** The cold fill: a colour from above, another from below. */
  fill: { sky: number; ground: number; intensity: number }
  /**
   * The fog round the light, on or off, which the sky shares: clear up to `near` metres
   * from the light, solid from `far`, and between them as thick as `density`
   * makes it (1 a plain ramp, more thick soon past near); its edge frayed by
   * wisps of noise `scale` metres wide that push it in and out by up to `wisp`
   * metres and blow along the ground at `drift` m/s. Where the page gives it a `horizon`, the fog and the sky
   * turn to that colour where the look runs level, the fog's own `band` degrees above or below.
   */
  fog: { enabled: boolean; color: number; horizon?: number; band?: number; near: number; far: number; density: number; wisp: number; scale: number; drift: number; lit?: number; litColor?: number; litSpread?: number }
  /**
   * The rats' colours: one for each part the model has, in the model's own to
   * start, and a tint over them all; the variants, each a tint over its share
   * of the rats, the eyes left out; their shell's sheen and highlight; and
   * their toon steps.
   */
  rats: { color: number; parts: Part[]; variants: Variant[]; glow: number; toon: ToonLook; paint: PaintLook; levels: LevelsLook; stagger: StaggerLook } & ShellLook
  /** The flagstone floor: how light, how saturated, how big a tile is in metres, how deep its relief; its shell; its painted normals; its toon steps. */
  floor: FloorLook & { shell: ShellLook; paint: PaintLook; toon: ToonLook }
  /** The ambient occlusion over the frame. */
  ao: AOLook
  /** The inked outlines over the frame. */
  outline: OutlineLook
  /** The posterized palette the frame ends in. */
  palette: PaletteLook
  /** Hatching in the frame's shade. */
  hatch: HatchLook
  /** Paper under the frame and grain over it. */
  grain: GrainLook
  /** The vignette closing the corners. */
  vignette: VignetteLook
  /** The finished frame's saturation. */
  screen: ScreenLook
  /** The depth of field, the tabletop's shallow focus. */
  dof: DofLook
  bloom: BloomLook
  /** The meat at the light. */
  meat: MeatLook
  /** The flame on top of it. */
  flame: FlameLook
  /** The trails the glowing eyes leave. */
  trails: TrailLook
  /** The stop-motion effect: the rats' run and their places held between beats, the camera and the world smooth. */
  stopMotion: StopMotionLook
}

/** What the stop motion folder edits. */
export interface StopMotionLook {
  enabled: boolean
  /** Beats a second: 12 is animation on twos, 8 on threes. */
  fps: number
  /** Whether the run clip steps on the beat. */
  run: boolean
  /** Whether the rats' places and facings step on the beat. */
  swarm: boolean
  /** Whether the lamp, its pool and the fog ring step on the beat; the swarm still reads the light where it really is. */
  light: boolean
  /** Whether the camera's follow of the light steps on the beat; the mouse still moves it every frame. */
  camera: boolean
  /** Between beats: each beat a photograph of its own, nothing identical to the last. Each on its switch, with its amount. */
  shadeWobble: boolean
  /** How far the toon steps move, as a share of the gradient. */
  shadeAmount: number
  lightFlicker: boolean
  /** How far the lights' intensities vary, as a share. */
  lightAmount: number
  strokeJitter: boolean
  /** How far the painted strokes move, in tiles of strokes. */
  strokeAmount: number
  frameJitter: boolean
  /** How far the whole frame moves, px. */
  frameAmount: number
  /** Whether the paper's fibres move on the beat. */
  paperOnBeat: boolean
  /** Whether some beats hold half as long again, and how many of them. */
  uneven: boolean
  unevenShare: number
  /** Whether each rat holds on a beat of its own phase, so the mass does not snap all at once. */
  stagger: boolean
  /** The boil: the rats' surface re-touched every beat, by how much, m, over bumps how many to the metre. */
  boil: boolean
  boilAmount: number
  boilScale: number
  /** Whether a held time lands on a baked pose of the run, never a blend of two. */
  snap: boolean
}

/** The part of the swarm's tuning the crowd folder edits, in place: the swarm reads it every step. */
export type CrowdTuning = Pick<Tuning, 'agitation' | 'lookAhead' | 'gap' | 'pile' | 'pileRamp' | 'notice' | 'pull' | 'ringMax' | 'dashRate' | 'dashSpeed' | 'dashTime' | 'weave' | 'reaction' | 'turnRate' | 'fleeReaction' | 'fleeTurn' | 'wander' | 'roam'>

export interface PanelEvents {
  /** The rats slider was let go. */
  count(): void
  /** A speed slider moved: once a move, never a frame. */
  speeds(): void
  /** The rat scale, size by speed or spacing slider moved: once a move, never a frame. */
  size(): void
  /** The run animation slider moved. */
  animation(): void
  /** The torch was put out or relit by the debug switch. */
  light(): void
  /** The lamp's shadows toggle flipped. */
  shadows(): void
  /** Any control in a look folder moved. */
  look(): void
  /** A floor picked in the floor folder: its own look laid into the folder's values, before `look`. */
  floor(): void
}

/** The tilt-shift, for its folder in the postprocessing folder: `placed` after its camera moves or it turns on or off. */
export interface TiltPanel {
  shift: TiltShift
  placed(): void
}

/** What the page asks of the panel once it is up. */
export interface Panel {
  /** The page moved the torch's reach itself, from the debug keys: show it on the slider. */
  showReach(): void
  /** The page moved a value the panel shows, from a key: show every control's value again. */
  refresh(): void
}

/** What the run folder edits: the run's tuning and the level's lights, both read live; and where the run starts again, for testing a late section. */
export interface RunPanel {
  tuning: RunTuning
  level: Level
  /**
   * The goose game's knobs: its holds, read live, and the rats' seed, set again by `reseed`; and
   * its pond's look, laid again by `changed`.
   */
  goose: { settings: GooseSettings; reseed(seed: number): void; refillZones?: { show: boolean }; dark?: DarkLook; feel?: GooseFeel; introLight?: { show: boolean; color: number; intensity: number; reach: number; height: number; fadeIn: number; fadeOut: number }; goslings?: GoslingSpeeds; goslingSize?: { height: number }; road?: { shape: RoadShape; shapeChanged(): void; look: RoadLook; changed(): void; arches?: { look: ArchLook; countChanged(): void } }; doors?: { stone: ArchStone; stoneChanged(): void; shell: ArchShell; shellChanged(): void }; walls?: { look: RoadWallLook; changed(): void; stone: ArchStone & { offsetX: number; offsetY: number }; stoneChanged(): void; shell: ArchShell; shellChanged(): void }; trees?: { look: { show: boolean; wood: number; saturation: number; y: number; trunk: number; rings: number }; shape: DeadTreeShape; changed(): void; woodChanged(): void; yChanged(): void; trunkChanged(): void; bark: BarkLook; barkChanged(): void; grass: GrassLook; grassChanged(): void; leaves?: LeafLook; leavesChanged(): void; wind: TreeWindLook; windChanged(): void; shine: ShineLook; shineChanged(): void }; bushes?: { look: { show: boolean; y: number }; shape: DeadTreeShape; changed(): void; leaves: LeafLook; leavesChanged(): void; yChanged(): void }; well?: { colours: Record<string, number>; glows: Record<string, number>; changed(): void; bucket?: { x: number; y: number; z: number }; zone?: ZoneSetting; ground?: { look: WellGroundLook; changed(): void }; fire?: { x: number; z: number }; reach?: { wellFireReach: number }; shine?: { look: ShineLook; changed(): void }; pit?: { look: { colour: number }; changed(): void; shine: ShineLook; shineChanged(): void } }; spawn?: { spawnReach: number; spawnFear: number }; fires?: FiresPanel; tree?: { look: TreeLook; zone?: ZoneSetting; landing?: { x: number; z: number }; jump?: { treeJump: number }; fire?: SceneFirePanel & { at: { x: number; z: number } } }; cage?: { zone: ZoneSetting; hold: { cageHold: number }; key: { zone: ZoneSetting; beside: { x: number; z: number }; inWing?: KeyInWing; bones: readonly string[] }; fire: SceneFirePanel & { at: { x: number; z: number } }; look?: CageLook; colours?: { colours: Record<string, number>; glows?: Record<string, number>; changed(): void }; shine?: { cart: ShineLook; skull: ShineLook; changed(): void }; wood?: { look: CartWoodLook; changed(): void } }; pond?: { look: PondLook; changed(): void; water: WaterLook; waterChanged(): void; bed: BedLook; bedChanged(): void; nest?: { look: NestLook; changed(): void; needles: NeedleLook; needlesChanged(): void; leaves: LeafLook; leavesChanged(): void }; tent?: { look: TentLook; changed(): void; recolour(): void; shineChanged(): void }; bonfire?: { look: { show: boolean; x: number; z: number; y: number; turn: number; size: number; flame: number; intensity: number; reach: number }; changed(): void }; geese?: IslandGeeseLook }; ground?: { look: RollingLook; changed(): void; arches?: { look: ArchLook; changed(): void } }; seeThrough?: { look: NoiseSeeThrough; changed(): void }; camera?: GooseCameraPanel }
  /** Start the run again at checkpoint `checkpoint`, by its gate's index, or the start at -1. */
  startAt(checkpoint: number): void
}

/**
 * The goose game's camera folder: how far behind her the camera's follow runs, s, read live; the field of view; a button that captures where
 * the camera now is from her, its angle and its distance, returning it as text to show; and one that forgets it.
 */
/**
 * How the goose game's father feels to play: how long his walk takes to all but reach the keys' pace, or a stop, s;
 * and a rat's bite on him: what it sounds as, at most one heard and seen a `gap` s however many bite him at once, all
 * at the hardest: his flinch, squashed down `squash` of his height, springing back over `lasts` s; his body flashing
 * `flash` of `flashColour`, fading over `flashLasts` s, and the frame's edges closing in `edge` of `edgeColour` with
 * it, more as his life runs low; the camera knocked the way the bite came, `knock` m, snapping back past where it was
 * over `knockLasts` s; and feathers puffing off him (`feathers`).
 */
export interface GooseFeel {
  inertia: number
  bite: { sound: 'hiss' | 'honk'; gap: number; lasts: number; squash: number; flash: number; flashColour: number; flashLasts: number; edge: number; edgeColour: number; knock: number; knockLasts: number }
  feathers: { look: FeatherLook; changed(): void }
  /** How fast his death plays as he falls, 1 as made (J plays it through where he stands, to see it whole); the dark's timing follows it, `changed`. */
  death: { speed: number; changed(): void }
  /**
   * His torch, felt: running low, past `low` of its fuel, its flame `shrink` smaller and `gutter` more flickering, the
   * lamp dipping as deep as `dips`, the crackle `thin` quieter, all at their most as it goes out; the crackle `rise`
   * faster as a fire fills it. Catching full: the lamp `flare` brighter and the light `reach` further, settling over
   * `flareLasts` s; the flame `pop` taller, springing back over `popLasts` s; `sparks` sparks at `sparkSpeed` m/s; and the
   * camera nudged `knock` m back, settling over `knockLasts` s. A catch topped up from all but full, softer.
   */
  torch: { low: number; shrink: number; gutter: number; dips: number; thin: number; rise: number; flare: number; reach: number; flareLasts: number; pop: number; popLasts: number; sparks: number; sparkSpeed: number; knock: number; knockLasts: number }
}

export interface GooseCameraPanel {
  follow: { lag: number }
  /** The camera's field of view, degrees, read and set live; and whether it is near orthographic, set by `orthoChanged`. */
  lens: { fov: number; ortho: boolean; orthoChanged(): void }
  capture(): string
  forget(): void
}

/**
 * The torch put out and relit, and the pause, as F and P do them and the
 * panel's buttons do: for a page with the panel or without one. F is a debug
 * key, and does nothing unless the debug keys are on; the button always
 * works. `changed` after the light; `labelled` after either, for a panel's
 * buttons to read right.
 */
export function lightAndPause(settings: Settings, changed: () => void, labelled: () => void = () => {}): { toggleLight(): void; togglePause(): void } {
  const actions = {
    toggleLight() {
      settings.on = !settings.on
      labelled()
      changed()
    },
    togglePause() {
      settings.paused = !settings.paused
      labelled()
    },
  }
  // Captured on the way down: lil-gui stops keys from bubbling out of the panel.
  addEventListener(
    'keydown',
    (event) => {
      if ((event.code !== 'KeyF' && event.code !== 'KeyP') || event.repeat) return
      if (event.code === 'KeyF' && !settings.debug) return
      // Whatever in the panel was last clicked keeps the focus, and would take
      // the key as typing: a number field would read the letter.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      event.preventDefault()
      if (event.code === 'KeyF') actions.toggleLight()
      else actions.togglePause()
    },
    { capture: true },
  )
  return actions
}

/** The eyes' colours the panel offers by name; the picker takes any other. */
const EYE_PRESETS: Record<string, number> = {
  'blood red': 0xff1a1a,
  'ghost white': 0xe8f0ff,
  'ghost cyan': 0x3dfff2,
  'ice blue': 0x3d8bff,
  'witch violet': 0xb04dff,
  'hot magenta': 0xff2ad4,
  'toxic green': 0x0aff5c,
  'acid lime': 0x8cff1a,
  'pumpkin amber': 0xffa21a,
}

// A long name is cut to an ellipsis rather than pushing its slider off the
// panel, and reads in full on hover - the fix three's Inspector got for its
// parameter labels (mrdoob/three.js#35206). Every name goes through `name()`,
// the one lil-gui sets at construction included, so the tooltip follows renames.
const setName = Controller.prototype.name
Controller.prototype.name = function (this: Controller, name: string) {
  setName.call(this, name)
  this.$name.title = this.$name.textContent ?? ''
  return this
}

function truncateNames(): void {
  const style = document.createElement('style')
  style.textContent = `.lil-gui .controller > .name {
    width: var(--name-width); min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }`
  document.head.append(style)
}

// A filter box at the top of the panel, the one three's Inspector is to get for
// its Parameters tab (mrdoob/three.js#35061): typing part of a name keeps only
// the controls that match, opening the folders that hold them, and a folder
// whose own name matches keeps all of its controls. Clearing the box, or
// Escape, shows every control again and puts back which folders were open. It
// hides by a class of its own, so a control the panel hides itself, like a
// colour another switch stands in for, stays hidden either way.
function addFilter(gui: GUI): void {
  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = 'filter by name'
  input.setAttribute('aria-label', 'filter the panel by name')
  const box = document.createElement('div')
  box.className = 'panel-filter'
  box.append(input)
  gui.$children.prepend(box)

  const hide = (element: HTMLElement, out: boolean) => element.classList.toggle('filtered-out', out)
  const named = (controller: Controller, query: string) => !controller._hidden && (controller.$name.textContent ?? '').toLowerCase().includes(query)
  let openBefore: Map<GUI, boolean> | undefined

  // Whether the folder holds a match, opening the folders on the way to it.
  function filter(folder: GUI, query: string): boolean {
    let found = false
    for (const controller of folder.controllers) {
      const match = named(controller, query)
      hide(controller.domElement, !match)
      found ||= match
    }
    for (const inner of folder.folders) {
      const whole = inner._title.toLowerCase().includes(query)
      if (whole) for (const element of [...inner.controllersRecursive(), ...inner.foldersRecursive()]) hide(element.domElement, false)
      const holds = whole || filter(inner, query)
      hide(inner.domElement, !holds)
      if (holds) for (const open of whole ? [inner, ...inner.foldersRecursive()] : [inner]) open.open()
      found ||= holds
    }
    return found
  }

  input.addEventListener('input', () => {
    const query = input.value.trim().toLowerCase()
    if (query) {
      openBefore ??= new Map(gui.foldersRecursive().map((folder) => [folder, !folder._closed]))
      filter(gui, query)
    } else if (openBefore) {
      for (const element of [...gui.controllersRecursive(), ...gui.foldersRecursive()]) hide(element.domElement, false)
      for (const [folder, open] of openBefore) folder.open(open)
      openBefore = undefined
    }
  })
}

// Typing in the filter box is typing, not playing: the game's keys listen on
// the way down, ahead of the box, so they are stopped here, a listener taken on
// as this module loads, before any of theirs.
addEventListener(
  'keydown',
  (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement) || !input.closest('.panel-filter')) return
    event.stopImmediatePropagation()
    if (event.code !== 'Escape') return
    input.value = ''
    input.dispatchEvent(new Event('input'))
  },
  { capture: true },
)

// A folder's values as plain data, under the names the panel shows, its own
// folders nested inside: colours as hex, numbers rounded, buttons left out.
function folderValues(folder: GUI): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const controller of folder.controllers) {
    const kind = controller.domElement.classList
    if (kind.contains('function')) continue
    const value: unknown = kind.contains('color') ? (controller as Controller & { $input: HTMLInputElement }).$input.value : controller.getValue()
    values[controller.$name.textContent ?? controller.property] = typeof value === 'number' ? Math.round(value * 1e4) / 1e4 : value
  }
  for (const inner of folder.folders) values[inner._title] = folderValues(inner)
  return values
}

const icon = (path: string) =>
  `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`
const COPY_ICON = icon('<rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>')
const COPIED_ICON = icon('<path d="M3 8.5l3.2 3.2L13 5"/>')

// A button on the folder's title copying its values as JSON, a tick showing
// once they are. It lives in the title's markup, which `title()` rewrites, so
// a folder renamed after this loses it.
function addCopy(folder: GUI): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'panel-copy'
  button.title = 'copy these values as JSON'
  button.innerHTML = COPY_ICON
  // Neither a click nor a key on it reaches the title, which would fold the folder.
  button.addEventListener('keydown', (event) => event.stopPropagation())
  button.addEventListener('click', async (event) => {
    event.stopPropagation()
    await navigator.clipboard.writeText(JSON.stringify(folderValues(folder), null, 2))
    button.innerHTML = COPIED_ICON
    setTimeout(() => (button.innerHTML = COPY_ICON), 1200)
  })
  folder.$title.append(button)
}

function filterAndCopyStyles(): void {
  const style = document.createElement('style')
  style.textContent = `.lil-gui .filtered-out { display: none !important; }
  .lil-gui .panel-filter {
    position: sticky; top: 0; z-index: 1;
    padding: var(--spacing) var(--padding); background: var(--background-color);
  }
  .lil-gui .panel-filter input { padding: 0 var(--padding); box-sizing: border-box; }
  .lil-gui .title { position: relative; padding-right: calc(var(--padding) + 20px); }
  .lil-gui .title > .panel-copy {
    position: absolute; right: calc(var(--padding) - 4px); top: 50%; transform: translateY(-50%);
    width: auto; height: auto; padding: 3px 4px; line-height: 0;
    background: none; border: none; color: inherit; opacity: 0.45;
  }
  .lil-gui .title > .panel-copy:hover, .lil-gui .title > .panel-copy:focus-visible { opacity: 1; background: none; }`
  document.head.append(style)
}

/** The panel, its rats slider topped at `maxRats`. P pauses, and F, a debug key, puts the torch out and relights it, as their buttons do. */
export function createPanel(settings: Settings, crowd: CrowdTuning, look: Look, maxRats: number, changed: PanelEvents, run: RunPanel, tilt?: TiltPanel): Panel {
  truncateNames()
  const gui = new GUI({ title: 'A Goose Tale' })
  gui.add(settings, 'rats', 0, maxRats, 1).onFinishChange(changed.count)

  // The slowest never outruns the fastest.
  const min = gui.add(settings, 'minSpeed', 0.2, 12, 0.05).name('slowest m/s')
  const max = gui.add(settings, 'maxSpeed', 0.2, 12, 0.05).name('fastest m/s')
  keepOrdered(min, max, changed.speeds)
  const fleeMin = gui.add(settings, 'fleeMinSpeed', 0.2, 12, 0.05).name('flee slowest m/s')
  const fleeMax = gui.add(settings, 'fleeMaxSpeed', 0.2, 12, 0.05).name('flee fastest m/s')
  keepOrdered(fleeMin, fleeMax, changed.speeds)

  gui.add(settings, 'size', 0.5, 3, 0.05).name('rat scale').onChange(changed.size)
  gui.add(settings, 'sizeBySpeed', 1, 3, 0.05).name('fastest ÷ slowest size').onChange(changed.size)
  gui.add(settings, 'spacing', 0.5, 3, 0.05).name('spacing').onChange(changed.size)
  gui.add(settings, 'runAnimation', 0.1, 4, 0.05).name('run animation speed').onChange(changed.animation)
  // The light's strength, 0 to 1, where it was before the torch: the torch's reach as a share of the light's
  // full hard radius, so the lamp's pool and the rats' ring grow and shrink together.
  const lightStrength = {
    get strength() {
      return run.tuning.torchReach / crowd.ringMax
    },
    set strength(value: number) {
      run.tuning.torchReach = Math.round(value * crowd.ringMax * 100) / 100
    },
  }
  const strength = gui.add(lightStrength, 'strength', 0, 1, 0.01).name('light strength (Q / E)')
  gui.add(settings, 'lightSpeed', 0.2, 12, 0.1).name('light speed m/s')
  gui.add(settings, 'bringRound').name('rats come round ahead')
  if (settings.roundPast !== undefined) gui.add(settings as Required<Pick<Settings, 'roundPast'>>, 'roundPast', 5, 80, 1).name('come round off camera or past m')
  gui.add(settings, 'character').name('show character').onChange(changed.look)
  const actions = lightAndPause(settings, changed.light, label)
  const pauseButton = gui.add(actions, 'togglePause')
  const { folder: runFolder, reach } = addRun(gui, settings, run)
  // The strength and the reach are one value, each slider showing the other's moves.
  strength.onChange(() => reach.updateDisplay())
  reach.onChange(() => strength.updateDisplay())
  // Putting the torch out by hand is a debug tool: it sits in the run folder, by the debug keys' switch.
  const button = runFolder.add(actions, 'toggleLight')
  addCrowd(gui, crowd, false)
  addPull(gui, crowd)
  addLook(gui, settings, look, changed, tilt, run.goose.fires)
  if (run.goose?.ground) addGround(gui, run.goose.ground)
  if (run.goose?.pond) addPond(gui, run.goose.pond)
  if (run.goose?.goslingSize) gui.addFolder('goslings').add(run.goose.goslingSize, 'height', 0.05, 1, 0.01).name('scale (height m)')
  if (run.goose?.goslings) addGoslingSpeeds(gui, run.goose.goslings)
  // The soft light over the geese in the opening, read live.
  if (run.goose?.introLight) {
    const light = gui.addFolder('opening light')
    light.add(run.goose.introLight, 'show')
    light.addColor(run.goose.introLight, 'color')
    light.add(run.goose.introLight, 'intensity', 0, 10, 0.05)
    light.add(run.goose.introLight, 'reach', 0.5, 12, 0.1).name('reach m')
    light.add(run.goose.introLight, 'height', 0.5, 8, 0.05).name('over her m')
    light.add(run.goose.introLight, 'fadeIn', 0, 5, 0.1).name('fade in s')
    light.add(run.goose.introLight, 'fadeOut', 0, 5, 0.1).name('fade out s')
  }
  if (run.goose?.road) addRoad(gui, run.goose.road)
  if (run.goose?.doors) addDoors(gui, run.goose.doors)
  if (run.goose?.walls) addRoadWalls(gui, run.goose.walls)
  if (run.goose?.trees) addDeadTrees(gui, run.goose.trees)
  if (run.goose?.bushes) addBushes(gui, run.goose.bushes)
  if (run.goose?.spawn) {
    const spawn = gui.addFolder('spawn brazier')
    spawn.add(run.goose.spawn, 'spawnReach', 0, 10, 0.05).name('strength m (holds the rats)')
    spawn.add(run.goose.spawn, 'spawnFear', 0, 2, 0.01).name('rats keep off (x strength)')
  }
  if (run.goose?.well) addWell(gui, run.goose.well)
  if (run.goose?.tree) addTree(gui, run.goose.tree)
  if (run.goose?.cage) addCage(gui, run.goose.cage)
  if (run.goose?.seeThrough) addGooseSeeThrough(gui, run.goose.seeThrough)
  if (run.goose?.camera) addGooseCamera(gui, run.goose.camera)
  // Every folder closed to start, the swarm's own controls in view; each opens on a reset to the values the page started on.
  for (const folder of gui.foldersRecursive()) {
    const reset = folder.add({ reset: () => folder.reset() }, 'reset').name('reset to defaults')
    folder.$children.prepend(reset.domElement)
    folder.close()
  }
  filterAndCopyStyles()
  addFilter(gui)
  for (const folder of [gui, ...gui.foldersRecursive()]) addCopy(folder)

  function label() {
    button.name(settings.on ? 'put the torch out (F, debug)' : 'relight the torch (F, debug)')
    pauseButton.name(settings.paused ? 'resume (P)' : 'pause (P)')
  }
  label()

  return {
    showReach() {
      reach.updateDisplay()
      strength.updateDisplay()
    },
    refresh() {
      for (const controller of gui.controllersRecursive()) controller.updateDisplay()
    },
  }
}

type NumberController = ReturnType<GUI['add']>

/** Keeps `low` at or under `high`: moving either past the other drags the other along. Then `changed`, if given. */
export function keepOrdered(low: NumberController, high: NumberController, changed?: () => void): void {
  low.onChange((value: number) => {
    if (high.getValue() < value) high.setValue(value)
    changed?.()
  })
  high.onChange((value: number) => {
    if (low.getValue() > value) low.setValue(value)
    changed?.()
  })
}

/**
 * The run folder: how fast the torch burns, the last of its fuel its reach
 * shrinks over, its reach, how much faster the wind and its gusts burn it,
 * and each light's reach and whether it is lit; the debug keys' switch; and a start at any
 * checkpoint. The folder, and the torch's reach slider for the keys to show.
 */
function addRun(gui: GUI, settings: Settings, run: RunPanel): { folder: GUI; reach: NumberController } {
  const folder = gui.addFolder('run')
  folder.add(run.tuning, 'burnRate', 0, 0.2, 0.001).name('burns a second (of a full torch)')
  folder.add(run.tuning, 'fade', 0, 1, 0.01).name('reach shrinks over the last (of the fuel)')
  const reach = folder.add(run.tuning, 'torchReach', 0, 3, 0.01).name('torch reach m (Q / E)')
  folder.add(run.tuning, 'windDrain', 0, 0.2, 0.001).name('wind burns a second, on top')
  folder.add(run.tuning, 'gustDrain', 0, 0.5, 0.001).name('a gust burns a second, on top')
  run.level.lights.forEach((light, i) => {
    const name = `${light.flame && light.fragile !== undefined ? 'fragile flame' : light.flame ? 'brazier' : 'light'} ${i + 1}`
    folder.add(light, 'reach', 0, 6, 0.05).name(`${name} reach m`)
    folder.add(light, 'on').name(`${name} lit`)
  })
  if (run.goose) {
    const { settings: goose, reseed, refillZones } = run.goose
    folder.add(goose, 'wellHold', 0.5, 15, 0.1).name('the well winched up in s')
    folder.add(goose, 'refillHold', 0.2, 10, 0.1).name('a fire fills the torch in s')
    folder.add(goose, 'lightLetGo', 0.1, 5, 0.05).name('let go unlit, the torch goes out in s')
    folder.add(goose, 'treeHold', 0.1, 5, 0.05).name('the dead tree gosling called down in s')
    folder.add(goose, 'herBite', 0, 1, 0.01).name('a rat bites her life a second')
    folder.add(goose, 'healAfter', 0, 10, 0.1).name('life heals after s unbitten')
    folder.add(goose, 'heal', 0, 2, 0.01).name('life heals a second')
    // How he feels to play: his walk's ease, and a bite on him.
    const { feel } = run.goose
    if (feel) {
      const felt = gui.addFolder('feel')
      felt.add(feel, 'inertia', 0, 1, 0.01).name('reaches his pace or stops in s')
      felt.add(feel.bite, 'sound', ['hiss', 'honk']).name('a bite sounds as')
      felt.add(feel.bite, 'gap', 0, 3, 0.05).name('a bite heard and seen once a s at most')
      felt.add(feel.bite, 'squash', 0, 0.5, 0.01).name('a bite squashes him (share of his height)')
      felt.add(feel.bite, 'lasts', 0.05, 1, 0.01).name('his flinch springs back over s')
      felt.add(feel.bite, 'flash', 0, 3, 0.05).name('a bite flashes his body')
      felt.addColor(feel.bite, 'flashColour').name('the flash colour')
      felt.add(feel.bite, 'flashLasts', 0.05, 2, 0.01).name('the flash fades over s')
      felt.add(feel.bite, 'edge', 0, 1, 0.01).name('a bite closes the edges in')
      felt.addColor(feel.bite, 'edgeColour').name('the edges colour')
      felt.add(feel.bite, 'knock', 0, 0.6, 0.005).name('a bite knocks the camera m')
      felt.add(feel.bite, 'knockLasts', 0.05, 2, 0.01).name('the knock settles over s')
      const dying = felt.addFolder('his death (J: see it whole)')
      dying.add(feel.death, 'speed', 0.25, 3, 0.05).name('plays at').onChange(() => feel.death.changed())
      const torch = felt.addFolder('his torch')
      torch.add(feel.torch, 'low', 0, 1, 0.01).name('runs low under (share of its fuel)')
      torch.add(feel.torch, 'shrink', 0, 1, 0.01).name('its flame smaller, all but out')
      torch.add(feel.torch, 'gutter', 0, 5, 0.05).name('its flame wilder, all but out')
      torch.add(feel.torch, 'dips', 0, 1, 0.01).name('guttering dips its light')
      torch.add(feel.torch, 'thin', 0, 1, 0.01).name('its crackle quieter, all but out')
      torch.add(feel.torch, 'rise', 0, 2, 0.01).name('its crackle faster as it fills')
      torch.add(feel.torch, 'flare', 0, 4, 0.05).name('caught, its light brighter')
      torch.add(feel.torch, 'reach', 0, 1, 0.01).name('caught, its light further (share)')
      torch.add(feel.torch, 'flareLasts', 0.05, 3, 0.01).name('the flare settles over s')
      torch.add(feel.torch, 'pop', 0, 2, 0.01).name('caught, its flame taller')
      torch.add(feel.torch, 'popLasts', 0.05, 2, 0.01).name('the flame springs back over s')
      torch.add(feel.torch, 'sparks', 0, 24, 1).name('caught, sparks thrown')
      torch.add(feel.torch, 'sparkSpeed', 0, 8, 0.05).name('the sparks fly m/s')
      torch.add(feel.torch, 'knock', 0, 0.3, 0.005).name('caught, the camera nudged m')
      torch.add(feel.torch, 'knockLasts', 0.05, 2, 0.01).name('the nudge settles over s')
      const plumes = felt.addFolder('feathers')
      const { look: plume, changed: plumeChanged } = feel.feathers
      plumes.add(plume, 'count', 0, 16, 1).name('puff off at the hardest bite')
      plumes.add(plume, 'size', 0.02, 0.3, 0.005).name('long m')
      plumes.add(plume, 'out', 0, 5, 0.05).name('fly out m/s')
      plumes.add(plume, 'up', 0, 5, 0.05).name('fly up m/s')
      plumes.add(plume, 'fall', 0.05, 3, 0.05).name('fall at most m/s')
      plumes.add(plume, 'sway', 0, 0.6, 0.01).name('sway m')
      plumes.add(plume, 'lies', 0, 10, 0.1).name('lie where they land s')
      plumes.addColor(plume, 'colour').name('colour').onChange(plumeChanged)
      plumes.add(plume, 'glow', 0, 1, 0.01).name('show in the dark').onChange(plumeChanged)
    }
    // Her death's dark over the screen (post.ts).
    const { dark } = run.goose
    if (dark) {
      const shade = gui.addFolder('dark (her death, K)')
      shade.add(dark, 'progress', -1, 1, 0.01).name('progress (-1 plays as she dies)')
      shade.add(dark, 'after', 0, 6, 0.05).name('waits as he dies s')
      shade.add(dark, 'finish', 0.1, 5, 0.05).name('goes black in s')
      shade.add(dark, 'scale', 0.2, 20, 0.1).name('noise scale')
      shade.add(dark, 'stretch', 0.2, 12, 0.1).name('noise stretch across')
      shade.add(dark, 'twist', -20, 20, 0.1).name('swirl rad at her')
      shade.add(dark, 'swirlRadius', 0.02, 2, 0.01).name('swirl falls off over')
      shade.add(dark, 'spin', -10, 10, 0.05).name('spin rad a second')
      shade.add(dark, 'churn', 0, 10, 0.05).name('noise churn a second')
      shade.add(dark, 'edge', 0, 0.3, 0.005).name('edge softness')
      shade.add(dark, 'radial', 0, 2, 0.01).name('far from her first')
    }
    folder.add(goose, 'seed', 1, 999, 1).name('rats seed').onFinishChange(reseed)
    // DEBUG: where things are done: the flames' dips, orange; the lanterns, blue; the scenes worked with the interact key, red.
    if (refillZones) folder.add(refillZones, 'show').name('show interaction zones')
  }
  folder.add(settings, 'debug').name('debug keys (Q / E reach, F out)')
  // The checkpoints by their gates, in the order the way on passes them; the start first.
  const at = { checkpoint: -1 }
  const checkpoints: Record<string, number> = { start: -1 }
  run.level.gates.forEach((_, g) => (checkpoints[`checkpoint ${g + 1}`] = g))
  folder.add(at, 'checkpoint', checkpoints).name('start at')
  folder.add({ start: () => run.startAt(at.checkpoint) }, 'start').name('start the run there')
  return { folder, reach }
}

/** The goose game's camera folder: the follow's lag, the field of view, and the capture of where the camera is, shown to copy. */
/** The see-through round the goose: its hole as the sewer's is, its dither's Perlin noise. */
function addGooseSeeThrough(gui: GUI, { look, changed }: { look: NoiseSeeThrough; changed(): void }): void {
  const folder = gui.addFolder('see-through (noise dithering)')
  folder.add(look, 'enabled').name('on').onChange(changed)
  folder.add(look, 'radius', 0.25, 8, 0.05).name('hole radius m').onChange(changed)
  folder.add(look, 'inner', 0, 1, 0.01).name('clear core (share of radius)').onChange(changed)
  folder.add(look, 'strength', 0, 1, 0.01).name('strength (1 = clear)').onChange(changed)
  folder.add(look, 'bias', 0, 4, 0.05).name('nearer than her by m').onChange(changed)
  folder.add(look, 'height', 0, 2, 0.05).name('hole centre over the ground m')
  folder.add(look, 'noiseScale', 0.02, 3, 0.01).name('noise blot size m').onChange(changed)
  folder.add(look, 'contrast', 0.25, 6, 0.05).name('noise contrast').onChange(changed)
  folder.add(look, 'drift', -2, 2, 0.01).name('noise rise m/s').onChange(changed)
  folder.add(look, 'wobble', 0, 1, 0.01).name('edge wobble (share of radius)').onChange(changed)
  folder.add(look, 'wobbleScale', 0.1, 8, 0.05).name('edge lobes').onChange(changed)
  folder.add(look, 'wobbleSpeed', 0, 2, 0.01).name('edge change speed').onChange(changed)
  folder.add(look, 'debug').name('show the zone in red (debug)').onChange(changed)
}

function addGooseCamera(gui: GUI, camera: GooseCameraPanel): void {
  const folder = gui.addFolder('camera')
  folder.add(camera.follow, 'lag', 0, 3, 0.05).name('follow lag s')
  const fov = folder.add(camera.lens, 'fov', 10, 100, 1).name('field of view deg')
  folder.add(camera.lens, 'ortho').name('near orthographic (test)').onChange(() => {
    camera.lens.orthoChanged()
    fov.updateDisplay()
  })
  const shown = { captured: '' }
  const text = folder.add(shown, 'captured').name('captured')
  folder.add({ capture: () => text.setValue(camera.capture()) }, 'capture').name('capture camera (copied, kept for reloads)')
  folder.add({ forget: () => (camera.forget(), text.setValue('')) }, 'forget').name('forget captured camera')
}

/** The goslings' folder: how fast each of their clips plays, read live. */
function addGoslingSpeeds(gui: GUI, speeds: GoslingSpeeds): void {
  const folder = gui.addFolder('gosling animations')
  folder.add(speeds, 'idle', 0, 3, 0.05).name('idle animation speed')
  folder.add(speeds, 'run', 0, 3, 0.05).name('run animation speed')
  folder.add(speeds, 'waterIdle', 0, 3, 0.05).name('water idle animation speed')
  folder.add(speeds, 'swim', 0, 3, 0.05).name('swim animation speed')
}

/** The goose game's well folder: a colour for each of its file's materials, the bucket's among them, by the names Blender gave them; how bright those that glow glow; how far the bucket is drawn off its place; and where she winches it. */
/** The old road: its way up the plain, how much of it is left where, and its stones on the floor. */
function addRoad(gui: GUI, { shape, shapeChanged, look, changed, arches }: NonNullable<NonNullable<RunPanel['goose']>['road']>): void {
  const folder = gui.addFolder('road')
  const way = [
    folder.add(shape, 'side', 0, 5, 0.05).name('passes a fire m off it'),
    folder.add(shape, 'wander', 0, 6, 0.05).name('strays sideways m'),
    folder.add(shape, 'whole', 0, 12, 0.1).name('whole within m of a fire'),
    folder.add(shape, 'thins', 0.1, 20, 0.1).name('thins over m'),
    folder.add(shape, 'left', 0, 1, 0.01).name('left in the dark (0 none)'),
    folder.add(shape, 'behind', 0, 40, 0.5).name('runs back past the start m'),
  ]
  for (const controller of way) controller.onFinishChange(shapeChanged)
  const stones = [
    folder.add(look, 'width', 0, 6, 0.05).name('width m'),
    folder.add(look, 'edge', 0.01, 3, 0.01).name('edge fades over m'),
    folder.add(look, 'wobble', 0, 2, 0.01).name('edge wavers m'),
    folder.add(look, 'patchSize', 0.05, 8, 0.05).name('patch size m'),
    folder.add(look, 'breakup', 0, 6, 0.05).name('slabs sink from edges'),
    folder.add(look, 'patches', 0, 1, 0.01).name('patches take/leave'),
    folder.add(look, 'lightness', 0, 3, 0.01).name('lightness (dark/light)'),
    folder.add(look, 'saturation', 0, 3, 0.01).name('saturation'),
    folder.add(look, 'hue', -180, 180, 1).name('hue (degrees)'),
    folder.add(look, 'scale', 0.2, 10, 0.05).name('tile size m'),
    folder.add(look, 'rotation', -180, 180, 1).name('turn from the road (degrees)'),
    folder.add(look, 'relief', 0, 3, 0.01).name('relief (0 = flat)'),
  ]
  for (const controller of stones) controller.onChange(changed)
  if (!arches) return
  folder.add(arches.look, 'count', 0, 40, 1).name('arches along it').onChange(arches.countChanged)
}

/** The goose game's doors folder, the road's arches (arches.ts): the road's slabs on them, painted and tiled as the road folder's are, and their own toon shell, its highlight, rim, painted strokes and steps. */
function addDoors(gui: GUI, { stone, stoneChanged, shell, shellChanged }: NonNullable<NonNullable<RunPanel['goose']>['doors']>): void {
  const folder = gui.addFolder('doors')
  addStone(folder, stone, stoneChanged, 'turn along the arch (degrees)')
  addToonMaterial(folder, shell, shellChanged)
}

/**
 * The road's slabs on a piece of stone, as `stone` and `wet` folders under `folder`: painted, tiled and wet, each change
 * handed to `changed`; `turn` names the slabs' turn, its tiles' size and turn left out without one (the folder has them).
 */
function addStone(folder: GUI, stone: ArchStone, stoneChanged: () => void, turn?: string): void {
  const slabs = folder.addFolder('stone')
  slabs.add(stone, 'lightness', 0, 3, 0.01).name('lightness (dark/light)')
  slabs.add(stone, 'saturation', 0, 3, 0.01).name('saturation')
  slabs.add(stone, 'hue', -180, 180, 1).name('hue (degrees)')
  if (turn !== undefined) {
    slabs.add(stone, 'scale', 0.05, 10, 0.05).name('tile size m')
    slabs.add(stone, 'rotation', -180, 180, 1).name(turn)
  }
  slabs.add(stone, 'relief', 0, 3, 0.01).name('relief (0 = flat)')
  slabs.onChange(stoneChanged)
  // How wet the stone is, and where: rising from the ground, the top as wet as the rain leaves it, streaks run down.
  const { wet } = stone
  const water = folder.addFolder('wet')
  water.add(wet, 'wetness', 0, 1, 0.01).name('wetness (0 = dry)')
  water.add(wet, 'darken', 0, 1, 0.01).name('darker where wet')
  water.add(wet, 'saturate', 0, 2, 0.01).name('more saturated where wet')
  water.add(wet, 'shine', 0, 6, 0.01).name('highlight where wet ×')
  water.add(wet, 'dryShine', 0, 2, 0.01).name('highlight where dry ×')
  water.add(wet, 'fill', 0, 1, 0.01).name('water fills the joints (flatter)')
  water.add(wet, 'rise', 0, 6, 0.05).name('wet up from the ground m')
  water.add(wet, 'fade', 0.01, 4, 0.01).name('fades over m')
  water.add(wet, 'top', 0, 1, 0.01).name('wet above that (0 = dry)')
  water.add(wet, 'streaks', 0, 1, 0.01).name('drip streaks')
  water.add(wet, 'streakWidth', 0.02, 1, 0.01).name('streak width m')
  water.add(wet, 'streakLength', 0.2, 6, 0.05).name('streak length m')
  water.onChange(stoneChanged)
}

/** The goose game's walls folder, the road's broken walls (roadwalls.ts): which kind, how many, how far off the road, how tall, and their seed; their stone and shell the doors folder's. */
function addRoadWalls(gui: GUI, { look, changed, stone, stoneChanged, shell, shellChanged }: NonNullable<NonNullable<RunPanel['goose']>['walls']>): void {
  const folder = gui.addFolder('walls')
  folder.add(look, 'style', ROAD_WALL_STYLES).name('kind').onChange(changed)
  folder.add(look, 'count', 0, 30, 1).name('along the road').onFinishChange(changed)
  folder.add(look, 'off', 0.5, 6, 0.05).name('face off the road m').onFinishChange(changed)
  folder.add(look, 'height', 0.2, 3, 0.05).name('height ×').onFinishChange(changed)
  folder.add(look, 'thickness', 0.2, 4, 0.05).name('thickness ×').onFinishChange(changed)
  folder.add(look, 'length', 0.2, 4, 0.05).name('length ×').onFinishChange(changed)
  folder.add(look, 'seed', 1, 100, 1).name('seed').onFinishChange(changed)
  folder.add(stone, 'scale', 0.05, 10, 0.05).name('texture scale (tile m)').onChange(stoneChanged)
  folder.add(stone, 'rotation', -180, 180, 1).name('texture rotation (degrees)').onChange(stoneChanged)
  folder.add(stone, 'offsetX', -5, 5, 0.01).name('texture offset along m').onChange(stoneChanged)
  folder.add(stone, 'offsetY', -5, 5, 0.01).name('texture offset up m').onChange(stoneChanged)
  addStone(folder, stone, stoneChanged)
  addToonMaterial(folder, shell, shellChanged)
}

/** The goose game's dead trees folder (deadtrees.ts): shown or not, their wood and its saturation, how high all of them stand, their bark set laid as the floor's, and how they are scattered along the road, scattered again on release. */
function addDeadTrees(gui: GUI, { look, shape, changed, woodChanged, yChanged, trunkChanged, bark, barkChanged, grass, grassChanged, leaves, leavesChanged, wind, windChanged, shine, shineChanged }: NonNullable<NonNullable<RunPanel['goose']>['trees']>): void {
  const folder = gui.addFolder('dead trees')
  folder.add(look, 'show').name('show').onChange(changed)
  folder.addColor(look, 'wood').name('wood (texture none, or wood colour)').onChange(woodChanged)
  folder.add(look, 'saturation', 0, 2, 0.01).name('saturation (0 = grey)').onChange(woodChanged)
  folder.add(look, 'y', -3, 3, 0.01).name('position y m (all of them)').onChange(yChanged)
  folder.add(look, 'trunk', 0, 1, 0.01).name('trunk not dithered (share of height)').onChange(trunkChanged)
  folder.add(look, 'rings', 1, 30, 1).name('trunk cut rings').onChange(trunkChanged)
  const textured = folder.addFolder('bark texture')
  textured.add(bark, 'texture', [...BARKS]).name('texture')
  textured.add(bark, 'lightness', 0, 8, 0.01).name('lightness (dark/light)')
  textured.add(bark, 'wood', 0, 1, 0.01).name('wood colour (1 = relief only)')
  textured.add(bark, 'saturation', 0, 3, 0.01)
  textured.add(bark, 'hue', -180, 180, 1).name('hue (degrees)')
  textured.add(bark, 'scale', 0.1, 10, 0.05).name('tile size m')
  textured.add(bark, 'rotation', -180, 180, 1).name('rotation (degrees)')
  textured.add(bark, 'relief', 0, 3, 0.01).name('relief (0 = flat)')
  textured.onChange(barkChanged)
  // The floor's grass up their feet: its painting and colours the floor folder's.
  const grassy = folder.addFolder('grass at the foot (floor texture)')
  grassy.add(grass, 'show')
  grassy.add(grass, 'height', 0, 4, 0.01).name('height m (all grass)')
  grassy.add(grass, 'fade', 0.01, 4, 0.01).name('fade m (into bark)')
  grassy.add(grass, 'wobble', 0, 2, 0.01).name('wobble m')
  grassy.add(grass, 'wobbleSize', 0.05, 5, 0.01).name('wobble size m')
  grassy.add(grass, 'lightness', 0, 3, 0.01).name('lightness (1 = as the floor)')
  grassy.add(grass, 'sharpness', 0.5, 64, 0.1).name('top/side blend sharpness')
  grassy.add(grass, 'relief', 0, 1, 0.01).name('bark relief through it')
  grassy.onChange(grassChanged)
  const shiny = folder.addFolder('highlight and rim')
  addShine(shiny, shine)
  shiny.onChange(shineChanged)
  if (leaves) addLeaves(folder, leaves, leavesChanged)
  // As justASimpleTree's wind section has it.
  const breeze = folder.addFolder('wind')
  breeze.add(wind, 'strength', 0, 1, 0.01).name('strength (top sway m)')
  breeze.add(wind, 'speed', 0, 3, 0.01)
  breeze.add(wind, 'gustSize', 1, 40, 0.5).name('gust size m')
  breeze.add(wind, 'direction', -180, 180, 1).name('direction (degrees)')
  breeze.add(wind, 'flutter', 0, 1, 0.01).name('leaf flutter (rad)')
  breeze.add(wind, 'branches', 0, 2, 0.01).name('branch swing')
  breeze.onChange(windChanged)
  addScatter(folder, shape, changed, 'trunk to trunk', 60)
}

/** The trees' leaves, where they have them, as justASimpleTree's leaves section lays them out: the cards, their shading, their colours. */
function addLeaves(folder: GUI, leaves: LeafLook, changed: () => void, shown = true): void {
  const section = folder.addFolder('leaves')
  if (shown) section.add(leaves, 'show').name('show leaves')
  const cards = section.addFolder('cards')
  cards.add(leaves, 'textured').name('show texture')
  cards.add(leaves, 'cutout', 0.01, 0.99, 0.01).name('cutout (alpha)')
  const shading = section.addFolder('shading')
  shading.add(leaves, 'shading', 0, 1, 0.01).name('baked shade (gradient × ao)')
  shading.add(leaves, 'shadowTo', 0, 1, 0.01).name('shadow below')
  shading.add(leaves, 'lightFrom', 0, 1, 0.01).name('light from')
  const colours = section.addFolder('colors')
  colours.addColor(leaves, 'shadow').name('shadow')
  colours.addColor(leaves, 'mid').name('mid')
  colours.addColor(leaves, 'light').name('light')
  colours.add(leaves, 'variation', 0, 1, 0.01).name('variation')
  shading.add(leaves, 'glow', 0, 1, 0.01).name('own colour, unlit (0 = lit only)')
  section.onChange(changed)
}

/** The nest on the pond's island (nest.ts): its size and shape, how many needle cards and where, its needles texture, and their colours. */
function addNest(island: GUI, nest: NonNullable<NonNullable<NonNullable<RunPanel['goose']>['pond']>['nest']>): void {
  const folder = island.addFolder('nest')
  const { look, needles } = nest
  folder.add(look, 'show')
  folder.add(look, 'x', -6, 6, 0.01).name('x from the middle m')
  folder.add(look, 'z', -6, 6, 0.01).name('z from the middle m')
  const size = folder.addFolder('size')
  size.add(look, 'radius', 0.1, 2, 0.01).name('rim reaches m')
  size.add(look, 'rim', 0.02, 0.8, 0.01).name('rim height m')
  size.add(look, 'thickness', 0.1, 1, 0.01).name('rim width (share of radius)')
  size.add(look, 'sink', 0, 0.3, 0.005).name('sinks into the crown m')
  const cards = folder.addFolder('needle cards')
  cards.add(look, 'around', 3, 80, 1).name('round the rim, per row')
  cards.add(look, 'rows', 1, 16, 1).name('rows over the rim')
  cards.add(look, 'layers', 1, 6, 1).name('layers')
  cards.add(look, 'floor', 0, 80, 1).name('in the hollow')
  cards.add(look, 'strays', 0, 80, 1).name('strays round it')
  cards.add(look, 'card', 0.03, 1, 0.01).name('card width m')
  cards.add(look, 'spread', 0, 1, 0.01).name('sizes vary (share)')
  cards.add(look, 'bristle', 0, 3, 0.01).name('bristle (0 = lie on the rim)')
  cards.add(look, 'seed', 0, 99, 1)
  for (const controller of [...folder.controllers, ...size.controllers, ...cards.controllers]) controller.onChange(nest.changed)
  // The texture: a change of it starts its shape from justASimpleTree's own.
  const painted = folder.addFolder('needles texture')
  painted.add(needles, 'texture', [...NEEDLE_TEXTURES]).onChange(() => {
    Object.assign(needles, NEEDLE_DEFAULTS[needles.texture])
    for (const controller of painted.controllers) controller.updateDisplay()
  })
  painted.add(needles, 'count', 1, 60, 1).name('needles per cell')
  painted.add(needles, 'shortest', 5, 110, 1).name('shortest (px of 256)')
  painted.add(needles, 'longest', 5, 110, 1).name('longest (px of 256)')
  painted.add(needles, 'width', 0.01, 0.6, 0.005).name('width (share of length)')
  painted.add(needles, 'turn', 0, 180, 1).name('willow: turn off one way (degrees)')
  painted.add(needles, 'pairs', 1, 20, 1).name('pine: needle pairs per sprig')
  painted.add(needles, 'needle', 0.1, 1.5, 0.01).name('pine: needle length (share)')
  painted.add(needles, 'angle', 5, 90, 1).name('pine: needle lean (degrees)')
  painted.onChange(nest.needlesChanged)
  addLeaves(folder, nest.leaves, nest.leavesChanged, false)
}

/** The goose game's bushes folder (bushes.ts): shown or not, their leaves, how high all of them stand, and how they are scattered as the trees are, scattered again on release. */
function addBushes(gui: GUI, { look, shape, changed, leaves, leavesChanged, yChanged }: NonNullable<NonNullable<RunPanel['goose']>['bushes']>): void {
  const folder = gui.addFolder('bushes')
  folder.add(look, 'show').name('show').onChange(changed)
  folder.add(look, 'y', -1, 1, 0.01).name('position y m (all of them)').onChange(yChanged)
  addLeaves(folder, leaves, leavesChanged, false)
  addScatter(folder, shape, changed, 'bush to bush')
}

/** How the dead trees or the bushes are scattered along the road, under `folder`, up to `tall` m tall, each change handed to `changed` on release. */
function addScatter(folder: GUI, shape: DeadTreeShape, changed: () => void, apart: string, tall = 18): void {
  folder.add(shape, 'clear', 0, 20, 0.1).name('nearest the road m').onFinishChange(changed)
  folder.add(shape, 'band', 2, 60, 0.5).name('furthest from the road m').onFinishChange(changed)
  folder.add(shape, 'thin', 0, 1, 0.01).name('thin out far off (0-1)').onFinishChange(changed)
  folder.add(shape, 'spacing', 0.5, 10, 0.1).name(`spacing m (${apart})`).onFinishChange(changed)
  folder.add(shape, 'groves', 0, 60, 1).name('groves').onFinishChange(changed)
  folder.add(shape, 'grove', 1, 20, 0.5).name('grove width m').onFinishChange(changed)
  folder.add(shape, 'between', 0, 1, 0.01).name('between groves (0-1)').onFinishChange(changed)
  folder.add(shape, 'shortest', 0.5, tall, 0.1).name('shortest m (y scale)').onFinishChange(changed)
  folder.add(shape, 'tallest', 0.5, tall, 0.1).name('tallest m (y scale)').onFinishChange(changed)
  folder.add(shape, 'width', 0.1, 4, 0.01).name('x z scale').onFinishChange(changed)
  folder.add(shape, 'light', 0, 10, 0.1).name('off a light m (past its reach)').onFinishChange(changed)
  folder.add(shape, 'piece', 0, 10, 0.1).name('off scene pieces m').onFinishChange(changed)
  folder.add(shape, 'byWall', 0, 10, 0.1).name('by a wall within m').onFinishChange(changed)
  folder.add(shape, 'behindWall', 0, 5, 0.05).name('behind its back face m').onFinishChange(changed)
  folder.add(shape, 'seed', 1, 100, 1).name('seed').onFinishChange(changed)
}

/** A scenery piece's own toon shell, as a `toon material` folder under `folder`: its highlight and rim, its painted strokes and its steps, each change handed to `changed`. */
function addToonMaterial(folder: GUI, shell: ShellLook & { paint: PaintLook; toon: ToonLook }, changed: () => void): void {
  const material = folder.addFolder('toon material')
  addShell(material, shell)
  addPaint(material, shell.paint, 'strokes a metre')
  addToon(material, shell.toon)
  material.onChange(changed)
}

function addWell(gui: GUI, { colours, glows, changed, bucket, zone, ground, fire, reach, shine, pit }: NonNullable<NonNullable<RunPanel['goose']>['well']>): void {
  const folder = gui.addFolder('well')
  if (shine) {
    // Its own highlight and rim, its rope's and the dead trees' pumpkins' with it.
    const shiny = folder.addFolder('highlight and rim')
    addShine(shiny, shine.look)
    shiny.onChange(shine.changed)
  }
  // The fire pit by it: its iron's colour, and its own highlight and rim.
  if (pit) {
    const pitFolder = folder.addFolder('fire pit')
    pitFolder.addColor(pit.look, 'colour').name('iron').onChange(pit.changed)
    const shiny = pitFolder.addFolder('highlight and rim')
    addShine(shiny, pit.shine)
    shiny.onChange(pit.shineChanged)
  }
  if (zone) {
    folder.add(zone, 'x', -2, 2, 0.01).name('winch zone offset x m')
    folder.add(zone, 'z', -2, 2, 0.01).name('winch zone offset z m')
    folder.add(zone, 'scaleX', 0.1, 4, 0.05).name('winch zone scale x')
    folder.add(zone, 'scaleY', 0.1, 4, 0.05).name('winch zone scale y')
  }
  if (bucket) for (const axis of ['x', 'y', 'z'] as const) folder.add(bucket, axis, -1, 1, 0.01).name(`bucket offset ${axis} m`)
  // The fire pit by it, across it from the lantern: its light moves with it, read live by the play.
  if (fire) for (const axis of ['x', 'z'] as const) folder.add(fire, axis, -5, 5, 0.05).name(`fire pit offset ${axis} m`)
  if (reach) folder.add(reach, 'wellFireReach', 0, 10, 0.05).name('fire pit strength m (holds the rats)')
  for (const name of Object.keys(colours)) {
    folder.addColor(colours, name).name(name).onChange(changed)
    if (name in glows) folder.add(glows, name, 0, 10, 0.1).name(`${name} intensity`).onChange(changed)
  }
  // The ground under it: the floor giving way to another set round it.
  if (ground) {
    const { look } = ground
    const under = folder.addFolder('texture')
    under.add(look as { texture: string }, 'texture', PAINTED_FLOORS).name('set')
    under.add(look, 'x', -3, 3, 0.05).name('offset x m')
    under.add(look, 'z', -3, 3, 0.05).name('offset z m')
    under.add(look, 'radius', 0, 8, 0.05).name('all of it out to m')
    under.add(look, 'fade', 0.01, 8, 0.05).name('fades over m')
    under.add(look, 'scaleX', 0.2, 3, 0.05).name('scale x')
    under.add(look, 'scaleZ', 0.2, 3, 0.05).name('scale z')
    under.add(look, 'wobble', 0, 3, 0.01).name('edge wavers m')
    under.add(look, 'wobbleSize', 0.05, 5, 0.01).name('waver size m')
    under.add(look, 'breakup', -8, 8, 0.05).name('break up (0 = plain fade)')
    under.add(look, 'lightness', 0, 3, 0.01).name('lightness (dark/light)')
    under.add(look, 'saturation', 0, 3, 0.01).name('saturation')
    under.add(look, 'hue', -180, 180, 1).name('hue (degrees)')
    under.add(look, 'scale', 0.2, 10, 0.05).name('tile size m')
    under.add(look, 'rotation', -180, 180, 1).name('rotation (degrees)')
    under.add(look, 'relief', 0, 3, 0.01).name('relief (0 = flat)')
    for (const controller of under.controllers) controller.onChange(ground.changed)
  }
}

/** The goose game's dead tree folder: its size, how high it stands and its turn, its look the dead trees' folders'; where and how each of its pumpkins stands; where its gosling perches on it, which way it faces, and where it lands jumping down; where she calls it down; and where its brazier stands and how its flame burns; all read live. */
function addTree(gui: GUI, { look: tree, zone, landing, jump, fire }: NonNullable<NonNullable<RunPanel['goose']>['tree']>): void {
  const folder = gui.addFolder('dead tree')
  if (zone) {
    folder.add(zone, 'x', -2, 2, 0.01).name('call zone offset x m')
    folder.add(zone, 'z', -2, 2, 0.01).name('call zone offset z m')
    folder.add(zone, 'scaleX', 0.1, 4, 0.05).name('call zone scale x')
    folder.add(zone, 'scaleY', 0.1, 4, 0.05).name('call zone scale y')
  }
  folder.add(tree, 'height', 0.5, 8, 0.05).name('height m')
  folder.add(tree, 'y', -1, 1, 0.01).name('y m (over the ground)')
  folder.add(tree, 'turn', -180, 180, 1).name('tree turn (degrees)')
  for (const axis of ['x', 'y', 'z'] as const) folder.add(tree.perch, axis, axis === 'y' ? 0 : -2, axis === 'y' ? 4 : 2, 0.01).name(`gosling on the tree ${axis} m`)
  folder.add(tree, 'goslingTurn', -180, 180, 1).name('gosling turn (degrees)')
  if (landing) for (const axis of ['x', 'z'] as const) folder.add(landing, axis, -3, 3, 0.01).name(`gosling lands ${axis} m`)
  folder.add(tree, 'jumpHeight', 0, 1.5, 0.01).name('gosling jumps up m (over the branch)')
  folder.add(tree, 'jumpForward', 0, 3, 0.01).name('gosling jumps forward m')
  folder.add(tree, 'jumpRight', -3, 3, 0.01).name('gosling jumps right m')
  if (jump) folder.add(jump, 'treeJump', 0.3, 4, 0.05).name('gosling jump takes s')
  tree.pumpkins.forEach((pumpkin, k) => {
    const one = folder.addFolder(`pumpkin ${k + 1}`)
    one.add(pumpkin, 'x', -4, 4, 0.01).name('x m (off the trunk)')
    one.add(pumpkin, 'z', -4, 4, 0.01).name('z m (off the trunk)')
    one.add(pumpkin, 'turn', -180, 180, 1).name('turn (degrees)')
    one.add(pumpkin, 'kind', 0, 2, 1).name("which of the well's")
  })
  if (fire) {
    folder.add(fire.at, 'x', -8, 8, 0.01).name('brazier offset x m')
    folder.add(fire.at, 'z', -8, 8, 0.01).name('brazier offset z m')
    addFire(folder, fire, 'brazier')
  }
}

/** The goose game's cage folder: where she unlocks the cage and how long it takes; where its key lies by the body, where she picks it up and how it sits in her wing; and its campfire, where it stands off its brazier's place; all read live. */
function addCage(gui: GUI, { zone, hold, key, fire, look, colours, shine, wood }: NonNullable<NonNullable<RunPanel['goose']>['cage']>): void {
  const folder = gui.addFolder('cage')
  if (look) {
    folder.add(look, 'turn', -180, 180, 1).name('cage turn y (degrees)')
    folder.add(look, 'campfire', 0.2, 2, 0.01).name('campfire size')
    folder.add(look, 'key', 0.1, 4, 0.05).name('key on the ground size')
    for (const axis of ['X', 'Y', 'Z'] as const) folder.add(look, `lockTurn${axis}`, -180, 180, 1).name(`dropped lock turn ${axis.toLowerCase()} (degrees)`)
  }
  if (colours)
    for (const name of Object.keys(colours.colours)) {
      folder.addColor(colours.colours, name).name(name).onChange(colours.changed)
      if (colours.glows && name in colours.glows) folder.add(colours.glows, name, 0, 10, 0.1).name(`${name} intensity`).onChange(colours.changed)
    }
  if (wood) {
    // The cart's planks, as the dead trees' bark texture folder lays out theirs.
    const planks = folder.addFolder('cart wood texture')
    planks.add(wood.look, 'texture', [...CART_WOODS]).name('texture')
    planks.add(wood.look, 'lightness', 0, 8, 0.01).name('lightness (dark/light)')
    planks.add(wood.look, 'wood', 0, 1, 0.01).name('cart colour (1 = relief only)')
    planks.add(wood.look, 'saturation', 0, 3, 0.01)
    planks.add(wood.look, 'hue', -180, 180, 1).name('hue (degrees)')
    planks.add(wood.look, 'scale', 0.05, 10, 0.05).name('tile size m')
    planks.add(wood.look, 'rotation', -180, 180, 1).name('rotation (degrees)')
    planks.add(wood.look, 'relief', 0, 3, 0.01).name('relief (0 = flat)')
    planks.onChange(wood.changed)
  }
  if (shine) {
    for (const [name, own] of [['cart highlight and rim', shine.cart], ['skull highlight and rim', shine.skull]] as const) {
      const shiny = folder.addFolder(name)
      addShine(shiny, own)
      shiny.onChange(shine.changed)
    }
  }
  addZone(folder, zone, 'unlock')
  folder.add(hold, 'cageHold', 0.1, 10, 0.05).name('unlock takes s')
  folder.add(key.beside, 'x', -3, 3, 0.01).name('key off the skull x m')
  folder.add(key.beside, 'z', -3, 3, 0.01).name('key off the skull z m')
  addZone(folder, key.zone, 'key')
  if (key.inWing) {
    folder.add(key.inWing, 'bone', key.bones).name('key in wing bone (shoulder to tip)')
    folder.add(key.inWing, 'size', 0.1, 4, 0.05).name('key in wing size')
    for (const axis of ['x', 'y', 'z'] as const) folder.add(key.inWing, axis, -0.5, 0.5, 0.005).name(`key in wing ${axis} m`)
    for (const axis of ['X', 'Y', 'Z'] as const) folder.add(key.inWing, `turn${axis}`, -180, 180, 1).name(`key in wing turn ${axis.toLowerCase()} (degrees)`)
  }
  folder.add(fire.at, 'x', -8, 8, 0.01).name('campfire offset x m')
  folder.add(fire.at, 'z', -8, 8, 0.01).name('campfire offset z m')
  addFire(folder, fire, 'campfire')
}

/** A scene's fire as its folder edits it: its fire zone where the torch is filled, and how far it holds the rats off. */
export interface SceneFirePanel {
  zone: ZoneSetting
  reach: Record<FireScene, number>
  kind: FireScene
}

/** `zone`'s controls in `folder`, `what` zone's: its offset and scale. */
function addZone(folder: GUI, zone: ZoneSetting, what: string): void {
  folder.add(zone, 'x', -3, 3, 0.01).name(`${what} zone offset x m`)
  folder.add(zone, 'z', -3, 3, 0.01).name(`${what} zone offset z m`)
  folder.add(zone, 'scaleX', 0.1, 5, 0.05).name(`${what} zone scale x`)
  folder.add(zone, 'scaleY', 0.1, 5, 0.05).name(`${what} zone scale y`)
}

/** A scene's fire's controls in `folder`, named for `what` it burns in: where the torch is filled at it and how far it holds the rats off; its flame and lamp in the flames folder. */
function addFire(folder: GUI, { zone, reach, kind }: SceneFirePanel, what: string): void {
  addZone(folder, zone, `${what} fire`)
  folder.add(reach, kind, 0, 10, 0.05).name(`${what} strength m (holds the rats)`)
}

/** A fire of the plain's in the flames folder: its name, its look, and whether it has a lamp and an offset off its fire to edit. */
export interface FireFolder {
  name: string
  look: SceneFireLook
  lamp?: boolean
  offset?: boolean
}

/** The plain's fires under the flames folder: how bright they all glow and their lamps' colour, and each fire's size, place and lamp in a folder of its own. */
export interface FiresPanel {
  look: { glow: number; lamp: number }
  /** The goose's and the goslings' shadows in the fires' light, read live (fakelamps.ts). */
  shadows?: { look: FireShadowLook }
  each: FireFolder[]
}

/** The goose game's ground folder: how the plain rolls (rolling.ts), each change laid at once; and how big the road's arches stand on it, and how high. */
function addGround(gui: GUI, { look, changed, arches }: NonNullable<NonNullable<RunPanel['goose']>['ground']>): void {
  const folder = gui.addFolder('ground')
  folder.add(look, 'height', 0, 3, 0.01).name('swells rise to m')
  folder.add(look, 'size', 2, 40, 0.1).name('swells apart m')
  folder.add(look, 'detail', 1, 8, 0.05).name('small swells (times smaller)')
  folder.add(look, 'detailWeight', 0, 1, 0.01).name('small swells strength')
  folder.add(look, 'brazierPad', 0, 10, 0.1).name('flat round a fire m')
  folder.add(look, 'piecePad', 0, 6, 0.1).name('flat round a scene piece m')
  folder.add(look, 'ramp', 0.1, 15, 0.1).name('swells come up over m')
  for (const controller of folder.controllers) controller.onChange(changed)
  if (!arches) return
  folder.add(arches.look, 'scale', 0.1, 2, 0.01).name('door scale').onChange(arches.changed)
  folder.add(arches.look, 'y', -5, 5, 0.01).name('door position y m').onChange(arches.changed)
}

/** The goose game's pond folder: where it lies, its shore, its bank and its water, each change laid at once. */
function addPond(gui: GUI, { look, changed, water, waterChanged, bed, bedChanged, nest, tent, bonfire, geese }: NonNullable<NonNullable<RunPanel['goose']>['pond']>): void {
  const folder = gui.addFolder('pond')
  folder.add(look, 'x', look.x - 30, look.x + 30, 0.1).name('x m')
  folder.add(look, 'z', look.z - 30, look.z + 30, 0.1).name('z m')
  folder.add(look, 'radius', 1, 30, 0.1).name('radius m')
  folder.add(look, 'stray', 0, 1, 0.01).name('shore wanders (0 = circle)')
  folder.add(look, 'bays', 0.2, 4, 0.01).name('bays (more = busier shore)')
  folder.add(look, 'shore', 0, 1, 0.001).name('shore noise')
  folder.add(look, 'depth', 0, 3, 0.01).name('bed depth m')
  folder.add(look, 'bank', 0.05, 1, 0.01).name('bank (small = steep)')
  folder.add(look, 'water', -3, 0, 0.01).name('water level m')
  for (const controller of folder.controllers) controller.onChange(changed)
  // The island off its middle, laid again with the pond.
  const island = folder.addFolder('island')
  island.add(look.island, 'show')
  island.add(look.island, 'x', -20, 20, 0.1).name('x from the middle m')
  island.add(look.island, 'z', -20, 20, 0.1).name('z from the middle m')
  island.add(look.island, 'radius', 0.3, 6, 0.05).name('half width m')
  island.add(look.island, 'long', 1, 4, 0.05).name('long (1 = round)')
  island.add(look.island, 'turn', -180, 180, 1).name('turn (degrees)')
  island.add(look.island, 'stray', 0, 0.8, 0.01).name('shore wanders (0 = smooth)')
  island.add(look.island, 'shore', 0, 1, 0.001).name('shore noise')
  island.add(look.island, 'height', 0, 1.5, 0.01).name('crown over the water m')
  island.add(look.island, 'foot', 0.1, 3, 0.01).name('foot runs out (share of radius)')
  for (const controller of island.controllers) controller.onChange(changed)
  island.add(bed, 'islandBeach', 0, 3, 0.01).name('sand reaches m up from the water (0 = none)').onChange(bedChanged)
  // The goose's nest on its crown (nest.ts), laid again on every change.
  if (nest) addNest(island, nest)
  // The bonfire on it, the cage's campfire and flame: where, how turned and how big, stood again on every change; its lamp read live.
  if (bonfire) {
    const fire = island.addFolder('bonfire')
    fire.add(bonfire.look, 'show')
    fire.add(bonfire.look, 'x', -6, 6, 0.01).name('x from the middle m')
    fire.add(bonfire.look, 'z', -6, 6, 0.01).name('z from the middle m')
    fire.add(bonfire.look, 'y', -0.5, 0.5, 0.005).name('up from the ground m')
    fire.add(bonfire.look, 'turn', -180, 180, 1).name('turn (degrees)')
    fire.add(bonfire.look, 'size', 0.2, 4, 0.01).name("logs size (1 = the cage's)")
    for (const controller of fire.controllers) controller.onChange(bonfire.changed)
    fire.add(bonfire.look, 'flame', 0.1, 4, 0.01).name("flame size (1 = the cage's)")
    fire.add(bonfire.look, 'intensity', 0, 60, 0.5).name('lamp strength')
    fire.add(bonfire.look, 'reach', 0, 20, 0.1).name('lamp reaches m')
  }
  // The mother goose in the nest and the goslings at play (islandgeese.ts), read live.
  if (geese) {
    const birds = island.addFolder('mother and goslings')
    const mother = birds.addFolder('mother')
    mother.add(geese.mother, 'show')
    mother.add(geese.mother, 'x', -2, 2, 0.01).name('x from the nest m')
    mother.add(geese.mother, 'z', -2, 2, 0.01).name('z from the nest m')
    mother.add(geese.mother, 'y', -0.5, 0.5, 0.005).name('up m')
    mother.add(geese.mother, 'turn', -180, 180, 1).name('turn (degrees)')
    mother.add(geese.mother, 'size', 0.2, 3, 0.01).name('size (1 = the goose)')
    const young = birds.addFolder('goslings at play')
    young.add(geese.goslings, 'count', 0, MOST_GOSLINGS, 1).name('how many')
    young.add(geese.goslings, 'x', -6, 6, 0.01).name('play area x from the middle m')
    young.add(geese.goslings, 'z', -6, 6, 0.01).name('play area z from the middle m')
    young.add(geese.goslings, 'radius', 0.2, 5, 0.01).name('play area radius m')
    young.add(geese.goslings, 'speed', 0.1, 3, 0.01).name('run speed m/s')
    young.add(geese.goslings, 'rest', 0, 6, 0.1).name('stands up to s')
  }
  // The tent on its crown (tent.ts): where and how big, stood again on every change; its colours, highlight and rim.
  if (tent) {
    const tentFolder = island.addFolder('tent')
    tentFolder.add(tent.look, 'show')
    tentFolder.add(tent.look, 'x', -6, 6, 0.01).name('x from the middle m')
    tentFolder.add(tent.look, 'z', -6, 6, 0.01).name('z from the middle m')
    tentFolder.add(tent.look, 'y', -0.5, 0.5, 0.005).name('up from the ground m')
    tentFolder.add(tent.look, 'turn', -180, 180, 1).name('turn (degrees)')
    tentFolder.add(tent.look, 'size', 0.2, 4, 0.01).name('height m')
    for (const controller of tentFolder.controllers) controller.onChange(tent.changed)
    const colours = tentFolder.addFolder('colours')
    for (const name of Object.keys(tent.look.colours)) colours.addColor(tent.look.colours, name).onChange(tent.recolour)
    const shine = tentFolder.addFolder('highlight and rim')
    addShine(shine, tent.look.shine)
    for (const controller of shine.controllers) controller.onChange(tent.shineChanged)
  }
  // How the goose and her goslings take to the water, read live by their placing.
  const birds = folder.addFolder('goose and goslings in the water')
  birds.add(look.goose, 'height', -0.6, 0.6, 0.005).name('goose afloat height m')
  birds.add(look.goose, 'wade', 0.01, 1, 0.005).name('goose wades to m deep')
  birds.add(look.goose, 'pace', 0.1, 1.5, 0.01).name('goose swims at (share of her walk)')
  birds.add(look.gosling, 'height', -0.3, 0.3, 0.005).name('gosling afloat height m')
  birds.add(look.gosling, 'wade', 0.01, 0.5, 0.005).name('gosling wades to m deep')
  // The bed: the floor giving way to another set down the bank.
  const under = folder.addFolder('bed')
  under.add(bed as { texture: string }, 'texture', STYLIZED_FLOORS).name('bed')
  under.add(bed, 'from', 0, 1, 0.005).name('fade starts m below the floor')
  under.add(bed, 'to', 0, 1, 0.005).name('all bed from m below')
  under.add(bed, 'wobble', 0, 0.5, 0.005).name('fade line wavers m')
  under.add(bed, 'wobbleSize', 0.05, 5, 0.01).name('waver size m')
  under.add(bed, 'beach', 0, 10, 0.05).name('beach reaches m past the shore (0 = none)')
  under.add(bed, 'beachWobble', 0, 3, 0.01).name('beach line wavers m')
  under.add(bed, 'breakup', 0, 8, 0.05).name('break up (0 = plain fade)')
  under.add(bed, 'scale', 0.2, 10, 0.05).name('tile size m')
  under.add(bed, 'rotation', -180, 180, 1).name('rotation (degrees)')
  under.add(bed, 'relief', 0, 3, 0.01).name('relief (0 = flat)')
  under.addColor(bed, 'colour').name('sand colour')
  under.addColor(bed, 'underwater').name('light left after 1 m of water')
  under.add(bed, 'murk', 0, 5, 0.01).name('murk (0 = clear water)')
  for (const controller of under.controllers) controller.onChange(bedChanged)
  // The water's look: colours and uniforms only, nothing laid again.
  const surface = folder.addFolder('water')
  surface.addColor(water, 'deep').name('deep colour')
  surface.addColor(water, 'shallow').name('shallow colour')
  surface.add(water, 'depthMax', 0.01, 10, 0.01).name('deep from m')
  surface.add(water, 'depthExponent', 0.05, 8, 0.01).name('deepens (under 1 = sooner)')
  surface.addColor(water, 'horizon').name('horizon colour')
  surface.add(water, 'horizonPower', 0.5, 12, 0.1).name('horizon (more = flatter)')
  surface.add(water, 'refraction', 0, 0.08, 0.0005).name('refraction strength')
  surface.add(water, 'refractionScale', 0.01, 4, 0.01).name('refraction per m')
  surface.add(water, 'refractionSpeed', 0, 1, 0.001).name('refraction speed')
  surface.add(water, 'refractionDepth', 0.01, 10, 0.01).name('ground shows to m deep')
  surface.add(water, 'clarity', 0, 8, 0.01).name('clarity (1 = old water)')
  surface.add(water, 'opacity', 0, 1, 0.01).name('opacity (0 = clear, 1 = opaque)')
  for (const controller of surface.controllers) controller.onChange(waterChanged)
}

/** The crowd folder: each control moves the running swarm. Without `notice`, the holder's notice is left to a folder of its own. */
export function addCrowd(gui: GUI, crowd: CrowdTuning, notice = true): void {
  const folder = gui.addFolder('crowd')
  folder.add(crowd, 'agitation', 0, 2, 0.05).name('writhes m/s')
  folder.add(crowd, 'lookAhead', 0, 2, 0.1).name('reads the light s')
  folder.add(crowd, 'gap', 0, 1, 0.05).name('keeps off it by m')
  folder.add(crowd, 'pile', 0, 3, 0.1).name('piles up (0 = flat)')
  folder.add(crowd, 'pileRamp', 0.25, 8, 0.25).name('pile rises over gaps')
  if (notice) folder.add(crowd, 'notice', 2, 40, 0.5).name('notices the holder within m')
  // The wander, where the page's rats have it (the goose game's): what a rat that has not noticed the holder does.
  if (crowd.wander !== undefined) folder.add(crowd as Required<Pick<CrowdTuning, 'wander'>>, 'wander', 0, 1.5, 0.05).name('runs about unnoticed x its pace (0 = writhes)')
  if (crowd.roam !== undefined) folder.add(crowd as Required<Pick<CrowdTuning, 'roam'>>, 'roam', 0.5, 20, 0.5).name('roams past its notice m')
  // How quickly a rat answers: to come on, and to bolt or lunge, the swarm's own where the page sets none.
  crowd.fleeReaction ??= FLEE_REACTION
  crowd.fleeTurn ??= FLEE_TURN
  const reacts = folder.addFolder('reacts')
  const answer = crowd as Required<Pick<CrowdTuning, 'reaction' | 'turnRate' | 'fleeReaction' | 'fleeTurn'>>
  reacts.add(answer, 'reaction', 0.02, 2, 0.01).name('gets going over s')
  reacts.add(answer, 'turnRate', 0.5, 20, 0.1).name('turns rad/s')
  reacts.add(answer, 'fleeReaction', 0.02, 2, 0.01).name('bolts or lunges over s')
  reacts.add(answer, 'fleeTurn', 0.5, 5, 0.1).name('turns bolting x')
  // The lunges and the weave, where the page's rats have them (the goose game's).
  if (crowd.dashRate !== undefined) {
    const lunges = folder.addFolder('lunges')
    const dash = crowd as Required<Pick<CrowdTuning, 'dashRate' | 'dashSpeed' | 'dashTime' | 'weave'>>
    lunges.add(dash, 'dashRate', 0, 2, 0.05).name('lunges a second')
    lunges.add(dash, 'dashSpeed', 1, 5, 0.1).name('lunge pace x')
    lunges.add(dash, 'dashTime', 0.05, 0.5, 0.01).name('lunge lasts s')
    lunges.add(dash, 'weave', 0, 1.5, 0.05).name('weaves rad')
  }
}

/** The geese's reach at its top stands for anywhere on the plain: every rat runs at the nearest of them. */
const ANYWHERE = 60

/**
 * The goose game's pull folder: how far off a rat runs at the goose or a
 * gosling, one reach for them all; each rat runs at the nearest it notices.
 */
function addPull(gui: GUI, crowd: CrowdTuning): void {
  const folder = gui.addFolder("rats' pull")
  const geese = {
    get reach() {
      return Math.min(crowd.notice, ANYWHERE)
    },
    set reach(value: number) {
      crowd.notice = crowd.pull = value >= ANYWHERE ? Infinity : value
    },
  }
  folder.add(geese, 'reach', 1, ANYWHERE, 0.5).name(`rats run at the goose or a gosling within m (${ANYWHERE} = anywhere)`)
}

/** A list as lil-gui binds it: each entry a property, by its index. */
const byIndex = (values: number[]) => values as unknown as Record<string, number>

/** What each toon step is, darkest first. */
const STEP_NAMES = {
  3: ['shade', 'half-light', 'full light'],
  5: ['deep shade', 'shade', 'half-light', 'light', 'full light'],
}

/** The look folders. */
/** The look's folders. */
function addLook(gui: GUI, settings: Settings, look: Look, changed: PanelEvents, tilt?: TiltPanel, fires?: FiresPanel): void {
  const lamp = gui.addFolder('lamp')
  lamp.addColor(look.lamp, 'color')
  lamp.add(look.lamp, 'intensity', 0, 150, 1)
  lamp.add(look.lamp, 'reach', 0, 30, 0.1).name('reach at full strength m (0 = endless)')
  lamp.add(look.lamp, 'falloff', 0, 3, 0.05).name('falloff (fade/sharp)')
  lamp.add(look.lamp, 'lag', 0, 0.5, 0.01).name('lag after the holder s')
  lamp.add(look.lamp, 'inFlame').name('in the torch (else 1.1 m up)')
  lamp.add(settings, 'shadows').name('shadows (start with ?shadows)').onChange(changed.shadows)

  const sun = gui.addFolder('sun')
  sun.addColor(look.sun, 'color')
  sun.add(look.sun, 'intensity', 0, 5, 0.05)
  sun.add(look.sun, 'x', -30, 30, 0.5).name('position x m')
  sun.add(look.sun, 'y', 1, 40, 0.5).name('position y m')
  sun.add(look.sun, 'z', -30, 30, 0.5).name('position z m')
  sun.add(look.sun, 'shadows')
  sun.add(look.sun, 'softness', 0, 20, 0.5).name('shadow softness')
  sun.add(look.sun, 'darkness', 0, 1, 0.01).name('shadow darkness')
  sun.addColor(look.sun, 'shadowColor').name('shadow colour (black = plain)')

  const fill = gui.addFolder('fill')
  fill.addColor(look.fill, 'sky')
  fill.addColor(look.fill, 'ground')
  fill.add(look.fill, 'intensity', 0, 3, 0.05)

  // The fog, the stop motion, the outlines, the palette and the depth of field: their folders hidden, the game's look
  // setting them.
  const fog = gui.addFolder('fog').hide()
  fog.add(look.fog, 'enabled').name('on')
  fog.addColor(look.fog, 'color')
  // The fog's colour toward the horizon, where the page gives it one.
  if (look.fog.horizon !== undefined) {
    const sky = look.fog as Required<typeof look.fog>
    sky.band ??= 15
    fog.addColor(sky, 'horizon').name('horizon colour')
    fog.add(sky, 'band', 1, 90, 1).name('horizon band °')
  }
  fog.add(look.fog, 'near', 0, 30, 0.25).name('clear to m')
  fog.add(look.fog, 'far', 1, 60, 0.25).name('solid from m')
  fog.add(look.fog, 'density', 1, 50, 0.5)
  fog.add(look.fog, 'wisp', 0, 4, 0.1).name('wisps m')
  fog.add(look.fog, 'scale', 0.5, 12, 0.25).name('wisp size m')
  fog.add(look.fog, 'drift', 0, 3, 0.05).name('drift m/s')
  // The fog lit by the lights in it: a haze of their colour round each, as far as a share of its reach.
  if (look.fog.lit !== undefined) {
    const lit = look.fog as Required<typeof look.fog>
    fog.add(lit, 'lit', 0, 3, 0.05).name('lit by the lights')
    fog.addColor(lit, 'litColor').name('lit colour')
    fog.add(lit, 'litSpread', 0.5, 5, 0.1).name('lit spread × reach')
  }

  const rats = addRatsFolder(gui, look.rats, look.trails)
  const levels = addLevelsFolder(gui, look.rats.levels)

  const ground = gui.addFolder('floor')
  // Picking a floor lays its own look with it: every control in the folder shows it. The stylized sets with a painting alone.
  ground
    .add(look.floor as { texture: string }, 'texture', PAINTED_FLOORS)
    .name('floor')
    .onChange(() => {
      changed.floor()
      for (const controller of ground.controllersRecursive()) controller.updateDisplay()
    })
  ground.add(look.floor, 'lightness', 0, 3, 0.01).name('lightness (dark/light)')
  ground.add(look.floor, 'saturation', 0, 3, 0.01)
  ground.add(look.floor, 'hue', -180, 180, 1).name('hue (degrees)')
  ground.add(look.floor, 'scale', 0.2, 10, 0.05).name('tile size m')
  ground.add(look.floor, 'rotation', -180, 180, 1).name('rotation (degrees)')
  ground.add(look.floor, 'relief', 0, 3, 0.01).name('relief (0 = flat)')
  addShell(ground, look.floor.shell)
  addPaint(ground, look.floor.paint, 'strokes per metre')
  addToon(ground, look.floor.toon)

  // Every pass over the finished frame in one folder: the frame's effects, then the lens.
  const post = gui.addFolder('postprocessing')
  const frame = addFrameEffects(post, look, true)

  // Nothing to wire: the page reads it every frame.
  const stop = gui.addFolder('stop motion').hide()
  stop.add(look.stopMotion, 'enabled').name('on')
  stop.add(look.stopMotion, 'fps', 2, 30, 1).name('beats a second')
  stop.add(look.stopMotion, 'run').name('holds the run')
  stop.add(look.stopMotion, 'swarm').name('holds the swarm')
  stop.add(look.stopMotion, 'light').name('holds the light')
  stop.add(look.stopMotion, 'camera').name('holds the camera')
  const between = stop.addFolder('between beats')
  between.add(look.stopMotion, 'shadeWobble').name('shade wobble')
  between.add(look.stopMotion, 'shadeAmount', 0, 0.5, 0.005).name('shade amount')
  between.add(look.stopMotion, 'lightFlicker').name('light flicker')
  between.add(look.stopMotion, 'lightAmount', 0, 0.2, 0.005).name('flicker amount')
  between.add(look.stopMotion, 'strokeJitter').name('stroke jitter')
  between.add(look.stopMotion, 'strokeAmount', 0, 0.5, 0.005).name('stroke amount (tiles)')
  between.add(look.stopMotion, 'frameJitter').name('frame jitter')
  between.add(look.stopMotion, 'frameAmount', 0, 6, 0.1).name('frame amount px')
  between.add(look.stopMotion, 'paperOnBeat').name('paper on the beat')
  between.add(look.stopMotion, 'uneven').name('uneven beats')
  between.add(look.stopMotion, 'unevenShare', 0, 1, 0.05).name('beats held longer')
  between.add(look.stopMotion, 'stagger').name('stagger the rats')
  between.add(look.stopMotion, 'boil').name('boil the surface')
  between.add(look.stopMotion, 'boilAmount', 0, 0.05, 0.001).name('boil amount m')
  between.add(look.stopMotion, 'boilScale', 1, 30, 0.5).name('boil bumps a metre')
  between.add(look.stopMotion, 'snap').name('snap to baked poses')

  const lens = addLens(post, look, true)
  // The tilt-shift last, its controls each telling the look themselves.
  if (tilt) addTiltFolder(post, tilt.shift, changed.look, tilt.placed)

  const meat = addCharacterFolder(gui, look.meat)
  const flame = addFlameFolder(gui, look.flame, fires)

  for (const folder of [lamp, sun, fill, fog, rats, levels, ground, ...frame, ...lens, meat, flame]) folder.onChange(changed.look)
}

/** The look of the rats as the rats folder and the levels of detail folder edit it: their colours, variants, eyes, shell, strokes, steps and levels. */
export type RatsLook = Look['rats']

/**
 * The rats folder: each part's colour and the tint, the variants, the eyes and their trails, the shell, the painted
 * normals, the toon steps and the far crowd's staggered steps. The folder, for the page to add its own to and to wire.
 */
export function addRatsFolder(gui: GUI, look: RatsLook, trailLook: TrailLook): GUI {
  const rats = gui.addFolder('rats')
  // The eyes have a folder of their own in here, with their trails.
  for (const part of look.parts) if (part.name !== 'eyes') rats.addColor(part, 'color').name(part.name)
  rats.addColor(look, 'color').name(look.parts.length ? 'tint' : 'colour')
  // The variants tint the parts, so a model of one colour has none to show.
  if (look.parts.length > 0) {
    const variants = rats.addFolder('variants')
    look.variants.forEach((variant, i) => {
      variants.addColor(variant, 'tint').name(`${i + 1} tint`)
      variants.add(variant, 'share', 0, 1, 0.01).name(`${i + 1} share`)
    })
  }
  // The eyes: a colour picked from the presets or by hand, their glow, and the trails they leave, which take the eyes'
  // colour unless told otherwise.
  const eyes = rats.addFolder('eyes')
  const eyePart = look.parts.find((part) => part.name === 'eyes')
  if (eyePart) {
    const colour = eyes.addColor(eyePart, 'color').name('colour')
    // A preset sets the picker, which carries it to the scene.
    eyes.add({ preset: eyePart.color }, 'preset', EYE_PRESETS).onChange((hex: number) => colour.setValue(hex))
    eyes.add(look, 'glow', 0, 6, 0.1)
  }
  const trails = eyes.addFolder('trails')
  trails.add(trailLook, 'enabled').name('on')
  trails.add(trailLook, 'seconds', 0, 2, 0.01).name('length (s of travel)')
  trails.add(trailLook, 'width', 0.001, 0.3, 0.001).name('width m')
  trails.add(trailLook, 'taper', 0.25, 4, 0.05).name('taper (1 straight)')
  trails.add(trailLook, 'wave', 0, 4, 0.05).name('sway (x width)')
  trails.add(trailLook, 'strength', 0, 8, 0.05).name('brightness')
  trails.add(trailLook, 'fade', 0.25, 12, 0.05).name('fade to the tail')
  trails.add(trailLook, 'wiggle', 0, 0.2, 0.005).name('wiggle m (smooth only)')
  trails.add(trailLook, 'wiggleSpeed', 0, 10, 0.1).name('wiggle waves /s')
  // The trails' own colour shows only while they do not take the eyes'.
  const ownColour = trails.addColor(trailLook, 'color').name('own colour').show(!trailLook.eyeColour)
  trails.add(trailLook, 'eyeColour').name('eyes colour').onChange((on: boolean) => ownColour.show(!on))
  addShell(rats, look)
  addPaint(rats, look.paint, 'strokes per body')
  addToon(rats, look.toon)
  // The far crowd's staggered steps: one step in n for the rats past so far from the light, a group a step; the CPU
  // step's alone (WebGL 2, or ?cpustep). The tint shows each rat's group, green stepping every step.
  const stagger = rats.addFolder('far rats updated less often (WebGL)')
  stagger.add(look.stagger, 'n', 1, 8, 1).name('teams taking turns (1 off)')
  stagger.add(look.stagger, 'from', 0, 20, 0.5).name('far = past m from light')
  stagger.add(look.stagger, 'show').name('colours: green every frame, other = team')

  return rats
}

/**
 * The rats' levels of detail, a folder of their own beside the rats', on WebGPU only: a rat drawn simpler the fewer
 * pixels long it stands. A folder a level, nearest first: its shares of the triangles, from how many pixels long it is
 * drawn (the last, below the one before), its rim. The folder, for the page to wire.
 */
export function addLevelsFolder(gui: GUI, look: RatsLook['levels']): GUI {
  const levels = gui.addFolder('levels of detail')
  levels.add(look, 'on')
  levels.add(look, 'show').name('tint by level (green, amber, red)')
  // The view split down the middle: the levels against the same tinted, or the whole rat against the levels.
  levels.add(look, 'split', { none: 'none', 'levels | tinted': 'tint', 'whole | levels': 'whole' }).name('split view')
  // How much the depth of field's blur lowers a rat's level: 0 not at all, 1 as far as it smears it, past 1 further.
  levels.add(look, 'blur', 0, 4, 0.05).name('blur counts x')
  const names = ['near', 'middle', 'far']
  look.levels.forEach((level, l, all) => {
    const folder = levels.addFolder(names[l] ?? `level ${l}`)
    folder.add(level, 'body', 0.02, 1, 0.01).name('body share')
    folder.add(level, 'eyes', 0.02, 1, 0.01).name('eyes share')
    if (l < all.length - 1) folder.add(level, 'from', 0, 400, 1).name('from px long')
    folder.add(level, 'rim', 0, 4, 0.01).name('rim strength x')
    folder.add(level, 'rimWidth', 0, 3, 0.01).name('rim width x')
  })
  return levels
}

/**
 * The post's frame effects, each a folder: the ambient occlusion, the outlines, hatching, palette, grain and paper, vignette;
 * the screen's saturation, where the look has it. `few`, the outlines and the palette hidden.
 */
export function addFrameEffects(gui: GUI, look: Pick<PostLook, 'ao' | 'outline' | 'hatch' | 'palette' | 'grain' | 'vignette' | 'screen'>, few = false): GUI[] {
  const occlusion = gui.addFolder('ambient occlusion')
  occlusion.add(look.ao, 'enabled').name('on')
  occlusion.add(look.ao, 'show').name('show ao only')
  occlusion.add(look.ao, 'strength', 0, 1, 0.01)
  occlusion.addColor(look.ao, 'color').name('colour')
  occlusion.add(look.ao, 'radius', 0.02, 4, 0.01).name('radius m')
  occlusion.add(look.ao, 'thickness', 0.05, 8, 0.05).name('thickness m')
  occlusion.add(look.ao, 'distanceExponent', 0.25, 8, 0.05).name('distance exponent')
  occlusion.add(look.ao, 'distanceFallOff', 0.1, 4, 0.05).name('distance falloff')
  occlusion.add(look.ao, 'samples', [4, 8, 16, 32])
  occlusion.add(look.ao, 'resolution', [0.25, 0.5, 0.75, 1]).name('resolution (of the frame)')

  const outline = gui.addFolder('outlines').show(!few)
  outline.add(look.outline, 'enabled').name('on')
  outline.addColor(look.outline, 'color').name('colour')
  outline.add(look.outline, 'thickness', 0.5, 4, 0.1).name('thickness px')
  outline.add(look.outline, 'depth', 0.005, 0.3, 0.005).name('depth break')
  outline.add(look.outline, 'normal', 0.01, 1, 0.01).name('normal break')

  const hatch = gui.addFolder('hatching')
  hatch.add(look.hatch, 'enabled').name('on')
  hatch.addColor(look.hatch, 'color').name('colour')
  hatch.add(look.hatch, 'below', 0.02, 1, 0.01).name('in shade under')
  hatch.add(look.hatch, 'cross').name('cross-hatch the darker')
  hatch.add(look.hatch, 'spacing', 2, 24, 1).name('spacing px')
  hatch.add(look.hatch, 'angle', 0, 180, 1).name('angle deg')
  hatch.add(look.hatch, 'width', 0.05, 0.95, 0.05).name('line width')
  hatch.add(look.hatch, 'strength', 0, 1, 0.01)

  const palette = gui.addFolder('palette').show(!few)
  palette.add(look.palette, 'enabled').name('on')
  palette.add(look.palette, 'levels', 2, 32, 1).name('levels a channel')

  const grain = gui.addFolder('grain and paper')
  grain.add(look.grain, 'grain').name('grain')
  grain.add(look.grain, 'grainStrength', 0, 0.5, 0.01).name('grain strength')
  grain.add(look.grain, 'grainSize', 1, 6, 1).name('grain size px')
  grain.add(look.grain, 'grainOnBeat').name('grain on the beat only')
  grain.add(look.grain, 'grainSpeed', 0, 60, 1).name('grain changes a second (0 still)')
  grain.add(look.grain, 'paper').name('paper')
  grain.add(look.grain, 'paperStrength', 0, 1, 0.01).name('paper strength')
  grain.add(look.grain, 'paperScale', 1, 16, 0.5).name('fibre size px')

  const vignette = gui.addFolder('vignette')
  vignette.add(look.vignette, 'enabled').name('on')
  vignette.add(look.vignette, 'strength', 0, 1, 0.01)
  vignette.add(look.vignette, 'inner', 0, 1.5, 0.01).name('starts at')
  vignette.add(look.vignette, 'outer', 0, 2, 0.01).name('full at')
  vignette.add(look.vignette, 'own').name("own colour, not the fog's")
  vignette.addColor(look.vignette, 'colour').name('colour')

  if (!look.screen) return [occlusion, outline, hatch, palette, grain, vignette]
  const screen = gui.addFolder('screen')
  screen.add(look.screen, 'saturation', 0, 2, 0.01).name('saturation (0 grey, 1 as drawn)')
  return [occlusion, outline, hatch, palette, grain, vignette, screen]
}

/** The post's lens, each a folder: the depth of field and the bloom. `few`, the depth of field hidden. */
export function addLens(gui: GUI, look: Pick<PostLook, 'dof' | 'bloom'>, few = false): GUI[] {
  const depth = gui.addFolder('depth of field').show(!few)
  depth.add(look.dof, 'enabled').name('on')
  depth.add(look.dof, 'onLight').name('focus on the light')
  depth.add(look.dof, 'focus', 0.5, 30, 0.1).name('focus m')
  depth.add(look.dof, 'focal', 0.1, 20, 0.1).name('soft past m')
  depth.add(look.dof, 'glow', 0, 1, 0.05).name('glow')
  depth.add(look.dof, 'bokeh', 0, 6, 0.1)

  const halo = gui.addFolder('bloom')
  halo.add(look.bloom, 'enabled').name('on')
  halo.add(look.bloom, 'strength', 0, 4, 0.05)
  halo.add(look.bloom, 'radius', 0, 1, 0.05)
  halo.add(look.bloom, 'resolution', 0.1, 1, 0.05).name('resolution (x frame)')
  halo.add(look.bloom, 'cheap').name('cheap (one pass)')
  halo.add(look.bloom, 'blurGlow', 0, 1, 0.05).name('cheap: glow in the blur')

  return [depth, halo]
}


/** The character's folder: on, its size and clips, its parts' colours, its stripes, shell, strokes and steps. */
export function addCharacterFolder(gui: GUI, look: MeatLook): GUI {
  const meat = gui.addFolder(characterLabel)
  meat.add(look, 'enabled').name('on')
  meat.add(look, 'height', 0.1, 2, 0.01).name('scale (height m)')
  meat.add(look, 'lift', 0, 2, 0.01).name('off the ground m')
  // A character that swims has its clips' speeds in a folder of their own, by its goslings'; the rest keep them here.
  const clips = swims ? gui.addFolder(`${characterLabel} animations`) : meat
  clips.add(look, 'idleSpeed', 0, 3, 0.05).name('idle animation speed')
  clips.add(look, 'runSpeed', 0, 3, 0.05).name('run animation speed')
  if (swims) {
    clips.add(look, 'waterIdleSpeed', 0, 3, 0.05).name('water idle animation speed')
    clips.add(look, 'swimSpeed', 0, 3, 0.05).name('swim animation speed')
    // Its changes handed on to the character's folder, as if made there: the page takes the character's look from
    // that folder's changes, and lil-gui passes a change only to a folder's parents.
    const forwarded = meat as unknown as { _callOnChange(controller: unknown): void }
    clips.onChange(({ controller }) => forwarded._callOnChange(controller))
  }
  meat.add(look, 'castShadow').name('casts shadows')
  const colours = meat.addFolder('colours')
  for (const part of look.parts) {
    colours.addColor(part, 'color').name(part.name)
    if (part.glow !== undefined) colours.add(part as Required<MeatPart>, 'glow', 0, 10, 0.1).name(`${part.name} intensity`)
  }
  const stripes = meat.addFolder(`stripes on the ${look.parts[0]?.name ?? 'first part'}`)
  stripes.add(look.stripes, 'enabled').name('on')
  stripes.addColor(look.stripes, 'color').name('colour')
  stripes.add(look.stripes, 'count', 1, 120, 1).name('stripes along its height')
  stripes.add(look.stripes, 'width', 0, 1, 0.01).name('width (share of the gap)')
  stripes.add(look.stripes, 'angle', { horizontal: 0, vertical: 90 }).name('direction')
  addShell(meat, look)
  addPaint(meat, look.paint, 'strokes up its height')
  addToon(meat, look.toon)

  return meat
}

/**
 * The torch flame's folder, with its embers and smoke. With the plain's `fires`, every flame's: the look they all
 * burn in, the fires' intensity and their lamps' colour, then the torch's own intensity, size and place, embers and
 * smoke, and each fire's, in folders.
 */
export function addFlameFolder(gui: GUI, look: FlameLook, fires?: FiresPanel): GUI {
  const flame = gui.addFolder(fires ? 'flames' : 'torch flame')
  flame.add(look, 'enabled').name('on')
  flame.addColor(look, 'color').name('edge colour')
  flame.addColor(look, 'body').name('body colour')
  flame.addColor(look, 'core').name('core colour')
  flame.add(look, 'coreShare', 0, 1, 0.01).name('core size')
  flame.add(look, 'opacity', 0, 1, 0.01)
  flame.add(look, 'flicker', 0, 0.6, 0.01).name('size flicker (share)')
  flame.add(look, 'curl', 0, 1.5, 0.01).name('tip curl (widths)')
  flame.add(look, 'tongues', 0, 0.6, 0.01).name('tongues (widths)')
  if (fires) {
    flame.add(fires.look, 'glow', 0, 8, 0.05).name("fires' intensity (1 = their colours)")
    flame.addColor(fires.look, 'lamp').name("fires' lamp colour")
    if (fires.shadows) {
      const shadows = flame.addFolder('fire shadows (goose and goslings)')
      shadows.add(fires.shadows.look, 'enabled').name('on')
      shadows.add(fires.shadows.look, 'strength', 0, 1, 0.01).name('darkness (1 = all the colour)')
      shadows.addColor(fires.shadows.look, 'color').name('colour (black = none of its light)')
      shadows.add(fires.shadows.look, 'softness', 0, 0.5, 0.005).name('edge softness')
      shadows.add(fires.shadows.look, 'lift', 0.05, 4, 0.05).name('projector over her head m (lower = longer)')
      shadows.add(fires.shadows.look, 'atFlame').name('projector at the flame (true to the fire)')
      shadows.add(fires.shadows.look, 'cover', 0.5, 6, 0.1).name('sees round her m (goslings further cast none)')
    }
  }
  const torch = fires ? flame.addFolder("goose's torch") : flame
  torch.add(look, 'glow', 0, 8, 0.05).name('intensity (1 = its colours)')
  torch.add(look, 'height', 0.02, 0.5, 0.005).name('height m')
  torch.add(look, 'width', 0.01, 0.3, 0.005).name('width m')
  torch.add(look, 'lift', -0.4, 0.3, 0.005).name('up from the meat m')
  torch.add(look, 'offsetX', -0.2, 0.2, 0.001).name('to its left m')
  torch.add(look, 'offsetZ', -0.2, 0.2, 0.001).name('ahead of it m')
  torch.add(look, 'lean', 0, 1, 0.01).name('lean rad a m/s')
  const embers = torch.addFolder('embers')
  embers.add(look.embers, 'enabled').name('on')
  embers.add(look.embers, 'count', 0, MAX_EMBERS, 1)
  embers.add(look.embers, 'life', 0.1, 3, 0.05).name('life s')
  embers.add(look.embers, 'rise', 0, 2, 0.01).name('rise m/s')
  embers.add(look.embers, 'spread', 0, 1, 0.01).name('spread m/s')
  embers.add(look.embers, 'size', 0.002, 0.1, 0.001).name('size m')
  embers.addColor(look.embers, 'hot').name('hot colour')
  embers.addColor(look.embers, 'cold').name('going out')
  const smoke = torch.addFolder('smoke')
  smoke.add(look.smoke, 'enabled').name('on')
  smoke.add(look.smoke, 'seconds', 0.1, 5, 0.05).name('length (s of smoke)')
  smoke.add(look.smoke, 'width', 0.005, 0.3, 0.005).name('width m')
  smoke.add(look.smoke, 'rise', 0, 1.5, 0.01).name('rise m/s')
  smoke.add(look.smoke, 'sway', 0, 0.2, 0.005).name('sway m')
  smoke.add(look.smoke, 'waves', 0, 5, 0.1)
  smoke.add(look.smoke, 'breaks', 0, 5, 1)
  smoke.add(look.smoke, 'opacity', 0, 1, 0.01)
  smoke.addColor(look.smoke, 'color').name('colour')
  for (const { name, look: own, lamp, offset } of fires?.each ?? []) {
    const one = flame.addFolder(name)
    one.add(own, 'height', 0.05, 4, 0.01).name('height m')
    one.add(own, 'width', 0.02, 2, 0.01).name('width m')
    one.add(own, 'foot', -1, 2, 0.01).name('foot up m')
    if (offset) {
      one.add(own, 'x', -2, 2, 0.01).name('offset x m')
      one.add(own, 'z', -2, 2, 0.01).name('offset z m')
    }
    if (lamp) one.add(own, 'intensity', 0, 150, 0.5).name('lamp intensity')
    one.close()
  }

  return flame
}


/** A shell's highlight and rim: what a model may show of them apart from the shell it shares. */
export type ShineLook = Pick<ShellLook, 'specular' | 'shininess' | 'softness' | 'specularColor' | 'rim' | 'rimStrength' | 'rimWidth' | 'rimSoftness' | 'rimColor'>

/** A shell's sheen, highlight and rim, in `folder`. */
export function addShell(folder: GUI, shell: ShellLook): void {
  folder.add(shell, 'sheen', 0, 1, 0.01).name('sheen (light on black)')
  addShine(folder, shell)
}

/** A shell's highlight and rim, in `folder`. */
function addShine(folder: GUI, shell: ShineLook): void {
  folder.add(shell, 'specular', 0, 4, 0.01).name('highlight')
  folder.add(shell, 'shininess', 1, 200, 1).name('highlight tightness')
  folder.add(shell, 'softness', 0, 0.5, 0.01).name('highlight softness')
  folder.addColor(shell, 'specularColor').name('highlight colour')
  folder.add(shell, 'rim').name('rim light')
  folder.add(shell, 'rimStrength', 0, 3, 0.01).name('rim strength')
  folder.add(shell, 'rimWidth', 0, 1, 0.01).name('rim width')
  folder.add(shell, 'rimSoftness', 0, 0.5, 0.005).name('rim softness')
  folder.addColor(shell, 'rimColor').name('rim colour')
}

/** A shell's painted normals, as a `painted normals` folder under `folder`; `densityName` says what the density counts along. */
function addPaint(folder: GUI, paint: PaintLook, densityName: string): void {
  const sub = folder.addFolder('painted normals')
  sub.add(paint, 'strength', 0, 20, 0.1).name('stroke strength')
  sub.add(paint, 'density', 0.1, 24, 0.1).name(densityName)
  sub.add(paint, 'size', 0.25, 4, 0.05).name('stroke size')
  sub.add(paint, 'rounding', 0, 1, 0.01).name('bend toward up')
}

/** A shell's toon steps, as a `toon` folder under `folder`: none, three or five, and each step's brightness. */
export function addToon(folder: GUI, toon: ToonLook): void {
  const sub = folder.addFolder('toon')
  sub.add(toon, 'steps', [0, 3, 5]).name('steps (0 = smooth)')
  const three = sub.addFolder('3 steps')
  toon.three.forEach((_, i) => three.add(byIndex(toon.three), String(i), 0, 1, 0.01).name(STEP_NAMES[3][i]))
  const five = sub.addFolder('5 steps')
  toon.five.forEach((_, i) => five.add(byIndex(toon.five), String(i), 0, 1, 0.01).name(STEP_NAMES[5][i]))
}

/** What one frame measured, for the readouts. */
export interface FrameSample {
  drawn: number
  count: number
  /** The triangles the view drew: the rats' at their levels of detail, and the floor's. */
  triangles: number
  /** Draw calls in the frame, shadow passes included. */
  drawCalls: number
  /** The step's time, ms: the worker's own; on the GPU, a step's GPU time with timestamps on, else NaN, and unshown. */
  steeringMs: number
  /** States the swarm has made so far: the readout counts them a second, so a swarm in slow motion shows. */
  states: number
  /** The frame's own work on the page's thread: the loop, from its start to the render's return. */
  pageMs: number
  frameMs: number
}

/** How often the readouts change, in seconds: each shows the mean of the frames since. */
const READOUT_PERIOD = 0.5

/** The readout line: rats drawn, triangles on screen, steering ms, states a second, frame ms, frames a second, and what draws them, as `drawing` says. */
export function createReadouts(drawing: () => string): (sample: FrameSample) => void {
  const line = document.createElement('div')
  line.id = 'readouts'
  document.body.append(line)

  let frames = 0
  let steering = 0
  let page = 0
  let frame = 0
  let drawn = 0
  let triangles = 0
  let draws = 0
  let states = Number.NaN
  return (sample) => {
    frames++
    steering += sample.steeringMs
    page += sample.pageMs
    frame += sample.frameMs
    drawn += sample.drawn
    triangles += sample.triangles
    draws += sample.drawCalls
    if (frame < READOUT_PERIOD * 1000) return
    const made = Number.isNaN(states) ? '' : `${Math.round(((sample.states - states) * 1000) / frame)} states/s · `
    states = sample.states
    line.textContent =
      `${Math.round(drawn / frames)} / ${sample.count} rats drawn · ` +
      `${Math.round(triangles / frames).toLocaleString('en-US')} triangles · ` +
      `${Math.round(draws / frames)} draw calls · ` +
      (Number.isNaN(steering) ? '' : `steering ${(steering / frames).toFixed(2)} ms · `) +
      made +
      `page ${(page / frames).toFixed(2)} ms · frame ${(frame / frames).toFixed(2)} ms · ` +
      `${Math.round((frames * 1000) / frame)} fps · ${drawing()}`
    frames = steering = page = frame = drawn = triangles = draws = 0
  }
}
