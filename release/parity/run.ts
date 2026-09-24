// The cross-path pixel-diff release gate (#14), in the browser.
//
// One bake per encoding — the demo's robot under the vertex encoding, Soldier
// under the rig encoding (ADR-0018) — each rendered through both decode paths
// at the same camera, the same lights and the same animation time, and the
// frames compared. Everything else
// in this repository's suite verifies *structure* — attributes present, graph
// builds, materials counted — and none of it can catch a decode that is subtly
// wrong on one path only, which is precisely the risk parity introduces.
//
// It lives here and not in CI because it needs a real GPU on both backends:
// headless WebGPU is not a dependable CI target, and a gate that flakes is a
// gate that gets disabled (ADR-0004's cost, paid honestly). So it is a manual
// release gate — `node release/parity/check.mjs`, on a developer machine,
// before publishing.
//
// This file is the assembly only. The decisions are elsewhere and are tested in
// CI without a GPU: `compare.ts` measures two frames, `verdict.ts` says what a
// set of frames means, `scene.ts` holds every number both paths render.
import type { AnimationClip, Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT } from "three-vat";
// The demo's asset loader and its WebGPU probe, reached across the package
// boundary on purpose: the gate proves the two paths agree on the model a
// reader has actually seen, and the reach runs one way only — nothing in the
// demo imports this folder (ADR-0011 amendment).
import { loadRobot } from "../../examples/src/assets.js";
import { detectWebGPU } from "../../examples/src/webgpu/support.js";
import type { PathFrames } from "./compare.js";
import { FPS, FRAME, RIG_CASE } from "./scene.js";
import { renderWebGLFrames } from "./webgl-frame.js";
import { renderTSLFrames } from "./tsl-frame.js";
import { describeBakeMismatch } from "./stage.js";
import { judge, type ParityCheck } from "./verdict.js";

/**
 * The page sits one directory below the server root; the demo's `public/` is
 * served at that root (vite.config.ts), so the model is one level up.
 */
const GATE_MODEL_URL = "../RobotExpressive.glb";

/**
 * Where the `node release/parity/check.mjs` driver listens. Opening the page by
 * hand just skips it.
 */
const RESULT_URL = "/__parity/result";

const statusEl = document.getElementById("status")!;
const checksEl = document.getElementById("checks")!;
const framesEl = document.getElementById("frames")!;

async function run(): Promise<{ pass: boolean; checks: ParityCheck[]; frame: typeof FRAME; userAgent: string }> {
  const report = (pass: boolean, checks: ParityCheck[]) => ({ pass, checks, frame: FRAME, userAgent: navigator.userAgent });

  // Without WebGPU there is no second path, and `WebGPURenderer` would quietly
  // fall back to its WebGL backend — which would compare the GLSL decode with
  // itself and pass. A gate that can pass while testing nothing is worse than
  // no gate, so this is a failure, not a skip.
  const support = await detectWebGPU(globalThis);
  if (!support.ok) {
    return report(false, [{ name: "this machine can run both paths", pass: false, detail: support.reason }]);
  }

  status("Loading and baking…");
  const robot = await loadRobot(GATE_MODEL_URL);
  // The rig case's asset is fetched on demand and gitignored, so its absence is
  // the one load failure with a known fix — named here rather than left to the
  // stack trace the catch below would report.
  const soldier = await loadRigCase().catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  if (soldier instanceof Error) {
    return report(false, [
      {
        name: "the rig case's asset is present",
        pass: false,
        detail: `could not load ${RIG_CASE.model}: ${soldier.message}. Run \`node scripts/fetch-test-assets.mjs\` (docs/test-assets.md) and try again.`,
      },
    ]);
  }
  // One bake *each*, and then proof that they are the same bake.
  //
  // Sharing one VAT would be the obvious thing — it is what makes "one bake,
  // two paths" true by construction — but a VAT owns two `DataTexture`s, and
  // this page holds two live renderers. Handing one texture to a
  // `WebGLRenderer` and then to a `WebGPURenderer` asks a question about three's
  // per-renderer texture bookkeeping that this gate has no business asking, and
  // which it would answer as a decode divergence. `bakeVAT` is deterministic CPU
  // math, so baking twice costs nothing and the guarantee comes back as evidence
  // (see `describeBakeMismatch`) rather than as an assumption.
  //
  // Neither bake reads a GPU's maximum texture size: that would be a second
  // renderer-shaped input. Both take the baker's default, and a texture too
  // large for this machine surfaces as a blank frame, which the verdict names.
  // The robot case is the vertex encoding's, named since the default became the
  // rig where the asset allows it (ADR-0027); the Soldier case below is the rig's.
  const bake = () => bakeVAT(robot.root, robot.clips, { fps: FPS, encoding: "delta" });
  const webglVat = bake();
  const tslVat = bake();

  const mismatch = describeBakeMismatch(webglVat, tslVat);
  const sameBake: ParityCheck = {
    name: "both paths were handed the same bake",
    pass: mismatch === null,
    detail: mismatch ?? `identical texels: ${webglVat.vertexCount} vertices x ${webglVat.totalFrames} frames, both layers`,
  };

  // The rig case, baked the same way twice for the same reason — and doubly
  // so: a rig geometry drawn by a `WebGPURenderer` and then a `WebGLRenderer`
  // fails the WebGL draw on its `Uint16` skin index (#52's finding), so the two
  // paths must not even share the geometry.
  const bakeRig = () => bakeVAT(soldier.root, soldier.clips, { fps: FPS, encoding: RIG_CASE.encoding });
  const webglRig = bakeRig();
  const tslRig = bakeRig();

  const rigMismatch = describeBakeMismatch(webglRig, tslRig);
  const sameRigBake: ParityCheck = {
    name: "both paths were handed the same rig bake",
    pass: rigMismatch === null,
    detail: rigMismatch ?? `identical texels: ${webglRig.slotCount} slots x ${webglRig.totalFrames} frames`,
  };

  status("Rendering the GLSL path…");
  const webgl = renderWebGLFrames(webglVat, webglRig);
  status("Rendering the TSL path…");
  const tsl = await renderTSLFrames(tslVat, tslRig);

  const verdict = judge({ webgl, tsl }, FRAME);
  show(webgl, tsl);
  return report(sameBake.pass && sameRigBake.pass && verdict.pass, [sameBake, sameRigBake, ...verdict.checks]);
}

