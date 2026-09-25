// three-vat's drop example, on WebGL: bake the asset you bring. The page opens
// on Soldier, baked in a worker and running as a crowd; a visitor drops their
// own .glb or .fbx onto it, or picks it with the button, and the page bakes
// that through `bakeVATInWorker` and replaces the crowd with theirs. The HUD
// says what the bake produced — the encoding it chose, how long it took, how
// many vertices — and the count slider runs to the playback texture's capacity.
// An FBX is welded with `mergeVertices` first, on this side of the bake, and
// the HUD counts it before and after; the toggle beside it rebakes it unmerged.
// The panel steers the bake itself — which clips, the fps, the encoding, the
// flat-material merge — and every change rebakes; the HUD reads the result off
// the VAT: the texture's size and bytes, why an `'auto'` bake fell back, and
// the clip table.
//
// A drop replaces the crowd only when its bake succeeds: a file the page does
// not take is refused by name, and a loader or baker that throws puts its own
// message on the HUD while the crowd and readouts already there stay.
//
// Hold this file next to webgpu/drop.ts: the sections are the same, and the
// differences are the renderers' (ADR-0011).
import * as THREE from "three";
import { bakeVATInWorker } from "three-vat";
import type { VAT, VATClock, VATCrowd, VATInstance } from "three-vat";
import type { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { mergeAssetVertices, parseAsset } from "./asset-file.js";
import { SOLDIER_URL, crowdScale } from "./assets.js";
import { CLEARANCE } from "./crowd.js";
import {
  clipChoices,
  defaultChoices,
  playbackOf,
  resolveDrop,
  spiralCell,
  type AssetFormat,
  type ClipChoice,
  type DropChoices,
} from "./drop.js";
import { createFrameStats } from "./frame-stats.js";
import { BAKE_ENCODING_CHOICES, createDropParams, type DropParams } from "./params.js";
import {
  formatBakeTime,
  formatBytes,
  formatClipCount,
  formatClipDuration,
  formatDimensions,
  vatFacts,
  type MeasurableClip,
} from "./vat-facts.js";
import { createDemoGUI } from "./webgl/gui.js";
import { createStage } from "./webgl/stage.js";

const params = createDropParams();
const stage = createStage(params);

// ---------------------------------------------------------------- bake
// Always in the worker (ADR-0026): a visitor's asset may take seconds to bake,
// and the crowd already on screen keeps running meanwhile.
const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
const maxTextureSize = getMaxTextureSize(stage.renderer);

// ---------------------------------------------------------------- crowd
// The capacity is the GPU's, not a number picked here: the playback texture is
// one row per instance, so its ceiling is the texture ceiling (ADR-0022). The
// crowd reserves every row of it and the slider draws a prefix.
const capacity = maxTextureSize;
const vatTime: VATClock = { value: 0 };
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
  mesh.customDepthMaterial?.dispose();
  mesh.customDistanceMaterial?.dispose();
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

/** The clip table: one row per baked clip, under a caption that counts them. */
function showClipTable(clips: readonly MeasurableClip[], caption: string) {
  readout("clip-count").textContent = caption;
  readout("clip-rows").replaceChildren(
    ...clips.map(({ name, duration, frames }) => {
      const row = document.createElement("tr");
      for (const text of [name, formatClipDuration(duration), `${frames} frames`]) {
        row.append(Object.assign(document.createElement("td"), { textContent: text }));
      }
      return row;
    }),
  );
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

/** The panel's say in a bake: what `bakeVATInWorker` is handed beside the GPU's ceiling. */
type BakePanel = Pick<DropParams, "fps" | "encoding" | "mergeFlatMaterials">;

/**
 * What the crowd on screen was baked from, and with which choices: the
 * format's, the panel's, and which of its clips were checked.
 */
let shown: { source: Source; choices: DropChoices; panel: BakePanel; checked: boolean[] } | null = null;

/**
 * The shown asset's clips: what the drop module said of each, and the boxes
 * the panel shows for them. The boxes edit `checked`, and a rebake reads it.
 */
let clips: { choices: ClipChoice[]; checked: boolean[] } = { choices: [], checked: [] };

/** The panel's bake folder, and the clip folder inside it, rebuilt for each new asset. */
let bakeFolder: GUI | null = null;
let clipFolder: GUI | null = null;

/** Each control, redrawn from the value it edits. */
const syncPanel = () => bakeFolder?.controllersRecursive().forEach((controller) => controller.updateDisplay());

/** A box per clip of a newly shown asset, each checked as the bake that showed it was. */
function showClipBoxes(choices: ClipChoice[], checked: boolean[]) {
  clips = { choices, checked };
  clipFolder?.destroy();
  clipFolder = bakeFolder?.addFolder("clips") ?? null;
  choices.forEach((clip, i) => {
    clipFolder
      ?.add(checked, i)
      .name(clip.reason ? `${clip.name} (${clip.reason})` : clip.name)
      .onChange(rebake);
  });
}

/** The panel as it stands, taken when a bake starts. */
const panelNow = (): BakePanel => ({
  fps: params.fps,
  encoding: params.encoding,
  mergeFlatMaterials: params.mergeFlatMaterials,
});

/** Whether the panel asks for a bake other than the one on screen. */
function panelDiffers(): boolean {
  if (!shown) return false;
  const { panel, checked } = shown;
  const now = panelNow();
  return (
    now.fps !== panel.fps ||
    now.encoding !== panel.encoding ||
    now.mergeFlatMaterials !== panel.mergeFlatMaterials ||
    clips.checked.some((box, i) => box !== checked[i])
  );
}

/**
 * A change made while a bake runs is not lost: it waits, and the bake after
 * this one reads the panel as it then stands.
 */
let pending = false;

/** Bake the asset on screen again, if the panel now asks for something else. */
function rebake() {
  if (!shown) return;
  if (busy) pending = true;
  else if (panelDiffers()) void bake(shown.source, shown.choices);
}

/**
 * The panel back as the crowd on screen was baked, after a bake that failed:
 * its options, and its clips' boxes. The HUD says why it failed, and the panel
 * describes what still stands.
 */
function restorePanel() {
  if (!shown) return;
  Object.assign(params, shown.panel);
  clips.checked.splice(0, clips.checked.length, ...shown.checked);
  syncPanel();
}

/**
 * The toggle as the crowd on screen was baked: shown only where its format
 * offers the merge (FBX), checked where the merge ran. Set after every bake,
 * so a rebake that fails puts the toggle back beside the crowd still standing.
 */
function showChoices(choices: DropChoices | undefined) {
  document.getElementById("merge-toggle")!.hidden = choices?.mergeVertices === undefined;
  mergeToggle.checked = choices?.mergeVertices ?? false;
}

/**
 * Load, bake and show one asset — or say why not, and keep what is on screen.
 * The asset on screen bakes the clips its boxes check; a new one starts from
 * the drop module's answer, every clip but the empty ones. The panel's fps,
 * encoding and merge carry over to a new asset: they are the visitor's, and
 * the one they force on it is the one they asked to see it under.
 */
async function bake(source: Source, choices: DropChoices) {
  const { name, bytes, format } = source;
  const newAsset = source !== shown?.source;
  busy = true;
  choose.disabled = true;
  mergeToggle.disabled = true;
  say("baking", `baking ${name}…`);
  try {
    const asset = await parseAsset(bytes, format);
    // The page's side of the bake, never the baker's (ADR-0031).
    const unmergedCount = choices.mergeVertices ? mergeAssetVertices(asset.root) : null;
    const judged = newAsset
      ? clipChoices(asset.clips.map((c) => ({ name: c.name, duration: c.duration, trackCount: c.tracks.length })))
      : clips.choices;
    // Snapshots: a box ticked while this bake runs is the next bake's.
    const checked = newAsset ? judged.map((c) => c.checked) : [...clips.checked];
    const panel = panelNow();
    const started = performance.now();
    const vat = await bakeVATInWorker(
      worker,
      asset.root,
      asset.clips.filter((_, i) => checked[i]),
      { maxTextureSize, ...panel },
    );
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
    const facts = vatFacts(vat);
    readout("dimensions").textContent = formatDimensions(facts);
    readout("bytes").textContent = formatBytes(facts.bytes);
    readout("fallback").hidden = facts.fallback === null;
    readout("fallback-reason").textContent = facts.fallback ?? "—";
    showClipTable(facts.clips, formatClipCount(facts));
    if (newAsset) showClipBoxes(judged, [...checked]);
    shown = { source, choices, panel, checked };
    say("ready", "");
  } catch (error) {
    say("failed", `${name} did not bake — ${error instanceof Error ? error.message : String(error)}`);
    restorePanel();
  } finally {
    busy = false;
    choose.disabled = false;
    mergeToggle.disabled = false;
    showChoices(shown?.choices);
    if (pending) {
      pending = false;
      rebake();
    }
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

createDemoGUI(params, stage, { setCount }, {
  title: "bake your own asset",
  countName: "instances",
  countRange: { min: 1, max: capacity, step: 1 },
  texturePanel: false,
  addControls(gui) {
    // The bake's own controls, directly under the count: each change rebakes
    // the asset on screen. The clip boxes are filled in by each new asset.
    bakeFolder = gui.addFolder("bake");
    // `onFinishChange`: a drag across the range is one rebake, not sixty.
    bakeFolder.add(params, "fps", 1, 60, 1).name("fps").onFinishChange(rebake);
    bakeFolder.add(params, "encoding", BAKE_ENCODING_CHOICES).name("encoding").onChange(rebake);
    bakeFolder.add(params, "mergeFlatMaterials").name("merge flat materials").onChange(rebake);
  },
});

// Soldier, through the same door a visitor's file takes: its bytes, the same
// parse, the same worker bake.
await bake(
  { name: SOLDIER_URL, bytes: await (await fetch(SOLDIER_URL)).arrayBuffer(), format: "gltf" },
  defaultChoices("gltf"),
);
