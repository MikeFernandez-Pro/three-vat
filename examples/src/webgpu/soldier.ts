// three-vat's first example, on WebGPU (ADR-0019): Soldier — a 49-bone skinned
// character — as a crowd, baked twice at load, once per encoding (ADR-0018).
// The count slider is the demo's; the encoding toggle is this page's own, and
// the HUD's texture dimensions, memory and bake time change with it. Every
// figure is measured off the live bake or the renderer, never stated.
//
// Hold this file next to webgl_soldier.ts. Nothing shared forces the
// resemblance (ADR-0011): the VAT section reads the same on both paths because
// `createVATMesh` takes either member of the `VAT` union on either path, and
// the differences that remain — `three/webgpu` for the renderer, `three-vat/tsl`
// for the decode, an awaited stage, `drawCalls` instead of `calls` — are the
// renderers', not the library's.
//
// Loaded by webgpu_soldier.ts only once WebGPU is known to work, so a browser
// without it never fetches the node-material bundle.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import Stats from "stats-gl";
import { bakeVAT } from "three-vat";
import type { DeltaVAT, RigVAT, VAT } from "three-vat";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { SOLDIER_CLIP_NAMES, SOLDIER_YAW, crowdScale, loadSoldier } from "../assets.js";
import { BANDS, CLEARANCE, MAX_COUNT, layoutCrowd, positionAt } from "../crowd.js";
import { ENCODING_CHOICES, ENCODING_NAMES, createSoldierParams, type Encoding } from "../params.js";
import { createTexturePanel } from "../texture-panel.js";
import { formatBakeTime, formatBytes, formatDimensions, vatFacts } from "../vat-facts.js";
import { createDemoGUI } from "./gui.js";
import { createStage } from "./stage.js";

const params = createSoldierParams();
// Awaited, unlike the WebGL stage: `getMaxTextureSize` below reads the WebGPU
// device's real limit, and there is no device before `init()`.
const stage = await createStage(params);

// ---------------------------------------------------------------- bake
// Two bakes of one subtree: the posed rig per frame, then where every vertex
// ended up per frame. Same clips, same fps, so the two clip tables agree row
// for row, and an instance's playback means the same thing under either.
const soldier = await loadSoldier();
const maxTextureSize = getMaxTextureSize(stage.renderer);

/** One encoding's bake, and the wall-clock time it took. */
interface Bake<V extends VAT> {
  vat: V;
  ms: number;
}

function timed<V extends VAT>(bake: () => V): Bake<V> {
  const started = performance.now();
  const vat = bake();
  return { vat, ms: performance.now() - started };
}

/** A bake the baker refused, and what it said. */
interface Refused {
  refused: string;
}

const rig: Bake<RigVAT> = timed(() =>
  bakeVAT(soldier.root, soldier.clips, { fps: 30, maxTextureSize, encoding: "rig" }),
);
// The vertex bake can be refused where the rig's is not: 7 434 vertices is a
// wider row than some GPUs' `maxTextureSize`, and that ceiling is one of the
// things the rig encoding removes (ADR-0018). A refusal is shown on the HUD
// rather than thrown — on such a GPU it is the example's evidence.
const delta: Bake<DeltaVAT> | Refused = (() => {
  try {
    return timed(() => bakeVAT(soldier.root, soldier.clips, { fps: 30, maxTextureSize }));
  } catch (error) {
    return { refused: error instanceof Error ? error.message : String(error) };
  }
})();
const { scale, footprint } = crowdScale(rig.vat.bounds);

// ---------------------------------------------------------------- crowd
// The full crowd, laid out once, for both crowds: an instance's playback names
// its clip by its frame band, and the two bakes' clip tables agree row for row
// — same clips, same fps — so one layout drives both, soldier for soldier,
// and the count slider moves `mesh.count` on each. Nothing is rebuilt behind
// either control.
const soldiers = layoutCrowd(rig.vat.clips, MAX_COUNT, footprint * CLEARANCE, undefined, SOLDIER_CLIP_NAMES);
// One clock for the page, read by both crowds, so flipping the toggle never
// moves an instance in time. On this path the clock is a TSL uniform — a node
// the graph samples and a `{ value }` the loop writes.
const vatTime: VATTimeUniform = uniform(0);

