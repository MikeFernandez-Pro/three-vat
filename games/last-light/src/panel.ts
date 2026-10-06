// The settings panel and the readouts: what makes the swarm tunable and
// measurable. The panel is three's own copy of lil-gui, so the game installs
// nothing for it; the readouts are one line of text, top-left.
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import type { AOLook, DofLook, GrainLook, HatchLook, OutlineLook, PaletteLook, VignetteLook } from './post'
import type { FloorLook } from './ground'
import { MAX_EMBERS } from './embers'
import type { FlameLook } from './flame'
import type { MeatLook } from './meat'
import type { PaintLook, ShellLook } from './shell'
import type { Part, TrailLook } from './rats'
import type { ToonLook } from './toon'
import type { Tuning } from './swarm'

/** What the panel edits. The page reads it, and is told when a group of it changes. */
export interface Settings {
  rats: number
  minSpeed: number
  maxSpeed: number
  /** How big a rat is: 1 at its usual size, a body about 0.25 m long. It scales the collision disc with it. */
  size: number
  /** How much room a rat keeps round it, on top of its size: 1 as drawn, 2 a disc twice as wide, so half as many fit the same ground. */
  spacing: number
  strength: number
  on: boolean
  shadows: boolean
  /** How fast every rat's Run plays: 1 the clip as authored, a 0.5 m bound every half second. */
  runAnimation: number
  /** How fast the light walks, m/s. */
  lightSpeed: number
  /** Paused: the swarm, the run and the light's walk all hold; the camera still moves. */
  paused: boolean
  /** Rats left behind in the fog are brought round ahead of a walking light, in the fog still: the crowd it walks into never thins. */
  bringRound: boolean
}

/**
 * How the scene looks, every control in the panel's look folders. Colours are
 * hex numbers; angles are degrees; distances metres.
 */
