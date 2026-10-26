// The level's walls, drawn as grey boxes (#175): each WALL_THICKNESS thick,
// from one end to the other, standing WALL_HEIGHT high, in the grey the
// lights' stands are. The level is a blockout: the play is judged before any
// art is made.
//
// The see-through, brought over from the test hall (ADR-0049), not merged: a
// wall nearer the camera than the holder, inside a circle round the holder as
// the camera sees it (measured by angle from the camera, so the hole is the
// same size on screen whatever the wall's depth), is dithered away with a
// screen-space Bayer threshold through the walls' `maskNode`, their shadows
// kept whole: Utanomori's see-through for its hero behind the trees, cut the
// way three's occlusion dither cuts. The ground is never cut. The goose game
// cuts the same hole with Perlin noise laid in the world for its threshold.
//
// The way on (#176), as plain shapes: a gate a rust-brown wall while shut,
// gone while open, cut by the see-through as the walls are; a key a small
// gold bar turning over the spot it lies on, gone once carried; a lever a grey
// post whose handle swings over as it is held, and stays over once pulled.
import { BoxGeometry, BufferGeometry, Group, LineBasicNodeMaterial, LineLoop, Mesh, MeshBasicNodeMaterial, MeshToonNodeMaterial, Vector3, type Camera, type Node, type NodeMaterial } from 'three/webgpu'
import { bool, cameraPosition, cameraViewMatrix, float, mix, mx_noise_float, output, positionWorld, renderGroup, screenCoordinate, select, smoothstep, time, uniform, vec3, vec4 } from 'three/tsl'
import { bayer16 } from 'three/examples/jsm/tsl/math/Bayer.js'
import { createToonGradient } from './toon'
import { WALL_THICKNESS, type Wall } from './walls'
import type { Gate, Key, Lever } from './run'

/** How high the walls stand, m: over the lights, so a wall hides a light behind it from the eye at the holder's height, and under the camera's start. */
export const WALL_HEIGHT = 2.2
const GREY = 0x6b6670
/** A gate's rust brown, and a key's gold. */
const GATE = 0x7a4a32
const GOLD = 0xffc23a
/** How high a key turns over its spot, m: over the rats' backs. */
const KEY_HEIGHT = 0.45
/** How far a lever's handle swings, radians, from up and back to up and forward. */
const SWING = 1.2

/** What the see-through is set by. */
export interface SeeThrough {
  /** Whether anything is cut at all. */
  enabled: boolean
  /** How much of the wall goes at the hole's core: 0 none, 1 all of it. */
  strength: number
  /** The hole's radius round the holder, m, as the camera sees it. */
  radius: number
  /** How much of the radius is the hole's core, 0 to 1, before it fades out to the edge. */
  inner: number
  /** A wall must be this much nearer the camera than the holder to be cut, m. */
  bias: number
  /** The dither's cell, in pixels. */
  ditherScale: number
}

/** A hole two metres round the holder, clear over its inner three fifths and dithered away to its edge, the cell two pixels: the hall's, a little smaller for walls nearer the holder. */
export const defaultSeeThrough = (): SeeThrough => ({ enabled: true, strength: 1, radius: 2, inner: 0.6, bias: 0.5, ditherScale: 2 })

/** What the blockout draws: the level's walls, and its gates, keys and levers. */
export interface Pieces {
  walls: readonly Wall[]
  gates: readonly Gate[]
  keys: readonly Key[]
  levers: readonly Lever[]
}

/** The way on as it stands, as the run has it: each gate open, each key carried, each lever pulled, and how long each has been held, s. */
export interface Standing {
  open: readonly boolean[]
  carrying: readonly boolean[]
  pulled: readonly boolean[]
  holding: readonly number[]
}

/** The level's walls as drawn, and the see-through's subject. */
export interface Blockout {
  readonly object: Group
  /** Where the see-through's hole is cut round, this frame: the holder. */
  seeThroughTo(subject: Vector3): void
  /** The gates, keys and levers as they stand, the keys turning at `time`, s. */
  update(standing: Standing, time: number): void
}

