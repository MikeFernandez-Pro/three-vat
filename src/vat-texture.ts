// The two things every texture this library produces has in common: the
// dimension ceiling it is asserted against, and the sampling flags it must
// carry. Its own module rather than a corner of `src/bake.ts` because the
// playback texture (ADR-0016) needs both and the baker imports the
// instance-playback contract — so a producer in `src/instance-playback.ts`
// reaching into the baker for them would close an import cycle.
import { DataTexture, FloatType, NearestFilter, RGBAFormat, RGFormat, UnsignedByteType } from 'three'
import type { TextureDataType } from 'three'

/**
 * The WebGL2 *spec floor for high-end desktop*, which two things lean on.
 *
 * - **The bake's fallback cap**, used when the caller does not pass
 *   `maxTextureSize`. The baker is renderer-agnostic by design (it runs in
 *   Node, and in a Web Worker) so it cannot query the real limit itself: pass
 *   `getMaxTextureSize(renderer)` from `three-vat/webgl` or `three-vat/tsl`
 *   whenever a renderer exists.
 * - **The instance ceiling**, because the playback texture is one row per
 *   instance (`createVATPlaybackTexture`, ADR-0016). That one takes no
 *   override, the crowd being built long after the bake was sized.
 *
 * Not a guarantee either way: plenty of mobile GPUs report 4096 or 8192, and
 * a crowd between that and this number is refused by the driver at upload
 * rather than here. The bake is where the real limit is worth passing, because
 * it is where the numbers get large.
 */
export const MAX_TEXTURE_SIZE = 16384

/**
 * The sampling flags every path relies on: nearest filtering, no mipmaps.
 * Frame interpolation is done manually in the shader (ADR-0002), so linear
 * filtering must stay off — on either format.
 */
function sampledExactly(tex: DataTexture): DataTexture {
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/**
 * Build an RGBA float VAT `DataTexture` — the position texture, the rig
 * texture and the playback texture, which is every layer whose texel is four
 * numbers that have to stay numbers.
 *
 * `data` is a `Float32Array` and not a `TypedArray`, deliberately: the normal
 * texture is two unsigned bytes a texel now ({@link makeVATNormalTexture}), and
 * handing its buffer to this function would upload byte pairs as float32 bits —
 * a crowd rendering garbage rather than a call that failed. The narrow
 * parameter turns that into a compile error, which is what a stale copy of the
 * Web Worker recipe in `docs/usage.md` deserves.
 *
 * `type` is passed by nobody and kept deliberately: it is the seam the other
 * half of #29 grows into, where the position layer becomes `HalfFloatType`.
 * That half is a separate ticket — it needs a range check half-float's 65 504
 * ceiling makes necessary — and this parameter is what it will not have to add.
 */
export function makeVATTexture(
  data: Float32Array,
  width: number,
  height: number,
  type: TextureDataType = FloatType,
): DataTexture {
  return sampledExactly(new DataTexture(data, width, height, RGBAFormat, type))
}

/**
 * Build the normal texture: two unsigned bytes a texel, an octahedral unit
 * vector (`src/octahedral.ts`, #29). `RG8` where the position layer is
 * `RGBA32F`, because a normal is a direction and eight bits of each of two
 * channels carry one to under a degree.
 *
 * `unpackAlignment` is the one thing this needs that the float builder does
 * not: a row of `RG8` is `2 × width` bytes, so an odd vertex count makes every
 * row an odd multiple of two, and the default alignment of 4 would have the
 * driver start each row at the wrong offset. An RGBA float row is a multiple
 * of 16 whatever the width, which is why this never came up before.
 */
export function makeVATNormalTexture(data: Uint8Array, width: number, height: number): DataTexture {
  const tex = new DataTexture(data, width, height, RGFormat, UnsignedByteType)
  tex.unpackAlignment = 1
  return sampledExactly(tex)
}
