// An instance's bounds at a moment (#152), from the VAT's **frame bounds**:
// the box the posed mesh occupies at each frame, measured at the bake. Beside
// `resolveVATFrame` and read through it, so the rows a box is made of are the
// rows the shader samples, and a change to what an instance shows changes its
// box with nothing written here.
import type { Box3 } from 'three'
import { resolveVATFrame } from './instance-playback.js'
import type { VATInstance } from './instance-playback.js'
import type { VATBase } from './types.js'

/**
 * The box `instance` occupies at `time`, in its own local space — the space of
 * `vat.geometry` and of `vat.bounds` — written into `target`, and returned.
 * Apply the instance matrix to it yourself, as to `vat.bounds`:
 *
 * ```ts
 * resolveVATBounds(vat, instances[i], time.value, box)
 * mesh.getMatrixAt(i, matrix)
 * box.applyMatrix4(matrix) // world space, axis-aligned
 * ```
 *
 * The union of the frame bounds of every row it is showing: both rows of the
 * two it interpolates, and mid-crossfade both rows of the band it is blending
 * out of. A union, never an interpolation between boxes, so the box is never
 * smaller than what is drawn, only a little larger: a lerp between two boxes
 * could cut through a limb that one of them holds. (Each frame's box is the
 * exact pose, rounded outward; a vertex-encoded crowd draws it through a
 * half-float delta, which can stray past it by the 0.061% half-float costs the
 * delta.) Once a crossfade is over
 * the outgoing band draws nothing and is left out, so an instance that blended
 * into a death is not hit where it stood.
 *
 * For picking, hit tests and game logic. It does not cull: the carrier culls
 * by `vat.bounds`, the union of every frame, so that no frame is culled
 * mid-animation.
 *
 * On an atlas, pass the instance's character, `atlas.characters[k]`, in place
 * of the atlas: the atlas's frame bounds are every character's at a row, and
 * each character keeps its own bake's.
 */
export function resolveVATBounds(vat: Pick<VATBase, 'frameBounds'>, instance: VATInstance, time: number, target: Box3): Box3 {
  const frame = resolveVATFrame(instance, time)
  target.makeEmpty()
  addFrame(vat.frameBounds, frame.row, target)
  addFrame(vat.frameBounds, frame.rowNext, target)
  const outgoing = frame.outgoing
  if (outgoing && outgoing.weight > 0) {
    addFrame(vat.frameBounds, outgoing.row, target)
    addFrame(vat.frameBounds, outgoing.rowNext, target)
  }
  return target
}

/** Grow `target` to hold frame `row`'s box. */
export function addFrame(frameBounds: Float32Array, row: number, target: Box3): void {
  const o = row * 6
  const { min, max } = target
  min.set(Math.min(min.x, frameBounds[o]!), Math.min(min.y, frameBounds[o + 1]!), Math.min(min.z, frameBounds[o + 2]!))
  max.set(Math.max(max.x, frameBounds[o + 3]!), Math.max(max.y, frameBounds[o + 4]!), Math.max(max.z, frameBounds[o + 5]!))
}
