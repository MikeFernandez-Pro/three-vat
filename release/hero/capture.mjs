// `pnpm hero` — the README's hero image, captured from the demo it advertises.
//
// It builds the demo, serves the build, opens it in a headless browser, drags
// the real count slider with a real mouse from one robot to the whole crowd,
// screenshots every step and encodes the result as a looping GIF. Running it
// again overwrites the image in place, which is the point: the hero can never be
// prettier than the thing it advertises, and it cannot go stale the first time
// the demo changes (ADR-0012). It is a release step, so it lives in `release/`
// beside the parity gate and reaches into the demo the same way (ADR-0011).
//
// This is the half that needs a browser, and it does nothing but drive one and
// write down what it saw. What to drag and when is `plan.mjs`, what the frames
// are worth in bytes is `gif.mjs`, and whether what it saw is worth publishing
// is `verdict.mjs` — all three pure and pinned by tests in CI, the same split
// the parity gate uses and for the same reason.
//
// **Why there is a browser driver here and not in the parity gate.** The gate
// hands a URL to the developer's own browser because it needs WebGPU on a real
// GPU, which is exactly what headless cannot be trusted to give. This needs the
// opposite: WebGL, which headless Chrome renders perfectly well through
// SwiftShader, and *no human in the loop at all* — a capture that needs someone
// to press a key produces a screenshot, not a release step. `playwright-core`
// rather than `playwright`: it drives the Chrome or Edge the machine already
// has, so no clone of this repository downloads a browser to build a library.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import { build, preview } from "vite";
import { encodeHeroGif } from "./gif.mjs";
import { capturePlan } from "./plan.mjs";
import { heroVerdict } from "./verdict.mjs";

// ---------------------------------------------------------------- the image
// The shape of the hero, as constants rather than as flags. It is one image, and
// retuning it is an edit someone makes once and reads back here — the way the
// parity gate keeps its tolerance in `compare.ts` (docs/releasing.md).

/** Wide enough for the HUD, the crowd and the texture panel to sit clear of each other. */
const WIDTH = 800;
const HEIGHT = 450;
/** Three seconds: long enough to read the drag, short enough to loop cleanly. */
const FRAMES = 36;
const FPS = 12;
/** Colour table, transparent slot included. 128 holds the sky's gradient without banding. */
const COLORS = 128;
/** Beats held on the single robot and on the full crowd, so the loop reads as a drag. */
const HOLD_START = 3;
const HOLD_END = 5;
/**
 * Long enough for the page to paint the count it was just given. The crowd is
 * laid out once and the slider draws a prefix of it, so this is a frame or two
 * of settling, not a rebuild.
 */
const SETTLE_MS = 90;

// ---------------------------------------------------------------- the run
const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const flag = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const OUT = flag("out", fileURLToPath(new URL("../../docs/media/hero.gif", import.meta.url)));
// Whatever Chrome this machine has. `chrome` first, because that is what a
// developer on this project already runs the parity gate in.
const CHANNELS = flag("browser", "chrome,msedge,chromium").split(",");

const demo = (path) => fileURLToPath(new URL(`../../examples/${path}`, import.meta.url));

if (!has("no-build")) {
  console.log("\n  building the demo…");
  await build({ root: demo(""), configFile: demo("vite.config.ts"), logLevel: "warn" });
}

const server = await preview({
  root: demo(""),
  configFile: demo("vite.config.ts"),
  preview: { port: 0, open: false },
  logLevel: "warn",
});
const url = server.resolvedUrls.local[0];

const browser = await launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  // 1, always: the GIF is this many pixels, and a retina capture would be four
  // times the bytes for the same image.
  deviceScaleFactor: 1,
});

/** @type {string[]} */
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));

console.log(`  ${url} → ${WIDTH}×${HEIGHT}, ${FRAMES} frames at ${FPS} fps`);
await page.goto(url, { waitUntil: "load" });

// Ready is not "loaded": the page bakes the VAT before it builds any of this.
// The slider existing means the bake is done, and a numeric draw-call readout
// means a frame has actually been drawn.
const slider = page
  .locator(".lil-gui .controller.number", { has: page.getByText("robots", { exact: true }) })
  .locator(".slider");
await slider.waitFor({ state: "visible", timeout: 120_000 });
await page.waitForFunction(
  () => Number(document.getElementById("draw-count")?.textContent) > 0,
  null,
  { timeout: 120_000 },
);
// The sky is a generated environment map; give it and the shadow map a beat to
// land, so frame one is not a different room from frame two.
await page.waitForTimeout(1_000);

const track = await slider.boundingBox();
if (!track) throw new Error("the count slider is not on screen — has the demo's one control moved?");
// lil-gui maps the track's own width linearly onto the range and clamps outside
// it. The clamp is why the sweep overshoots by a couple of pixels at each end:
// aiming at the exact edge lands a rounded pixel short, and a drag that stops at
// 336 of 340 is a drag that did not cross the range. Inside the track the
// overshoot skews a step by a robot or two, which is why the counts reported at
// the end are the ones read back off the page and not the ones asked for.
const OVERSHOOT = 2;
const xAt = (fraction) => track.x - OVERSHOOT + fraction * (track.width + 2 * OVERSHOOT);
const y = track.y + track.height / 2;
// The press has to land *on* the control — outside it there is nothing to grab,
// and the drag that followed would move a mouse over a page that never noticed.
// Only the moves after it are allowed past the edge.
const press = async () => {
  await page.mouse.move(track.x + 1, y);
  await page.mouse.down();
};

