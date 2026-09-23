// three-vat on WebGPU: a crowd whose instances change their minds — each one
// switching clip on a timer of its own, and each transition a **crossfade**
// between two clips that are *both still playing* (ADR-0025).
//
// The page exists to make one sentence watchable. A transition costs **one
// write**: `setVATInstance` with a `clip`, a `startTime` and a `fadeDuration`,
// at the moment the instance changes animation, and nothing per frame
// afterwards. The GPU derives the blend weight from the same clock it was
// already reading, so a dozen instances can be mid-transition at once, each
// begun at its own moment and each a different way through, inside one draw
// call per material.
//
// The control is the argument. It opens at zero — a cut — because that is what
// this looked like before the crossfade, and the crowd is popping between gaits
// in plain sight. Drag it up and every pop becomes a transition, and nothing
// skates however long it is set: the outgoing clip keeps running rather than
// freezing on the frame the write caught it on.
//
// The texture panel is the evidence, and it is on by default here for that
// reason alone. An instance mid-transition draws **two** cursors, one per band,
// and both of them move.
//
// Hold this file next to webgl_crossfade.ts. The VAT section reads the same on
// both, and nothing shared forces it (ADR-0011): `setVATInstance` takes one
// shape on both paths, because the pack it writes is one contract (ADR-0009).
// What differs is `three/webgpu` for the renderer, `three-vat/tsl` for the
// decode, an awaited stage, the Inspector for the control panel, and
// `drawCalls` where WebGL counts `calls`.
//
// One thing is duplicated that could have been shared, and deliberately: the
// controller below — the schedule compared against what has been written, and
// the `setVATInstance` call that follows — is renderer-agnostic to the last
// line, and it stays on both pages because it is *the thing the reader came to
// read*. ADR-0011 is explicit that the resemblance between a pair's VAT
// sections is evidence only while nothing forces it; hoisting this one into a
// shared module would manufacture the very resemblance this page exists to
// demonstrate. What `transitions.ts` holds instead is the schedule's
// arithmetic and the HUD's prose, which are not what a caller writes.
//
// Loaded by webgpu_crossfade.ts only once WebGPU is known to work, so a browser
// without it never fetches the node-material bundle.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { bakeVAT, setVATInstance } from "three-vat";
import type { VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { crowdScale, loadRobot } from "../assets.js";
import { createCrossfadeParams } from "../params.js";
import { createTexturePanel } from "../texture-panel.js";
import {
  COLUMNS,
  MAX_COUNT,
  SPACING,
  cellOf,
  clipOfSwitch,
  desyncOf,
  drawsLine,
  inFlight,
  switchTimeOf,
  switchesBy,
  transitionsLine,
} from "../transitions.js";
import { createDemoGUI } from "./gui.js";
import { createFrameStats } from "../frame-stats.js";
import { createInspector } from "./inspector.js";
import { createStage } from "./stage.js";

const params = createCrossfadeParams();
// Awaited, unlike the WebGL stage: `getMaxTextureSize` on the next line reads
// the WebGPU device's real limit, and there is no device before `init()`.
const stage = await createStage(params);

// ---------------------------------------------------------------- bake
// The crowd pages' robot, baked the same way. Nothing about the bake knows this
// page transitions anything: a crossfade is two bands of one baked texture,
// which is the whole reason it costs one write.
const robot = await loadRobot();
const vat = bakeVAT(robot.root, robot.clips, { fps: 30, maxTextureSize: getMaxTextureSize(stage.renderer) });
const { scale, footprint } = crowdScale(vat.bounds);
const pitch = footprint * SPACING;

// ---------------------------------------------------------------- crowd
// The whole crowd, laid out once: every instance on a clip of its own choosing
// and a phase of its own, so the field is already a crowd before anything has
// transitioned (CONTEXT.md, **Instance desync**).
//
// This array is the page's **mirror of the pack** — what it last wrote into
// each row. It is kept because the HUD asks the resolver how many instances are
// mid-transition, and the resolver answers about an instance rather than about
// a texture. Every write below replaces one entry, so the mirror and the rows
// say the same thing by construction.
const instances: VATInstance[] = Array.from({ length: MAX_COUNT }, (_, index) => {
  const clip = vat.clips[clipOfSwitch(index, 0, vat.clips.length)]!;
  return { clip, startTime: desyncOf(index, clip.duration) };
});

const vatTime: VATTimeUniform = uniform(0);
// The whole VAT wiring, and the playback texture the transitions are written
// into: `createVATMesh` hands it back beside the mesh because it is the object a
// caller has to hold to change an instance after the crowd is built (ADR-0016).
const { mesh, playback } = createVATMesh(vat, instances, { time: vatTime });
// Named for the Inspector's TSL graph (inspector.ts): each decode — one node
// material per source material — opens there by this name, the crossfade's
// branch on the transition being live included.
for (const [i, material] of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).entries()) {
  material.userData.graphId = `robot · ${material.name || i}`;
}
mesh.castShadow = params.shadows;
mesh.receiveShadow = params.shadows;
mesh.frustumCulled = false;
stage.setCrowd(mesh);

// The crowd stands still, all of it, facing the camera's side of the field: a
// change of gait is a silhouette, and an instance that was also travelling
// would be showing the visitor its motion rather than its transition.
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const size = new THREE.Vector3().setScalar(scale);
for (let index = 0; index < MAX_COUNT; index++) {
  const { x, z } = cellOf(index, pitch);
  mesh.setMatrixAt(index, matrix.compose(position.set(x, 0, z), new THREE.Quaternion(), size));
}
mesh.instanceMatrix.needsUpdate = true;

