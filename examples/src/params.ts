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
    // crowd — zone counts are keyed by ZONES in crowd.ts
    dancers: 60,
    walkers: 160,
    runners: 120,
    /** Ring spacing as a multiple of the robot's real width. 1 = shoulder to
     *  shoulder; below 1 they would overlap, so the slider stops there. */
    clearance: 1.25,
    /** Extra clear band between zones, in footprints. */
    zoneGap: 2,
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
    // debug
    showVatTextures: false,
  };
}
