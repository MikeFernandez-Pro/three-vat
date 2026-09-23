// three's Inspector, attached to a page's renderer: the engineering overlay and
// the control panel in one, on the WebGPU path (ADR-0024).
//
// Set as `renderer.inspector`, the node renderer reports into it — CPU and GPU
// time per pass, draw calls, memory, a recorded timeline of every call in a
// frame, a console — and its **Parameters** tab is where the page's controls
// live (gui.ts). The **TSL Graph** extension is added too: a node material
// tagged `material.userData.graphId` opens in it as an editable graph, which
// for these pages is the decode this library builds in TSL, laid out on screen.
//
// The WebGL pages cannot have it — `WebGLRenderer` has no `inspector` — and
// take three's own `Stats` and `lil-gui` instead.
import type * as THREE from "three/webgpu";
import { Inspector } from "three/addons/inspector/Inspector.js";
import * as tslGraph from "three/addons/inspector/extensions/tsl-graph/TSLGraphEditor.js";

export type { Inspector };

// The module's default export at runtime (r186 has no named one), typed by the
// named class its declarations carry (which is the only one they carry). A
// namespace import is the one form both agree on.
const TSLGraphEditor = (tslGraph as unknown as { default: typeof tslGraph.TSLGraphEditor }).default;

/** Build the Inspector, give it the TSL graph, and hand it the renderer. */
export function createInspector(renderer: THREE.WebGPURenderer): Inspector {
  const inspector = new Inspector();
  inspector.addTab(new TSLGraphEditor());
  renderer.inspector = inspector;
  return inspector;
}

/**
 * Place the Inspector: its button, and beside it the Parameters group that the
 * Inspector floats on its own while the main panel is closed — which is how the
 * page's controls, the count slider above all (ADR-0012), are on screen at rest
 * without the timings and the timeline being.
 *
 * Placed low, on the side the page leaves free: the HUD holds the top-left
 * (ADR-0012) and the texture panel, on the pages that carry one, the right
 * edge — so `side` is the caller's, and it says which of the two the Inspector
 * may have. Once: the Inspector remembers its layout, and a visitor who moved
 * it gets the layout they left, not this one.
 */
export function placeInspector(inspector: Inspector, side: "left" | "right"): void {
  if (!firstVisit) return;
  inspector.setHorizontalAlign(side);
  inspector.setVerticalAlign("bottom");
}

/**
 * Whether this page load is the visitor's first with the Inspector — read
 * once, as this module loads and before any Inspector is built, because the
 * Inspector saves a layout of its own the moment it picks its first tab, and a
 * check made after that would always find one.
 */
const firstVisit = !hasSavedLayout();

/**
 * Whether the Inspector has a layout of the visitor's to restore: its one
 * `localStorage` entry, with a `layout` in it (`getItem`/`setItem` in
 * `Inspector.js`). Storage can be missing or refused — a private window, a
 * frame with storage blocked — and then there is nothing saved, by definition.
 */
function hasSavedLayout(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as { layout?: unknown };
    return saved.layout !== undefined;
  } catch {
    return false;
  }
}

/** The one key the Inspector keeps everything under. */
const STORAGE_KEY = "threejs-inspector";
