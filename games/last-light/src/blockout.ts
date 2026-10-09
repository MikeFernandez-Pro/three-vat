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
// way three's occlusion dither cuts. The ground is never cut.
//
// The way on (#176), as plain shapes: a gate a rust-brown wall while shut,
// gone while open, cut by the see-through as the walls are; a key a small
// gold bar turning over the spot it lies on, gone once carried; a lever a grey
// post whose handle swings over as it is held, and stays over once pulled.
import { BoxGeometry, Group, Mesh, MeshBasicNodeMaterial, MeshToonNodeMaterial, Vector3, type Node } from 'three/webgpu'
import { bool, cameraPosition, float, positionWorld, screenCoordinate, smoothstep, uniform } from 'three/tsl'
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
export const defaultSeeThrough = (): SeeThrough => ({ radius: 2, inner: 0.6, bias: 0.5, ditherScale: 2 })

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

/** The level's walls, gates, keys and levers, drawn, with the see-through on the walls and gates. */
export function createBlockout({ walls, gates, keys, levers }: Pieces, look: SeeThrough = defaultSeeThrough()): Blockout {
  const gradient = createToonGradient()
  const material = new MeshToonNodeMaterial({ color: GREY, gradientMap: gradient })
  const gateMaterial = new MeshToonNodeMaterial({ color: GATE, gradientMap: gradient })

  // The see-through: a wall nearer the camera than the subject, inside the
  // circle the hole's radius makes round the subject as the camera sees it,
  // fades out from the circle's core to its edge, and the dither cuts it where
  // the screen's Bayer threshold falls under the fade. The circle is measured
  // by angle from the camera, the angle the radius subtends at the subject's
  // depth, so it is one size on screen whatever the wall's depth.
  const subject = uniform(new Vector3())
  const toHere = positionWorld.sub(cameraPosition)
  const toSubject = subject.sub(cameraPosition)
  const here = toHere.length()
  const depth = toSubject.length()
  const angle = toHere.div(here).dot(toSubject.div(depth)).clamp(-1, 1).acos()
  const cone = float(look.radius).div(depth).atan()
  const fade = smoothstep(look.inner, 1, angle.div(cone)).oneMinus()
  const inFront = here.lessThan(depth.sub(look.bias))
  const cut = fade.mul(float(inFront))
  // Remapped to [0, 1), so a full cut removes every fragment.
  const threshold = (bayer16(screenCoordinate.div(look.ditherScale)) as Node<'vec4'>).r.mul(255 / 256)
  for (const m of [material, gateMaterial]) {
    m.maskNode = threshold.greaterThanEqual(cut)
    // The walls' shadows stay whole where they are dithered out.
    m.maskShadowNode = bool(true)
  }

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
