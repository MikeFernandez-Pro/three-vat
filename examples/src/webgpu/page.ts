// three-vat on WebGPU: a crowd of robots, one mesh, one VAT, many instances —
// each picking its own clip, phase and playback rate. The animation runs
// entirely on the GPU (zero per-frame CPU); only the walk/run transform is
// updated on the CPU each frame, and idle instances cost nothing at all.
//
// The VAT is the middle section, and it is deliberately short: bake, build,
// drive the clock. Everything above it is the room (webgpu/stage.ts) and
// everything below it is the panel (webgpu/gui.ts).
//
// Hold this file next to webgl_crowd.ts. Nothing shared forces the resemblance
// (ADR-0011): the VAT section reads the same on both paths because
// `createVATMesh` genuinely has one signature, and the differences that remain
// — `three/webgpu` for the renderer, `three-vat/tsl` for the decode, an awaited
// stage, no depth material to dispose, `drawCalls` instead of `calls` — are the
// renderers', not the library's.
//
// Loaded by webgpu_crowd.ts only once WebGPU is known to work, so a browser
// without it never fetches the node-material bundle.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import Stats from "stats-gl";
import { bakeVAT } from "three-vat";
import type { VATClip } from "three-vat";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { crowdScale, loadRobot } from "../assets.js";
import { BANDS, CLEARANCE, MAX_COUNT, layoutCrowd, positionAt, type Robot } from "../crowd.js";
import { createDemoParams } from "../params.js";
import { createTexturePanel } from "../texture-panel.js";
import { vatFacts } from "../vat-facts.js";
import { createDemoGUI } from "./gui.js";
import { createStage } from "./stage.js";

const params = createDemoParams();
// Awaited, unlike the WebGL stage: `getMaxTextureSize` on the next line reads
// the WebGPU device's real limit, and there is no device before `init()`.
const stage = await createStage(params);

// ---------------------------------------------------------------- bake
// RobotExpressive is a hierarchy of 14 rigid, node-animated parts, not a single
// SkinnedMesh — see ADR-0008. `bakeVAT` merges the subtree and bakes where each
// vertex ended up, so the source of the deformation never matters.
const robot = await loadRobot();
const vat = bakeVAT(robot.root, robot.clips, {
  fps: 30,
  // The only renderer-shaped input to the bake: this GPU's real ceiling.
  maxTextureSize: getMaxTextureSize(stage.renderer),
});
const { scale, footprint } = crowdScale(vat.bounds);

// ---------------------------------------------------------------- crowd
// The full crowd, laid out once. The count slider does not rebuild anything: it
// moves `mesh.count`, and `layoutCrowd` guarantees the first N robots of the
// full layout *are* the crowd at count N — same rings, same clips, nothing
// shuffled. That is what makes the slider honest. A rebuild per step would
// re-clone the geometry and recompile the node materials, and the draw-call
// readout the demo is built around would be measuring the rebuild, not the
// crowd.
const robots: Robot<VATClip>[] = layoutCrowd(vat.clips, MAX_COUNT, footprint * CLEARANCE);
// One clock for the page: every VAT mesh a scene adds should read the same
// time, so the crowd stays one crowd. On this path the clock is a TSL uniform —
// a node the graph samples and a `{ value }` the loop writes, which is what
// makes the line at the bottom of this file the same line the WebGL page writes.
const vatTime: VATTimeUniform = uniform(0);

// The whole VAT wiring, on this path: the bake's geometry, the crowd's
// playback texture written, and one node material per source
// material (never merged — ADR-0008, so 3 draw calls, not 3 per robot).
// Shadows need no depth material here: `positionNode` feeds the depth pass
// too, which is the one asymmetry `createVATMesh` absorbs. Placing the
// instances stays ours: only we know the layout.
const mesh: THREE.InstancedMesh = createVATMesh(vat, robots, { time: vatTime }).mesh;
mesh.castShadow = params.shadows;
mesh.receiveShadow = params.shadows;
mesh.frustumCulled = false; // instances are placed by per-frame matrices
stage.setCrowd(mesh);

/**
 * Draw the first `count` robots. The other instances stay resident and unread.
 *
 * This owns `params.count`: lil-gui happens to write it before calling here,
 * but the assignment stays so the function is correct called from anywhere.
 */
function setCount(count: number) {
  params.count = count;
  mesh.count = count;
  place(time);
  updateInfo();
}

