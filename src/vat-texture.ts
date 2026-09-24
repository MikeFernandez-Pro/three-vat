// The two things every texture this library produces has in common: the
// dimension ceiling it is asserted against, and the sampling flags it must
// carry. Its own module rather than a corner of `src/bake.ts` because the
// playback texture (ADR-0016) needs both and the baker imports the
// instance-playback contract — so a producer in `src/instance-playback.ts`
// reaching into the baker for them would close an import cycle.
import { DataTexture, FloatType, HalfFloatType, NearestFilter, RGBAFormat, RGFormat, UnsignedByteType } from 'three'

/**
 * The WebGL2 *spec floor for high-end desktop*, which two things lean on.
 *
 * - **The bake's fallback cap**, used when the caller does not pass
 *   `maxTextureSize`. The baker is renderer-agnostic by design (it runs in
 *   Node, and in a Web Worker) so it cannot query the real limit itself: pass
 *   `getMaxTextureSize(renderer)` from `three-vat/webgl` or `three-vat/tsl`
 *   whenever a renderer exists.
 * - **The instance ceiling's fallback**, because the playback texture is one
 *   row per instance (`createVATPlaybackTexture`, ADR-0016), used when the
 *   caller does not pass `maxTextureSize` to it or to `createVATMesh`. The
 *   crowd is built beside the renderer, so the real limit is to hand there
 *   (ADR-0022's amendment).
 *
 * Not a guarantee either way: plenty of mobile GPUs report 4096 or 8192. The
 * playback texture names this number as its source when it falls back to it,
 * so a crowd refused against it says where the real limit belongs.
 */
export const MAX_TEXTURE_SIZE = 16384

/**
 * The largest magnitude a half-float can hold, and so the position layer's one
 * hard limit since #73.
 *
 * Precision is not the limit anyone expects it to be: half-float is floating
 * point, so its error is 0.061% *of the delta* at every magnitude and exactly
 * zero at the rest pose — a scale-invariant property of storing deltas
 * (ADR-0002's amendment). Range is. A component past this clips to infinity,
 * silently, which is why {@link makeVATTexture}'s one half-float caller checks
 * every delta it writes.
 */
export const HALF_FLOAT_MAX = 65504

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
 * Build an RGBA VAT `DataTexture` — the position texture, the rig texture and
 * the playback texture, which is every layer whose texel is four numbers that
 * have to stay numbers.
 *
 * `type` says which kind of number, and the two callers that pass it disagree
 * deliberately (ADR-0002's amendment):
 *
 * - **`HalfFloatType`, with a `Uint16Array`** — the position layer (#73). It
 *   stores *deltas*, and half-float's error is proportional to what it holds:
 *   0.061% of the delta, zero at the rest pose. Eight bytes a texel instead of
 *   sixteen. Half-float tops out at 65 504, which is the one thing a delta can
 *   exceed, so `bakeVAT` range-checks before it writes.
 * - **`FloatType`, with a `Float32Array`** — the rig texture, whose texels are
 *   a quaternion and an *absolute* translation, and the playback texture, whose
 *   `startTime` in seconds does not survive half precision.
 *
 * `data` is one of those two arrays and not a `TypedArray`, deliberately: the
 * normal texture is two unsigned bytes a texel ({@link makeVATNormalTexture}),
 * and handing its buffer to this function would upload byte pairs as float32
 * bits — a crowd rendering garbage rather than a call that failed. The narrow
 * parameter turns that into a compile error, which is what a stale copy of the
 * Web Worker recipe in `docs/usage.md` deserves. Pairing either array with the
 * *other's* `type` is the same fault wearing a legal signature — half a texel
 * read as a whole one — so that pairing is checked here and refused, rather
 * than left to the driver.
 */
export function makeVATTexture(
  data: Float32Array | Uint16Array,
  width: number,
  height: number,
  type: typeof FloatType | typeof HalfFloatType = FloatType,
): DataTexture {
  const half = type === HalfFloatType
  const wanted = half ? Uint16Array : Float32Array
  if (!(data instanceof wanted)) {
    throw new Error(
      `three-vat: a ${half ? 'HalfFloatType' : 'FloatType'} texture is built from a ${wanted.name}, not a ${data.constructor.name} — the array and the type describe the same texels and have to agree`,
    )
  }
  return sampledExactly(new DataTexture(data, width, height, RGBAFormat, type))
}

/**
 * Build the normal texture: two unsigned bytes a texel, an octahedral unit
 * vector (`src/octahedral.ts`, #29). `RG8` where the position layer is
 * `RGBA16F`, because a normal is a direction and eight bits of each of two
 * channels carry one to under a degree.
 *
 * `unpackAlignment` is the one thing this needs that the float builder does
 * not: a row of `RG8` is `2 × width` bytes, so an odd vertex count makes every
 * row an odd multiple of two, and the default alignment of 4 would have the
 * driver start each row at the wrong offset. An RGBA half-float row is `8 ×
 * width` bytes and an RGBA float row `16 × width` — a multiple of 4 at any
 * width either way, which is why this never came up on those.
 */
export function makeVATNormalTexture(data: Uint8Array, width: number, height: number): DataTexture {
  const tex = new DataTexture(data, width, height, RGFormat, UnsignedByteType)
  tex.unpackAlignment = 1
  return sampledExactly(tex)
}
