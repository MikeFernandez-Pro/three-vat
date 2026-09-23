// three-vat's first example, on WebGL (ADR-0019): Soldier — a 49-bone skinned
// character — as a crowd, baked twice at load, once per encoding (ADR-0018).
// The count slider is the demo's; the encoding toggle is this page's own, and
// the HUD's texture dimensions, memory and bake time change with it. Every
// figure is measured off the live bake or the renderer, never stated.
//
// Hold this file next to webgl_crowd.ts: the sections are the demo's, and the
// VAT section differs by one bake option. Everything the two crowds share —
// layout, placement, the loop — is written once here; what differs between
// them is which mesh is visible.
import * as THREE from "three";
import Stats from "three/addons/libs/stats.module.js";
import { bakeVAT } from "three-vat";
import type { DeltaVAT, RigVAT, VAT, VATClock } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { SOLDIER_CLIP_NAMES, SOLDIER_YAW, crowdScale, loadSoldier } from "./assets.js";
import { CLEARANCE, MAX_COUNT, layoutCrowd, positionAt } from "./crowd.js";
import { ENCODING_CHOICES, ENCODING_NAMES, createSoldierParams, type Encoding } from "./params.js";
import { createTexturePanel } from "./texture-panel.js";
import { formatBakeTime, formatBytes, formatDimensions, vatFacts } from "./vat-facts.js";
import { createDemoGUI } from "./webgl/gui.js";
import { createStage } from "./webgl/stage.js";

const params = createSoldierParams();
const stage = createStage(params);

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
// moves an instance in time.
const vatTime: VATClock = { value: 0 };

/** One encoding's crowd: its bake, its mesh and its texture panel. */
interface Crowd {
  encoding: Encoding;
  bake: Bake<VAT>;
  mesh: THREE.InstancedMesh;
  panel: ReturnType<typeof createTexturePanel>;
}

// The whole VAT wiring, on this path, once per encoding: the bake's geometry,
// the crowd's playback texture written, one patched material per source
// material and the depth material for shadows. `createVATMesh` takes either
// member of the `VAT` union; which decode it patches in is the bake's.
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
// One readout, and the argument is what the toggle does to it: the texture's
// width changes unit — vertices to slots — and its memory drops by two orders
// of magnitude. Both bake times stay on screen, because the second one was the
// wait at load.
//
// Only that readout, because only that readout is this page's evidence
// (ADR-0020): the draw-call counter does not move when the toggle does, so it
// is the crowd pages' figure and it is not carried here for completeness.
const hudEl = document.getElementById("hud")!;
const vatEl = document.getElementById("vat")!;

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
const stats = new Stats();
document.body.appendChild(stats.dom);
stats.dom.style.cssText = "position:fixed;bottom:0;left:50%;transform:translateX(-50%)";

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
// `Timer`, not the deprecated `Clock`: three says so on every load now that the
// Inspector shows its console (ADR-0024). Updated once per frame, read after.
const timer = new THREE.Timer();
stage.renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  const dt = timer.getDelta();
  if (params.animate) {
    time += dt;
    place(time);
  }
  vatTime.value = time; // the one line that drives every instance's animation
  if (params.showTexturePanel) live.panel.update(time);
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  stats.end();
});
