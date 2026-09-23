// three-vat on WebGPU: a crowd twisted toward a target *after* the VAT has
// posed it, by a node graph this library knows nothing about.
//
// The deformation here is the scene's, not the library's — a crowd that turns
// to watch you is a game's idea, and three-vat's job ends at the posed vertex.
// On this path there is nothing to hand back, because `positionNode` already
// *is* a value: `vatNodes` returns the decode and this page composes with it,
// which is the asymmetry ADR-0021 closed on the WebGL side by inventing a hook.
// Hold this file next to webgl_deform.ts and that is the difference between
// them — one declares two GLSL chunks, the other wraps one node.
//
// The normal is deformed here too, and for the same reason the WebGL page needs
// two injection points: a twist applied to the position alone leaves the crowd
// shaded as though it had never moved. `normalLocal` is where the decode wrote
// it, in the vertex stage, so this graph turns it by the very same angle. And
// the crowd casts shadows without a second material, because the depth pass
// reads `positionNode` — the twist goes with it for free.
//
// Loaded by webgpu_deform.ts only once WebGPU is known to work, so a browser
// without it never fetches the node-material bundle.
import * as THREE from "three/webgpu";
import {
  Fn,
  atan,
  clamp,
  cos,
  float,
  instanceIndex,
  int,
  ivec2,
  normalLocal,
  positionGeometry,
  sin,
  smoothstep,
  textureLoad,
  uniform,
  vec3,
} from "three/tsl";
import type { Node } from "three/webgpu";
import Stats from "stats-gl";
import { bakeVAT, createVATPlaybackTexture } from "three-vat";
import type { VATInstance } from "three-vat";
import { getMaxTextureSize, vatNodes, type VATTimeUniform } from "three-vat/tsl";
import { crowdScale, loadRobot } from "../assets.js";
import {
  MAX_COUNT,
  SPACING,
  cellOf,
  crowdLine,
  desyncOf,
  homeRows,
  twistLine,
  twistProfile,
  widestTwist,
} from "../deforming.js";
import { createDeformParams } from "../params.js";
import { createDemoGUI } from "./gui.js";
import { createStage } from "./stage.js";

/** A fluent TSL vec3 node, as `three-vat/tsl` names it internally. */
type Vec3Node = Node<"vec3">;

const params = createDeformParams();
// Awaited, unlike the WebGL stage: `getMaxTextureSize` on the next line reads
// the WebGPU device's real limit, and there is no device before `init()`.
const stage = await createStage(params);

// ---------------------------------------------------------------- bake
// The crowd pages' robot, baked the same way. Nothing about the bake knows this
// page deforms anything: the twist runs after the decode, so a VAT is a VAT.
const robot = await loadRobot();
const vat = bakeVAT(robot.root, robot.clips, { fps: 30, maxTextureSize: getMaxTextureSize(stage.renderer) });
const { scale, footprint } = crowdScale(vat.bounds);
const pitch = footprint * SPACING;

// ---------------------------------------------------------------- the page's own data
// One texel per instance — where it stands and how far it turns — in the page's
// own texture, read in the graph by `instanceIndex`. The library knows nothing
// about it; it is the per-instance data the deformation is the page's *for*.
const homeTexture = new THREE.DataTexture(homeRows(pitch), 1, MAX_COUNT, THREE.RGBAFormat, THREE.FloatType);
homeTexture.needsUpdate = true;

const { knee, span } = twistProfile(vat.bounds.min.y, vat.bounds.max.y - vat.bounds.min.y);

// What the page drives: the target the pointer moves, and the limit the slider
// moves. TSL uniforms — a node the graph reads and a `{ value }` the page
// writes, which is what makes the lines that set them the same lines the WebGL
// page writes.
const uTarget = uniform(new THREE.Vector3(9, 0, 6));
const uTwistLimit = uniform(THREE.MathUtils.degToRad(params.twistLimit));
const uKnee = uniform(knee);
const uSpan = uniform(span);

