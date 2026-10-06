// Where chosen points of the mesh are at every baked frame, on the CPU: a
// **point track**. Each point is the centre of a handful of vertices — an eye,
// a hand, a muzzle — posed as the decode poses them, so a caller can hang a
// trail, a spark or a held thing on a body part without reading texels itself.
// Read once, after the bake or the load, and looked up by row afterwards, the
// rows `resolveVATFrame` names.
import { DataUtils, Quaternion, Vector3 } from 'three'
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import type { DeltaVAT, RigVAT, VAT } from './types.js'

/**
 * Every baked frame's position of each point in `points`, a point being the
 * centre of the vertices of `vat.geometry` it lists. Three floats a point a
 * frame, in the space of `vat.geometry` and `vat.bounds` — point `p` at frame
 * row `f` at `(f × points.length + p) × 3` — for every one of
 * `vat.totalFrames` rows, so the rows a clip's `startFrame` and
 * `resolveVATFrame` count in address it directly:
 *
 * ```ts
 * const track = trackVATPoints(vat, [leftEyeVertices, rightEyeVertices])
 * const { row, rowNext, mix } = resolveVATFrame(instance, time.value)
 * const at = (r: number, axis: number) => track[(r * 2 + eye) * 3 + axis]!
 * const x = at(row, 0) + (at(rowNext, 0) - at(row, 0)) * mix // and y, z
 * ```
 *
 * Each vertex is posed as the decode poses it at a row: the rest position plus
 * its delta under the vertex encoding, skinned from its slots under the rig
 * encoding. Between rows the caller lerps the point, which a rig decode does
 * not quite do — it blends slots — but a frame's step is short enough for the
 * two to agree to well under the size of the part. A crossfade's outgoing band
 * is the caller's to weigh in, as `resolveVATBounds` does.
 *
 * Reads the textures' CPU copies, so it is run before anything disposes of
 * them; costs a pass over the listed vertices a frame, once.
 */
export function trackVATPoints(vat: VAT, points: readonly (readonly number[])[]): Float32Array {
  const count = vat.geometry.getAttribute('position').count
  for (const vertices of points) {
    if (vertices.length === 0) throw new Error('three-vat: trackVATPoints was given a point of no vertices — a point is the centre of at least one')
    for (const v of vertices) {
      if (!Number.isInteger(v) || v < 0 || v >= count) {
        throw new Error(`three-vat: trackVATPoints was given vertex ${v}, and the geometry has vertices 0 to ${count - 1}`)
      }
    }
  }
  const track = new Float32Array(vat.totalFrames * points.length * 3)
  const pose = vat.encoding === 'rig' ? rigPose(vat) : deltaPose(vat)
  const at = new Vector3()
  for (let f = 0; f < vat.totalFrames; f++) {
    points.forEach((vertices, p) => {
      let x = 0
      let y = 0
      let z = 0
      for (const v of vertices) {
        pose(f, v, at)
        x += at.x
        y += at.y
        z += at.z
      }
      const o = (f * points.length + p) * 3
      track[o] = x / vertices.length
      track[o + 1] = y / vertices.length
      track[o + 2] = z / vertices.length
    })
  }
  return track
}

/** Writes vertex `v` at frame row `f` into `target`. */
type Pose = (f: number, v: number, target: Vector3) => void

/** The vertex encoding: the rest position plus the half-float delta at the vertex's texel (ADR-0030's layout). */
function deltaPose(vat: DeltaVAT): Pose {
  const data = vat.positionTexture.image.data as Uint16Array
  const width = vat.positionTexture.image.width
  const rest = vat.geometry.getAttribute('position')
  const half = DataUtils.fromHalfFloat
  return (f, v, target) => {
    const o = ((f * vat.rowsPerFrame + Math.floor(v / width)) * width + (v % width)) * 4
    target.set(rest.getX(v) + half(data[o]!), rest.getY(v) + half(data[o + 1]!), rest.getZ(v) + half(data[o + 2]!))
  }
}

/** The rig encoding: the part-local rest position, skinned from the slots it is weighted to at the row. */
function rigPose(vat: RigVAT): Pose {
  const data = vat.rigTexture.image.data as Float32Array
  const width = vat.rigTexture.image.width
  const rest = vat.geometry.getAttribute('position')
  const skinIndex = vat.geometry.getAttribute('skinIndex')
  const skinWeight = vat.geometry.getAttribute('skinWeight')
  const q = new Quaternion()
  const posed = new Vector3()
  return (f, v, target) => {
    target.set(0, 0, 0)
    for (let i = 0; i < 4; i++) {
      const w = skinWeight.getComponent(v, i)
      if (w === 0) continue
      const o = (f * width + skinIndex.getComponent(v, i) * RIG_TEXELS_PER_SLOT) * 4
      const r = o + RIG_TEXELS.rotation * 4
      const t = o + RIG_TEXELS.placement * 4
      // x ↦ s·(q x) + t, the slot's pose, weighted.
      q.set(data[r]!, data[r + 1]!, data[r + 2]!, data[r + 3]!).normalize()
      posed.fromBufferAttribute(rest, v).applyQuaternion(q).multiplyScalar(data[t + 3]!)
      posed.x += data[t]!
      posed.y += data[t + 1]!
      posed.z += data[t + 2]!
      target.addScaledVector(posed, w)
    }
  }
}
