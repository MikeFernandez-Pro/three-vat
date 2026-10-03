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
// names, from the mark the look script leaves on <html> before any module runs
// (examples/look.mjs). So a page reads `palette.floor` and never asks which
// look it is in. When the gallery's switch moves the mark on a running page,
// the palette takes the other set in place and tells whoever asked with
// `onLook`, so a page repaints what it painted rather than loading again.

/** A look: light or dark. */
export type Look = "light" | "dark";

/** The look <html> is marked with. Light where there is no document, so a test or a bake under Node reads the light palette. */
function markedLook(): Look {
  return typeof document !== "undefined" && document.documentElement.dataset.look === "dark" ? "dark" : "light";
}

/** The look this page is in now. */
export let look: Look = markedLook();

const LIGHT = {
  /** The floor, a shade under the backdrop so contact shadows read. */
  floor: 0xebe8e1,
  /** The key light: warm, high, casting the shadows. */
  key: 0xfff6ea,
  /** The fill: a cool sky over a warm ground, lifting the shadow side. */
  fill: 0xe8eef7,
  /** The one accent, for the thing a page wants you to look at. */
  accent: 0xe4572e,
  /** A character's box, drawn round it: the accent, where the characters are not red. */
  bounds: 0xe4572e,
  /** A matte character, where the feature allows the source material to go. */
  character: 0xc9c4ba,
  /** The body colour of a character with none of its own below: the Horse. */
  body: 0xffeecc,
  /** Soldier's body. */
  soldier: 0x67a5e0,
  /** The robot's body. */
  robot: 0xfbc965,
  /** Michelle, all of her: she has one material. */
  michelle: 0xd4a9fe,
  /** A prop: the thing a page sets in front of its characters to look at, the deform page's cube. */
  prop: 0xff6352,
  /** The atlas example's cast, a colour a character: Soldier's, the robot's, Michelle's. */
  cast: [0xe4572e, 0x3d7ea6, 0x6a994e] as readonly number[],
};

// The dark look keeps the lights as they are and lifts the floor instead: the
// hemisphere is most of what lights the floor, and a dimmer fill blacks it out.
// Its characters are all one warm red, so a box drawn round one is blue.
const DARK: typeof LIGHT = {
  ...LIGHT,
  floor: 0x303030,
  body: 0xff6666,
  soldier: 0xff6666,
  robot: 0xff6666,
  michelle: 0xff6666,
  prop: 0xffeccc,
  bounds: 0x6fb3e0,
  cast: [0xff6666, 0x6fb3e0, 0x9ccc65],
};

/**
 * The characters' own colours, part by part, keyed by the name of the
 * material each part comes from: Soldier's body and visor, and
 * RobotExpressive's three. A page paints a part with `partColour`, and a part
 * of any other asset takes the matte `character`. In the light look, a blue
 * Soldier with a grey visor, a yellow robot with brown details and grey eyes;
 * in the dark, red bodies, grey visors and eyes, and sand details.
 */
const PARTS: Record<Look, Record<string, number>> = {
  light: { VanguardBodyMat: LIGHT.soldier, Vanguard_VisorMat: 0x595959, Main: LIGHT.robot, Grey: 0x866a5b, Black: 0x636363 },
  dark: { VanguardBodyMat: DARK.soldier, Vanguard_VisorMat: 0x4f4f4f, Main: DARK.robot, Grey: 0xeecaa0, Black: 0x4f4f4f },
};

/** Which parts make up which character, so a repaint can tell two parts apart that a look paints alike. */
export const characters: readonly (readonly string[])[] = [
  ["VanguardBodyMat", "Vanguard_VisorMat"],
  ["Main", "Grey", "Black"],
];

/** The look's set, one object for the page's life: its values change with the look. */
export const palette: Readonly<typeof LIGHT> = { ...(look === "dark" ? DARK : LIGHT) };

/** The look's part colours, one object for the page's life, as `palette` is. */
export const parts: Readonly<Record<string, number>> = { ...PARTS[look] };

/** The part colours of a look, the one a page is not in included. */
export function partsOf(of: Look): Readonly<Record<string, number>> {
  return PARTS[of];
}

/** The colour a part of a character takes, by its material's name. */
export function partColour(materialName: string): number {
  return parts[materialName] ?? palette.character;
}

/** A material a character part wears: its name, and a colour to set. */
interface PartMaterial {
  name: string;
  color: { setHex(hex: number): unknown };
}

const worn = new Set<PartMaterial>();

/**
 * Paint a character's material its part's colour, and paint it again whenever
 * the look changes, so a bake made after the change takes the new look.
 */
export function wearPart<M extends PartMaterial>(material: M): M {
  material.color.setHex(partColour(material.name));
  worn.add(material);
  return material;
}

const listeners: ((from: Look) => void)[] = [];

/**
 * Call `repaint` whenever the look changes on this running page, after the
 * palette holds the new look's set, with the look it left. A page repaints
 * whatever it painted from the palette as it was built: a material's colour,
 * an instance's.
 */
export function onLook(repaint: (from: Look) => void): void {
  listeners.push(repaint);
}

if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
  new MutationObserver(() => {
    const next = markedLook();
    if (next === look) return;
    const from = look;
    look = next;
    Object.assign(palette, look === "dark" ? DARK : LIGHT);
    Object.assign(parts, PARTS[look]);
    for (const material of worn) material.color.setHex(partColour(material.name));
    for (const repaint of listeners) repaint(from);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-look"] });
}
