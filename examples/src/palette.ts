// The studio's scene colours: six names every page lights and floors its scene
// with, inline, so the recipe a reader copies still reads as plain three.js —
// `new THREE.Color(palette.floor)` — while the look stays one set (ADR-0037).
//
// Plain numbers, no three.js: a colour is a colour whichever renderer draws it,
// and this module is shared by both (release/packaging/bundles.test.ts). The
// page chrome's colours are the theme's (src/theme.css); `studio` here is the
// theme's `--studio`, kept in step by hand, so the canvas and the page around
// it are one off-white.
export const palette = {
  /** The seamless backdrop, and the fog that melts the floor into it. */
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
} as const;
