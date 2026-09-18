// The control panel, wired to this page's stage. The defaults it edits are
// shared (params.ts); what each knob *touches* is renderer-specific — tone
// mapping exposure, a MeshStandardNodeMaterial ground, PMREM presets through
// the node renderer — so the wiring lives with the page (ADR-0011). Line for
// line the WebGL page's panel below the crowd control, because at this level
// the two renderers ask for the same things: only the `Stage` it is handed
// differs. The crowd control itself is the one divergence, and a temporary one.
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import type { DemoParams } from "../params.js";
import { ENV_PRESET_NAMES, type Stage } from "./stage.js";

export interface GUIHooks {
  /** Show or hide the baked-texture panel. */
  showVatTextures(visible: boolean): void;
}

export function createDemoGUI(params: DemoParams, stage: Stage, hooks: GUIHooks): GUI {
  const gui = new GUI({ title: "robot crowd" });
  gui.add(params, "animate").name("animate");

  // No crowd control here yet: this page still opens on the full crowd while
  // the count slider lands on the WebGL page first (ADR-0012). #22 brings it
  // here, and this panel back in line with the WebGL one.

  gui
    .add(params, "maxZoom", 20, 240, 5)
    .name("max zoom out")
    .onChange((v: number) => {
      stage.controls.maxDistance = v;
    });
  gui.addColor(params, "bgTop").name("bg top").onChange(stage.applyBackground);
  gui.addColor(params, "bgBottom").name("bg bottom").onChange(stage.applyBackground);
  gui
    .add(params, "exposure", 0.1, 3, 0.05)
    .name("exposure")
    .onChange((v: number) => {
      stage.renderer.toneMappingExposure = v;
    });
  gui.add(params, "shadows").name("shadows").onChange(stage.applyShadows);
  gui
    .add(params, "showVatTextures")
    .name("show VAT textures")
    .onChange((v: boolean) => hooks.showVatTextures(v));

  const lightFolder = gui.addFolder("lights");
  lightFolder
    .addColor(params, "ambientColor")
    .name("ambient color")
    .onChange((v: string) => {
      stage.ambient.color.set(v);
    });
  lightFolder
    .add(params, "ambientIntensity", 0, 25, 0.05)
    .name("ambient intensity")
    .onChange((v: number) => {
      stage.ambient.intensity = v;
    });
  lightFolder
    .addColor(params, "sunColor")
    .name("sun color")
    .onChange((v: string) => {
      stage.sun.color.set(v);
    });
  lightFolder
    .add(params, "sunIntensity", 0, 8, 0.05)
    .name("sun intensity")
    .onChange((v: number) => {
      stage.sun.intensity = v;
    });
  // The shadow camera is a fixed ±40 box aimed at the origin, so dragging the sun
  // too far off moves the crowd out of its frustum and shadows clip. 100 keeps
  // the useful range without needing a per-frame shadow-camera fit.
  for (const [key, axis] of [
    ["sunX", "x"],
    ["sunY", "y"],
    ["sunZ", "z"],
  ] as const) {
    lightFolder
      .add(params, key, -100, 100, 1)
      .name(`sun ${axis}`)
      .onChange((v: number) => {
        stage.sun.position[axis] = v;
      });
  }

  const groundFolder = gui.addFolder("ground");
  groundFolder
    .add(params, "groundVisible")
    .name("visible")
    .onChange((v: boolean) => {
      stage.ground.visible = v;
    });
  groundFolder
    .addColor(params, "groundColor")
    .name("color")
    .onChange((v: string) => {
      stage.groundMaterial.color.set(v);
    });
  groundFolder
    .add(params, "groundRoughness", 0, 1, 0.01)
    .name("roughness")
    .onChange((v: number) => {
      stage.groundMaterial.roughness = v;
    });
  groundFolder
    .add(params, "groundMetalness", 0, 1, 0.01)
    .name("metalness")
    .onChange((v: number) => {
      stage.groundMaterial.metalness = v;
    });

  const envFolder = gui.addFolder("environment");
  envFolder.add(params, "envPreset", ENV_PRESET_NAMES).name("preset").onChange(stage.applyEnvironment);
  envFolder.add(params, "envAsBackground").name("as background").onChange(stage.applyEnvironment);
  envFolder
    .add(params, "envIntensity", 0, 3, 0.05)
    .name("intensity")
    .onChange((v: number) => {
      stage.scene.environmentIntensity = v;
      stage.scene.backgroundIntensity = v;
    });

  const fogFolder = gui.addFolder("fog");
  fogFolder.add(params, "fogEnabled").name("enabled").onChange(stage.applyFog);
  fogFolder.addColor(params, "fogColor").name("color").onChange(stage.applyFog);
  fogFolder.add(params, "fogNear", 0, 200, 1).name("near").onChange(stage.applyFog);
  fogFolder.add(params, "fogFar", 1, 400, 1).name("far").onChange(stage.applyFog);

  return gui;
}
