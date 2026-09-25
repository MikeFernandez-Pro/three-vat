// `node release/drop/check.mjs` — the drop pages' headed end-to-end check
// (#101), driven from a terminal so it can have an exit code.
//
// It serves the examples on localhost with their own vite config, opens each
// drop page in the Chrome this machine already has, and does what a visitor
// does: waits for Soldier to bake, drops a `.glb` on the page, picks one with
// the button, drops a file the page does not take and one that will not
// parse, drops Samba Dancing.fbx and turns its merge off, and drops Soldier
// once more. Then it steers the bake from the panel (#104): it forces the
// vertex encoding and puts it back, and on Samba it finds Mixamo's empty
// `Take 001` unchecked and unchecks the one clip left, which bakes nothing
// that animates. After each it reads the HUD. Every console line is captured and any
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
        // The bake's full readouts (#104): the texture, the fallback, the clip table.
        dimensions: text("dimensions"),
        bytes: text("bytes"),
        fellBack: !document.getElementById("fallback")?.hidden,
        clipCount: text("clip-count"),
        clipTable: [...document.querySelectorAll("#clip-rows tr")].map((row) => row.firstElementChild?.textContent ?? ""),
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
  /**
   * The panel's box for one clip, whichever panel draws it — lil-gui on WebGL,
   * the Inspector on WebGPU. Found as a visitor finds it, by the clip's name
   * beside it: the nearest checkbox whose row reads that name, outside the HUD.
   * Marked so a real click can reach it, and read as the box reads.
   */
  const clipBox = (clip) =>
    page.evaluate((clip) => {
      for (const marked of document.querySelectorAll("[data-check-box]")) marked.removeAttribute("data-check-box");
      for (const box of document.querySelectorAll('input[type="checkbox"]')) {
        // The panel's, not the HUD's: the HUD's clip table names the clip too.
        if (box.closest("#hud")) continue;
        // Nor a hidden one: the Inspector hides a replaced asset's clip folder.
        if ((box.closest("label") ?? box).getClientRects().length === 0) continue;
        let row = box.parentElement;
        for (let up = 0; row && up < 4; up++, row = row.parentElement) {
          if (row.querySelectorAll('input[type="checkbox"]').length > 1) break;
          if (row.textContent?.includes(clip)) {
            // Its label, which is what a visitor clicks: the Inspector draws its
            // own checkmark over an input it hides.
            (box.closest("label") ?? box).setAttribute("data-check-box", "");
            return { found: true, checked: /** @type {HTMLInputElement} */ (box).checked, label: row.textContent.trim() };
          }
        }
      }
      return { found: false, checked: false, label: "" };
    }, clip);
  /** The panel's encoding dropdown: the one select offering `auto`. */
  const chooseEncoding = (label) =>
    answered(async () => {
      await page.evaluate(() => {
        const select = [...document.querySelectorAll("select")].find((s) =>
          [...s.options].some((o) => o.textContent === "auto"),
        );
        select?.setAttribute("data-encoding", "");
      });
      await page.selectOption("[data-encoding]", { label });
    });

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
    check(
      "the HUD reads the texture, the slots and the clip table off the bake",
      /^\d+ slots × \d+ frames$/.test(opened.dimensions) &&
        /\d (KB|MB)$/.test(opened.bytes) &&
        !opened.fellBack &&
        opened.clipCount === `${opened.clipTable.length} clips` &&
        opened.clipTable.length > 1,
      JSON.stringify(opened),
    );

    const vertex = await chooseEncoding("vertex");
    check(
      "forcing the vertex encoding rebakes, and the readouts follow",
      vertex.state === "ready" &&
        vertex.encoding === "vertex" &&
        vertex.dimensions.startsWith(`${SOLDIER_VERTICES} verts × `) &&
        vertex.bytes !== opened.bytes &&
        !vertex.fellBack,
      JSON.stringify(vertex),
    );
    const auto = await chooseEncoding("auto");
    check(
      "back on 'auto', the rig takes Soldier again",
      auto.state === "ready" && auto.encoding === SOLDIER_ENCODING && auto.dimensions === opened.dimensions,
      JSON.stringify(auto),
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
    // Mixamo's `Take 001`: zero duration and no tracks, so the drop module
    // starts it unchecked, with the reason beside the box, and it is not baked.
    const take = await clipBox("Take 001");
    check(
      "Samba's empty Take 001 starts unchecked, with its reason, and is not baked",
      take.found && !take.checked && take.label.includes("empty") && !samba.clipTable.includes("Take 001"),
      JSON.stringify({ take, clipTable: samba.clipTable }),
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

    // Uncheck the one clip Samba bakes: a bake of no clips is still a bake.
    const [danced] = samba.clipTable;
    const box = await clipBox(danced);
    const still = await answered(() => page.click("[data-check-box]"));
    check(
      "unchecking every clip still bakes, and reads 0 clips: nothing animates",
      box.found && box.checked && still.state === "ready" && still.clipCount === "0 clips: nothing animates" &&
        still.clipTable.length === 0,
      JSON.stringify({ box, still }),
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
