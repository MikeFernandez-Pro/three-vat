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
import { BoxGeometry, Group, Mesh, MeshToonNodeMaterial, Vector3, type Node } from 'three/webgpu'
import { bool, cameraPosition, float, positionWorld, screenCoordinate, smoothstep, uniform } from 'three/tsl'
import { bayer16 } from 'three/examples/jsm/tsl/math/Bayer.js'
import { createToonGradient } from './toon'
import { WALL_THICKNESS, type Wall } from './walls'

/** How high the walls stand, m: over the lights, so a wall hides a light behind it from the eye at the holder's height, and under the camera's start. */
export const WALL_HEIGHT = 2.2
const GREY = 0x6b6670

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

/** The level's walls as drawn, and the see-through's subject. */
export interface Blockout {
  readonly object: Group
  /** Where the see-through's hole is cut round, this frame: the holder. */
  seeThroughTo(subject: Vector3): void
}

/** The level's walls, drawn, with the see-through on them. */
export function createBlockout(walls: readonly Wall[], look: SeeThrough = defaultSeeThrough()): Blockout {
  const material = new MeshToonNodeMaterial({ color: GREY, gradientMap: createToonGradient() })

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
  material.maskNode = threshold.greaterThanEqual(cut)
  // The walls' shadows stay whole where they are dithered out.
  material.maskShadowNode = bool(true)

  const object = new Group()
  const box = new BoxGeometry(1, 1, 1)
  for (const { from, to } of walls) {
    const dx = to.x - from.x
    const dz = to.z - from.z
    const wall = new Mesh(box, material)
    wall.position.set((from.x + to.x) / 2, WALL_HEIGHT / 2, (from.z + to.z) / 2)
    wall.scale.set(Math.hypot(dx, dz), WALL_HEIGHT, WALL_THICKNESS)
    wall.rotation.y = -Math.atan2(dz, dx)
    wall.castShadow = wall.receiveShadow = true
    object.add(wall)
  }
  return {
    object,
    seeThroughTo(point) {
      subject.value.copy(point)
    },
  }
}
