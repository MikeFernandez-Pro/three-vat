// The WebGPU page's door: ask the browser for an adapter, then either load the
// demo or explain why it cannot run and point at the WebGL one.
//
// The check comes before any three.js import that matters, and the page proper
// arrives through a dynamic import, so a browser without WebGPU never fetches
// the node-material bundle it could not use.
//
// Why check at all, when `WebGPURenderer` has a WebGL fallback backend: because
// it would then *work*, silently, drawing this crowd through GLSL while the
// caption claims WebGPU. That is the one claim this page exists to make, so a
// reader is better served by an honest notice and a working link.
import { detectWebGPU } from "./webgpu/support.js";

const support = await detectWebGPU(globalThis);

if (support.ok) {
  await import("./webgpu/page.js");
} else {
  const notice = document.getElementById("unsupported")!;
  notice.querySelector("#reason")!.textContent = support.reason;
  notice.hidden = false;
  // The HUD goes with it. Its readouts are measurements of a frame — draw
  // calls, the crowd, the bake — and there is no frame: a HUD left on screen
  // would be stating figures for a demo that never ran.
  document.getElementById("hud")!.hidden = true;
}
