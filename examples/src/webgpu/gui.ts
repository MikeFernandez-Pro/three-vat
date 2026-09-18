// The control panel, wired to this page's stage. The defaults it edits are
// shared (params.ts); what each knob *touches* is renderer-specific — tone
// mapping exposure, a MeshStandardNodeMaterial ground, PMREM presets through
// the node renderer — so the wiring lives with the page (ADR-0011). Line for
// line the WebGL page's panel, because at this level the two renderers ask for
// the same things: only the `Stage` it is handed differs.
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { MAX_COUNT } from "../crowd.js";
import type { DemoParams } from "../params.js";
import { ENV_PRESET_NAMES, type Stage } from "./stage.js";

export interface GUIHooks {
  /** Draw the first `count` robots of the crowd. */
  setCount(count: number): void;
  /** Show or hide the baked-texture panel. */
  showTexturePanel(visible: boolean): void;
  /** Show or hide the engineering overlay: stats-gl and its frame timings. */
  showStats(visible: boolean): void;
}

/**
 * @param container Where the panel lives: the HUD's own column, not lil-gui's
 *   auto-placed top-right corner. The count slider is the demo's one control
 *   and reads best directly under the numbers it moves — and the whole right
 *   edge belongs to the texture panel now (ADR-0012).
 */
export function createDemoGUI(
  params: DemoParams,
  stage: Stage,
  hooks: GUIHooks,
  container: HTMLElement,
): GUI {
  const gui = new GUI({ title: "robot crowd", container, width: 250 });
  gui.add(params, "animate").name("animate");

  // The demo's one crowd control (ADR-0012). `onChange`, not `onFinishChange`:
  // the argument is made by watching the crowd grow under the drag while the
  // draw-call counter refuses to move, and that only reads if it tracks live.
  // It can afford to — the crowd is laid out once and this draws a prefix of
  // it, so there is no rebuild behind the slider.
  gui
    .add(params, "count", 1, MAX_COUNT, 1)
    .name("robots")
    .onChange((v: number) => hooks.setCount(v));

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
  // Both default-on-screen decisions are reversible, and neither is the
  // reader's first job: the texture panel is the evidence and starts visible,
  // the engineering overlay starts hidden (ADR-0012).
  gui
    .add(params, "showTexturePanel")
    .name("VAT textures")
    .onChange((v: boolean) => hooks.showTexturePanel(v));
  gui
    .add(params, "showStats")
    .name("frame timings")
    .onChange((v: boolean) => hooks.showStats(v));

  // The scene-tweak folders start closed: they are not what the page is for,
  // and an open accordion would push the count slider off a phone screen.
  const lightFolder = gui.addFolder("lights").close();
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

  const groundFolder = gui.addFolder("ground").close();
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

  const envFolder = gui.addFolder("environment").close();
  envFolder.add(params, "envPreset", ENV_PRESET_NAMES).name("preset").onChange(stage.applyEnvironment);
  envFolder.add(params, "envAsBackground").name("as background").onChange(stage.applyEnvironment);
  envFolder
    .add(params, "envIntensity", 0, 3, 0.05)
    .name("intensity")
    .onChange((v: number) => {
      stage.scene.environmentIntensity = v;
      stage.scene.backgroundIntensity = v;
    });

  const fogFolder = gui.addFolder("fog").close();
  fogFolder.add(params, "fogEnabled").name("enabled").onChange(stage.applyFog);
  fogFolder.addColor(params, "fogColor").name("color").onChange(stage.applyFog);
  fogFolder.add(params, "fogNear", 0, 200, 1).name("near").onChange(stage.applyFog);
  fogFolder.add(params, "fogFar", 1, 400, 1).name("far").onChange(stage.applyFog);

  return gui;
}
