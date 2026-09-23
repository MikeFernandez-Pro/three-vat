// The WebGPU crossfade page's door: ask the browser for an adapter, then either
// load the example or explain why it cannot run and point at the WebGL one.
//
// The same door as the crowd pages' (webgpu_crowd.ts), for the same reason: the
// check comes before any three.js import that matters, and the page proper
// arrives through a dynamic import, so a browser without WebGPU never fetches
// the node-material bundle it could not use — and never renders this crowd
// through `WebGPURenderer`'s silent WebGL fallback while the page claims to be
// blending through TSL.
import { detectWebGPU } from "./webgpu/support.js";

const support = await detectWebGPU(globalThis);

if (support.ok) {
  await import("./webgpu/crossfade.js");
} else {
  const notice = document.getElementById("unsupported")!;
  notice.querySelector("#reason")!.textContent = support.reason;
  notice.hidden = false;
  // The HUD goes with it. Its readouts count transitions in a crowd being drawn
  // on screen, and there is no crowd: a count left standing would be a figure
  // for an example that never ran.
  document.getElementById("hud")!.hidden = true;
}
