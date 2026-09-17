// Can this browser run the WebGPU page, and if not, what does the reader need
// to be told?
//
// `WebGPURenderer` answers neither question usefully on its own: with no WebGPU
// it silently switches to its WebGL fallback backend, so the page would render
// a crowd through GLSL while claiming to be the WebGPU demo — the one claim
// this page exists to make. So the check is made here, up front, and the page
// either builds a real WebGPU crowd or shows the notice that points at the
// WebGL demo.
//
// The host is a parameter rather than a reach for `globalThis`, so the decision
// is a pure function of what the browser exposes and can be tested in Node.

/** Available, or not available with something to say about it. */
export type WebGPUAvailability = { ok: true } | { ok: false; reason: string };

/**
 * The WebGPU entry point, as much of it as a support check touches. Also what
 * `navigator-gpu.d.ts` declares `navigator.gpu` to be, so the shape is written
 * once.
 */
export interface GPUEntryPoint {
  requestAdapter(): Promise<unknown>;
}

/** The little of a browser global that a support check actually reads. */
export interface WebGPUHost {
  isSecureContext?: boolean;
  navigator?: { gpu?: GPUEntryPoint };
}

/**
 * Ask this browser for a WebGPU adapter, and turn the answer into something
 * showable.
 *
 * An adapter, not just `navigator.gpu`: the API can be present and still start
 * nothing — a blocklisted driver, a headless run, a machine with the GPU
 * process disabled — and "has the API" would send those readers into a blank
 * canvas.
 */
export async function detectWebGPU(host: WebGPUHost): Promise<WebGPUAvailability> {
  const gpu = host.navigator?.gpu;
  if (!gpu) {
    // `navigator.gpu` is only exposed to secure contexts, so an http:// origin
    // looks exactly like a browser that never shipped WebGPU. Telling those two
    // apart matters: one of them the reader can fix.
    return host.isSecureContext === false
      ? { ok: false, reason: "WebGPU needs a secure context — this page is served over http, so `navigator.gpu` is hidden. Try https or localhost." }
      : { ok: false, reason: "This browser has no WebGPU support (`navigator.gpu` is missing)." };
  }

  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return { ok: false, reason: "WebGPU is present, but this machine started no adapter — often a blocklisted driver or a disabled GPU process." };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `Requesting a WebGPU adapter failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
