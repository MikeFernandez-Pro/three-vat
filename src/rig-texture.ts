// The rig texture's layout, spelled once: the baker that writes it and every
// decode that reads it take the numbers from here, so a slot can never be two
// texels in the bake and three in a shader (the same discipline `PACK_TEXELS`
// keeps for the playback texture, ADR-0009).
//
// A row of a rig-encoded VAT holds the posed rig as one **slot** per bone
// (ADR-0018): a rotation as a quaternion, then a translation and a uniform
// scale — two RGBA float texels, at `x = slot * RIG_TEXELS_PER_SLOT + texel`,
// `y = frame`. Clips stack as bands through the same clip table the position
// texture uses, so the row arithmetic above the sampling does not know which
// encoding it is addressing.

/** Texels one slot occupies in a row, and what each holds. */
export const RIG_TEXELS = {
  /** `(qx, qy, qz, qw)` — the slot's rotation, on one hemisphere with its neighbouring rows. */
  rotation: 0,
  /** `(tx, ty, tz, s)` — where the slot puts the origin, and its uniform scale in the spare component. */
  placement: 1,
} as const

/** Texture width per slot. */
export const RIG_TEXELS_PER_SLOT = 2

// Below the bands, one row more: the **hierarchy row**, at `y = totalFrames`,
// read only by a crossfade (ADR-0039). A row blends one slot at a time, and
// that is right between neighbouring frames; between two clips a limb turns
// far, and three's mixer blends each bone's local transform, not the posed
// one. So a crossfade walks the slot's chain instead, and needs two constants
// per slot no frame row holds: where its pivot sits, and which slot it hangs
// from. They take the slot's first texel of the row; the second is spare.

/** Texels of a slot's column in the hierarchy row, and what each holds. */
export const RIG_HIERARCHY_TEXELS = {
  /**
   * `(px, py, pz, parent)` — the slot's pivot, where its node's origin sits in
   * the slot's own part-local geometry, and the slot it hangs from, `-1` at
   * the top of a chain.
   */
  pivot: 0,
} as const

/**
 * The cosine between two rotations past which a crossfade's slerp is a
 * normalised lerp instead: too close for the angle to divide by, and too close
 * for the two to differ. The same number in the CPU definition and both
 * decode paths.
 */
export const RIG_SLERP_LINEAR_ABOVE = 0.9995