// The whole field in frame at rest, framed off the grid the bake produced
// rather than typed in — so the page opens on all of the crowd whatever the
// model measures — and low enough that a change of gait reads as one.
const field = (COLUMNS - 1) * pitch;
stage.camera.position.set(0, field * 0.34, field * 0.88);
stage.controls.target.set(0, 1.4, 0);
stage.controls.update();

// ---------------------------------------------------------------- the transitions
/**
 * How many switches each instance has already been written. Compared against
 * the schedule once a frame: a frame that ran long — or a tab that was in the
 * background — then costs one write and lands *on* the schedule rather than
 * drifting behind it.
 */
const written = new Int32Array(MAX_COUNT);

/**
 * Write every switch the schedule says is due by `time`.
 *
 * This is the whole controller, and it is the shape a game writes: the CPU
 * touches an instance at the moment its animation changes, and does not touch
 * it again until the next one. Nothing here runs per frame *per instance* —
 * the loop is a comparison of two integers, and the write inside it happens a
 * few times a second across the whole crowd.
 *
 * `from` is passed rather than left to `setVATInstance` to read the row back,
 * because the page is holding the very state it would read — this is the
 * hand-assembled case the field exists for, and passing it keeps the mirror
 * above exact rather than nearly right.
 */
function applySwitches(time: number): void {
  for (let index = 0; index < params.count; index++) {
    const due = switchesBy(index, time);
    if (due === written[index]) continue;
    written[index] = due;

    const previous = instances[index]!;
    const next: VATInstance = {
      clip: vat.clips[clipOfSwitch(index, due, vat.clips.length)]!,
      // The moment the schedule named, not the moment this frame noticed it:
      // the blend begins when the incoming clip does, so a frame late here
      // would be a transition late on screen.
      startTime: switchTimeOf(index, due),
      fadeDuration: params.fadeDuration,
      // The clip it was playing, still playing — the outgoing band. Its own
      // start time goes with it, which is why it keeps moving rather than
      // freezing on the frame this write caught it on.
      from: { clip: previous.clip, startTime: previous.startTime, speed: previous.speed },
    };
    setVATInstance(playback, index, next);
    instances[index] = next;
  }
}

// ---------------------------------------------------------------- HUD
// What this page's feature is evidenced by, and nothing else (ADR-0020): how
// much of the crowd is between two clips at this moment, and that the crowd is
// still one draw call per material while it is. Both are measured — the first
// through the library's own resolver, over the pack the shader is reading, and
// the second off the renderer's own count for the frame just drawn. The WebGL
// crossfade page carries exactly these, readout for readout.
const transitionCountEl = document.getElementById("transition-count")!;
const transitionsNoteEl = document.getElementById("transitions-note")!;
const drawsNoteEl = document.getElementById("draws-note")!;

function setCount(count: number) {
  params.count = count;
  mesh.count = count;
  transitionsNoteEl.textContent = transitionsLine(params.count, params.fadeDuration);
}

setCount(params.count); // a crowd standing before the first frame

// ---------------------------------------------------------------- panels
// The baked textures, on screen at rest rather than one click away: an instance
// mid-transition draws two cursors, one per band, and that is what this page is
// evidence of (ADR-0024, as this pair amended it).
const texturePanel = createTexturePanel([
  { name: "RobotExpressive", vat, instances: () => instances.slice(0, params.count) },
]);
document.body.append(texturePanel.root);

function showTexturePanel(visible: boolean) {
  texturePanel.root.style.display = visible ? "flex" : "none";
}
showTexturePanel(params.showTexturePanel);

// The frame timings, top-left as on every three example and on screen at rest:
// FPS, CPU, GPU and draw calls (src/frame-stats.ts). And the Inspector, top
// right: the control panel in its Parameters tab, and the deeper profiling -
// memory, a timeline, a console, the TSL graph - behind its button (ADR-0024).
const frame = await createFrameStats(stage.renderer);
const inspector = createInspector(stage.renderer);
createDemoGUI(params, stage, { setCount, showTexturePanel }, inspector, {
  title: "crossfading crowd",
  countRange: { min: 1, max: MAX_COUNT, step: 1 },
  addControls(gui) {
    // The example's own control, beside the count. From zero — the cut this
    // page opens on — to a second, which is longer than any transition a crowd
    // wants and exactly the length the old capped fade could not be asked for.
    gui
      .add(params, "fadeDuration", 0, 1, 0.01)
      .name("blend seconds")
      .onChange(() => {
        transitionsNoteEl.textContent = transitionsLine(params.count, params.fadeDuration);
      });
  },
});

// ---------------------------------------------------------------- loop
// `Timer`, not the deprecated `Clock`: three says so on every load now that the
// Inspector shows its console (ADR-0024). Updated once per frame, read after.
const timer = new THREE.Timer();
let time = 0;
stage.renderer.setAnimationLoop(() => {
  frame.begin();
  timer.update();
  if (params.animate) {
    time += timer.getDelta();
    applySwitches(time);
  }
  vatTime.value = time; // the one line that drives every instance's animation
  if (params.showTexturePanel) texturePanel.update(time);
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  // Both readouts, measured after the frame they describe: the transitions from
  // the packs the vertices just read, the draws from the renderer's own count.
  // `render.drawCalls` where WebGL counts `render.calls`: both are this frame's
  // count, under different names.
  transitionCountEl.textContent = `${inFlight(instances, params.count, time)}`;
  drawsNoteEl.textContent = drawsLine(stage.renderer.info.render.drawCalls);
  frame.end();
});
