// What two bytes of the normal texture mean, spelled once (#29).
//
// A normal is a **unit vector**, and the bake used to spend sixteen bytes on
// one — three float channels carrying a value in `[-1, 1]` and a fourth
// carrying nothing. Octahedral encoding folds the sphere onto a square instead:
// the octahedron `|x| + |y| + |z| = 1` projected to the plane, its far
// hemisphere folded outward into the corners. Two unsigned bytes, `RG8`, and
// ~0.95° of worst-case angular error — the standard trade for VAT normals, and
// the one Houdini makes. Error in a normal is shading, never geometry.
//
// Four places have to agree about this mapping: the baker, the GLSL decode
// (`vatOctDecode`, src/webgl.ts), the TSL decode (`octDecode`, src/tsl.ts) and
// the demo's texture panel. This module is the definition; the panel and the
// baker *call* it, and only the two shaders cannot — they are transcriptions,
// term for term, in the same order, down to the branchless fold. That is the
// bug class CI cannot catch on its own, because the only thing proving the two
// shaders agree is the parity gate, which is manual and GPU-only. So the
// arithmetic here is pinned in `octahedral.test.ts` — the one seam a test
// without a GPU can hold — and the gate is left catching transcription slips
// rather than design errors.
//
// The layout around it is untouched (ADR-0002): same stacked bands, same
// `NearestFilter`, same manual two-row lerp. A row still holds one texel per
// vertex; the texel is narrower.

/** A vector the decode can write into — `THREE.Vector3` is one. */
export interface Vec3Out {
  x: number
  y: number
  z: number
}

/**
 * `sign`, with zero counted as positive.
 *
 * The fold reflects a component across the axis it sits on, so a component of
 * exactly zero must still pick a side — GLSL's own `sign()` returns zero there
 * and would collapse the reflection. It never arises from a decoded texel (no
 * byte maps to exactly zero) and it does arise in the encoder, from any normal
 * lying in a plane through an axis.
 */
const signNotZero = (v: number) => (v >= 0 ? 1 : -1)

/** A `[-1, 1]` coordinate as the unsigned byte a texel holds. */
const toByte = (v: number) => Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)))

/**
 * Write a normal into two bytes of a VAT normal texture's buffer, at `offset`
 * and `offset + 1` — `(row * vertexCount + vertex) * 2` for the texel of one
 * vertex at one frame.
 *
 * Takes a direction, not a unit vector: the first step is a division by the L1
 * norm, so the encoding is scale-invariant and an unnormalised normal encodes
 * to the same texel its normalised twin does. A zero-length normal has no
 * direction to divide out, and is written as the texel +Z lands on rather than
 * as NaN — a degenerate vertex then shades like a flat one instead of turning
 * the mesh black.
 */
export function encodeOctahedral(
  x: number,
  y: number,
  z: number,
  out: Uint8Array | number[],
  offset: number,
): void {
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z)
  if (l1 === 0) {
    out[offset] = toByte(0)
    out[offset + 1] = toByte(0)
    return
  }

  const px = x / l1
  const py = y / l1
  // The far hemisphere folds outward into the square's corners: the near one
  // fills the diamond `|x| + |y| <= 1`, and everything with z < 0 is reflected
  // across the diamond's edges into what is left.
  const fold = z <= 0
  out[offset] = toByte(fold ? (1 - Math.abs(py)) * signNotZero(px) : px)
  out[offset + 1] = toByte(fold ? (1 - Math.abs(px)) * signNotZero(py) : py)
}

/**
 * Decode a normal texel — the two bytes {@link encodeOctahedral} wrote — back
 * to a unit vector. Pass `out` to decode a whole layer without allocating.
 *
 * `u` and `v` are the stored bytes, `0..255`; a sampler hands the shaders the
 * same numbers already divided by 255, which is the `/ 255` below and the only
 * difference between this and the two transcriptions of it.
 *
 * The fold is undone without a branch, by the identity that a negative `z`
 * means exactly `|x| + |y| - 1` of overshoot to take back off both components,
 * each toward its own zero. Branchless because #72 measured what a branch in
 * the vertex decode costs: the compiler holds registers for the side it skips,
 * and an idle crowd pays for them.
 */
export function decodeOctahedral<T extends Vec3Out>(u: number, v: number, out: T): T
export function decodeOctahedral(u: number, v: number): Vec3Out
export function decodeOctahedral(u: number, v: number, out: Vec3Out = { x: 0, y: 0, z: 0 }): Vec3Out {
  const ex = (u / 255) * 2 - 1
  const ey = (v / 255) * 2 - 1
  const z = 1 - Math.abs(ex) - Math.abs(ey)
  const t = Math.max(-z, 0)
  const x = ex - signNotZero(ex) * t
  const y = ey - signNotZero(ey) * t

  const length = Math.hypot(x, y, z) || 1
  out.x = x / length
  out.y = y / length
  out.z = z / length
  return out
}
