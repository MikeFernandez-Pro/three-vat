// The two things every texture this library produces has in common: the
// dimension ceiling it is asserted against, and the sampling flags it must
// carry. Its own module rather than a corner of `src/bake.ts` because the
// playback texture (ADR-0016) needs both and the baker imports the
// instance-playback contract — so a producer in `src/instance-playback.ts`
// reaching into the baker for them would close an import cycle.
import { DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three'
import type { TextureDataType, TypedArray } from 'three'

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
 * Build a VAT `DataTexture` with the fixed sampling flags every path relies on:
 * RGBA, nearest filtering, no mipmaps. Frame interpolation is done manually in
 * the shader, so linear filtering must stay off.
 */
export function makeVATTexture(
  data: TypedArray,
  width: number,
  height: number,
  type: TextureDataType = FloatType,
): DataTexture {
  const tex = new DataTexture(data, width, height, RGBAFormat, type)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}
