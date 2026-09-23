// three-vat on WebGPU: a VAT crowd riding the **second carrier** — one
// `BatchedMesh`, one geometry, N instances — that spawns and dies while you
// watch.
//
// Two claims the library otherwise only writes down, made on screen. That a VAT
// crowd can ride a `BatchedMesh` at all: three's own per-instance frustum
// culling and depth sorting are left on, so the drawn slot is a permutation
// that changes every frame, and the pack is read by the instance's *logical*
// index through `batchIndirectIndex` (ADR-0016). And that such a crowd can
// spawn and die: the playback texture reserves its rows once, from a capacity,
// and they are filled and refilled as instances come and go (ADR-0022).
//
// The ground is the playback texture. Row `i` stands in cell `i` of a square
// field, so an instance that dies leaves a hole and the next spawn drops into
// it — which is `BatchedMesh.addInstance` reissuing the lowest freed id, seen
// from the outside. **Row recycling** is the hazard of this whole pattern: that
// reissued row still holds the dead instance's pack, and it is `setVATInstance`
// below, before the instance is ever drawn, that stops the new arrival playing a
// corpse's clip.
//
// Hold this file next to webgl_batched.ts. Nothing shared forces the
// resemblance (ADR-0011): the differences that remain — `three/webgpu` for the
// renderer, `three-vat/tsl` for the decode, an awaited stage, a `positionNode`
// where the other patches a material, no depth material to build, `drawCalls`
// instead of `calls`, and a batch folded into one draw by this page where the
// other's renderer folds it itself (collapse.ts) — are the renderers', not the
// library's.
//
// Loaded by webgpu_batched.ts only once WebGPU is known to work, so a browser
// without it never fetches the node-material bundle.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import Stats from "stats-gl";
import { bakeVAT, createVATPlaybackTexture, setVATInstance } from "three-vat";
import { getMaxTextureSize, vatNodes, type VATTimeUniform } from "three-vat/tsl";
import { crowdScale, loadRobot } from "../assets.js";
import { createBatchedParams } from "../params.js";
import { createRowLedger, ledgerKey } from "../row-ledger.js";
import {
  CAPACITY,
  SPACING,
  cellOf,
  churnTicks,
  clipOfSpawn,
  createRoster,
  populationLine,
  spawnLine,
  yawOf,
} from "../spawning.js";
import { collapseUniformBatches } from "./collapse.js";
import { createDemoGUI } from "./gui.js";
import { createStage } from "./stage.js";

const params = createBatchedParams();
// Awaited, unlike the WebGL stage: `getMaxTextureSize` on the next line reads
// the WebGPU device's real limit, and there is no device before `init()`.
const stage = await createStage(params);

// The one thing this page does to its renderer that the WebGL page does not
// have to: WebGPU has no multi-draw, so three draws a batch once per visible
// instance, and this folds a one-geometry batch back into one draw (#65,
// ADR-0023). It reaches into three's backend, which is why it is the page's and
// not the library's — and why it may decline, on a three it does not know, in
// which case the HUD below says so rather than showing a number that is not
// the crowd's.
const collapsed = collapseUniformBatches(stage.renderer);

// ---------------------------------------------------------------- bake
// The crowd pages' robot, baked once. Which asset it is does not matter to this page
// — what matters is that it is *one* geometry and one material, because a
// `BatchedMesh` takes a single material and has no geometry groups to split a
// multi-material bake across (docs/usage.md).
const robot = await loadRobot();
const vat = bakeVAT(robot.root, robot.clips, { fps: 30, maxTextureSize: getMaxTextureSize(stage.renderer) });
const { scale, footprint } = crowdScale(vat.bounds);
const pitch = footprint * SPACING;

// ---------------------------------------------------------------- crowd
// The playback texture is built from a **capacity** and not from a census: 256
// rows, none of them live. A level that starts empty needs no fake instance to
// get off the ground, and the rows are reserved here because a texture cannot
// grow in place later (ADR-0022).
const playback = createVATPlaybackTexture([], { capacity: CAPACITY });
const vatTime: VATTimeUniform = uniform(0);