export interface Look {
  /**
   * The warm light the holder carries: its reach is where it fades to nothing,
   * its falloff how fast it gets there, its lag how many seconds it eases
   * after the holder; and whether it burns in the torch's flame, or hangs
   * where a holder's hand would carry it.
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
  }
  /** The cold fill: a colour from above, another from below. */
  fill: { sky: number; ground: number; intensity: number }
  /** The fog round the light, which the sky shares: clear up to `near` metres from the light, solid from `far`. */
  fog: { color: number; near: number; far: number }
  /**
   * The rats' colours: one for each part the model has, in the model's own to
   * start, and a tint over them all; their shell's sheen and highlight; and
   * their toon steps.
   */
  rats: { color: number; parts: Part[]; glow: number; toon: ToonLook; paint: PaintLook } & ShellLook
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
  /** The depth of field, the tabletop's shallow focus. */
  dof: DofLook
  /** The meat at the light. */
  meat: MeatLook
  /** The flame on the end of its bandage. */
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
export type CrowdTuning = Pick<Tuning, 'agitation' | 'lookAhead' | 'gap'>

export interface PanelEvents {
  /** The rats slider was let go. */
  count(): void
  /** A speed slider moved: once a move, never a frame. */
  speeds(): void
  /** The rat scale slider moved: once a move, never a frame. */
  size(): void
  /** The run animation slider moved. */
  animation(): void
  /** The strength slider moved, or the light was put out or relit. */
  light(): void
  /** The lamp's shadows toggle flipped. */
  shadows(): void
  /** Any control in a look folder moved. */
  look(): void
}

/** The panel, its rats slider topped at `maxRats`. Space puts the light out and relights it, and P pauses, as their buttons do. */
export function createPanel(settings: Settings, crowd: CrowdTuning, look: Look, maxRats: number, changed: PanelEvents): void {
  const gui = new GUI({ title: 'Last Light' })
  gui.add(settings, 'rats', 0, maxRats, 1).onFinishChange(changed.count)

  // The slowest never outruns the fastest.
  const min = gui.add(settings, 'minSpeed', 0.2, 12, 0.05).name('slowest m/s')
  const max = gui.add(settings, 'maxSpeed', 0.2, 12, 0.05).name('fastest m/s')
  keepOrdered(min, max, changed.speeds)

  gui.add(settings, 'size', 0.5, 3, 0.05).name('rat scale').onChange(changed.size)
  gui.add(settings, 'spacing', 0.5, 3, 0.05).name('spacing').onChange(changed.size)
  gui.add(settings, 'runAnimation', 0.1, 4, 0.05).name('run animation speed').onChange(changed.animation)
  gui.add(settings, 'strength', 0, 1, 0.01).name('light strength').onChange(changed.light)
  gui.add(settings, 'lightSpeed', 0.2, 12, 0.1).name('light speed m/s')
  gui.add(settings, 'bringRound').name('rats come round ahead')
  const actions = { toggleLight, togglePause }
  const button = gui.add(actions, 'toggleLight')
  const pauseButton = gui.add(actions, 'togglePause')
  addCrowd(gui, crowd)
  addLook(gui, settings, look, changed)

  function label() {
    button.name(settings.on ? 'put the light out (space)' : 'relight (space)')
    pauseButton.name(settings.paused ? 'resume (P)' : 'pause (P)')
  }
  function toggleLight() {
    settings.on = !settings.on
    label()
    changed.light()
  }
  function togglePause() {
    settings.paused = !settings.paused
    label()
  }
  label()

  // Captured on the way down: lil-gui stops keys from bubbling out of the panel.
  addEventListener(
    'keydown',
    (event) => {
      if ((event.code !== 'Space' && event.code !== 'KeyP') || event.repeat) return
      // Whatever in the panel was last clicked keeps the focus, and would answer
      // the space too: the shadows toggle would flip, or the button click twice.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      event.preventDefault()
      if (event.code === 'Space') toggleLight()
      else togglePause()
    },
    { capture: true },
  )
}

type NumberController = ReturnType<GUI['add']>

/** Keeps `low` at or under `high`: moving either past the other drags the other along. Then `changed`, if given. */
function keepOrdered(low: NumberController, high: NumberController, changed?: () => void): void {
  low.onChange((value: number) => {
    if (high.getValue() < value) high.setValue(value)
    changed?.()
  })
  high.onChange((value: number) => {
    if (low.getValue() > value) low.setValue(value)
    changed?.()
  })
}

/** The crowd folder, open: each control moves the running swarm, with no reset. */
function addCrowd(gui: GUI, crowd: CrowdTuning): void {
  const folder = gui.addFolder('crowd')
  folder.add(crowd, 'agitation', 0, 2, 0.05).name('writhes m/s')
  folder.add(crowd, 'lookAhead', 0, 2, 0.1).name('reads the light s')
  folder.add(crowd, 'gap', 0, 1, 0.05).name('keeps off it by m')
}

/** A list as lil-gui binds it: each entry a property, by its index. */
const byIndex = (values: number[]) => values as unknown as Record<string, number>

/** What each toon step is, darkest first. */
const STEP_NAMES = {
  3: ['shade', 'half-light', 'full light'],
  5: ['deep shade', 'shade', 'half-light', 'light', 'full light'],
}

/** The look folders, closed to start so the swarm's controls stay in view. */
function addLook(gui: GUI, settings: Settings, look: Look, changed: PanelEvents): void {
  const lamp = gui.addFolder('lamp').close()
  lamp.addColor(look.lamp, 'color')
  lamp.add(look.lamp, 'intensity', 0, 150, 1)
  lamp.add(look.lamp, 'reach', 0, 30, 0.1).name('reach m (0 = endless)')
  lamp.add(look.lamp, 'falloff', 0, 3, 0.05).name('falloff (fade/sharp)')
  lamp.add(look.lamp, 'lag', 0, 0.5, 0.01).name('lag after the holder s')
  lamp.add(look.lamp, 'inFlame').name('in the torch (else 1.1 m up)')
  lamp.add(settings, 'shadows').name('shadows').onChange(changed.shadows)

  const sun = gui.addFolder('sun').close()
  sun.addColor(look.sun, 'color')
  sun.add(look.sun, 'intensity', 0, 5, 0.05)
  sun.add(look.sun, 'x', -30, 30, 0.5).name('position x m')
  sun.add(look.sun, 'y', 1, 40, 0.5).name('position y m')
  sun.add(look.sun, 'z', -30, 30, 0.5).name('position z m')
  sun.add(look.sun, 'shadows')
  sun.add(look.sun, 'softness', 0, 20, 0.5).name('shadow softness')
  sun.add(look.sun, 'darkness', 0, 1, 0.01).name('shadow darkness')

  const fill = gui.addFolder('fill').close()
  fill.addColor(look.fill, 'sky')
  fill.addColor(look.fill, 'ground')
  fill.add(look.fill, 'intensity', 0, 3, 0.05)

  const fog = gui.addFolder('fog').close()
  fog.addColor(look.fog, 'color')
  fog.add(look.fog, 'near', 0, 30, 0.25).name('clear to m')
  fog.add(look.fog, 'far', 1, 60, 0.25).name('solid from m')

  const rats = gui.addFolder('rats').close()
  for (const part of look.rats.parts) rats.addColor(part, 'color').name(part.name)
  rats.addColor(look.rats, 'color').name(look.rats.parts.length ? 'tint' : 'colour')
  if (look.rats.parts.some((part) => part.name === 'eyes')) rats.add(look.rats, 'glow', 0, 6, 0.1).name('eyes glow')
  addShell(rats, look.rats)
  addPaint(rats, look.rats.paint, 'strokes per body')
  addToon(rats, look.rats.toon)

  const ground = gui.addFolder('floor').close()
  ground.add(look.floor, 'lightness', 0, 3, 0.01).name('lightness (dark/light)')
  ground.add(look.floor, 'saturation', 0, 3, 0.01)
  ground.add(look.floor, 'scale', 0.2, 10, 0.05).name('tile size m')
  ground.add(look.floor, 'relief', 0, 3, 0.01).name('relief (0 = flat)')
  addShell(ground, look.floor.shell)
  addPaint(ground, look.floor.paint, 'strokes per metre')
  addToon(ground, look.floor.toon)

  // Open, while it is being read: what it does is easiest to see with the folder in hand.
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

  const outline = gui.addFolder('outlines')
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

  const palette = gui.addFolder('palette')
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

  // Nothing to wire: the page reads it every frame.
  const stop = gui.addFolder('stop motion')
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

  const depth = gui.addFolder('depth of field')
  depth.add(look.dof, 'enabled').name('on')
  depth.add(look.dof, 'onLight').name('focus on the light')
  depth.add(look.dof, 'focus', 0.5, 30, 0.1).name('focus m')
  depth.add(look.dof, 'focal', 0.1, 20, 0.1).name('soft past m')
  depth.add(look.dof, 'bokeh', 0, 6, 0.1)

  const meat = gui.addFolder('meat')
  meat.add(look.meat, 'enabled').name('on')
  meat.add(look.meat, 'height', 0.1, 2, 0.01).name('height m')
  meat.add(look.meat, 'lift', 0, 2, 0.01).name('off the ground m')
  const MEAT_PARTS = ['meat', 'bone', 'knob', 'cheeks']
  look.meat.colors.forEach((_, i) => meat.addColor(byIndex(look.meat.colors), String(i)).name(MEAT_PARTS[i]))
  addShell(meat, look.meat)
  addPaint(meat, look.meat.paint, 'strokes up its height')
  addToon(meat, look.meat.toon)

  const flame = gui.addFolder('torch flame')
  flame.add(look.flame, 'enabled').name('on')
  flame.add(look.flame, 'height', 0.02, 0.5, 0.005).name('height m')
  flame.add(look.flame, 'width', 0.01, 0.3, 0.005).name('width m')
  flame.add(look.flame, 'lift', -0.2, 0.3, 0.005).name('up from the bandage m')
  flame.add(look.flame, 'offsetX', -0.2, 0.2, 0.001).name('to its left m')
  flame.add(look.flame, 'offsetZ', -0.2, 0.2, 0.001).name('ahead of it m')
  flame.addColor(look.flame, 'color').name('edge colour')
  flame.addColor(look.flame, 'body').name('body colour')
  flame.addColor(look.flame, 'core').name('core colour')
  flame.add(look.flame, 'coreShare', 0, 1, 0.01).name('core size')
  flame.add(look.flame, 'flicker', 0, 0.6, 0.01).name('size flicker (share)')
  flame.add(look.flame, 'curl', 0, 1.5, 0.01).name('tip curl (widths)')
  flame.add(look.flame, 'tongues', 0, 0.6, 0.01).name('tongues (widths)')
  flame.add(look.flame, 'lean', 0, 1, 0.01).name('lean rad a m/s')
  const embers = flame.addFolder('embers')
  embers.add(look.flame.embers, 'enabled').name('on')
  embers.add(look.flame.embers, 'count', 0, MAX_EMBERS, 1)
  embers.add(look.flame.embers, 'life', 0.1, 3, 0.05).name('life s')
  embers.add(look.flame.embers, 'rise', 0, 2, 0.01).name('rise m/s')
  embers.add(look.flame.embers, 'spread', 0, 1, 0.01).name('spread m/s')
  embers.add(look.flame.embers, 'size', 0.002, 0.1, 0.001).name('size m')
  embers.addColor(look.flame.embers, 'hot').name('hot colour')
  embers.addColor(look.flame.embers, 'cold').name('going out')

  const trails = gui.addFolder('eye trails (with the stop motion)')
  trails.add(look.trails, 'enabled').name('on')
  trails.add(look.trails, 'seconds', 0, 2, 0.01).name('length (s of travel)')
  trails.add(look.trails, 'width', 0.001, 0.3, 0.001).name('width m')
  trails.add(look.trails, 'taper', 0.25, 4, 0.05).name('taper (1 straight)')
  trails.add(look.trails, 'wave', 0, 4, 0.05).name('sway (x width)')
  trails.add(look.trails, 'strength', 0, 8, 0.05).name('brightness')
  trails.add(look.trails, 'fade', 0.25, 12, 0.05).name('fade to the tail')
  trails.add(look.trails, 'eyeColour').name('eyes colour')
  trails.addColor(look.trails, 'color').name('own colour')

  for (const folder of [lamp, sun, fill, fog, rats, ground, occlusion, outline, hatch, palette, grain, vignette, depth, trails, meat, flame]) folder.onChange(changed.look)
}

/** A shell's sheen and highlight, in `folder`. */
function addShell(folder: GUI, shell: ShellLook): void {
  folder.add(shell, 'sheen', 0, 1, 0.01).name('sheen (light on black)')
  folder.add(shell, 'specular', 0, 2, 0.01).name('highlight')
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

/** A shell's toon steps, as a closed `toon` folder under `folder`: three or five, and each step's brightness. */
function addToon(folder: GUI, toon: ToonLook): void {
  const sub = folder.addFolder('toon').close()
  sub.add(toon, 'steps', [3, 5]).name('steps')
  const three = sub.addFolder('3 steps')
  toon.three.forEach((_, i) => three.add(byIndex(toon.three), String(i), 0, 1, 0.01).name(STEP_NAMES[3][i]))
  const five = sub.addFolder('5 steps')
  toon.five.forEach((_, i) => five.add(byIndex(toon.five), String(i), 0, 1, 0.01).name(STEP_NAMES[5][i]))
}

/** What one frame measured, for the readouts. */
export interface FrameSample {
  drawn: number
  count: number
  /** The vertices the view drew. */
  vertices: number
  /** Draw calls in the frame, shadow passes included. */
  drawCalls: number
  steeringMs: number
  frameMs: number
}

/** How often the readouts change, in seconds: each shows the mean of the frames since. */
const READOUT_PERIOD = 0.5

/** The readout line: rats drawn, vertices on screen, steering ms, frame ms, frames a second, and the backend drawing them. */
export function createReadouts(backend: string): (sample: FrameSample) => void {
  const line = document.createElement('div')
  line.id = 'readouts'
  document.body.append(line)

  let frames = 0
  let steering = 0
  let frame = 0
  let drawn = 0
  let vertices = 0
  let draws = 0
  return (sample) => {
    frames++
    steering += sample.steeringMs
    frame += sample.frameMs
    drawn += sample.drawn
    vertices += sample.vertices
    draws += sample.drawCalls
    if (frame < READOUT_PERIOD * 1000) return
    line.textContent =
      `${Math.round(drawn / frames)} / ${sample.count} rats drawn · ` +
      `${Math.round(vertices / frames).toLocaleString('en-US')} vertices · ` +
      `${Math.round(draws / frames)} draw calls · ` +
      `steering ${(steering / frames).toFixed(2)} ms · frame ${(frame / frames).toFixed(2)} ms · ` +
      `${Math.round((frames * 1000) / frame)} fps · ${backend}`
    frames = steering = frame = drawn = vertices = draws = 0
  }
}
