// three-vat on WebGL: a crowd twisted toward a target *after* the VAT has posed
// it, by GLSL this library knows nothing about.
//
// The deformation here is the scene's, not the library's — a crowd that turns
// to watch you is a game's idea, and three-vat's job ends at the posed vertex.
// What it owes the caller is somewhere to put the next four lines, and on this
// path that is the **post-decode hook**: a `prelude` ahead of three's shader, a
// chunk at the `position` point, a chunk at the `normal` point, and
// `vatInstanceIndex` declared at both so a chunk can read its own per-instance
// data (ADR-0021).
//
// Two of those are the page's whole argument, and they are the reason the hook
// has two injection points rather than one. three expands `beginnormal_vertex`
// *before* `begin_vertex` and derives `transformedNormal` between them, so a
// twist applied to the position alone leaves the crowd shaded as though it had
// never moved: correct in silhouette, wrong in the light. Hence a lit scene, and
// hence a sun low enough to see it. And the crowd casts shadows, because
// `createVATMesh` threads the hook to the depth and distance materials too — a
// crowd whose shadow does not twist with it is the other half of the same bug.
//
// Hold this file next to webgpu/deform.ts. The TSL path needs no hook at all:
// `positionNode` is a value it hands back, and the page composes with it. That
// asymmetry is the feature, not a gap (ADR-0021).
import * as THREE from "three";
import Stats from "stats-gl";
import { bakeVAT } from "three-vat";
import type { VATClock, VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { crowdScale, loadRobot } from "./assets.js";
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
} from "./deforming.js";
import { createDeformParams } from "./params.js";
import { createDemoGUI } from "./webgl/gui.js";
import { createStage } from "./webgl/stage.js";

const params = createDeformParams();
const stage = createStage(params);

// ---------------------------------------------------------------- bake
// The crowd pages' robot, baked the same way. Nothing about the bake knows
// this page deforms anything: the hook runs after the decode, so a VAT is a VAT.
const robot = await loadRobot();
const vat = bakeVAT(robot.root, robot.clips, { fps: 30, maxTextureSize: getMaxTextureSize(stage.renderer) });
const { scale, footprint } = crowdScale(vat.bounds);
const pitch = footprint * SPACING;

// ---------------------------------------------------------------- the page's own data
// One texel per instance — where it stands and how far it turns — in the page's
// own texture, read in the chunk by the index the hook declares. This is what
// `vatInstanceIndex` is *for*: per-instance data the library knows nothing
// about, addressed by the same logical index the pack is.
const homeTexture = new THREE.DataTexture(homeRows(pitch), 1, MAX_COUNT, THREE.RGBAFormat, THREE.FloatType);
homeTexture.needsUpdate = true;

const { knee, span } = twistProfile(vat.bounds.min.y, vat.bounds.max.y - vat.bounds.min.y);

// The hook's uniforms, held here because the page drives them: the target is
// moved by the pointer, the limit by the slider. One object per uniform, shared
// by every material the crowd draws with — which is what makes the twist and
// its shadow one deformation rather than two that agree.
const uTarget = { value: new THREE.Vector3(9, 0, 6) };
const uTwistLimit = { value: THREE.MathUtils.degToRad(params.twistLimit) };

// ---------------------------------------------------------------- the hook
// The caller's GLSL, which is all this page is. `prelude` sits ahead of three's
// shader — not an injection point, so a helper the two chunks share is declared
// once — and each chunk stands alone, because `MeshDepthMaterial` carries
// `beginnormal_vertex` inside a block that can be dead (ADR-0006).
const hook = {
  // Folded into three-vat's own program key, never replacing it: two crowds
  // with different hooks must not share a compiled program.
  key: "deform:twist",
  uniforms: {
    uHome: { value: homeTexture },
    uTarget,
    uTwistLimit,
    uKnee: { value: knee },
    uSpan: { value: span },
  },
  prelude: /* glsl */ `
    uniform highp sampler2D uHome;
    uniform vec3 uTarget;
    uniform float uTwistLimit;
    uniform float uKnee;
    uniform float uSpan;

    // This instance's angle: the yaw from where it stands to the target,
    // clamped so the crowd leans rather than spins, scaled by a gain of its
    // own. Its cell and its gain are one texel of this page's own texture,
    // fetched by the index three-vat declares at both injection points.
    float twistAngle( const in int instance ) {
      vec4 home = texelFetch( uHome, ivec2( 0, instance ), 0 );
      vec2 toTarget = uTarget.xz - home.xy;
      return clamp( atan( toTarget.x, toTarget.y ), -uTwistLimit, uTwistLimit ) * home.z;
    }

    // A yaw about the instance's own vertical axis, eased in with height so the
    // feet stay planted — off the *rest* pose, so the position and the normal
    // are given the very same angle and the shading cannot disagree with the
    // silhouette.
    vec3 twistY( const in vec3 v, const in float angle ) {
      float a = angle * smoothstep( uKnee, uKnee + uSpan, position.y );
      float s = sin( a ), c = cos( a );
      return vec3( c * v.x + s * v.z, v.y, -s * v.x + c * v.z );
    }`,
  position: "transformed = twistY( transformed, twistAngle( vatInstanceIndex ) );",
  // The second point, and the reason there are two. Drop this line and the
  // crowd still twists — and still shades as though it had not.
  normal: "objectNormal = twistY( objectNormal, twistAngle( vatInstanceIndex ) );",
};