// Cloned before the batch is built, because a `BatchedMesh` takes its material
// at construction — and given its decode after, because the decode needs the
// carrier it will draw on.
// `positionNode` as the cast says: a bake's materials are the glTF's, and the
// node renderer takes a `positionNode` on any of them — which is exactly what
// `createVATMesh` does on this path, one line further in.
const material = vat.materials[0]!.clone() as THREE.Material & { positionNode: unknown };
const crowd = new THREE.BatchedMesh(
  CAPACITY,
  vat.geometry.getAttribute("position").count,
  vat.geometry.getIndex()?.count ?? 0,
  material,
);
const geometryId = crowd.addGeometry(vat.geometry);

// The carrier, so the decode resolves the pack row through the logical index
// rather than through the drawn slot. `perObjectFrustumCulled` and
// `sortObjects` are left at three's defaults — both `true` — which is the point:
// the slot really is a permutation here, and the decode is exercised through it
// every frame rather than asserted about.
//
// No depth material: `positionNode` is read by the shadow pass too, which is
// the one line of this page the WebGL half has to spend a call on.
material.positionNode = vatNodes(vat, { time: vatTime, playback, carrier: crowd }).positionNode;
crowd.castShadow = params.shadows;
crowd.receiveShadow = params.shadows;
// Object-level culling off, per-instance culling on — two different switches,
// and only the second is this page's subject. The batch's own bounding sphere
// would have to be recomputed every time an instance appeared or went away;
// `perObjectFrustumCulled` is untouched and is what culls inside the draw.
crowd.frustumCulled = false;
stage.setCrowd(crowd);

// The whole field in frame at rest: this page's crowd is a fixed square rather
// than rings that grow with a slider, so the camera opens looking at all of it
// — a hole in the far corner is as much the evidence as one in the near.
stage.camera.position.set(0, 14, 27);
stage.controls.target.set(0, 1, 0);
stage.controls.update();

// ---------------------------------------------------------------- spawn, die
// What the library deliberately does not do: allocate an index, or remember
// which rows are live (ADR-0022). `addInstance` already hands the numbering
// out, so the page keeps the rest — which is what this roster is.
const roster = createRoster(CAPACITY);
const clipNames = vat.clips.map((clip) => clip.name);

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const size = new THREE.Vector3().setScalar(scale);

/** Fill the row the carrier hands back, and only then let the instance be seen. */
function spawn(): void {
  if (roster.live >= CAPACITY) return;
  // The id is three's: it reissues the *lowest freed* one, so this is routinely
  // a row a dead instance left behind rather than a fresh one.
  const id = crowd.addInstance(geometryId);
  const { x, z } = cellOf(id, pitch);
  quaternion.setFromAxisAngle(up, yawOf(id));
  crowd.setMatrixAt(id, matrix.compose(position.set(x, 0, z), quaternion, size));

  // What this row held a moment ago, read before it is overwritten: a recycled
  // row takes the clip *after* its last occupant's, so its two occupants are
  // never doing the same thing and a cell that comes back the colour it went
  // dim can only mean the row was not rewritten.
  const before = roster.rows[id];
  const previous = before ? clipNames.indexOf(before.clip) : null;

  // The one write a spawn costs — and the one that makes the row this
  // instance's. Skip it for a recycled id and the new arrival plays whatever
  // the last occupant was playing, from wherever that clip had got to.
  const clip = vat.clips[clipOfSpawn(roster.spawns, vat.clips.length, previous)]!;
  setVATInstance(playback, id, { clip, startTime: time });
  report(roster.fill(id, clip.name));
}

/** Remove a live instance, chosen at random. The row it leaves keeps its pack. */
function kill(): void {
  const id = roster.pick(Math.random());
  if (id === null) return;
  crowd.deleteInstance(id);
  roster.free(id);
}