/**
 * The see-through, for any material to take: where the hole is cut round, a
 * uniform to move, and the mask that cuts it. A material given it is dithered
 * away round the subject, its shadow kept whole. Its look is on uniforms:
 * `set` takes another, and recompiles nothing.
 */
export function seeThrough(look: SeeThrough = defaultSeeThrough()): SeeThroughCut<SeeThrough> {
  const hole = holeRound()
  const ditherScale = shared(1)
  // Remapped to [0, 1), so a full cut removes every fragment.
  const threshold = (bayer16(screenCoordinate.div(ditherScale)) as Node<'vec4'>).r.mul(255 / 256)
  const set = (next: SeeThrough) => {
    hole.set(next)
    ditherScale.value = Math.max(1, next.ditherScale)
  }
  set(look)
  return { subject: hole.subject, set, cut: cutBy(threshold.greaterThanEqual(hole.cut)) }
}

/**
 * The goose game's see-through: the same hole, its dither Perlin noise in
 * place of the screen's Bayer grid. The noise is laid in the world, on the
 * surfaces, so the hole's edge breaks up into blots that stay on a wall as
 * the camera moves past it, where the grid's cells stay on the screen. Nor is
 * the hole a circle: as the Portfolio's intro iris does, its edge is pushed in
 * and out by a second noise, taken round the hole as the camera sees it and
 * slowly turning over in time, so it opens as a blot that keeps changing shape.
 */
export interface NoiseSeeThrough extends Omit<SeeThrough, 'ditherScale'> {
  /** How high over the ground under the subject the hole is centred, m. */
  height: number
  /** How big the noise's blots are, m. */
  noiseScale: number
  /** How hard the blots' edges are: 1 the noise as it comes, higher harder, so the hole opens in fewer, sharper blots. */
  contrast: number
  /** How fast the noise rises through the surfaces, m/s: 0 still. */
  drift: number
  /** How far the hole's edge is pushed in and out, as a share of its radius: 0 a circle. */
  wobble: number
  /** How many lobes the edge has: the edge's noise, a radius to a unit of it. */
  wobbleScale: number
  /** How fast the edge changes shape. */
  wobbleSpeed: number
  /**
   * The zone shown, to set it by: what the see-through would take away drawn red in its place, the hole's fade a red
   * wash over the rest, and rings round her at its radius and its clear core's (`seeThroughZone`).
   */
  debug: boolean
}

/** A hole two metres round the goose, centred at her neck, clear over its inner two fifths, its blots a third of a metre and still, its edge pushed a third of its radius in and out. */
export const defaultNoiseSeeThrough = (): NoiseSeeThrough => ({ enabled: true, strength: 1, radius: 2, inner: 0.4, bias: 0.5, height: 0.4, noiseScale: 0.35, contrast: 1.6, drift: 0, wobble: 0.35, wobbleScale: 1.8, wobbleSpeed: 0.15, debug: false })

/** The see-through dithered by Perlin noise in the world, as `seeThrough` is by the screen's Bayer grid. */
export function noiseSeeThrough(look: NoiseSeeThrough = defaultNoiseSeeThrough()): SeeThroughCut<NoiseSeeThrough> {
  const wobble = shared(0)
  const wobbleScale = shared(1)
  const wobbleSpeed = shared(0)
  const hole = holeRound((round) => mx_noise_float(vec3(round.mul(wobbleScale), time.mul(wobbleSpeed))).mul(wobble))
  const scale = shared(1)
  const contrast = shared(1)
  const drift = shared(0)
  // Perlin's noise lies about 0, mostly within ±1: spread by the contrast and
  // moved to [0, 1), so a full cut still removes every fragment.
  const at = positionWorld.add(vec3(0, time.mul(drift).negate(), 0)).div(scale)
  const threshold = mx_noise_float(at).mul(contrast).mul(0.5).add(0.5).clamp(0, 255 / 256)
  const debug = shared(0)
  // What the see-through takes away, as the noise falls under the hole's fade.
  const away = threshold.lessThan(hole.cut)
  const set = (next: NoiseSeeThrough) => {
    hole.set(next)
    debug.value = next.debug ? 1 : 0
    scale.value = Math.max(0.01, next.noiseScale)
    contrast.value = Math.max(0.1, next.contrast)
    drift.value = next.drift
    wobble.value = next.wobble
    wobbleScale.value = Math.max(0.01, next.wobbleScale)
    wobbleSpeed.value = next.wobbleSpeed
  }
  set(look)
  // Shown, nothing is taken away: what would be is drawn red, and the fade over the rest a red wash.
  const cut = (m: NodeMaterial, kept?: Node<'bool'>) => {
    const taken = kept ? away.and(kept.not()) : away
    m.maskNode = taken.not().or(debug.greaterThan(0.5))
    m.maskShadowNode = bool(true)
    const red = select(taken, float(1), hole.cut.mul(0.4)).mul(debug)
    m.outputNode = vec4(mix(output.rgb, vec3(1, 0, 0), red), output.a)
  }
  return { subject: hole.subject, set, cut }
}

