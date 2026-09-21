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
