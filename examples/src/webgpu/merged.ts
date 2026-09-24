// three-vat's merged-materials example, on WebGPU (ADR-0028): the robot crowd,
// baked twice at load — once as it ships, once with `mergeFlatMaterials: true`
// — and a toggle between the two. RobotExpressive's three materials differ only
// in their flat colour, so the merge makes them one material with the colours
// in the vertices, and the crowd draws once where it drew three times. The
// draw-call count is measured off the renderer, frame by frame.
//
// Hold this file next to webgl_merged.ts. Nothing shared forces the
// resemblance (ADR-0011): the differences that remain — `three/webgpu` for the
// renderer, `three-vat/tsl` for the decode, an awaited stage, the Inspector —
// are the renderers', not the library's.
//
// Loaded by webgpu_merged.ts only once WebGPU is known to work, so a browser
// without it never fetches the node-material bundle.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { bakeVAT } from "three-vat";
import type { VAT, VATClip } from "three-vat";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { crowdScale, loadRobot } from "../assets.js";
import { CLEARANCE, MAX_COUNT, layoutCrowd, positionAt, type Robot } from "../crowd.js";
import { createMergedParams } from "../params.js";
import { createFrameStats } from "../frame-stats.js";
import { createDemoGUI } from "./gui.js";
import { createInspector } from "./inspector.js";
import { createStage } from "./stage.js";

const params = createMergedParams();
// Awaited, unlike the WebGL stage: `getMaxTextureSize` below reads the WebGPU
// device's real limit, and there is no device before `init()`.
const stage = await createStage(params);

// ---------------------------------------------------------------- bake
// The same subtree, the same clips, twice: the option is the whole difference.
const robot = await loadRobot();
const options = { fps: 30, maxTextureSize: getMaxTextureSize(stage.renderer) };
const bakes: Record<"merged" | "plain", VAT> = {
  merged: bakeVAT(robot.root, robot.clips, { ...options, mergeFlatMaterials: true }),
  plain: bakeVAT(robot.root, robot.clips, options),
};
const { scale, footprint } = crowdScale(bakes.plain.bounds);

// ---------------------------------------------------------------- crowd
// One layout drives both crowds: the two bakes share a clip table row for row,
// so an instance means the same thing in either, and the toggle swaps a mesh
// rather than a crowd.
const robots: Robot<VATClip>[] = layoutCrowd(bakes.plain.clips, MAX_COUNT, footprint * CLEARANCE);
const vatTime: VATTimeUniform = uniform(0);

function buildCrowd(vat: VAT): THREE.InstancedMesh {
  const mesh: THREE.InstancedMesh = createVATMesh(vat, robots, { time: vatTime }).mesh;
  mesh.castShadow = params.shadows;
  mesh.receiveShadow = params.shadows;
  mesh.frustumCulled = false; // instances are placed by per-frame matrices
  mesh.visible = false; // until the toggle says so
  stage.setCrowd(mesh);
  return mesh;
}

const crowds = { merged: buildCrowd(bakes.merged), plain: buildCrowd(bakes.plain) };
let live = crowds.merged;

function setCount(count: number) {
  params.count = count;
  for (const mesh of Object.values(crowds)) mesh.count = count;
  place(time);
}

function setMerged(merged: boolean) {
  params.mergeFlatMaterials = merged;
  live = merged ? crowds.merged : crowds.plain;
  for (const mesh of Object.values(crowds)) mesh.visible = mesh === live;
  place(time); // the crowd that was hidden has not been placed since
  updateNote();
}

// ---------------------------------------------------------------- placement
let time = 0;
const up = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const pos = new THREE.Vector3();
const m = new THREE.Matrix4();

function place(time: number) {
  for (let i = 0; i < params.count; i++) {
    const r = robots[i]!;
    const a = r.angle0 + r.omega * time;
    const { x, z } = positionAt(r, time);
    pos.set(x, 0, z);
    const facing = r.omega === 0 ? r.heading : -a + (r.omega > 0 ? 0 : Math.PI);
    q.setFromAxisAngle(up, facing);
    s.setScalar(scale);
    live.setMatrixAt(i, m.compose(pos, q, s));
  }
  live.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- HUD
// The draw-call count, and what the crowd is drawn with: the one readout the
// toggle moves (ADR-0020). Both are measured — the count off the renderer, the
// materials off the bake.
const drawCountEl = document.getElementById("draw-count")!;
const drawsNoteEl = document.getElementById("draws-note")!;

function updateNote() {
  const vat = params.mergeFlatMaterials ? bakes.merged : bakes.plain;
  const n = vat.materials.length;
  drawsNoteEl.textContent = params.mergeFlatMaterials
    ? `merged: the crowd is ${n} material, ${bakes.plain.materials.length} flat colours in its vertices — one draw call per pass`
    : `as it ships: the crowd is ${n} materials, one draw call each per pass`;
}

setCount(params.count);
setMerged(params.mergeFlatMaterials);

const frame = await createFrameStats(stage.renderer);

const inspector = createInspector(stage.renderer);
createDemoGUI(params, stage, { setCount }, inspector, {
  title: "merged flat materials",
  countName: "robots",
  texturePanel: false,
  addControls(gui) {
    // The example's control (ADR-0019), directly under the count.
    gui
      .add(params, "mergeFlatMaterials")
      .name("merge flat materials")
      .onChange((v) => setMerged(v));
  },
});

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
stage.renderer.setAnimationLoop(() => {
  frame.begin();
  timer.update();
  const dt = timer.getDelta();
  if (params.animate) {
    time += dt;
    place(time);
  }
  vatTime.value = time;
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  drawCountEl.textContent = `${stage.renderer.info.render.drawCalls}`;
  frame.end();
});