/** One encoding's crowd: its bake, its mesh and its texture panel. */
interface Crowd {
  encoding: Encoding;
  bake: Bake<VAT>;
  mesh: THREE.InstancedMesh;
  panel: ReturnType<typeof createTexturePanel>;
}

// The whole VAT wiring, on this path, once per encoding: the bake's geometry,
// the crowd's playback texture written, and one node material per source
// material. Shadows need no depth material here: `positionNode` feeds the
// depth pass too. `createVATMesh` takes either member of the `VAT` union;
// which decode it builds is the bake's.
function buildCrowd(encoding: Encoding, bake: Bake<VAT>): Crowd {
  const mesh: THREE.InstancedMesh = createVATMesh(bake.vat, soldiers, { time: vatTime }).mesh;
  mesh.castShadow = params.shadows;
  mesh.receiveShadow = params.shadows;
  mesh.frustumCulled = false; // instances are placed by per-frame matrices
  mesh.visible = false; // until the toggle says so
  stage.setCrowd(mesh);

  const panel = createTexturePanel([
    { name: `Soldier · ${ENCODING_NAMES[encoding]} encoding`, vat: bake.vat, instances: () => soldiers.slice(0, params.count) },
  ]);
  panel.root.style.display = "none";
  document.body.append(panel.root);

  return { encoding, bake, mesh, panel };
}

const crowds: Partial<Record<Encoding, Crowd>> = { rig: buildCrowd("rig", rig) };
if ("vat" in delta) crowds.delta = buildCrowd("delta", delta);
/** The crowd on screen — the one the HUD measures. */
let live: Crowd = crowds.rig!;

/**
 * Draw the first `count` soldiers, of either crowd. The hidden crowd is kept
 * at the same count so the toggle swaps a crowd, not a crowd and a count.
 */
function setCount(count: number) {
  params.count = count;
  for (const crowd of Object.values(crowds)) crowd.mesh.count = count;
  place(time);
  updateInfo();
}

/** Show one encoding's crowd and measure it. The other stays resident, hidden. */
function setEncoding(encoding: Encoding) {
  const next = crowds[encoding];
  if (!next) return; // refused at the bake; the toggle is disabled then
  params.encoding = encoding;
  live = next;
  for (const crowd of Object.values(crowds)) crowd.mesh.visible = crowd === live;
  showTexturePanel(params.showTexturePanel);
  place(time); // the crowd that was hidden has not been placed since
  updateVat();
}

// ---------------------------------------------------------------- placement
let time = 0;
const up = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const pos = new THREE.Vector3();
const m = new THREE.Matrix4();

