// The browser the release suite's headed checks drive: the parity gate
// (parity/check.mjs) and the drop pages' end-to-end check (drop/check.mjs).
// One launcher, because both need the same Chrome for the same reason, and a
// second copy is where the two would drift on which flags a real GPU needs.
// Plain JavaScript: both callers run under bare `node`.
import { chromium } from "playwright-core";

/**
 * The first Chrome-shaped browser this machine actually has — headed, because
 * a headless Chrome does not dependably hand out a WebGPU device, and on this
 * machine's real GPU rather than a software rasteriser, because the GPU is the
 * thing under test.
 *
 * @param {string[]} channels Branded channel names, stable first; `chromium`
 *   means "whatever playwright has installed".
 */
export async function launchChrome(channels) {
  const tried = [];
  for (const channel of channels) {
    try {
      return await chromium.launch({
        headless: false,
        channel: channel === "chromium" ? undefined : channel,
        // WebGPU on whatever GPU this is, blocklist or not: the checks run on
        // one adapter, and which adapter is not their business.
        args: ["--ignore-gpu-blocklist"],
      });
    } catch (error) {
      tried.push(`${channel}: ${String(error).split("\n")[0]}`);
    }
  }
  throw new Error(`no browser to drive (pass --no-open to open the URL by hand). Tried —\n    ${tried.join("\n    ")}`);
}
