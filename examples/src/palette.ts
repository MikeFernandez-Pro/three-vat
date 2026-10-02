// The studio's scene colours: seven names every page lights and floors its scene
// with, inline, so the recipe a reader copies still reads as plain three.js —
// `new THREE.Color(palette.floor)` — while the look stays one set (ADR-0037).
//
// Plain numbers, no three.js: a colour is a colour whichever renderer draws it,
// and this module is shared by both (release/packaging/bundles.test.ts). The
// backdrop is not here: every canvas clears to nothing, so the backdrop the
// floor fades out into is the page's own `--studio` (src/theme.css), one
// colour on either renderer, and no tone mapping ever reaches it.
//
// Two sets, one per look (CONTEXT.md): the page reads whichever its look
// names, settled once as this module loads, from the mark the look script
// leaves on <html> before any module runs (examples/look.mjs). So a page reads
// `palette.floor` and never asks which look it is in.

/** A look: light or dark. */
export type Look = "light" | "dark";

/**
 * The look this page opened in, read off <html>. Light where there is no
 * document, so a test or a bake under Node reads the light palette.
 */
export const look: Look = typeof document !== "undefined" && document.documentElement.dataset.look === "dark" ? "dark" : "light";

const LIGHT = {
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
  /** The characters' own body colour: Soldier's and the robot's bodies, the Horse, Michelle. */
  body: 0xffeecc,
  /** A prop: the thing a page sets in front of its characters to look at, the deform page's cube. */
  prop: 0xff6352,
  /** The atlas example's cast, a colour a character: Soldier's, the robot's, Michelle's. */
  cast: [0xe4572e, 0x3d7ea6, 0x6a994e] as readonly number[],
};

// The dark look keeps the lights as they are and lifts the floor instead: the
// hemisphere is most of what lights the floor, and a dimmer fill blacks it out.
const DARK: typeof LIGHT = { ...LIGHT, floor: 0x303030, body: 0xff6666, prop: 0xffeccc, cast: [0xff6666, 0x6fb3e0, 0x9ccc65] };

export const palette: Readonly<typeof LIGHT> = look === "dark" ? DARK : LIGHT;

/**
 * The characters' own colours, part by part, keyed by the name of the
 * material each part comes from: Soldier's body and visor, and
 * RobotExpressive's three. A page paints a part with `partColour`, and a part
 * of any other asset takes the matte `character`. In the light look, warm
 * cream bodies, a pale visor, grey eyes and terracotta details; in the dark,
 * red bodies, grey visors and eyes, and sand details.
 */
export const parts: Readonly<Record<string, number>> =
  look === "dark"
    ? { VanguardBodyMat: palette.body, Vanguard_VisorMat: 0x4f4f4f, Main: palette.body, Grey: 0xeecaa0, Black: 0x4f4f4f }
    : { VanguardBodyMat: palette.body, Vanguard_VisorMat: 0xfff8d6, Main: palette.body, Grey: 0xdd9f7e, Black: 0x4f4f4f };

/** The colour a part of a character takes, by its material's name. */
export function partColour(materialName: string): number {
  return parts[materialName] ?? palette.character;
}
