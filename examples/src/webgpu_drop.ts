// Try your own model, on WebGPU: bake the glTF or FBX you bring, and take the bake home.
//
// The page opens on Soldier, baked and running as a crowd. Drop your own asset
// anywhere on it — a .glb, a .gltf with its .bin and textures (as files or as
// their folder), or an .fbx — or pick it from the panel, and it is baked with
// `bakeVATInWorker`, so the crowd on screen keeps running meanwhile, and put
// on screen as a crowd of its own. The readouts are read off the bake: the
// encoding `'auto'` chose (and why it fell back, if it did), the vertices, the
// time it took, the texture and its size, the clips.
//
// Then take it: download the bake as a baked file, which `loadVAT` reads back
// with no bake at all — written in the page by `three-vat/write`, and sent
// nowhere — or copy the code that reproduces it on your own page.
//
// A drop replaces the crowd only when its bake succeeds: a file the page does
// not take is refused by name, and a loader or baker that throws puts its own
// message on the page while the crowd already there stays.
//
// The same program as webgl_drop.ts, but for the decode (ADR-0011):
// `three/webgpu` for the renderer, `three-vat/tsl` for the crowd, a TSL
// uniform for its clock, and an awaited `init()` before the device is read.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bakeVATInWorker, type VAT, type VATCrowd, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import {
  createAssetReader,
  droppedFiles,
  mergeAssetVertices,
  pickedFiles,
  type DroppedAsset,
  type PageFile,
} from "./asset-file.js";
import {
  BAKE_DEFAULTS,
  bakedFileName,
  clipChoices,
  defaultChoices,
  playbackOf,
  resolveDrop,
  snippetOf,
  spiralCell,
  type AssetFormat,
  type ClipChoice,
  type DropChoices,
  type SnippetSource,
} from "./drop.js";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { formatBakeTime, formatBytes, formatClipCount, formatClipDuration, formatDimensions, vatFacts } from "./vat-facts.js";
import source from "./webgpu_drop.ts?raw";

const MAX_COUNT = 400;
const HEIGHT = 1.8; // every asset is shown at a person's height, whatever units it came in

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.append(renderer.domElement);
// Before anything reads the device: there is none until `init()`.
await renderer.init();
// With no WebGPU, the renderer runs this same TSL on its WebGL 2 backend.
// Said, read off the backend, so nobody mistakes one for the other.
if ((renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend) {
  badge("no WebGPU here: TSL on the WebGL 2 backend");
}

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.studio);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 14, 26);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -20;
key.shadow.camera.right = key.shadow.camera.top = 20;
key.shadow.camera.far = 80;
key.shadow.bias = -0.0005;
key.shadow.radius = 3; // soft edges, as the studio wants them
scene.add(key);

scene.add(createFloor(camera.position.distanceTo(controls.target)));

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- bake
// Always in a worker: a visitor's asset may take seconds to bake.
const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
const maxTextureSize = getMaxTextureSize(renderer);
const parseAsset = createAssetReader(renderer);
const time: VATTimeUniform = uniform(0);

/** What plays where there is no clip to play: the first frame, held. */
const HELD = { startFrame: 0, frames: 1, fps: 1 };

/** A crowd of this bake, on a square spiral, scaled to a person's height. */
function buildCrowd(vat: VAT): VATCrowd {
  const instances: VATInstance[] = Array.from(
    { length: MAX_COUNT },
    (_, i) => playbackOf(i, vat.clips) ?? { clip: HELD, startTime: 0, speed: 0 },
  );
  const crowd = createVATMesh(vat, instances, { time, maxTextureSize });
  const size = vat.bounds.getSize(new THREE.Vector3());
  const scale = HEIGHT / Math.max(size.y, 1e-6);
  const pitch = Math.max(size.x, size.z, size.y * 0.3) * scale * 1.4;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < MAX_COUNT; i++) {
    const { x, z } = spiralCell(i);
    crowd.mesh.setMatrixAt(i, matrix.makeScale(scale, scale, scale).setPosition(x * pitch, 0, z * pitch));
  }
  crowd.mesh.count = count;
  crowd.mesh.castShadow = true;
  crowd.mesh.receiveShadow = true;
  crowd.mesh.frustumCulled = false; // the crowd spreads far past the bake's own bounds
  return crowd;
}

