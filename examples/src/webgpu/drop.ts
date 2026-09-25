// three-vat's drop example, on WebGPU: bake the asset you bring. The page opens
// on Soldier, baked in a worker and running as a crowd; a visitor drops their
// own asset onto it — a .glb, or a .gltf with its .bin and textures, as
// files or as their folder — or picks it with the buttons, and the page bakes that
// through `bakeVATInWorker` and replaces the crowd with theirs. The HUD says
// what the bake produced — the encoding it chose, how long it took, how many
// vertices — and the count slider runs to the playback texture's capacity.
//
// A drop replaces the crowd only when its bake succeeds: a file the page does
// not take is refused by name, and a loader or baker that throws puts its own
// message on the HUD while the crowd and readouts already there stay.
//
// Hold this file next to webgl_drop.ts. Nothing shared forces the resemblance
// (ADR-0011): the differences that remain — `three/webgpu` for the renderer,
// `three-vat/tsl` for the decode, an awaited stage, a uniform for the clock,
// the Inspector — are the renderers', not the library's.
//
// Loaded by webgpu_drop.ts only once WebGPU is known to work, so a browser
// without it never fetches the node-material bundle.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { bakeVATInWorker } from "three-vat";
import type { VAT, VATCrowd, VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { createAssetReader, droppedFiles, pickedFiles, type PageFile } from "../asset-file.js";
import { SOLDIER_URL, crowdScale } from "../assets.js";
import { CLEARANCE } from "../crowd.js";
import { playbackOf, resolveDrop, spiralCell, type AssetFormat } from "../drop.js";
import { createFrameStats } from "../frame-stats.js";
import { createDropParams } from "../params.js";
import { formatBakeTime } from "../vat-facts.js";
import { createDemoGUI } from "./gui.js";
import { createInspector } from "./inspector.js";
import { createStage } from "./stage.js";

const params = createDropParams();
// Awaited, unlike the WebGL stage: `getMaxTextureSize` below reads the WebGPU
// device's real limit, and there is no device before `init()`.
const stage = await createStage(params);

// ---------------------------------------------------------------- bake
// Always in the worker (ADR-0026): a visitor's asset may take seconds to bake,
// and the crowd already on screen keeps running meanwhile.
const worker = new Worker(new URL("../bake.worker.ts", import.meta.url), { type: "module" });
const maxTextureSize = getMaxTextureSize(stage.renderer);
const parseAsset = createAssetReader(stage.renderer);

// ---------------------------------------------------------------- crowd
// The capacity is the GPU's, not a number picked here: the playback texture is
// one row per instance, so its ceiling is the texture ceiling (ADR-0022). The
// crowd reserves every row of it and the slider draws a prefix.
const capacity = maxTextureSize;
const vatTime: VATTimeUniform = uniform(0);
/** What plays where there is no clip to play: the first frame, held. */
const HELD = { startFrame: 0, frames: 1, fps: 1 };

let current: { vat: VAT; crowd: VATCrowd } | null = null;

/** Build a crowd of `capacity` instances of this bake, standing on a square spiral. */
function buildCrowd(vat: VAT): VATCrowd {
  const instances: VATInstance[] = Array.from(
    { length: capacity },
    (_, i) => playbackOf(i, vat.clips) ?? { clip: HELD, startTime: 0, speed: 0 },
  );
  const crowd = createVATMesh(vat, instances, { time: vatTime, maxTextureSize });
  const { mesh } = crowd;
  const { scale, footprint } = crowdScale(vat.bounds);
  const pitch = footprint * CLEARANCE;
  const m = new THREE.Matrix4();
  for (let i = 0; i < capacity; i++) {
    const { x, z } = spiralCell(i);
    mesh.setMatrixAt(i, m.makeScale(scale, scale, scale).setPosition(x * pitch, 0, z * pitch));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = params.count;
  mesh.castShadow = params.shadows;
  mesh.receiveShadow = params.shadows;
  mesh.frustumCulled = false; // the instances spread far past the bake's own bounds
  return crowd;
}

/** Everything a replaced crowd held on the GPU: its materials, its playback, and the bake under it. */
function dispose({ vat, crowd }: { vat: VAT; crowd: VATCrowd }) {
  const { mesh } = crowd;
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
  // No depth material to dispose: `positionNode` feeds the depth pass too.
  mesh.dispose();
  crowd.playback.texture.dispose();
  vat.geometry.dispose();
  if (vat.encoding === "rig") vat.rigTexture.dispose();
  else {
    vat.positionTexture.dispose();
    vat.normalTexture?.dispose();
  }
}

function setCount(count: number) {
  params.count = count;
  if (current) current.crowd.mesh.count = count;
}

// ---------------------------------------------------------------- HUD
// The bake's own figures and nothing else (ADR-0020). Written only when a bake
// succeeds, so after a failure they still describe the crowd on screen.
const hud = document.getElementById("hud")!;
const readout = (id: string) => document.getElementById(id)!;
readout("capacity").textContent = `${capacity}`;

/**
 * Where the page is: baking, showing a crowd, or telling the visitor why their
 * drop did not take. The warnings are the drop's own — a texture it lacks —
 * and stay beside whatever the bake came to.
 */
function say(state: "baking" | "ready" | "refused" | "failed", message: string, warnings?: readonly string[]) {
  hud.dataset.state = state;
  readout("message").textContent = message;
  if (warnings) readout("warnings").textContent = warnings.join("\n");
}

let busy = false;
// Two buttons, because a browser's file picker takes files or a folder and
// never both. The folder's files come in at their paths under it, as a
// dropped folder's do, and go through the same `take`.
const pickers = [
  ["choose", "file-input"],
  ["choose-folder", "folder-input"],
].map(([button, input]) => ({
  button: document.getElementById(button!) as HTMLButtonElement,
  input: document.getElementById(input!) as HTMLInputElement,
}));

/** Load, bake and show one asset — or say why not, and keep what is on screen. */
async function bake(
  name: string,
  bytes: ArrayBuffer,
  format: AssetFormat,
  resources?: ReadonlyMap<string, PageFile | null>,
  warnings: readonly string[] = [],
) {
  busy = true;
  for (const { button } of pickers) button.disabled = true;
  say("baking", `baking ${name}…`, warnings);
  try {
    const asset = await parseAsset(bytes, format, resources);
    const started = performance.now();
    const vat = await bakeVATInWorker(worker, asset.root, asset.clips, { maxTextureSize });
    const ms = performance.now() - started;
    const next = { vat, crowd: buildCrowd(vat) };

    if (current) {
      stage.removeCrowd(current.crowd.mesh);
      dispose(current);
    }
    current = next;
    stage.setCrowd(next.crowd.mesh);

    readout("asset").textContent = name;
    readout("encoding").textContent = vat.encoding === "rig" ? "rig" : "vertex";
    readout("vertices").textContent = `${vat.vertexCount}`;
    readout("bake-time").textContent = formatBakeTime(ms);
    say("ready", "");
  } catch (error) {
    say("failed", `${name} did not bake — ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    busy = false;
    for (const { button } of pickers) button.disabled = false;
  }
}

/** A drop or a pick: resolve it, refuse it by name, or bake it with the files it names. */
async function take(files: Promise<PageFile[]> | PageFile[]) {
  if (busy) return;
  // Claimed before the folder walk and the .gltf read, not only by the bake:
  // a second drop landing meanwhile would otherwise pass the check too.
  busy = true;
  try {
    const resolution = await resolveDrop(await files);
    if (!resolution.ok) {
      say("refused", `refused — ${resolution.refusal}`, []);
      return;
    }
    const { entry, format, resources, warnings } = resolution;
    await bake(entry.path, await entry.file.arrayBuffer(), format, resources, warnings);
  } finally {
    busy = false;
  }
}

// ---------------------------------------------------------------- drop
// The whole page is the target. Read in the browser and nowhere else.
addEventListener("dragover", (event) => {
  event.preventDefault();
  document.body.classList.add("dragging");
});
addEventListener("dragleave", () => document.body.classList.remove("dragging"));
addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("dragging");
  void take(droppedFiles(event.dataTransfer));
});
for (const { button, input } of pickers) {
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    void take(pickedFiles(input.files));
    input.value = ""; // so picking the same file again is a change
  });
}

// ---------------------------------------------------------------- loop
const frame = await createFrameStats(stage.renderer);
const timer = new THREE.Timer();
stage.renderer.setAnimationLoop(() => {
  frame.begin();
  timer.update();
  if (params.animate) vatTime.value += timer.getDelta();
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  frame.end();
});

const inspector = createInspector(stage.renderer);
createDemoGUI(params, stage, { setCount }, inspector, {
  title: "bake your own asset",
  countName: "instances",
  countRange: { min: 1, max: capacity, step: 1 },
  texturePanel: false,
});

// Soldier, through the same door a visitor's file takes: its bytes, the same
// parse, the same worker bake.
await bake(SOLDIER_URL, await (await fetch(SOLDIER_URL)).arrayBuffer(), "gltf");
