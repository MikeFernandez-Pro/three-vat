// What the page draws at: the desktop's look, or a lighter one where the game
// plays on the touch controls. A phone draws a screen as sharp as a desktop's
// on a far smaller GPU, so it pays for fewer pixels, cheaper shadows and a
// thinner snowfall; the camp, the crowds and the vignette are the same.
import { TOUCH } from './touch-input'

export interface Quality {
  /** The ceiling on the device pixel ratio the canvas draws at. */
  readonly maxPixelRatio: number
  /** The sun's shadow map, a side in texels. */
  readonly shadowMapSize: number
  /** VSM's blurred shadows, or PCF's: no blur passes, harder edges. */
  readonly softShadows: boolean
  /** Snowflakes falling over the camp. */
  readonly snowflakes: number
}

const DESKTOP: Quality = { maxPixelRatio: 2, shadowMapSize: 1024, softShadows: true, snowflakes: 10_000 }
const PHONE: Quality = { maxPixelRatio: 1.5, shadowMapSize: 512, softShadows: false, snowflakes: 3_000 }

export const QUALITY = TOUCH ? PHONE : DESKTOP
