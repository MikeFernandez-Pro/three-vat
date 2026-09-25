// `node release/drop/check.mjs` — the drop pages' headed end-to-end check
// (#101), driven from a terminal so it can have an exit code.
//
// It serves the examples on localhost with their own vite config, opens each
// drop page in the Chrome this machine already has, and does what a visitor
// does: waits for Soldier to bake, drops a `.glb` on the page, picks one with
// the button, drops a file the page does not take and one that will not
// parse. Then (#102) Soldier as a `.gltf` beside its `.bin` and textures:
// dropped as loose files, picked as a folder, and dropped missing a texture;
// and a Draco- and a meshopt + KTX2-compressed `.glb`. After each it reads
// the HUD. A dropped folder is the one path it cannot drive: a script cannot
// put a directory on a DataTransfer, so the folder goes through the button's
// input. Every console line is captured and any
// error fails the run, as the parity gate's does (parity/console.mjs): a WGSL
// compile error never reaches a readout, and a HUD can read right over a crowd
// that never drew.
//
// Headed, on the real GPU, for the parity gate's reason: headless WebGPU is not
// a dependable target (browser.mjs). The dropped files are built in the page
// from bytes this script reads; nothing is uploaded anywhere, which is the
// page's own promise.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { launchChrome } from "../browser.mjs";
import { describeMessage, judgeConsole } from "../parity/console.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const TIMEOUT_MS = Number(flag("timeout", 120_000));
const CHANNELS = flag("browser", "chrome,msedge,chromium").split(",");
const PAGES = ["webgl_drop", "webgpu_drop"];
const examples = (path) => fileURLToPath(new URL(`../../examples/${path}`, import.meta.url));

const SOLDIER = examples("public/Soldier.glb");
const soldierBytes = readFileSync(SOLDIER).toString("base64");

// Soldier's figures under the default encoding: the rig takes it (ADR-0027),
// and its merged geometry is 7 434 vertices (ADR-0018's table).
const SOLDIER_ENCODING = "rig";
const SOLDIER_VERTICES = "7434";

// The same Soldier as a .gltf beside its .bin and textures (#102), split out
// of the pinned .glb here rather than pinned again: the figures a bake of it
// has to match are the .glb's, and no second asset could promise that.
const soldierGltf = splitGlb(readFileSync(SOLDIER), "Soldier");
const soldierFolder = mkdtempSync(join(tmpdir(), "three-vat-drop-"));
for (const { path, bytes } of soldierGltf) {
  mkdirSync(dirname(join(soldierFolder, "Soldier", path)), { recursive: true });
  writeFileSync(join(soldierFolder, "Soldier", path), bytes);
}
const TEXTURE = soldierGltf.find(({ path }) => path.startsWith("textures/"))?.path;
if (!TEXTURE) throw new Error("Soldier.glb carries no texture to leave out");

// The compressed .glb files, fetched and pinned by scripts/fetch-test-assets.mjs:
// three's Draco duck, and its facecap, meshopt geometry under KTX2 textures.
const testAsset = (name) => fileURLToPath(new URL(`../../test-assets/${name}`, import.meta.url));
const COMPRESSED = [
  { name: "duck.glb", what: "a Draco-compressed .glb" },
  { name: "facecap.glb", what: "a meshopt-compressed .glb with KTX2 textures" },
];
for (const { name } of COMPRESSED) {
  if (!existsSync(testAsset(name))) throw new Error(`test-assets/${name} is missing — run node scripts/fetch-test-assets.mjs`);
}

/**
 * A `.glb` taken apart as an exporter writes a `.gltf`: the JSON, its binary
 * chunk as `<name>.bin`, and each embedded image as a file under `textures/`.
 * The images' bytes stay in the `.bin` too; nothing reads them there.
 * @param {Buffer} glb @param {string} name
 */
function splitGlb(glb, name) {
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength + 8;
  const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLength));
  const files = [];
  json.images?.forEach((image, i) => {
    const view = json.bufferViews[image.bufferView];
    const extension = image.mimeType === "image/png" ? "png" : "jpg";
    // A URI a .gltf would write: percent-encoded, as the spec asks.
    const path = `textures/${name} ${i}.${extension}`;
    files.push({ path, bytes: bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength) });
    json.images[i] = { uri: encodeURI(path), ...(image.name ? { name: image.name } : {}) };
  });
  json.buffers[0].uri = `${name}.bin`;
  files.unshift({ path: `${name}.gltf`, bytes: Buffer.from(JSON.stringify(json)) }, { path: `${name}.bin`, bytes: bin });
  return files;
}