/**
 * Drive the population to `count`, one instance at a time. This is what the
 * count slider does on this page: the crowd is not a prefix of a layout here,
 * it is a live population, and it moves by spawning and dying like everything
 * else on screen.
 */
function setCount(count: number): void {
  params.count = count;
  while (roster.live < count) spawn();
  while (roster.live > count) kill();
  updateReadouts();
}

// ---------------------------------------------------------------- HUD
const hudEl = document.getElementById("hud")!;
const drawCountEl = document.getElementById("draw-count")!;
const drawsNoteEl = document.getElementById("draws-note")!;
const populationEl = document.getElementById("population")!;
const recycleEl = document.getElementById("recycle")!;

// One draw for the crowd per pass, whatever the population — the carrier's
// whole cost claim, measured rather than stated, and on this path made true by
// the page: three's WebGPU backend would draw the batch once per visible
// instance, and collapse.ts folds those back into one. Two sentences, because
// the fold can decline on a three it does not know, and a HUD that then said
// "one draw" over a count that is the crowd's size would be the one lie this
// page cannot afford. The WebGL page's own number needs no folding; the two
// pages say what their own renderer does.
drawsNoteEl.textContent = collapsed
  ? "the crowd is one draw per pass, at any population — three culls and sorts inside it, per instance; " +
    "WebGPU has no multi-draw, so the page folds three's per-instance draws back into one"
  : "one draw per visible instance, per pass — three's WebGPU backend unrolls a batch, and this three " +
    "is not the one the page knows how to fold";

const ledger = createRowLedger(roster, clipNames);
document.getElementById("ledger-slot")!.append(ledger.root);
document.getElementById("ledger-key")!.innerHTML =
  `${ledgerKey(clipNames)} — one cell per reserved row, dim where the instance has gone`;

function updateReadouts(): void {
  ledger.update();
  populationEl.textContent = populationLine(roster);
}

/** Report a spawn, in the words the pair shares (`spawnLine`). */
function report(event: ReturnType<typeof roster.fill>): void {
  recycleEl.textContent = spawnLine(event);
}

// ---------------------------------------------------------------- panels
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

// ---------------------------------------------------------------- loop
let time = 0;
let carry = 0;

setCount(params.count); // a crowd standing before the first frame

createDemoGUI(
  params,
  stage,
  { setCount, showStats },
  hudEl,
  {
    title: "batched crowd",
    countName: "live instances",
    // From none: an empty field is a legal thing to ask for here, and it is
    // what a level that has not started yet looks like.
    countRange: { min: 0, max: CAPACITY, step: 1 },
    // No texture panel: the baked VAT is not what this page is evidence about.
    texturePanel: false,
    addControls(gui) {
      // The example's own control: how fast the crowd turns over. Each event is
      // one instance removed and one spawned, so the population holds while the
      // rows underneath it are recycled — which is the state a game is in and
      // the state this page exists to show.
      gui.add(params, "churn", 0, 30, 1).name("respawns / sec");
    },
  },
);

const clock = new THREE.Clock();
stage.renderer.setAnimationLoop(() => {
  stats.begin();
  const dt = clock.getDelta();
  if (params.animate) {
    time += dt;
    // The churn: kill one, spawn one, as many times as this frame owes. Nothing
    // else on the CPU touches the crowd — a standing instance costs nothing per
    // frame under either carrier, which is the claim every page here makes.
    const owed = churnTicks(carry, dt, params.churn);
    carry = owed.carry;
    for (let i = 0; i < owed.ticks && roster.live > 0; i++) {
      kill();
      spawn();
    }
    if (owed.ticks > 0) updateReadouts();
  }
  vatTime.value = time; // the one line that drives every instance's animation
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  // Measured, not asserted: the renderer's own count for the frame just drawn.
  // `render.drawCalls` where WebGL counts `render.calls`: both are this frame's
  // count, under different names.
  drawCountEl.textContent = `${stage.renderer.info.render.drawCalls}`;
  stats.end();
  stats.update();
});