// Only the ground transform is CPU work, and only for the crowd on screen. The
// animation itself never touches the CPU, at any instance count, under either
// encoding — that is the whole claim.
function place(time: number) {
  const { mesh } = live;
  for (let i = 0; i < params.count; i++) {
    const r = soldiers[i]!;
    const a = r.angle0 + r.omega * time;
    const { x, z } = positionAt(r, time);
    pos.set(x, 0, z);
    // Movers face along the tangent of travel; idlers keep a fixed heading.
    // Soldier is authored facing the other way from the robot, hence the yaw.
    const facing = (r.omega === 0 ? r.heading : -a + (r.omega > 0 ? 0 : Math.PI)) + SOLDIER_YAW;
    q.setFromAxisAngle(up, facing);
    s.setScalar(scale);
    mesh.setMatrixAt(i, m.compose(pos, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- HUD
// The demo's readouts, and the argument is what the toggle does to them: the
// draw calls and the count hold, the texture's width changes unit — vertices
// to slots — and its memory drops by two orders of magnitude. Both bake times
// stay on screen, because the second one was the wait at load.
const hudEl = document.getElementById("hud")!;
const infoEl = document.getElementById("info")!;
const vatEl = document.getElementById("vat")!;
const drawCountEl = document.getElementById("draw-count")!;
const drawsNoteEl = document.getElementById("draws-note")!;

// The same under either encoding: a rig row changes what a vertex reads, not
// how many materials the character has.
drawsNoteEl.textContent = `the crowd is one draw call per material — ${vatFacts(rig.vat).drawCalls} of them — never one per soldier`;

/** The live VAT's figures, and both bakes' times. */
function updateVat() {
  const facts = vatFacts(live.bake.vat);
  const bakes =
    `baked at load: rig ${formatBakeTime(rig.ms)} · ` +
    ("vat" in delta ? `vertex ${formatBakeTime(delta.ms)}` : `vertex refused — ${delta.refused}`);
  vatEl.replaceChildren(
    `${ENCODING_NAMES[live.encoding]} VAT ${formatDimensions(facts)} · ${formatBytes(facts.bytes)} of GPU texture, at every count`,
    document.createElement("br"),
    bakes,
  );
}

function updateInfo() {
  const byClip = new Map<string, number>();
  for (let i = 0; i < params.count; i++) {
    const name = soldiers[i]!.clip.name;
    byClip.set(name, (byClip.get(name) ?? 0) + 1);
  }
  // The bands by the clip Soldier plays each one in.
  const mix = BANDS.filter((b) => byClip.get(SOLDIER_CLIP_NAMES[b.clip]))
    .map((b) => `${byClip.get(SOLDIER_CLIP_NAMES[b.clip])} ${b.label}`)
    .join(" · ");
  const word = params.count === 1 ? "soldier" : "soldiers";
  infoEl.textContent = `${params.count} ${word} — ${mix} — one mesh, one VAT, zero per-frame CPU animation`;
}

// ---------------------------------------------------------------- panels
/** The live crowd's texture panel, or none. The other crowd's stays hidden. */
function showTexturePanel(visible: boolean) {
  for (const crowd of Object.values(crowds)) {
    crowd.panel.root.style.display = visible && crowd === live ? "flex" : "none";
  }
}

setCount(params.count); // lay the crowd out before the first render
setEncoding(params.encoding); // and show the encoding the page opens on

// The engineering overlay. Built either way — a reader who turns it on wants it
// on the frame they asked, not after a reload — but hidden until they do.
const stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);
stats.dom.style.cssText = "position:fixed;bottom:0;left:50%;transform:translateX(-50%)";
await stats.init(stage.renderer);

function showStats(visible: boolean) {
  stats.dom.style.display = visible ? "block" : "none";
}
showStats(params.showStats);

createDemoGUI(params, stage, { setCount, showTexturePanel, showStats }, hudEl, {
  title: "soldier crowd",
  countName: "soldiers",
  addControls(gui) {
    // The example's control (ADR-0019), directly under the count: `onChange`
    // swaps the crowd on the spot, and the HUD line above it changes with it.
    const toggle = gui
      .add(params, "encoding", ENCODING_CHOICES)
      .name("encoding")
      .onChange((v: Encoding) => setEncoding(v));
    // One choice is no toggle: with the vertex bake refused, the reason is on
    // the HUD and the control says so by being inert.
    if (!("vat" in delta)) toggle.disable();
  },
});

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
  if (params.showTexturePanel) live.panel.update(time);
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  // Measured, not asserted: the renderer's own count for the frame just drawn,
  // with one crowd visible — the hidden one costs no call. `render.drawCalls`
  // where WebGL counts `render.calls`: both are this frame's count.
  drawCountEl.textContent = `${stage.renderer.info.render.drawCalls}`;
  stats.end();
  stats.update();
});
