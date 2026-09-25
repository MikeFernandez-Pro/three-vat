// `node release/drop/check.mjs` — the drop pages' headed end-to-end check
// (#101), driven from a terminal so it can have an exit code.
//
// It serves the examples on localhost with their own vite config, opens each
// drop page in the Chrome this machine already has, and does what a visitor
// does: waits for Soldier to bake, drops a `.glb` on the page, picks one with
// the button, drops a file the page does not take and one that will not
// parse, drops Samba Dancing.fbx and turns its merge off, and drops Soldier
// once more. After each it reads the HUD. Every console line is captured and any
// error fails the run, as the parity gate's does (parity/console.mjs): a WGSL
// compile error never reaches a readout, and a HUD can read right over a crowd
// that never drew.
//
// Headed, on the real GPU, for the parity gate's reason: headless WebGPU is not
// a dependable target (browser.mjs). The dropped files are built in the page
// from bytes this script reads; nothing is uploaded anywhere, which is the
// page's own promise.
import { existsSync, readFileSync } from "node:fs";
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

// Samba Dancing, the common Mixamo export, pinned by scripts/fetch-test-assets.mjs
// (#99) rather than committed. FBXLoader hands it over non-indexed, and the
// page merges it by default: 165 960 vertices before, 35 440 after — the
// figures src/bake.integration.test.ts pins for the same bytes.
const SAMBA = fileURLToPath(new URL("../../test-assets/Samba Dancing.fbx", import.meta.url));
if (!existsSync(SAMBA)) {
  console.error(`\n  ${SAMBA} is missing — run \`node scripts/fetch-test-assets.mjs\` first.\n`);
  process.exit(1);
}
const sambaBytes = readFileSync(SAMBA).toString("base64");
const SAMBA_UNMERGED = "165960";
const SAMBA_MERGED = "35440";

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
      /** The merge toggle: not offered, or offered and on or off. */
      const toggleState = () => {
        if (document.getElementById("merge-toggle")?.hidden) return "absent";
        const box = /** @type {HTMLInputElement} */ (document.getElementById("merge-vertices"));
        return box.checked ? "on" : "off";
      };
      return {
        state: document.getElementById("hud")?.dataset.state ?? "",
        asset: text("asset"),
        encoding: text("encoding"),
        vertices: text("vertices"),
        bakeTime: text("bake-time"),
        capacity: text("capacity"),
        message: text("message"),
        // The merge: its readout, and the toggle — whether it is offered and how it is set.
        merged: !document.getElementById("merged")?.hidden,
        unmerged: text("unmerged"),
        toggle: toggleState(),
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
        Number(opened.capacity) > 0 &&
        !opened.merged &&
        opened.toggle === "absent",
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

    const samba = await drop([{ path: "Samba Dancing.fbx", base64: sambaBytes }]);
    check(
      "a dropped .fbx bakes merged by default, counted before and after",
      samba.state === "ready" &&
        samba.asset === "Samba Dancing.fbx" &&
        samba.toggle === "on" &&
        samba.merged &&
        samba.unmerged === SAMBA_UNMERGED &&
        samba.vertices === SAMBA_MERGED,
      JSON.stringify(samba),
    );

    const unmerged = await answered(() => page.click("#merge-vertices"));
    check(
      "turning the merge off rebakes the FBX as FBXLoader built it",
      unmerged.state === "ready" &&
        unmerged.asset === "Samba Dancing.fbx" &&
        unmerged.toggle === "off" &&
        !unmerged.merged &&
        unmerged.vertices === SAMBA_UNMERGED,
      JSON.stringify(unmerged),
    );

    const back = await drop([{ path: "Soldier.glb", base64: soldierBytes }]);
    check(
      "a .glb after it offers no merge",
      back.state === "ready" && back.vertices === SOLDIER_VERTICES && !back.merged && back.toggle === "absent",
      JSON.stringify(back),
    );
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