// ---------------------------------------------------------------- placement
let time = 0;
const up = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const pos = new THREE.Vector3();
const m = new THREE.Matrix4();

// Only the ground transform is CPU work. The animation itself never touches the
// CPU, at any instance count — that is the whole claim.
//
// The angle is derived from absolute time rather than accumulated per frame, so
// robots on a ring stay *exactly* in formation however long the demo runs;
// accumulating `+= dt * omega` would let rounding drift them into each other.
function place(time: number) {
  for (let i = 0; i < params.count; i++) {
    const r = robots[i]!;
    const a = r.angle0 + r.omega * time;
    // The same call the non-overlap test asserts against, so the formula that
    // is proven and the formula that is drawn cannot drift apart.
    const { x, z } = positionAt(r, time);
    pos.set(x, 0, z);
    // Movers face along the tangent of travel; idlers keep a fixed heading.
    const facing = r.omega === 0 ? r.heading : -a + (r.omega > 0 ? 0 : Math.PI);
    q.setFromAxisAngle(up, facing);
    s.setScalar(scale);
    mesh.setMatrixAt(i, m.compose(pos, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- HUD
// Two readouts, on screen at rest, and the argument is the relationship between
// them: the count climbs by two orders of magnitude while the draw calls sit
// still (ADR-0012). Both are what this page's own feature is evidenced by, and
// nothing else is here — what the texture weighs is the Soldier pages' evidence,
// not this page's (ADR-0020). Every figure is derived from the bake or measured
// from the renderer — nothing here is a number typed in.
const hudEl = document.getElementById("hud")!;
const infoEl = document.getElementById("info")!;
const drawCountEl = document.getElementById("draw-count")!;
const drawsNoteEl = document.getElementById("draws-note")!;

const facts = vatFacts(vat);
// Stated per material rather than as a share of the total, because the crowd is
// drawn once more in the shadow pass: "one per material" is true of every pass
// it appears in, at any count, which is the claim. The total above it is
// whatever the frame really cost.
drawsNoteEl.textContent = `the crowd is one draw call per material — ${facts.drawCalls} of them — never one per robot`;

function updateInfo() {
  const byClip = new Map<string, number>();
  for (let i = 0; i < params.count; i++) {
    const name = robots[i]!.clip.name;
    byClip.set(name, (byClip.get(name) ?? 0) + 1);
  }
  const mix = BANDS.filter((b) => byClip.get(b.clip))
    .map((b) => `${byClip.get(b.clip)} ${b.label}`)
    .join(" · ");
  const robotWord = params.count === 1 ? "robot" : "robots";
  infoEl.textContent = `${params.count} ${robotWord} — ${mix} — one mesh, one VAT, zero per-frame CPU animation`;
}

setCount(params.count); // lay the crowd out before the first render

// ---------------------------------------------------------------- panels
const texturePanel = createTexturePanel([
  { name: "RobotExpressive", vat, instances: () => robots.slice(0, params.count) },
]);
document.body.append(texturePanel.root);

function showTexturePanel(visible: boolean) {
  texturePanel.root.style.display = visible ? "flex" : "none";
}
showTexturePanel(params.showTexturePanel);

// The engineering overlay. Built either way — a reader who turns it on wants it
// on the frame they asked, not after a reload — but hidden until they do.
const stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);
// Bottom centre: the left column is the HUD and its panel, the right edge is
// the texture panel, and the overlay should sit in neither when it is on.
stats.dom.style.cssText = "position:fixed;bottom:0;left:50%;transform:translateX(-50%)";
await stats.init(stage.renderer);

function showStats(visible: boolean) {
  stats.dom.style.display = visible ? "block" : "none";
}
showStats(params.showStats);

createDemoGUI(params, stage, { setCount, showTexturePanel, showStats }, hudEl);

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
stage.renderer.setAnimationLoop(() => {
  stats.begin();
  const dt = clock.getDelta();
  if (params.animate) {
    time += dt;
    place(time);
  }
  vatTime.value = time; // the one line that drives every instance's animation
  if (params.showTexturePanel) texturePanel.update(time);
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  // Measured, not asserted: this is the renderer's own count for the frame just
  // drawn, crowd and ground and shadow pass together. It is the number the
  // reader is invited to watch refuse to move. `render.drawCalls` where WebGL
  // counts `render.calls`: both are this frame's count, under different names.
  drawCountEl.textContent = `${stage.renderer.info.render.drawCalls}`;
  stats.end();
  stats.update();
});
