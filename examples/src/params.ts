// The demo's controls and their defaults — shared by every page, because a
// reader comparing two renderers should be comparing renderers, not two
// different crowds under two different suns (ADR-0011).
//
// Data only: no three.js, no renderer. Each page decides what a knob *does*;
// this file only says what the knobs are and where they start.

export type EnvPresetName = "none" | "sky" | "sunset" | "dusk" | "room" | "neutral";

export type DemoParams = ReturnType<typeof createDemoParams>;

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
    bgTop: "#8ec8ea",
    bgBottom: "#e8d5b0",
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
    fogColor: "#e8d5b0",
    fogNear: 25,
    fogFar: 90,
    /**
     * The baked textures, drawn on screen. On by default: it is the demo's
     * evidence, not a diagnostic (ADR-0012).
     */
    showTexturePanel: true,
    /**
     * The engineering overlay — stats-gl and its frame timings. This is what
     * hides behind a toggle now: a reader who has never heard of a VAT is not
     * served by a GPU-time graph, and a reader who wants one knows to look.
     */
    showStats: false,
  };
}
