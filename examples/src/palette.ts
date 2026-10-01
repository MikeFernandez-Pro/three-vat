// The studio's scene colours: seven names every page lights and floors its scene
// with, inline, so the recipe a reader copies still reads as plain three.js —
// `new THREE.Color(palette.floor)` — while the look stays one set (ADR-0037).
//
// Plain numbers, no three.js: a colour is a colour whichever renderer draws it,
// and this module is shared by both (release/packaging/bundles.test.ts). The
// page chrome's colours are the theme's (src/theme.css); `studio` here is the
// theme's `--studio`, kept in step by hand, so the canvas and the page around
// it are one off-white.
export const palette = {
  /** The seamless backdrop the floor fades out into (floor.ts). */
  studio: 0xf2f0eb,
  /** The floor, a shade under the backdrop so contact shadows read. */
  floor: 0xebe8e1,
  /** The key light: warm, high, casting the shadows. */
  key: 0xfff6ea,
  /** The fill: a cool sky over a warm ground, lifting the shadow side. */
  fill: 0xe8eef7,
  /** The one accent, for the thing a page wants you to look at. */
  accent: 0xe4572e,
  /** A matte character, where the feature allows the source material to go. */
  character: 0xc9c4ba,
  /** A loud light, for a page that needs which way a surface faces to show from afar. */
  loud: 0xff2d8a,
} as const;

/**
 * The characters' own colours, part by part, keyed by the name of the
 * material each part comes from: Soldier's body and visor, and
 * RobotExpressive's three. A page paints a part with `partColour`, and a part
 * of any other asset takes the matte `character`.
 */
export const parts: Readonly<Record<string, number>> = {
  VanguardBodyMat: 0xfff2d6,
  Vanguard_VisorMat: 0xe4572e,
  Main: 0xfff2d6,
  Grey: 0x2f6f73,
  Black: 0xe4572e,
};

/** The colour a part of a character takes, by its material's name. */
export function partColour(materialName: string): number {
  return parts[materialName] ?? palette.character;
}