// ---------------------------------------------------------------- crowd
// Every instance plays the same clip, started a moment apart: the twist is what
// this page is about, and a desynced idle is a crowd standing rather than a
// row of clones breathing in time (CONTEXT.md, **Instance desync**).
const idle = vat.clips.find((clip) => clip.name === "Idle") ?? vat.clips[0]!;
const instances: VATInstance[] = Array.from({ length: MAX_COUNT }, (_, i) => ({
  clip: idle,
  startTime: desyncOf(i, idle.duration),
}));

const vatTime: VATClock = { value: 0 };
// The whole VAT wiring, and the hook threaded through it: `createVATMesh`
// carries it to the render materials, the depth material and the distance
// material in one call, which is the point of threading it here rather than
// patching three materials by hand and forgetting the fourth.
const mesh: THREE.InstancedMesh = createVATMesh(vat, instances, { time: vatTime, hook }).mesh;
mesh.castShadow = params.shadows;
mesh.receiveShadow = params.shadows;
mesh.frustumCulled = false;
stage.setCrowd(mesh);

// The crowd stands still and faces +z, all of it — so the angle a visitor sees
// an instance turn through *is* the angle the chunk computed, with no per-
// instance heading mixed into it.
//
// It is also what makes this page and the WebGPU one the same picture rather
// than two that resemble each other. This chunk twists about the *local*
// origin, before the instance matrix; the node graph over there twists the
// already-instanced position about the instance's own cell. Those agree exactly
// while every instance matrix is a translation and a uniform scale — a rotation
// here would be a rotation composed on the other side of the twist, and the two
// pages would drift apart by it.
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
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
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
// from the same rule the chunk implements — where that deformation comes from,
// and that the normal went with the position.
const hudEl = document.getElementById("hud")!;
const twistAngleEl = document.getElementById("twist-angle")!;
const twistNoteEl = document.getElementById("twist-note")!;
const deformNoteEl = document.getElementById("deform-note")!;
const crowdEl = document.getElementById("crowd")!;

// Counted, not stated: every material this crowd draws with carries the hook,
// the shadow pass's included, which is why the shadows twist.
const patched = (mesh.material as THREE.Material[]).length + 2;
deformNoteEl.textContent =
  `your own GLSL, run after the decode at both injection points, in all ${patched} materials this crowd draws with — ` +
  "the depth and distance materials among them, so the shadows twist too · move your pointer over the ground";

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
// stats-gl lays its panels out absolutely inside a box of no size, and at
// `bottom: 0` a box of no size puts every panel just below the viewport. Sized
// to the panels it holds, it sits on the edge and centres on its real width.
const panel = stats.dom.firstElementChild as HTMLElement | null;
stats.dom.style.width = `calc(${panel?.style.width || "90px"} * ${stats.dom.children.length})`;
stats.dom.style.height = panel?.style.height || "48px";

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
// `Timer`, not the deprecated `Clock`: three says so on every load now that the
// Inspector shows its console (ADR-0024). Updated once per frame, read after.
const timer = new THREE.Timer();
let time = 0;
stage.renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  if (params.animate) time += timer.getDelta();
  vatTime.value = time; // the one line that drives every instance's animation
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  stats.end();
  stats.update();
});