/**
 * The see-through's zone round its subject, for its debug: a red ring at the hole's radius and a fainter one at its
 * clear core's, facing the camera at the subject's depth, as the hole is measured; drawn over everything.
 */
export function seeThroughZone(): { object: Group; update(subject: Vector3, camera: Camera, look: NoiseSeeThrough): void } {
  const circle = new BufferGeometry().setFromPoints(Array.from({ length: 96 }, (_, k) => new Vector3(Math.cos((k / 96) * Math.PI * 2), Math.sin((k / 96) * Math.PI * 2), 0)))
  const ring = (opacity: number) => {
    const material = new LineBasicNodeMaterial({ color: 0xff0000, transparent: true, opacity, depthTest: false })
    const line = new LineLoop(circle, material)
    line.renderOrder = 10
    return line
  }
  const outer = ring(1)
  const core = ring(0.5)
  const object = new Group()
  object.add(outer, core)
  object.visible = false
  return {
    object,
    update(subject, camera, look) {
      object.visible = look.debug && look.enabled
      if (!object.visible) return
      object.position.copy(subject)
      object.quaternion.copy(camera.quaternion)
      outer.scale.setScalar(look.radius)
      core.scale.setScalar(look.radius * Math.min(look.inner, 0.99))
    },
  }
}

/** A see-through: where the hole is cut round, a uniform to move; a material to cut, but where `kept` holds; its look, taken again. */
export interface SeeThroughCut<Look> {
  subject: { value: Vector3 }
  cut(material: NodeMaterial, kept?: Node<'bool'>): void
  set(look: Look): void
}

// Every frame's or the panel's, read by walls that never move: a uniform in
// the object group would keep the value they were first drawn with.
const shared = (value: number) => uniform(value).setGroup(renderGroup)

// The see-through's hole, before its dither: a wall nearer the camera than the
// subject, inside the circle the hole's radius makes round the subject as the
// camera sees it, fades out from the circle's core to its edge, and the dither
// cuts it where its threshold falls under the fade. The circle is measured by
// angle from the camera, the angle the radius subtends at the subject's depth,
// so it is one size on screen whatever the wall's depth. `warp`, where given,
// pushes the edge out where it is under 0 and in where over, read at a point
// round the hole as the camera sees it, its edge 1 from its centre.
function holeRound(warp?: (round: Node<'vec2'>) => Node<'float'>): { subject: { value: Vector3 }; cut: Node<'float'>; set(look: Omit<SeeThrough, 'ditherScale'>): void } {
  const subject = uniform(new Vector3()).setGroup(renderGroup)
  const on = shared(1)
  const strength = shared(1)
  const radius = shared(1)
  const inner = shared(0)
  const bias = shared(0)
  const toHere = positionWorld.sub(cameraPosition)
  const toSubject = subject.sub(cameraPosition)
  const here = toHere.length()
  const depth = toSubject.length()
  const angle = toHere.div(here).dot(toSubject.div(depth)).clamp(-1, 1).acos()
  const cone = radius.div(depth).atan()
  // Across the camera's view, so the point is the hole's own, whichever way the camera faces.
  const off = toHere.div(here).sub(toSubject.div(depth))
  const round = cameraViewMatrix.mul(vec4(off, 0)).xy.div(cone)
  const edge = warp ? angle.div(cone).add(warp(round)) : angle.div(cone)
  const fade = smoothstep(inner, 1, edge).oneMinus()
  const inFront = here.lessThan(depth.sub(bias))
  return {
    subject,
    cut: fade.mul(float(inFront)).mul(strength).mul(on),
    set(next) {
      on.value = next.enabled ? 1 : 0
      strength.value = next.strength
      radius.value = Math.max(0.05, next.radius)
      // Short of 1, so the fade's two edges never meet.
      inner.value = Math.min(next.inner, 0.99)
      bias.value = next.bias
    },
  }
}

