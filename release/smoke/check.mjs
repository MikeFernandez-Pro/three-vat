// `node release/smoke/check.mjs` — every example, opened once, on its own
// renderer (ADR-0037).
//
// It serves the examples on localhost with their own vite config, opens every
// page in the page table — both renderers' pages of every feature, old style
// and new — in the headed Chrome the parity gate and the drop check drive
// (release/browser.mjs), and fails on any console error or on a page that never
// draws. Nothing is clicked: this is not what a page is evidence of, which is
// the parity gate's and each page's own business, only that it runs. With a
// page per renderer per feature, one that stopped running would otherwise be
// found by a visitor.
//
// "Draws" is counted at the GPU API rather than read off a page: a script
// added before any of the page's own wraps every draw entry point of WebGL,
// WebGL 2 and WebGPU and counts the calls. So the check means the same thing
// on a page written today and on one written next year, and no page carries
// anything for it.
//
// Read off the page table (examples/pages.mjs), so a new page is covered the
// moment its file lands. Headed, on the real GPU, for the parity gate's reason:
// headless Chrome does not dependably hand out a WebGPU device, and a WebGPU
// page that quietly ran on its WebGL 2 backend would pass for the wrong
// reason. Not part of `pnpm test`, because it needs that GPU; a release step
// beside the parity and drop checks instead (docs/releasing.md).
//
//   --pages=webgl_crowd,webgpu_crowd  only these pages
//   --timeout=60000                   how long a page has to draw, in ms
//   --browser=chrome,msedge,chromium  the channels to try, in order
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { pageNames } from "../../examples/pages.mjs";
import { launchChrome } from "../browser.mjs";
import { describeMessage } from "../parity/console.mjs";
import { judgePage } from "./verdict.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const TIMEOUT_MS = Number(flag("timeout", 60_000));
const CHANNELS = flag("browser", "chrome,msedge,chromium").split(",");
const PAGES = flag("pages", pageNames.join(",")).split(",");
/**
 * How long a page is watched after its first draw. The first frame is where a
 * pipeline that fails to build says so, and a second or two after it is where
 * the frames that follow it do.
 */
const SETTLE_MS = 2_000;

const unknown = PAGES.filter((page) => !pageNames.includes(page));
if (unknown.length > 0) {
  console.error(`\n  not a page: ${unknown.join(", ")} (the page table has ${pageNames.join(", ")})\n`);
  process.exit(1);
}

const examples = (path) => fileURLToPath(new URL(`../../examples/${path}`, import.meta.url));
const server = await createServer({
  configFile: examples("vite.config.ts"),
  root: examples("."),
  logLevel: "warn",
  server: { port: 0, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls.local[0];

console.log(`\n  three-vat — every example, opened once\n  ${base}, ${PAGES.length} pages\n`);

const browser = await launchChrome(CHANNELS);
/** @type {import("./verdict.mjs").SmokeCheck[]} */
const checks = [];

try {
  for (const page of PAGES) checks.push(...(await open(page)));
} finally {
  await browser.close();
  await server.close();
}

console.log("");
for (const check of checks) {
  console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  console.log(`        ${check.detail}`);
}
const failed = checks.filter((check) => !check.pass).length;
console.log(`\n  ${failed === 0 ? `PASS — all ${PAGES.length} pages ran clean and drew` : `FAIL — ${failed} checks, see above`}\n`);
process.exit(failed === 0 ? 0 : 1);

/**
 * Wrap every draw entry point the page could reach, and count the calls.
 * Serialised into the page by playwright and run before any of its scripts,
 * so it must stand alone: nothing from this module is in scope there.
 */
function countDraws() {
  const counter = { draws: 0 };
  Object.defineProperty(globalThis, "__threeVatSmoke", { value: counter });
  const wrap = (prototype, names) => {
    if (!prototype) return;
    for (const name of names) {
      const original = prototype[name];
      if (typeof original !== "function") continue;
      prototype[name] = function (...rest) {
        counter.draws++;
        return original.apply(this, rest);
      };
    }
  };
  const gl = ["drawArrays", "drawElements"];
  wrap(globalThis.WebGLRenderingContext?.prototype, gl);
  wrap(globalThis.WebGL2RenderingContext?.prototype, [...gl, "drawArraysInstanced", "drawElementsInstanced", "drawRangeElements"]);
  const gpu = ["draw", "drawIndexed", "drawIndirect", "drawIndexedIndirect"];
  wrap(globalThis.GPURenderPassEncoder?.prototype, gpu);
  wrap(globalThis.GPURenderBundleEncoder?.prototype, gpu);
}

/** Open one page, wait for it to draw, and judge what it did. @param {string} name */
async function open(name) {
  /** @type {import("../parity/console.mjs").ConsoleLine[]} */
  const lines = [];
  const page = await browser.newPage();
  const record = (line) => {
    // The browser asks every origin for a favicon on its own account; no page
    // requested it, and its 404 says nothing about one.
    if (/\/favicon\.ico$/.test(line.text)) return;
    lines.push(line);
    if (line.level === "error" || line.level === "pageerror") {
      console.log(`  [${name} ${line.level}] ${line.text.split("\n").join("\n        ")}`);
    }
  };
  page.on("console", (message) =>
    record(describeMessage({ type: message.type(), text: message.text(), location: message.location() })),
  );
  page.on("pageerror", (error) => record({ level: "pageerror", text: error.message }));
  await page.addInitScript(countDraws);

  const started = Date.now();
  const draws = () => page.evaluate(() => globalThis.__threeVatSmoke?.draws ?? 0).catch(() => 0);
  try {
    // A page that cannot even be navigated to is a failure to report, not a
    // reason to stop checking the rest.
    await page.goto(`${base}${name}.html`).catch((error) => record({ level: "pageerror", text: `navigation failed: ${error.message}` }));
    await page
      .waitForFunction(() => (globalThis.__threeVatSmoke?.draws ?? 0) > 0, null, { timeout: TIMEOUT_MS, polling: 100 })
      .then(() => page.waitForTimeout(SETTLE_MS))
      .catch(() => {});
    const drawn = await draws();
    process.stdout.write(`  ${name}: ${drawn} draws in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
    return judgePage({ page: name, lines, draws: drawn, waitedMs: TIMEOUT_MS });
  } finally {
    await page.close();
  }
}
