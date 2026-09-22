// `node release/parity/check.mjs` — the cross-path pixel-diff release gate
// (#14), driven from a terminal so it can have an exit code.
//
// It serves release/parity/index.html on localhost, opens it in the Chrome this
// machine already has, captures everything that browser prints to its console,
// and waits for the page to post its verdict back. That shape — a real, headed
// browser on the developer's own machine rather than a headless one in CI — is
// the whole point: the gate compares a GLSL decode on a real GPU against a WGSL
// decode on the same real GPU, and headless WebGPU is not a dependable target.
// localhost is a secure context, so `navigator.gpu` is exposed without a
// certificate.
//
// The browser is driven (`playwright-core`, the dependency the hero capture
// already carries) for one reason, and it is not to pick the browser: the
// console. A WGSL compile error never reaches a pixel verdict — three reports
// it to the console, the pipeline never builds, and the render target keeps
// whatever frame it held, so the page's own checks can pass on a picture the
// decode under test did not draw. The driver subscribes to the console and to
// uncaught page errors, prints every line, and fails the gate on any error —
// which is the check that comes first below, because it explains any other.
// `--no-open` prints the URL instead, for a machine where the browser with
// WebGPU is not Chrome or Edge; that run has no console capture, and says so.
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { describeMessage, judgeConsole } from "./console.mjs";

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const TIMEOUT_MS = Number(flag("timeout", 180_000));
const OPEN = !has("no-open");
// Whatever Chrome this machine has, stable channel first. A branded channel
// name is how playwright-core finds an installed browser rather than one of
// its own; `chromium` at the end means "whatever playwright has installed".
const CHANNELS = flag("browser", "chrome,msedge,chromium").split(",");
// Optional: a PNG of the page once the verdict is in — the four compared frames
// and every check, for a failure someone wants to look at after the fact.
const SCREENSHOT = flag("screenshot", null);
// `release/`, so the page is served at `/parity/` and the demo's `public/` —
// which vite.config.ts points at — is served at the root beside it.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Resolved by the middleware below, the first time the page posts a verdict. */
let deliver;
const verdict = new Promise((resolve) => {
  deliver = resolve;
});

const server = await createServer({
  root: ROOT,
  // Quiet: the gate's output is the verdict, not a dev-server banner.
  logLevel: "warn",
  server: { port: 0, strictPort: false },
  plugins: [
    {
      name: "parity-result",
      // Registered inside `configureServer` so it runs *before* vite's own
      // middlewares, which would otherwise answer this POST with the SPA
      // fallback and swallow the verdict.
      configureServer(vite) {
        vite.middlewares.use("/__parity/result", (req, res) => {
          const chunks = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => {
            res.statusCode = 204;
            res.end();
            try {
              deliver(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
              deliver({ pass: false, checks: [{ name: "the page reported a readable verdict", pass: false, detail: String(error) }] });
            }
          });
        });
      },
    },
  ],
});

await server.listen();
const url = `${server.resolvedUrls.local[0]}parity/`;

console.log(`\n  three-vat — cross-path parity gate\n  ${url}\n`);

/**
 * What the browser printed (`ConsoleLine` in console.mjs). Printed as it
 * arrives, and judged once the verdict is in.
 */
const consoleLines = [];
let browser = null;
let page = null;
if (OPEN) {
  browser = await launch();
  page = await browser.newPage();
  page.on("console", (message) =>
    record(describeMessage({ type: message.type(), text: message.text(), location: message.location() })),
  );
  page.on("pageerror", (error) => record({ level: "pageerror", text: error.message }));
  await page.goto(url);
  console.log("  Waiting for the browser to finish rendering both paths…\n");
} else {
  console.log("  Open that in a browser with WebGPU. Waiting for its verdict…");
  console.log("  (no console capture on this run — a shader compile error will show only in that browser's devtools)\n");
}

const timeout = new Promise((resolve) =>
  setTimeout(
    () => resolve({ pass: false, checks: [{ name: "the browser reported back in time", pass: false, detail: `nothing posted to ${url} within ${TIMEOUT_MS / 1000}s — is the page open, and does that browser have WebGPU?` }] }),
    TIMEOUT_MS,
  ).unref?.(),
);

const result = await Promise.race([verdict, timeout]);

if (browser) {
  if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT, fullPage: true });
  await browser.close();
}
await server.close();

// The console verdict, first: an error printed by the browser explains a frame
// that came back wrong or blank, so it is read before any pixel check is.
if (OPEN) {
  const consoleCheck = judgeConsole(consoleLines);
  result.checks = [consoleCheck, ...(result.checks ?? [])];
  result.pass = result.pass && consoleCheck.pass;
}

for (const check of result.checks ?? []) {
  console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  console.log(`        ${check.detail}`);
}
console.log(`\n  ${result.pass ? "PASS — the two decode paths agree" : "FAIL — the gate is not satisfied"}\n`);
if (result.userAgent) console.log(`  ${result.userAgent}\n`);

process.exit(result.pass ? 0 : 1);

/** Keep a console line, and show it as it happens. @param {import("./console.mjs").ConsoleLine} line */
function record(line) {
  consoleLines.push(line);
  console.log(`  [browser ${line.level}] ${line.text.split("\n").join("\n        ")}`);
}

/**
 * The first Chrome-shaped browser this machine actually has — headed, because
 * a headless Chrome does not dependably hand out a WebGPU device, and on this
 * machine's real GPU rather than a software rasteriser, because the GPU is the
 * thing under test.
 */
async function launch() {
  const tried = [];
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({
        headless: false,
        channel: channel === "chromium" ? undefined : channel,
        // WebGPU on whatever GPU this is, blocklist or not: the gate compares
        // two decodes on one adapter, and which adapter is not its business.
        args: ["--ignore-gpu-blocklist"],
      });
    } catch (error) {
      tried.push(`${channel}: ${String(error).split("\n")[0]}`);
    }
  }
  throw new Error(`no browser to drive (pass --no-open to open the URL by hand). Tried —\n    ${tried.join("\n    ")}`);
}