/**
 * The rig case's asset (`RIG_CASE`), loaded the way the demo loads the robot,
 * its clips resolved by name in the table's order.
 *
 * The gate's own loader rather than the demo's: the demo has no Soldier yet —
 * the example that brings one is #55 — and the robot's loader is reached
 * across the package boundary only because the point there is the model a
 * reader has seen. This asset is here for a different reason (the encoding
 * was measured and pinned on it), so it is loaded where it is used.
 */
async function loadRigCase(): Promise<{ root: Object3D; clips: AnimationClip[] }> {
  const gltf = await new GLTFLoader().loadAsync(RIG_CASE.model);
  gltf.scene.updateMatrixWorld(true);
  const clips = RIG_CASE.clips.map((name) => {
    const clip = gltf.animations.find((c) => c.name === name);
    if (!clip) {
      throw new Error(`${RIG_CASE.model} has no clip "${name}" — it has ${gltf.animations.map((c) => `"${c.name}"`).join(", ")}`);
    }
    return clip;
  });
  return { root: gltf.scene, clips };
}

function status(text: string): void {
  statusEl.textContent = text;
}

/** The compared frames, side by side per case, because a human looking at a failure wants to see it. */
function show(webgl: PathFrames, tsl: PathFrames): void {
  for (const [label, pixels] of [
    ["GLSL decode (WebGLRenderer) — vertex encoding", webgl.clean],
    ["TSL decode (WebGPURenderer) — vertex encoding", tsl.clean],
    ["GLSL decode (WebGLRenderer) — rig encoding", webgl.rig.clean],
    ["TSL decode (WebGPURenderer) — rig encoding", tsl.rig.clean],
  ] as const) {
    const canvas = document.createElement("canvas");
    canvas.width = FRAME.width;
    canvas.height = FRAME.height;
    canvas
      .getContext("2d")!
      .putImageData(new ImageData(new Uint8ClampedArray(pixels), FRAME.width, FRAME.height), 0, 0);

    const figure = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = label;
    figure.append(canvas, caption);
    framesEl.append(figure);
  }
}

function render(result: { pass: boolean; checks: ParityCheck[] }): void {
  statusEl.textContent = result.pass ? "PASS — the two decode paths agree" : "FAIL — see below";
  statusEl.className = result.pass ? "pass" : "fail";
  for (const check of result.checks) {
    const row = document.createElement("li");
    row.className = check.pass ? "pass" : "fail";
    // Built rather than interpolated: `detail` carries an exception's stack when
    // the gate fails early, and that is text, not markup.
    const verdict = document.createElement("b");
    verdict.textContent = check.pass ? "PASS" : "FAIL";
    const detail = document.createElement("span");
    detail.textContent = check.detail;
    row.append(verdict, ` ${check.name}`, detail);
    checksEl.append(row);
  }
}

const result = await run().catch((error: unknown) => ({
  pass: false,
  checks: [{ name: "the gate ran at all", pass: false, detail: error instanceof Error ? (error.stack ?? error.message) : String(error) }],
  frame: FRAME,
  userAgent: navigator.userAgent,
}));

render(result);

// Hand the verdict to whoever started this. `node release/parity/check.mjs` is
// listening on that endpoint and turns it into an exit code; a developer who
// just opened the page has nothing there, and the failure to post is not a
// failure of the gate.
void fetch(RESULT_URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(result),
}).catch(() => {});