/** Everything a replaced crowd held on the GPU. */
function dispose(vat: VAT, { mesh, playback }: VATCrowd) {
  for (const material of mesh.material as THREE.Material[]) material.dispose();
  mesh.dispose();
  playback.texture.dispose();
  vat.geometry.dispose();
  if (vat.encoding === "rig") vat.rigTexture.dispose();
  else {
    vat.positionTexture.dispose();
    vat.normalTexture?.dispose();
  }
}

// ---------------------------------------------------------------- page text
const hud = document.getElementById("hud")!;
const show = {
  asset: readout("asset"),
  encoding: readout("encoding"),
  vertices: readout("vertices"),
  bakeTime: readout("bake-time"),
  dimensions: readout("dimensions"),
  bytes: readout("bytes"),
  clipCount: readout("clip-count"),
  unmerged: readout("unmerged"),
  fallback: readout("fallback-reason"),
  message: readout("message"),
  warnings: readout("warnings"),
  download: readout("download-status"),
};

/** Where the page is: baking, showing a crowd, or saying why a drop did not take. */
function say(state: "baking" | "ready" | "refused" | "failed", message: string, warnings?: readonly string[]) {
  hud.dataset.state = state;
  show.message(message);
  if (warnings) show.warnings(warnings.join("\n"));
}

// ---------------------------------------------------------------- what is shown
/** A drop the page has read: what a rebake loads again without asking for it. */
interface Source {
  name: string;
  bytes: ArrayBuffer;
  format: AssetFormat;
  resources?: ReadonlyMap<string, PageFile | null>;
  warnings: readonly string[];
  /** The Soldier the page opens on, rather than a model the visitor brought. */
  opening?: true;
}

/** The crowd on screen, and everything it was made from. */
let shown: {
  vat: VAT;
  crowd: VATCrowd;
  source: Source;
  choices: DropChoices;
  encoding: Encoding;
  clips: ClipChoice[];
  checked: boolean[];
  readImages: DroppedAsset["readImages"];
} | null = null;

type Encoding = "auto" | "rig" | "delta";
let count = 100;
let encoding: Encoding = BAKE_DEFAULTS.encoding as Encoding;
let busy = false;
let downloading = false;

// ---------------------------------------------------------------- panel
const panel = createPanel();
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const folderInput = document.getElementById("folder-input") as HTMLInputElement;
// The zone on the page is a picker too: click it to browse.
const dropZone = document.getElementById("drop-zone") as HTMLButtonElement;
dropZone.addEventListener("click", () => fileInput.click());
const pickers = [
  panel.button("choose files", () => fileInput.click()),
  panel.button("choose a folder", () => folderInput.click()),
];
panel.slider("count", { min: 1, max: MAX_COUNT, value: count }, (value) => {
  count = value;
  if (shown) shown.crowd.mesh.count = count;
});
const encodingSelect = panel.select(
  "encoding",
  [
    ["auto", "auto"],
    ["rig", "rig"],
    ["delta", "vertex"],
  ],
  encoding,
  (value) => {
    encoding = value;
    rebake();
  },
);
// FBX only: FBXLoader builds no index, so the page welds the vertices before
// the bake — the baker never changes geometry uninvited.
const mergeToggle = panel.toggle("mergeVertices", true, (on) => {
  if (shown) void bake(shown.source, { ...shown.choices, mergeVertices: on }, shown.checked);
});
mergeToggle.hidden = true; // until an FBX is shown
const clipGroup = panel.group("clips");
const downloadButton = panel.button("download the bake", () => void download());
downloadButton.querySelector("button")!.disabled = true; // until there is a bake
panel.button("code for this bake", () => {
  snippetPanel.hidden = !snippetPanel.hidden;
});
panel.source({ code: source, path: "examples/src/webgpu_drop.ts" });

