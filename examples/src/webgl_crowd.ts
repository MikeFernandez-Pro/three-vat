// three-vat on WebGL: a crowd of robots, one mesh, one VAT, many instances —
// each picking its own clip, phase and playback rate. The animation runs
// entirely on the GPU (zero per-frame CPU); only the walk/run transform is
// updated on the CPU each frame, and idle instances cost nothing at all.
//
// The VAT is the middle section, and it is deliberately short: bake, build,
// drive the clock. Everything above it is the room (webgl/stage.ts) and
// everything below it is the panel (webgl/gui.ts).
import * as THREE from "three";
import Stats from "stats-gl";
import { bakeVAT } from "three-vat";
import type { VATClip, VATClock } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { crowdScale, loadRobot } from "./assets.js";
import { layoutCrowd, positionAt, ZONES, type Robot } from "./crowd.js";
import { createDemoParams } from "./params.js";
import { createVATDebugPanel } from "./vat-debug.js";
import { createDemoGUI } from "./webgl/gui.js";
import { createStage } from "./webgl/stage.js";

const params = createDemoParams();
const stage = createStage(params);

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
let robots: Robot<VATClip>[] = [];
let mesh: THREE.InstancedMesh | null = null;
// One clock for the page, not one per rebuild: every VAT mesh a scene adds
// should read the same time, so the crowd stays one crowd.
const vatTime: VATClock = { value: 0 };

function build() {
  disposeCrowd();
  robots = layoutCrowd(vat.clips, params, footprint * params.clearance, params.zoneGap);

  // The whole VAT wiring, on this path: geometry cloned from the bake, the
  // instance-playback attributes written, one patched material per source
  // material (never merged — ADR-0008, so 3 draw calls, not 3 per robot) and
  // the depth material that keeps shadows deformed instead of frozen in the
  // bind pose. Placing the instances stays ours: only we know the layout.
  mesh = createVATMesh(vat, robots, { time: vatTime }).mesh;

  mesh.castShadow = params.shadows;
  mesh.receiveShadow = params.shadows;
  mesh.frustumCulled = false; // instances are placed by per-frame matrices
  stage.setCrowd(mesh);

  place(time); // lay the crowd out before the first render
  updateInfo();
}

function disposeCrowd() {
  if (!mesh) return;
  stage.scene.remove(mesh);
  mesh.geometry.dispose();
  for (const mat of mesh.material as THREE.Material[]) mat.dispose();
  (mesh.customDepthMaterial as THREE.Material | undefined)?.dispose();
  (mesh.customDistanceMaterial as THREE.Material | undefined)?.dispose();
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
  if (!mesh) return;
  for (let i = 0; i < robots.length; i++) {
    const r = robots[i]!;
    const a = r.angle0 + r.omega * time;
    // The same call the non-overlap test asserts against, so the formula that
    // is proven and the formula that is drawn cannot drift apart.
    const { x, z } = positionAt(r, time);
    pos.set(x, 0, z);
    // Movers face along the tangent of travel; dancers keep a fixed heading.
    const facing = r.omega === 0 ? r.heading : -a + (r.omega > 0 ? 0 : Math.PI);
    q.setFromAxisAngle(up, facing);
    s.setScalar(scale);
    mesh.setMatrixAt(i, m.compose(pos, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- caption
const infoEl = document.getElementById("info")!;
const drawsEl = document.getElementById("draws")!;

function updateInfo() {
  const byClip = new Map<string, number>();
  for (const r of robots) {
    byClip.set(r.clip.name, (byClip.get(r.clip.name) ?? 0) + 1);
  }
  const mix = ZONES.filter((z) => byClip.get(z.clip))
    .map((z) => `${byClip.get(z.clip)} ${z.key}`)
    .join(" · ");
  infoEl.textContent = `${robots.length} robots — ${mix} — one mesh, one VAT, zero per-frame CPU animation`;
}

build();

// ---------------------------------------------------------------- panels
const vatPanel = createVATDebugPanel([{ name: "RobotExpressive", vat, instances: () => robots }]);
document.body.append(vatPanel.root);

function showVatTextures(visible: boolean) {
  vatPanel.root.style.display = visible ? "flex" : "none";
}
showVatTextures(params.showVatTextures);

createDemoGUI(params, stage, { rebuild: build, showVatTextures });

const stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);
stats.dom.style.cssText = "position:fixed;bottom:0;left:0";
await stats.init(stage.renderer);

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
  if (params.showVatTextures) vatPanel.update(time);
  stage.controls.update();
  stage.renderer.render(stage.scene, stage.camera);
  drawsEl.textContent = `${stage.renderer.info.render.calls} draw calls · ${stage.renderer.info.render.triangles.toLocaleString()} tris`;
  stats.end();
  stats.update();
});
