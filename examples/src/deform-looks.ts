// The twisted crowd's colour presets: three for the crowd and three for the
// hemisphere light, each set against the one thing the page wants you to
// look at, the accent-red cube (a hue of about 14 degrees) on the studio's
// warm off-white. A preset sets the colour pickers, which stay free after.
//
// The page's own, not the studio's: no other page offers them, so they stay
// out of the palette (src/palette.ts), whose entries the first of each
// repeat. Plain numbers, no three.js, for both pages.
import { palette } from "./palette.js";

export type CrowdLook = "clay" | "teal" | "sage";

/** The crowd's colour, one per preset. */
export const CROWD_COLOURS: readonly { value: CrowdLook; text: string; colour: number }[] = [
  // A neutral warm grey that recedes and lets the cube lead.
  { value: "clay", text: "clay", colour: palette.character },
  // The accent's complement, against which the cube pops hardest; dark, so
  // the twist reads in silhouette.
  { value: "teal", text: "deep teal", colour: 0x2f6f73 },
  // Triadic with the accent, light and desaturated: a colour that keeps the
  // studio's pastel calm.
  { value: "sage", text: "sage", colour: 0xa3b5a0 },
];

export type SkyLook = "studio" | "golden" | "dusk";

/** The hemisphere light's sky and ground, one pair per preset. */
export const SKY_COLOURS: readonly { value: SkyLook; text: string; sky: number; ground: number }[] = [
  // A cool sky over a warm ground, lifting the shadow side without colouring it.
  { value: "studio", text: "studio", sky: palette.fill, ground: palette.floor },
  // Warm light from above, a cool bounce from below: warm light and cool
  // shadows, as at sunset.
  { value: "golden", text: "golden hour", sky: 0xffe2c2, ground: 0xc9c3d9 },
  // A low, cool blue over slate, where the red cube is the one warm thing.
  { value: "dusk", text: "dusk", sky: 0xb8c7e0, ground: 0x5b6275 },
];

/** The panel's choice, as `[value, text]` pairs. */
export function presetChoices<T extends string>(presets: readonly { value: T; text: string }[]): readonly (readonly [T, string])[] {
  return presets.map(({ value, text }) => [value, text] as const);
}

/** A colour as a colour picker spells it: `#rrggbb`. */
export function pickerValue(colour: number): string {
  return `#${colour.toString(16).padStart(6, "0")}`;
}
