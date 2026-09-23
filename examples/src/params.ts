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

export type SoldierParams = ReturnType<typeof createSoldierParams>;

/**
 * The Soldier example's parameters: the shared ones, plus the one control the
 * example is for (ADR-0019). It opens on the rig encoding — the feature the
 * page shows — and the toggle to the vertex encoding is how a visitor produces
 * the comparison, watching the HUD's texture memory change by two orders of
 * magnitude.
 */
export function createSoldierParams() {
  return { ...createDemoParams(), encoding: "rig" as Encoding };
}

export type BatchedParams = ReturnType<typeof createBatchedParams>;

/**
 * The batched example's parameters: the shared ones, plus the one control the
 * example is for — how fast the crowd turns over.
 *
 * It opens with a crowd already standing and already churning, where the crowd
 * pages open on a single robot a visitor grows. The difference is what each
 * page is for: theirs is what happens when you *raise* the count, and this
 * one's is what happens while you watch, so a page that started still would be
 * hiding its own subject.
 *
 * The count is the **live population**, and it is a target rather than a
 * setting: spawning and dying are the caller's business on this carrier
 * (ADR-0022), so the page adds and removes instances until it gets there.
 * The texture panel is off — the VAT is not what this page is evidence about.
 */
export function createBatchedParams() {
  return { ...createDemoParams(), count: 96, churn: 5, showTexturePanel: false };
}

export type DeformParams = ReturnType<typeof createDeformParams>;

/**
 * The deform example's parameters: the shared ones, plus the one thing the
 * deformation itself is steered by — how far an instance may turn, in degrees,
 * because that is the unit the reader is looking at rather than the radians the
 * shader takes.
 *
 * It opens on a crowd already standing, like the batched page and unlike the
 * crowd pages: what a visitor produces here is the *twist*, by moving the
 * target, and a page that started with one robot would be asking them to build
 * the crowd first. The texture panel is off — the baked VAT is not what this
 * page is evidence about; what happens *after* it is decoded is.
 */
export function createDeformParams() {
  return { ...createDemoParams(), count: 120, twistLimit: 45, showTexturePanel: false };
}

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
     * The baked textures, drawn on screen. On by default: it is the demo's
     * evidence, not a diagnostic (ADR-0012).
     */
    showTexturePanel: true,
  };
}