// One sweep to the top and back before anything is recorded. It does two jobs.
// It asks the page what the top of its range is — `MAX_COUNT` lives in the
// demo's TypeScript, which a Node script cannot import, and reading it off the
// control is truer anyway: the plan is built for the slider that exists. And it
// puts the full crowd through the pipeline once, so the shader compile and the
// instance upload happen here rather than as a hitch in the middle of the take.
await press();
await page.mouse.move(xAt(1), y);
await page.waitForTimeout(1_000);
const maxCount = (await hud()).count;
await page.mouse.move(xAt(0), y);
await page.mouse.up();
await page.waitForTimeout(500);

if (!Number.isFinite(maxCount) || maxCount < 2) {
  throw new Error(
    `dragging the slider to its end left ${maxCount} robots on screen — the drag is not reaching the control`,
  );
}

const plan = capturePlan({ maxCount, frames: FRAMES, holdStart: HOLD_START, holdEnd: HOLD_END });

const frames = [];
const counts = [];
const drawCalls = new Set();

// A real press and a real drag, so what the GIF shows is the control a reader
// will put their own mouse on — not a variable assigned from outside the page.
await press();
for (const [i, step] of plan.entries()) {
  await page.mouse.move(xAt(step.fraction), y);
  await page.waitForTimeout(SETTLE_MS);
  const { count, draws } = await hud();
  counts.push(count);
  drawCalls.add(draws);
  frames.push(PNG.sync.read(await page.screenshot({ type: "png" })).data);
  process.stdout.write(`\r  frame ${i + 1}/${plan.length} — ${count} robots, ${draws} draw calls   `);
}
await page.mouse.up();
console.log("");

// Where the evidence ended up, measured off the page rather than assumed. Both
// are found by the id the demo gives them, so this reads the panel and the
// readout themselves and never whatever else happens to be that size.
const { panel, readout } = await page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const { left, right, top, bottom } = el.getBoundingClientRect();
    return { left, right, top, bottom };
  };

  const root = document.getElementById("texture-panel");
  const canvases = root ? [...root.querySelectorAll("canvas")] : [];
  // A cursor layer is the one canvas type here drawn with a translucent brush:
  // the cursors are white at 62% over nothing, so their pixels come back part
  // way between clear and opaque. The strips under them are opaque edge to edge.
  // Every canvas in the panel already has a 2D context, so asking for one reads
  // the page rather than changing it.
  const cursorLayers = canvases.filter((c) => {
    const pixels = c.getContext("2d")?.getImageData(0, 0, c.width, c.height).data;
    if (!pixels) return false;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0 && pixels[i] < 255) return true;
    }
    return false;
  });

  return {
    panel: root
      ? { canvases: canvases.length, cursorLayers: cursorLayers.length, ...box(root) }
      : null,
    readout: box(document.getElementById("draw-count")),
  };
});

await browser.close();
await server.close();

const gif = encodeHeroGif({ frames, width: WIDTH, height: HEIGHT, fps: FPS, maxColors: COLORS });
const { pass, checks } = heroVerdict({
  counts,
  maxCount,
  drawCalls: [...drawCalls],
  pageErrors,
  panel,
  readout,
  frame: { width: WIDTH, height: HEIGHT },
  bytes: gif.length,
});

console.log("");
for (const check of checks) {
  console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  console.log(`        ${check.detail}`);
}

// A GIF that does not carry the argument is worse than no GIF, so a failed
// capture leaves the image already on disk alone (ADR-0012).
if (!pass) {
  console.log(`\n  FAIL — the capture does not carry the argument. ${OUT} is unchanged.\n`);
  process.exit(1);
}

writeFileSync(OUT, gif);
console.log(`\n  PASS — wrote ${OUT}\n`);

/** The HUD, read as values: the crowd it says is on screen, and the frame it cost. */
function hud() {
  return page.evaluate(() => ({
    count: Number(/^(\d+)/.exec(document.getElementById("info").textContent)?.[1]),
    draws: Number(document.getElementById("draw-count").textContent),
  }));
}

/** The first Chrome-shaped browser this machine actually has. */
async function launch() {
  const tried = [];
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch({
        headless: !has("headed"),
        channel: channel === "chromium" ? undefined : channel,
        // A software rasteriser, so the capture looks the same on a laptop, a
        // workstation and a box with no GPU at all. The demo is not being
        // benchmarked here, only photographed.
        args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars"],
      });
    } catch (error) {
      tried.push(`${channel}: ${String(error).split("\n")[0]}`);
    }
  }
  throw new Error(`no browser to drive. Tried —\n    ${tried.join("\n    ")}`);
}
