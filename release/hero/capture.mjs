// `node release/hero/capture.mjs` — the README's hero image, captured from the
// demo it advertises.
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
import { preview } from "vite";
import { buildDemos } from "../../examples/build.mjs";
import { encodeHeroGif } from "./gif.mjs";
import { capturePlan } from "./plan.mjs";
import { heroVerdict } from "./verdict.mjs";

// ---------------------------------------------------------------- the image
// The shape of the hero, as constants rather than as flags. It is one image, and
// retuning it is an edit someone makes once and reads back here — the way the
// parity gate keeps its tolerance in `compare.ts` (docs/releasing.md).

/**
 * Wide enough for the HUD, the crowd and the texture panel to sit clear of each
 * other. 800x450 was not: the readout line runs under the controls panel there,
 * so the image advertised "one draw call per material - 3 of them" with the
 * "never one" that is the whole point hidden behind a slider.
 */
const WIDTH = 1000;
const HEIGHT = 560;
/**
 * Two and a half seconds: long enough to read the drag, short enough to loop
 * cleanly - and short enough to pay for the wider frame. At 1000x560 the image
 * is 1.4x the pixels it was, which put 36 frames over the budget below; the
 * drag reads the same at 30, and the budget is not the thing to move.
 */
const FRAMES = 30;
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

/**
 * The page the hero is captured from: the robot crowd on WebGL, which is what
 * the README advertises. Its own address, not the deployed root — the root is
 * the gallery now, and the hero has to record the page rather than a shell
 * framing it (ADR-0020).
 */
const PAGE = "webgl_crowd.html";

if (!has("no-build")) {
  console.log("\n  building the pages…");
  // `buildDemos`, not a bare `build`: this app is one build per page (#17) and
  // the config refuses to run without being told which, so a bare build would
  // not get as far as a browser. Calling the pages' own build script is what
  // keeps the capture honest besides — the hero comes off the bytes the deploy
  // ships.
  await buildDemos();
}

const server = await preview({
  root: demo(""),
  configFile: demo("vite.config.ts"),
  preview: { port: 0, open: false },
  logLevel: "warn",
});
// The crowd page itself. The gallery would frame it, and a GIF of a sidebar
// beside a crowd is not the image the README is making a claim with.
const url = new URL(PAGE, server.resolvedUrls.local[0]).href;

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

// The frame timings come off, and only here. They are always on for a visitor
// (ADR-0024) and they are honest there, because a visitor has a GPU. This
// capture does not: it runs through SwiftShader on purpose, so that the image
// is the same from any machine (see `launch` below), and the strip therefore
// reads the rasteriser rather than the library - about 11 FPS and 400 ms of
// "GPU". A README whose whole argument is that this is fast cannot open on
// that number. The draw-call readout, which is the claim the image actually
// makes, is a count and not a timing, so it stays and the verdict goes on
// requiring it (ADR-0012: the hero can never be prettier than the thing it
// advertises, and a figure produced by the photographer is not the thing).
// Attached, not visible: the strip is a div of absolutely positioned canvases
// and reports no box of its own.
await page.locator("#frame-stats").waitFor({ state: "attached", timeout: 30_000 });
await page.evaluate(() => {
  document.getElementById("frame-stats").style.display = "none";
});

// The textures are off by default (ADR-0024); the image is the one place they
// are evidence at rest, so they are switched on here - through the panel a
// visitor would use - before a frame is recorded, and the verdict below goes
// on checking that they are in it.
await page
  .locator(".lil-gui .controller.boolean", { has: page.getByText("VAT textures", { exact: true }) })
  .locator("input")
  .check();
await page.waitForTimeout(500);

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