/** Files for a synthetic drop: loose, every folder dropped, as several files picked together arrive. */
const loose = (files) =>
  files.map(({ path, bytes }) => ({ path: path.slice(path.lastIndexOf("/") + 1), base64: bytes.toString("base64") }));

const server = await createServer({
  configFile: examples("vite.config.ts"),
  root: examples("."),
  logLevel: "warn",
  server: { port: 0, strictPort: false },
});
await server.listen();
const base = server.resolvedUrls.local[0];

console.log(`\n  three-vat — drop pages, end to end\n  ${base}\n`);

const browser = await launchChrome(CHANNELS);
/** @type {{ name: string, pass: boolean, detail: string }[]} */
const checks = [];

try {
  for (const name of PAGES) await checkPage(name);
} finally {
  await browser.close();
  await server.close();
  rmSync(soldierFolder, { recursive: true, force: true });
}

for (const check of checks) {
  console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  console.log(`        ${check.detail}`);
}
const pass = checks.every((check) => check.pass);
console.log(`\n  ${pass ? "PASS — both drop pages bake what they are given" : "FAIL — see above"}\n`);
process.exit(pass ? 0 : 1);

/** Drive one page through every drop, and judge its console. @param {string} name */
async function checkPage(name) {
  /** @type {import("../parity/console.mjs").ConsoleLine[]} */
  const lines = [];
  const page = await browser.newPage();
  const record = (line) => {
    lines.push(line);
    console.log(`  [${name} ${line.level}] ${line.text.split("\n").join("\n        ")}`);
  };
  page.on("console", (message) =>
    record(describeMessage({ type: message.type(), text: message.text(), location: message.location() })),
  );
  page.on("pageerror", (error) => record({ level: "pageerror", text: error.message }));
  // The page's promise that no file leaves the browser, held to what the
  // browser actually sent: no request carries a body. Reads from elsewhere
  // are listed rather than failed — three's Inspector loads its TSL graph
  // editor from tsl-graph.xyz on every WebGPU page — and `blob:` URLs are
  // the loader's own in-memory textures, which never reach a network.
  const sent = [];
  const elsewhere = new Set();
  page.on("request", (request) => {
    const url = request.url();
    if (request.method() !== "GET" || request.postDataBuffer()) sent.push(`${request.method()} ${url}`);
    else if (!url.startsWith(base) && !url.startsWith("blob:") && !url.startsWith("data:")) elsewhere.add(new URL(url).origin);
  });

  const check = (what, pass, detail) => checks.push({ name: `${name}: ${what}`, pass, detail });
  const hud = () =>
    page.evaluate(() => {
      const text = (id) => document.getElementById(id)?.textContent ?? "";
      return {
        state: document.getElementById("hud")?.dataset.state ?? "",
        asset: text("asset"),
        encoding: text("encoding"),
        vertices: text("vertices"),
        bakeTime: text("bake-time"),
        capacity: text("capacity"),
        message: text("message"),
        warnings: text("warnings"),
      };
    });
  /** Wait for the page to settle out of `baking`, then read it. */
  const settled = async () => {
    await page.waitForFunction(() => document.getElementById("hud")?.dataset.state !== "baking", null, {
      timeout: TIMEOUT_MS,
    });
    return hud();
  };
  /**
   * Run `act`, then wait for the page to answer it and settle. Its first answer
   * is a change of state or message — `baking <file>…`, or a refusal — and
   * waiting for that, rather than for a state, is what keeps a second drop
   * from reading the first one's HUD.
   */
  const answered = async (act) => {
    const before = await hud();
    await act();
    await page.waitForFunction(
      ({ state, message }) => {
        const hudEl = document.getElementById("hud");
        return hudEl?.dataset.state !== state || document.getElementById("message")?.textContent !== message;
      },
      before,
      { timeout: TIMEOUT_MS },
    );
    return settled();
  };
  /** Drop files on the page as a visitor does: a `drop` event carrying them. */
  const drop = (files) =>
    answered(() =>
      page.evaluate((files) => {
        const transfer = new DataTransfer();
        for (const { path, base64 } of files) {
          const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
          transfer.items.add(new File([bytes], path));
        }
        document.body.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }, files),
    );

  try {
    await page.goto(`${base}${name}.html`);

    const opened = await settled();
    check(
      "Soldier is baked and running before any drop",
      opened.state === "ready" &&
        opened.asset === "Soldier.glb" &&
        opened.encoding === SOLDIER_ENCODING &&
        opened.vertices === SOLDIER_VERTICES &&
        opened.bakeTime !== "—" &&
        Number(opened.capacity) > 0,
      JSON.stringify(opened),
    );

    const dropped = await drop([{ path: "dropped-Soldier.glb", base64: soldierBytes }]);
    check(
      "a dropped .glb bakes in the worker and replaces the crowd",
      dropped.state === "ready" &&
        dropped.asset === "dropped-Soldier.glb" &&
        dropped.encoding === SOLDIER_ENCODING &&
        dropped.vertices === SOLDIER_VERTICES,
      JSON.stringify(dropped),
    );

    const picked = await answered(() => page.setInputFiles("#file-input", SOLDIER));
    check(
      "a .glb chosen with the button bakes too",
      picked.state === "ready" && picked.asset === "Soldier.glb" && picked.vertices === SOLDIER_VERTICES,
      JSON.stringify(picked),
    );

    const refused = await drop([{ path: "robot.obj", base64: btoa("o robot") }]);
    check(
      "an .obj is refused, naming the formats the page takes, and the crowd stays",
      refused.state === "refused" &&
        [".glb", ".gltf", ".fbx"].every((extension) => refused.message.includes(extension)) &&
        refused.asset === "Soldier.glb",
      JSON.stringify(refused),
    );

    const failed = await drop([{ path: "broken.glb", base64: btoa("not a model") }]);
    check(
      "a file the loader throws on shows the loader's message, and the crowd stays",
      failed.state === "failed" &&
        failed.message.startsWith("broken.glb did not bake — ") &&
        failed.message.length > "broken.glb did not bake — ".length &&
        failed.asset === "Soldier.glb" &&
        failed.vertices === SOLDIER_VERTICES,
      JSON.stringify(failed),
    );

    const gltf = await drop(loose(soldierGltf));
    check(
      "a .gltf dropped with its .bin and textures bakes as its .glb does",
      gltf.state === "ready" &&
        gltf.asset === "Soldier.gltf" &&
        gltf.encoding === SOLDIER_ENCODING &&
        gltf.vertices === SOLDIER_VERTICES &&
        gltf.warnings === "",
      JSON.stringify(gltf),
    );

    const folder = await answered(() => page.setInputFiles("#folder-input", join(soldierFolder, "Soldier")));
    check(
      "a folder chosen with the button bakes, each file at its path under it",
      folder.state === "ready" &&
        folder.asset === "Soldier/Soldier.gltf" &&
        folder.vertices === SOLDIER_VERTICES &&
        folder.warnings === "",
      JSON.stringify(folder),
    );

    const lacking = await drop(loose(soldierGltf.filter(({ path }) => path !== TEXTURE)));
    check(
      "a .gltf missing a texture warns by the texture's name, and still bakes",
      lacking.state === "ready" &&
        lacking.asset === "Soldier.gltf" &&
        lacking.vertices === SOLDIER_VERTICES &&
        lacking.warnings.includes(encodeURI(TEXTURE)),
      JSON.stringify(lacking),
    );

    for (const { name: file, what } of COMPRESSED) {
      const got = await drop([{ path: file, base64: readFileSync(testAsset(file)).toString("base64") }]);
      check(
        `${what} loads and bakes`,
        got.state === "ready" && got.asset === file && Number(got.vertices) > 0 && got.warnings === "",
        JSON.stringify(got),
      );
    }
  } catch (error) {
    check("the page ran to the end", false, String(error));
  } finally {
    await page.close();
  }

  check(
    "no request sent anything out of the page",
    sent.length === 0,
    sent.length === 0
      ? `every request was a bodiless GET${elsewhere.size ? `; read from ${[...elsewhere].join(", ")} too` : ""}`
      : sent.join("\n        "),
  );
  const verdict = judgeConsole(lines);
  check(verdict.name, verdict.pass, verdict.detail);
}
