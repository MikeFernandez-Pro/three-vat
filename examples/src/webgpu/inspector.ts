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
// Left where the Inspector puts itself — top-right, the corner every three
// example keeps its controls in — and left to remember where a visitor moves
// it. The WebGL pages cannot have it (`WebGLRenderer` has no `inspector`) and
// take stats-gl top-left and lil-gui top-right instead, which is the same
// layout.
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