/** Lock what starts a bake while one runs. */
function lock(locked: boolean) {
  dropZone.disabled = locked;
  for (const control of [...pickers, encodingSelect, mergeToggle, clipGroup.element]) {
    for (const input of control.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")) {
      input.disabled = locked;
    }
  }
}

/** The panel as the crowd on screen was baked: after a new asset, or a bake that failed. */
function syncPanel() {
  if (!shown) return;
  encoding = shown.encoding;
  encodingSelect.querySelector("select")!.value = encoding;
  mergeToggle.hidden = shown.choices.mergeVertices === undefined;
  mergeToggle.querySelector("input")!.checked = shown.choices.mergeVertices ?? false;
  clipGroup.clear();
  shown.clips.forEach((clip, i) => {
    const label = clip.reason ? `${clip.name} (${clip.reason})` : clip.name;
    clipGroup.toggle(label, shown!.checked[i]!, (on) => {
      const checked = [...shown!.checked];
      checked[i] = on;
      void bake(shown!.source, shown!.choices, checked);
    });
  });
}

// ---------------------------------------------------------------- bake it
/**
 * Load, bake and show one asset — or say why not, and keep what is on screen.
 * `checked` is which of its clips to bake; a new asset starts from every clip
 * that animates.
 */
async function bake(source: Source, choices: DropChoices, checked?: boolean[]) {
  if (busy) return;
  busy = true;
  lock(true);
  say("baking", `baking ${source.name}…`, source.warnings);
  try {
    const asset = await loading(() => parseAsset(source.bytes, source.format, source.resources));
    // The page's side of the bake, never the baker's.
    const unmerged = choices.mergeVertices ? mergeAssetVertices(asset.root) : null;
    const clips =
      source === shown?.source
        ? shown.clips
        : clipChoices(asset.clips.map((c) => ({ name: c.name, duration: c.duration, trackCount: c.tracks.length })));
    const baking = checked ?? clips.map((clip) => clip.checked);
    const { vat, ms } = await forging(async () => {
      const started = performance.now();
      const vat = await bakeVATInWorker(
        worker,
        asset.root,
        asset.clips.filter((_, i) => baking[i]),
        { maxTextureSize, encoding },
      );
      return { vat, ms: performance.now() - started };
    });

    const crowd = buildCrowd(vat);
    if (shown) {
      scene.remove(shown.crowd.mesh);
      dispose(shown.vat, shown.crowd);
    }
    scene.add(crowd.mesh);
    shown = { vat, crowd, source, choices, encoding, clips, checked: baking, readImages: asset.readImages };

    // Every figure read off the bake itself.
    const facts = vatFacts(vat);
    show.asset(source.name);
    show.encoding(vat.encoding === "rig" ? "rig" : "vertex");
    show.vertices(vat.vertexCount);
    document.getElementById("merged")!.hidden = unmerged === null;
    show.unmerged(unmerged ?? "—");
    show.bakeTime(formatBakeTime(ms));
    show.dimensions(formatDimensions(facts));
    show.bytes(formatBytes(facts.bytes));
    document.getElementById("fallback")!.hidden = facts.fallback === null;
    show.fallback(facts.fallback ?? "—");
    show.clipCount(formatClipCount(facts));
    document.getElementById("clip-rows")!.replaceChildren(
      ...facts.clips.map(({ name, duration, frames }) => {
        const row = document.createElement("li");
        row.append(Object.assign(document.createElement("span"), { textContent: name }));
        row.append(` ${formatClipDuration(duration)} · ${frames} frames`);
        return row;
      }),
    );
    show.download("");
    showSnippet();
    // The card makes way for the visitor's own model: a pill, out of its way.
    if (!source.opening) dropZone.dataset.size = "pill";
    say("ready", "");
  } catch (error) {
    say("failed", `${source.name} did not bake — ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    busy = false;
    syncPanel();
    lock(false);
    downloadButton.querySelector("button")!.disabled = shown === null || downloading;
  }
}

/** Keep the crowd, bake it again with the panel as it now stands. */
function rebake() {
  if (shown) void bake(shown.source, shown.choices, shown.checked);
}

/** A drop or a pick: resolve it, refuse it by name, or bake it with its format's defaults. */
async function take(files: Promise<PageFile[]> | PageFile[]) {
  if (busy) return;
  busy = true; // claimed before the folder walk, so a second drop meanwhile is ignored
  let source: Source;
  try {
    const resolution = await resolveDrop(await files);
    if (!resolution.ok) {
      say("refused", `refused — ${resolution.refusal}`, []);
      return;
    }
    const { entry, format, resources, warnings } = resolution;
    source = { name: entry.path, bytes: await entry.file.arrayBuffer(), format, resources, warnings };
  } catch (error) {
    // A folder that would not walk, or a file that would not read.
    say("failed", `the drop could not be read — ${error instanceof Error ? error.message : String(error)}`, []);
    return;
  } finally {
    busy = false;
  }
  await bake(source, defaultChoices(source.format));
}

// The whole page is the drop target, the zone included: `dragging` lays the
// overlay over it. Only a drag that leaves the window takes it away — one that
// crosses from element to element inside it leaves each with somewhere to go.
addEventListener("dragover", (event) => {
  event.preventDefault();
  document.body.classList.add("dragging");
});
addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("dragging");
});
addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("dragging");
  void take(droppedFiles(event.dataTransfer));
});
for (const input of [fileInput, folderInput]) {
  input.addEventListener("change", () => {
    void take(pickedFiles(input.files));
    input.value = ""; // so picking the same file again is a change
  });
}

// ---------------------------------------------------------------- take it home
/** The bake on screen as a baked file, written here and saved under the asset's name. */
async function download() {
  if (!shown) return;
  const { vat, source, readImages } = shown; // the bake as it stood at the click
  const button = downloadButton.querySelector("button")!;
  button.disabled = downloading = true;
  show.download("writing…");
  try {
    // Fetched only now: most visits never download.
    const { writeBakedFile } = await import("three-vat/write");
    const bytes = await writeBakedFile(vat, { images: await readImages() });
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/gltf-binary" }));
    Object.assign(document.createElement("a"), { href: url, download: bakedFileName(source.name) }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000); // a browser may still be reading it
    show.download(`saved ${bakedFileName(source.name)}, ${formatBytes(bytes.byteLength)}`);
  } catch (error) {
    // A texture a baked file cannot carry is refused by name; the crowd stays.
    show.download(`not written — ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    downloading = false;
    button.disabled = busy; // a bake that started meanwhile re-enables it as it finishes
  }
}

// The code that reproduces the crowd on screen, baking the asset or loading
// the downloaded file — rewritten by every bake, so it always says what is shown.
const snippetPanel = document.getElementById("snippet")!;
const snippetFrom = document.getElementById("snippet-from") as HTMLSelectElement;
const snippetCode = document.getElementById("snippet-code")!;
const copyButton = document.getElementById("copy") as HTMLButtonElement;

function showSnippet() {
  if (!shown) return;
  const { source, choices, clips, checked } = shown;
  snippetCode.textContent = snippetOf({
    asset: source.name,
    format: source.format,
    choices,
    bake: { ...BAKE_DEFAULTS, encoding: shown.encoding },
    clips: clips.map((clip, i) => ({ name: clip.name, checked: checked[i]! })),
    renderer: "webgpu",
    from: snippetFrom.value as SnippetSource,
  });
}
snippetFrom.addEventListener("change", showSnippet);
snippetPanel.querySelector(".ui-source-close")!.addEventListener("click", () => (snippetPanel.hidden = true));
copyButton.addEventListener("click", () => {
  const flash = (text: string) => {
    copyButton.textContent = text;
    setTimeout(() => (copyButton.textContent = "copy"), 1500);
  };
  navigator.clipboard.writeText(snippetCode.textContent ?? "").then(
    () => flash("copied"),
    () => flash("select it to copy"),
  );
});

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
});

// Soldier, through the same door a visitor's file takes.
await bake(
  { name: "Soldier.glb", bytes: await loading(async () => (await fetch("Soldier.glb")).arrayBuffer()), format: "gltf", warnings: [], opening: true },
  defaultChoices("gltf"),
);
