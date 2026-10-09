// The lit areas as a texture (litareas.ts, ADR-0054): a row of ANGLES
// distances a light, red only, read texel by texel and never filtered. The
// GPU step reads it to keep rats out of the lit areas, and the drawing to
// light the ground in them: one upload, read the same way by both.
import { DataTexture, FloatType, NearestFilter, RedFormat } from 'three/webgpu'
import { ANGLES, LIT_ROWS, type LitAreas } from './litareas'

/** The lit areas' table as a texture, and its upload. */
export interface SeenTexture {
  readonly texture: DataTexture
  /** Upload the table again if a row of it was worked out again since. */
  update(): void
}

/** `areas`' table as a texture, uploaded as it changes. */
export function seenTexture(areas: LitAreas): SeenTexture {
  const texture = new DataTexture(areas.table, ANGLES, LIT_ROWS, RedFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  let uploaded = areas.version
  return {
    texture,
    update() {
      if (areas.version === uploaded) return
      uploaded = areas.version
      texture.needsUpdate = true
    },
  }
}