// ---------------------------------------------------------------- crowd
// Every instance plays the same clip, started a moment apart: the twist is what
// this page is about, and a desynced idle is a crowd standing rather than a row
// of clones breathing in time (CONTEXT.md, **Instance desync**).
const idle = vat.clips.find((clip) => clip.name === "Idle") ?? vat.clips[0]!;
const instances: VATInstance[] = Array.from({ length: MAX_COUNT }, (_, i) => ({
  clip: idle,
  startTime: desyncOf(i, idle.duration),
}));

const vatTime: VATTimeUniform = uniform(0);
const playback = createVATPlaybackTexture(instances);

// Built by hand rather than through `createVATMesh`, for one reason: this page
// needs the decode *as a value* so it can compose with it. That is the whole of
// what the TSL path offers where the WebGL path offers a hook.
// `positionNode` as the cast says: a bake's materials are the glTF's, and the
// node renderer takes a `positionNode` on any of them.
type VATNodeMaterial = THREE.Material & { positionNode: Node | null };
const materials = vat.materials.map((source) => source.clone() as VATNodeMaterial);
const mesh = new THREE.InstancedMesh(vat.geometry, materials, MAX_COUNT);

// The decode: the posed vertex, this mesh's instancing re-applied, and
// `normalLocal` written from inside the vertex stage.
const { positionNode } = vatNodes(vat, { time: vatTime, playback, carrier: mesh });

// ---------------------------------------------------------------- the twist
// The caller's own graph, composed with the library's. Everything the WebGL
// page's two GLSL chunks say, said once here — because a node graph has no
// injection points to stand alone at, and the normal is a value in the same
// vertex stage rather than a variable taken before the position.
const twisted = Fn(() => {
  // The decode runs here: `positionLocal` and `normalLocal` are the posed
  // vertex's once this line has been read.
  const posed = vec3(positionNode).toVar();

  // This instance's angle: the yaw from where it stands to the target, clamped
  // so the crowd leans rather than spins, scaled by a gain of its own — its
  // cell and its gain being one texel of this page's own texture, read by the
  // instance's index.
  const home = textureLoad(homeTexture, ivec2(int(0), int(instanceIndex))).toVar();
  const angle = clamp(
    atan(uTarget.x.sub(home.x), uTarget.z.sub(home.y)),
    uTwistLimit.negate(),
    uTwistLimit,
  ).mul(home.z);
  // Eased in with height off the *rest* pose, so the position and the normal
  // are given the very same angle and the shading cannot disagree with the
  // silhouette.
  const eased = angle.mul(smoothstep(uKnee, uKnee.add(uSpan), positionGeometry.y)).toVar();
  const s = sin(eased).toVar();
  const c = cos(eased).toVar();
  const twistY = (v: Vec3Node): Vec3Node =>
    vec3(c.mul(v.x).add(s.mul(v.z)), v.y, s.negate().mul(v.x).add(c.mul(v.z)));

  // The normal, turned with the position. Drop this line and the crowd still
  // twists — and still shades as though it had not.
  normalLocal.assign(twistY(vec3(normalLocal)));

  // About the instance's own vertical axis, which is where it stands: the
  // decode has already applied this mesh's instancing, so the pivot is the
  // instance's cell rather than the origin.
  const pivot = vec3(home.x, float(0), home.y);
  return pivot.add(twistY(posed.sub(pivot)));
}, "vec3")();

for (const material of materials) material.positionNode = twisted;

mesh.castShadow = params.shadows;
mesh.receiveShadow = params.shadows;
mesh.frustumCulled = false;
stage.setCrowd(mesh);

// The crowd stands still and faces +z, all of it — and every instance matrix is
// a translation and a uniform scale, nothing else. That is what makes this page
// and the WebGL one the same picture: the graph above twists the *instanced*
// position about the instance's own cell, where the WebGL chunk twists the local
// position about the local origin, and the two agree exactly for as long as no
// instance is rotated. It is also why the angle a visitor sees an instance turn
// through *is* the angle the graph computed, with no heading mixed into it.
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const size = new THREE.Vector3().setScalar(scale);
for (let index = 0; index < MAX_COUNT; index++) {
  const { x, z } = cellOf(index, pitch);
  mesh.setMatrixAt(index, matrix.compose(position.set(x, 0, z), new THREE.Quaternion(), size));
}
mesh.instanceMatrix.needsUpdate = true;