const cutBy = (mask: Node<'bool'>) => (m: NodeMaterial, kept?: Node<'bool'>) => {
  m.maskNode = kept ? mask.or(kept) : mask
  // The shadows stay whole where they are dithered out.
  m.maskShadowNode = bool(true)
}

/** The level's walls, gates, keys and levers, drawn, with the see-through on the walls and gates. */
export function createBlockout({ walls, gates, keys, levers }: Pieces, look: SeeThrough = defaultSeeThrough()): Blockout {
  const gradient = createToonGradient()
  const material = new MeshToonNodeMaterial({ color: GREY, gradientMap: gradient })
  const gateMaterial = new MeshToonNodeMaterial({ color: GATE, gradientMap: gradient })
  const { subject, cut } = seeThrough(look)
  for (const m of [material, gateMaterial]) cut(m)

  const object = new Group()
  const box = new BoxGeometry(1, 1, 1)
  const wallOf = ({ from, to }: Wall, m: MeshToonNodeMaterial) => {
    const dx = to.x - from.x
    const dz = to.z - from.z
    const wall = new Mesh(box, m)
    wall.position.set((from.x + to.x) / 2, WALL_HEIGHT / 2, (from.z + to.z) / 2)
    wall.scale.set(Math.hypot(dx, dz), WALL_HEIGHT, WALL_THICKNESS)
    wall.rotation.y = -Math.atan2(dz, dx)
    wall.castShadow = wall.receiveShadow = true
    object.add(wall)
    return wall
  }
  for (const wall of walls) wallOf(wall, material)
  const gateMeshes = gates.map((gate) => wallOf(gate, gateMaterial))

  // A key: a gold bar, unlit, so it reads in the dark among the rats.
  const gold = new MeshBasicNodeMaterial({ color: GOLD })
  const keyMeshes = keys.map(({ x, z }) => {
    const key = new Mesh(box, gold)
    key.position.set(x, KEY_HEIGHT, z)
    key.scale.set(0.32, 0.08, 0.1)
    key.castShadow = true
    object.add(key)
    return key
  })

  // A lever: a post, and a handle on a pivot at its top.
  const leverParts = levers.map(({ x, z }) => {
    const post = new Mesh(box, material)
    post.position.set(x, 0.45, z)
    post.scale.set(0.2, 0.9, 0.2)
    post.castShadow = post.receiveShadow = true
    const pivot = new Group()
    pivot.position.set(x, 0.9, z)
    const handle = new Mesh(box, gateMaterial)
    handle.position.y = 0.3
    handle.scale.set(0.08, 0.6, 0.08)
    handle.castShadow = true
    pivot.add(handle)
    object.add(post, pivot)
    return pivot
  })

  return {
    object,
    seeThroughTo(point) {
      subject.value.copy(point)
    },
    update({ open, carrying, pulled, holding }, time) {
      gateMeshes.forEach((gate, g) => (gate.visible = !open[g]))
      keyMeshes.forEach((key, k) => {
        key.visible = !carrying[k]
        key.rotation.y = time * 1.5
        key.position.y = KEY_HEIGHT + Math.sin(time * 2 + k) * 0.05
      })
      leverParts.forEach((pivot, l) => {
        const share = pulled[l] ? 1 : Math.min(1, (holding[l] ?? 0) / levers[l]!.hold)
        pivot.rotation.x = -SWING + 2 * SWING * share
      })
    },
  }
}
