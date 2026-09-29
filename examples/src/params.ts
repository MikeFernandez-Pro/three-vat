// The demo's controls and their defaults — shared by every page, because a
// reader comparing two renderers should be comparing renderers, not two
// different crowds under two different suns (ADR-0011).
//
// Data only: no three.js, no renderer. Each page decides what a knob *does*;
// this file only says what the knobs are and where they start.

export type EnvPresetName = "none" | "sky" | "sunset" | "dusk" | "room" | "neutral";

export type DemoParams = ReturnType<typeof createDemoParams>;

/** The two encodings a bake can choose (ADR-0018), as `bakeVAT` spells them. */
export type Encoding = "delta" | "rig";

/**
 * The encodings as the example's toggle names them: the glossary's words, with
 * `bakeVAT`'s literals behind them. `delta` is what the option is called; what
 * a visitor is choosing is where every *vertex* ended up.
 */
export const ENCODING_NAMES: Readonly<Record<Encoding, string>> = { delta: "vertex", rig: "rig" };

/** The same two, as lil-gui takes a dropdown's choices: label → value. */
export const ENCODING_CHOICES: Readonly<Record<string, Encoding>> = Object.fromEntries(
  (Object.entries(ENCODING_NAMES) as [Encoding, string][]).map(([encoding, name]) => [name, encoding]),
);

/**
 * A fresh, mutable parameter set. Fresh rather than a shared constant so a page
 * can never mutate another page's defaults — and so the values here read as the
 * starting point they are.
 */
export function createDemoParams() {
  return {
    /**
     * The demo's one crowd control: how many robots are on screen. It opens on
     * a single robot because the demo is an argument, not a showcase — the
     * reader produces the evidence by dragging it up (ADR-0012).
     */
    count: 1,
    maxZoom: 120,
    animate: true,
    shadows: true,
    bgTop: "#000000",
    bgBottom: "#000000",
    exposure: 1.0,
    // lights
    ambientColor: "#eaf2fb",
    ambientIntensity: 0.6,
    sunColor: "#fff2df",
    sunIntensity: 2.2,
    sunX: 35,
    sunY: 55,
    sunZ: 25,
    // ground
    groundVisible: true,
    groundColor: "#8a9b6e",
    groundRoughness: 0.95,
    groundMetalness: 0.0,
    // environment
    envPreset: "sky" as EnvPresetName,
    envAsBackground: false,
    envIntensity: 1.0,
    // fog
    fogEnabled: true,
    fogColor: "#000000",
    fogNear: 25,
    fogFar: 90,
    /**
     * The baked textures, drawn on screen. Off by default: the page opens on the
     * crowd and its number, and the textures are one click away in the panel
     * (ADR-0024, amending ADR-0012). The hero capture switches them on for the
     * image, which is the one place they are evidence at rest.
     */
    showTexturePanel: false,
  };
}