// The whole field in frame at rest, and low enough that the sun rakes across
// the crowd: the shading is half of what this page is evidence for.
stage.camera.position.set(0, 9, 28);
stage.controls.target.set(0, 1.5, 0);
stage.controls.update();

// ---------------------------------------------------------------- the target
// What the crowd is looking at, on the ground and visible — a deformation with
// no visible cause is a caption, and this page is meant to have neither.
const marker = new THREE.Mesh(
  new THREE.TorusGeometry(0.5, 0.07, 8, 36),
  new THREE.MeshBasicNodeMaterial({ color: 0xffffff }),
);
marker.rotation.x = -Math.PI / 2;
marker.position.copy(uTarget.value);
stage.scene.add(marker);

// The control: the target follows the pointer over the ground. Suspended while
// the camera is being dragged, or every orbit would drag the crowd's attention
// round with it.
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hit = new THREE.Vector3();
let orbiting = false;
stage.controls.addEventListener("start", () => (orbiting = true));
stage.controls.addEventListener("end", () => (orbiting = false));

addEventListener("pointermove", (event) => {
  if (orbiting) return;
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, stage.camera);
  if (!raycaster.ray.intersectPlane(ground, hit)) return;
  uTarget.value.set(hit.x, 0, hit.z);
  marker.position.copy(uTarget.value);
  updateReadouts();
});

// ---------------------------------------------------------------- HUD
// What this page's feature is evidenced by, and nothing else (ADR-0020): the
// twist the crowd is under right now — measured over the instances on screen
// from the same rule the graph implements — where that deformation comes from,
// and that the normal went with the position. The WebGL deform page carries
// exactly these, readout for readout.
const hudEl = document.getElementById("hud")!;
const twistAngleEl = document.getElementById("twist-angle")!;
const twistNoteEl = document.getElementById("twist-note")!;
const deformNoteEl = document.getElementById("deform-note")!;
const crowdEl = document.getElementById("crowd")!;

// Counted, not stated. Fewer materials than the WebGL page has, and the
// difference is the one `createVATMesh` absorbs there: no depth material is
// built here, because the depth pass reads `positionNode` itself.
deformNoteEl.textContent =
  `your own node, composed with the one three-vat hands back, in all ${materials.length} materials this crowd draws with — ` +
  "the depth pass reads it too, so the shadows twist with it · move your pointer over the ground";

function updateReadouts() {
  twistAngleEl.textContent = `${Math.round((widestTwist(params.count, pitch, uTarget.value, uTwistLimit.value) * 180) / Math.PI)}°`;
  twistNoteEl.textContent = twistLine(uTwistLimit.value);
  crowdEl.textContent = crowdLine(params.count);
}

function setCount(count: number) {
  params.count = count;
  mesh.count = count;
  updateReadouts();
}

setCount(params.count); // a crowd standing, and turning, before the first frame

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

createDemoGUI(params, stage, { setCount, showStats }, hudEl, {
  title: "twisted crowd",
  countRange: { min: 1, max: MAX_COUNT, step: 1 },
  // No texture panel: the baked VAT is not what this page is evidence about —
  // what happens to a vertex *after* it is decoded is.
  texturePanel: false,
  addControls(gui) {
    // The deformation's own control, beside the count: how far an instance may
    // turn. In degrees, because that is the unit the reader is looking at.
    gui
      .add(params, "twistLimit", 0, 90, 1)
      .name("twist limit °")
      .onChange((degrees: number) => {
        uTwistLimit.value = THREE.MathUtils.degToRad(degrees);
        updateReadouts();
      });
  },
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let time = 0;
stage.renderer.setAnimationLoop(() => {
  stats.begin();
  if (params.animate) time += clock.getDelta();
  else clock.getDelta();
  vatTime.value = time; // the one line that drives every instance's animation
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  stats.end();
  stats.update();
});
