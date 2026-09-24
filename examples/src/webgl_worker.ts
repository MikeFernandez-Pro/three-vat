// three-vat's worker example, on WebGL (ADR-0026): the same bake, run in a Web
// Worker or on the main thread, while a crowd walks. The bake is Soldier's
// vertex encoding at 60 fps — the slow one, on purpose — and the HUD sets the
// two runs side by side: how long each bake took, and the longest frame the
// page drew while it ran. On the main thread that frame is the whole bake, and
// the crowd freezes for it; in a worker the crowd never stops.
//
// Hold this file next to webgpu/worker.ts: the sections are the same, and the
// VAT section is one call — `bakeVATInWorker` where `bakeVAT` would be, with
// the worker as its first argument.
import * as THREE from "three";
import { bakeVAT, bakeVATInWorker } from "three-vat";
import type { DeltaVAT, VATClip, VATClock } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { SOLDIER_CLIP_NAMES, SOLDIER_YAW, crowdScale, loadSoldier } from "./assets.js";
import { CLEARANCE, MAX_COUNT, layoutCrowd, positionAt, type Robot } from "./crowd.js";
import { BAKE_THREAD_CHOICES, BAKE_THREAD_NAMES, createWorkerParams, type BakeThread } from "./params.js";
import { createStallMeter } from "./stall.js";
import { formatBakeTime } from "./vat-facts.js";
import { createFrameStats } from "./frame-stats.js";
import { createDemoGUI } from "./webgl/gui.js";
import { createStage } from "./webgl/stage.js";

const params = createWorkerParams();
const stage = createStage(params);
const soldier = await loadSoldier();

// ---------------------------------------------------------------- bake
// The worker is two lines (src/bake.worker.ts). The page's side is the one
// call below; everything else here is measuring it.
const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
const options = { fps: 60, maxTextureSize: getMaxTextureSize(stage.renderer) };

/** What one run of the bake cost: its wall-clock time, and the longest frame the page drew meanwhile. */
interface Run {
  ms: number;
  longestFrame: number;
}

const runs: Partial<Record<BakeThread, Run>> = {};
/** Where a bake is running now, or `null` between bakes. */
let baking: BakeThread | null = null;
/** Why the last bake was refused, when it was. */
let refused: string | null = null;
const meter = createStallMeter();

/** Wait until the page has painted what it holds now — a bake on this thread would otherwise hide its own "baking…" line. */
const painted = () => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

async function bake(thread: BakeThread): Promise<DeltaVAT | null> {
  baking = thread;
  refused = null;
  updateVat();
  await painted();

  meter.start();
  const started = performance.now();
  let vat: DeltaVAT | null = null;
  try {
    vat =
      thread === "worker"
        ? await bakeVATInWorker(worker, soldier.root, soldier.clips, options)
        : bakeVAT(soldier.root, soldier.clips, options);
  } catch (error) {
    // 7 434 vertices is a wider row than some GPUs take; the refusal is the
    // page's to show rather than throw.
    refused = error instanceof Error ? error.message : String(error);
  }
  const ms = performance.now() - started;
  const longestFrame = await meter.stop();
  if (vat) runs[thread] = { ms, longestFrame };

  baking = null;
  updateVat();
  return vat;
}

// ---------------------------------------------------------------- crowd
// Built from the bake at load, which runs in the worker while the loop below
// already draws. Later bakes are measured and let go: what the page argues is
// where a bake ran, and the crowd on screen is what shows it.
let mesh: THREE.InstancedMesh | null = null;
let soldiers: Robot<VATClip>[] = [];
let scale = 1;
const vatTime: VATClock = { value: 0 };

function buildCrowd(vat: DeltaVAT) {
  const fit = crowdScale(vat.bounds);
  scale = fit.scale;
  soldiers = layoutCrowd(vat.clips, MAX_COUNT, fit.footprint * CLEARANCE, undefined, SOLDIER_CLIP_NAMES);
  mesh = createVATMesh(vat, soldiers, { time: vatTime }).mesh;
  mesh.castShadow = params.shadows;
  mesh.receiveShadow = params.shadows;
  mesh.frustumCulled = false; // instances are placed by per-frame matrices
  stage.setCrowd(mesh);
  setCount(params.count);
}

function setCount(count: number) {
  params.count = count;
  if (!mesh) return;
  mesh.count = count;
  place(time);
}

// ---------------------------------------------------------------- placement
let time = 0;
const up = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const pos = new THREE.Vector3();
const m = new THREE.Matrix4();

function place(time: number) {
  if (!mesh) return;
  for (let i = 0; i < params.count; i++) {
    const r = soldiers[i]!;
    const a = r.angle0 + r.omega * time;
    const { x, z } = positionAt(r, time);
    pos.set(x, 0, z);
    const facing = (r.omega === 0 ? r.heading : -a + (r.omega > 0 ? 0 : Math.PI)) + SOLDIER_YAW;
    q.setFromAxisAngle(up, facing);
    s.setScalar(scale);
    mesh.setMatrixAt(i, m.compose(pos, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- HUD
// Both runs, side by side, and nothing else: the bake times agree, and the
// longest frame is the whole difference (ADR-0020).
const vatEl = document.getElementById("vat")!;

function runLine(thread: BakeThread): string {
  const run = runs[thread];
  return run
    ? `${BAKE_THREAD_NAMES[thread]}: baked in ${formatBakeTime(run.ms)}, longest frame ${formatBakeTime(run.longestFrame)}`
    : `${BAKE_THREAD_NAMES[thread]}: not run yet`;
}

function updateVat() {
  const status = baking
    ? `baking ${BAKE_THREAD_NAMES[baking]}…`
    : refused
      ? `refused — ${refused}`
      : "pick where, then bake again";
  vatEl.replaceChildren(
    `Soldier, vertex VAT at ${options.fps} fps · ${status}`,
    document.createElement("br"),
    `${runLine("worker")} · ${runLine("main")}`,
  );
}

// ---------------------------------------------------------------- loop
// Started before the first bake, so the load bake is measured like any other.
const frame = await createFrameStats(stage.renderer);
const timer = new THREE.Timer();
stage.renderer.setAnimationLoop(() => {
  frame.begin();
  meter.frame(performance.now());
  timer.update();
  const dt = timer.getDelta();
  if (params.animate) {
    time += dt;
    place(time);
  }
  vatTime.value = time;
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  frame.end();
});

const loaded = await bake("worker");
if (loaded) buildCrowd(loaded);

createDemoGUI(params, stage, { setCount }, {
  title: "bake in a worker",
  countName: "soldiers",
  texturePanel: false,
  addControls(gui) {
    // The example's control (ADR-0019): where the next bake runs, and the
    // button that runs it.
    gui.add(params, "bakeOn", BAKE_THREAD_CHOICES).name("bake on");
    const actions = {
      bake() {
        if (!baking) void bake(params.bakeOn);
      },
    };
    gui.add(actions, "bake").name("bake again");
  },
});
