// three-vat's drop example, on WebGPU: bake the asset you bring. The page opens
// on Soldier, baked in a worker and running as a crowd; a visitor drops their
// own .glb or .fbx onto it, or picks it with the button, and the page bakes
// that through `bakeVATInWorker` and replaces the crowd with theirs. The HUD
// says what the bake produced — the encoding it chose, how long it took, how
// many vertices — and the count slider runs to the playback texture's capacity.
// An FBX is welded with `mergeVertices` first, on this side of the bake, and
// the HUD counts it before and after; the toggle beside it rebakes it unmerged.
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
import { mergeAssetVertices, parseAsset } from "../asset-file.js";
import { SOLDIER_URL, crowdScale } from "../assets.js";
import { CLEARANCE } from "../crowd.js";
import { defaultChoices, playbackOf, resolveDrop, spiralCell, type AssetFormat, type DropChoices } from "../drop.js";
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

/** Where the page is: baking, showing a crowd, or telling the visitor why their drop did not take. */
function say(state: "baking" | "ready" | "refused" | "failed", message: string) {
  hud.dataset.state = state;
  readout("message").textContent = message;
}

let busy = false;
const choose = document.getElementById("choose") as HTMLButtonElement;
const mergeToggle = document.getElementById("merge-vertices") as HTMLInputElement;

/** A file the page has read: what a toggle rebakes without asking the visitor for it again. */
interface Source {
  name: string;
  bytes: ArrayBuffer;
  format: AssetFormat;
}

/** What the crowd on screen was baked from, and with which choices. */
let shown: { source: Source; choices: DropChoices } | null = null;

/**
 * The toggle as the crowd on screen was baked: shown only where its format
 * offers the merge (FBX), checked where the merge ran. Set after every bake,
 * so a rebake that fails puts the toggle back beside the crowd still standing.
 */
function showChoices(choices: DropChoices | undefined) {
  document.getElementById("merge-toggle")!.hidden = choices?.mergeVertices === undefined;
  mergeToggle.checked = choices?.mergeVertices ?? false;
}

/** Load, bake and show one asset — or say why not, and keep what is on screen. */
async function bake(source: Source, choices: DropChoices) {
  const { name, bytes, format } = source;
  busy = true;
  choose.disabled = true;
  mergeToggle.disabled = true;
  say("baking", `baking ${name}…`);
  try {
    const asset = await parseAsset(bytes, format);
    // The page's side of the bake, never the baker's (ADR-0031).
    const unmergedCount = choices.mergeVertices ? mergeAssetVertices(asset.root) : null;
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
    readout("merged").hidden = unmergedCount === null;
    readout("unmerged").textContent = unmergedCount === null ? "—" : `${unmergedCount}`;
    readout("bake-time").textContent = formatBakeTime(ms);
    shown = { source, choices };
    say("ready", "");
  } catch (error) {
    say("failed", `${name} did not bake — ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    busy = false;
    choose.disabled = false;
    mergeToggle.disabled = false;
    showChoices(shown?.choices);
  }
}

/** A drop or a pick: resolve it, refuse it by name, or bake it with its format's defaults. */
async function take(files: File[]) {
  if (busy) return;
  const resolution = resolveDrop(files.map((file) => ({ path: file.name, file })));
  if (!resolution.ok) {
    say("refused", `refused — ${resolution.refusal}`);
    return;
  }
  const { entry, format } = resolution;
  await bake({ name: entry.path, bytes: await entry.file.arrayBuffer(), format }, defaultChoices(format));
}

// Turning the merge off rebakes the same bytes unmerged, and the vertex
// readout shows what FBXLoader's non-indexed geometry costs.
mergeToggle.addEventListener("change", () => {
  if (!shown || busy) return;
  void bake(shown.source, { ...shown.choices, mergeVertices: mergeToggle.checked });
});

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
  void take([...(event.dataTransfer?.files ?? [])]);
});
const input = document.getElementById("file-input") as HTMLInputElement;
choose.addEventListener("click", () => input.click());
input.addEventListener("change", () => {
  void take([...(input.files ?? [])]);
  input.value = ""; // so picking the same file again is a change
});

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
await bake(
  { name: SOLDIER_URL, bytes: await (await fetch(SOLDIER_URL)).arrayBuffer(), format: "gltf" },
  defaultChoices("gltf"),
);
