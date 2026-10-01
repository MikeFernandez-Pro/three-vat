// A worker bake, on WebGPU: `bakeVATInWorker`, and a page that keeps drawing.
//
// A bake is CPU work, and on the main thread the page draws nothing until it
// returns. `bakeVATInWorker` runs the same bake in a Web Worker instead: the
// page hands over the subtree and the clips, the worker calls `bakeVAT` on a
// copy, and the VAT comes back as it would have from the call itself. The
// worker's side is two lines (src/bake.worker.ts).
//
// The page opens unbaked, on the soldiers as three plays them: a
// `SkinnedMesh` each, posed by an `AnimationMixer` on the CPU every frame.
// Those are what a main-thread bake freezes and a worker bake leaves moving.
// Once baked, the VAT crowd takes their place, and the comparison says what
// the bake cost the page on each thread and what the crowd costs to draw.
//
// The same program as webgl_worker.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { bakeVAT, bakeVATInWorker, type DeltaVAT, type VATCrowd, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { askToBake, showComparison } from "./bake-compare.js";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws, type VATDraws } from "./vat-draws.js";
import source from "./webgpu_worker.ts?raw";

const COUNT = 60;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.append(renderer.domElement);
// Before anything reads the device: there is none until `init()`.
await renderer.init();
// With no WebGPU, the renderer runs this same TSL on its WebGL 2 backend.
// Said, read off the backend, so nobody mistakes one for the other.
if ((renderer.backend as { isWebGLBackend?: boolean }).isWebGLBackend) {
  badge("no WebGPU here: TSL on the WebGL 2 backend");
}

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.studio);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 12, 24);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -14;
key.shadow.camera.right = key.shadow.camera.top = 14;
key.shadow.camera.far = 80;
key.shadow.bias = -0.0005;
key.shadow.radius = 3; // soft edges, as the studio wants them
scene.add(key);

scene.add(createFloor(camera.position.distanceTo(controls.target)));

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- loop
// Started before the first load, so the page is drawing while it bakes. Each
// frame notes how long it has been since the last one: while a bake runs,
// the longest of those gaps is how long the page stood still. And each frame
// counts the crowd's draws, whichever crowd is on screen.
const time: VATTimeUniform = uniform(0);
const timer = new THREE.Timer();
/** Three's own crowd, a soldier per place, and the mixer posing each. */
const skinned = new THREE.Group();
const mixers: THREE.AnimationMixer[] = [];
/** What the crowd on screen is drawn as, for the draw counter to pick out. */
const crowdObjects = new Set<THREE.Object3D>();
const takeDraws = countVATDraws(renderer, scene, (object) => crowdObjects.has(object as THREE.Object3D));
const setDrawCalls = readout("draw-calls");
let draws: VATDraws = { main: 0, shadow: 0 };
let lastFrame = performance.now();
let longestFrame = 0;
let frameDrawn: (() => void)[] = [];
renderer.setAnimationLoop(() => {
  const now = performance.now();
  longestFrame = Math.max(longestFrame, now - lastFrame);
  lastFrame = now;

  timer.update();
  const delta = timer.getDelta();
  // The CPU's share of three's own crowd: every bone of every soldier, posed
  // here, while that crowd is the one on screen.
  if (skinned.parent) for (const mixer of mixers) mixer.update(delta);
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);

  draws = takeDraws();
  setDrawCalls(formatVATDraws(draws));
  const waiting = frameDrawn;
  frameDrawn = [];
  for (const resolve of waiting) resolve();
});

/** Until the next frame has been drawn: the one a bake held back, or the first a new crowd is in. */
const nextFrame = () => new Promise<void>((resolve) => frameDrawn.push(resolve));

// ---------------------------------------------------------------- crowd
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
// The studio's matte look, on the materials both crowds draw with.
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  for (const material of [object.material].flat() as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
  }
});

// Where each soldier stands, whichever way it is drawn: a sunflower of 60.
const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 0.9;
const places = Array.from({ length: COUNT }, (_, i) => {
  const radius = spacing * Math.sqrt(i + 0.5);
  const angle = i * 2.39996; // the golden angle
  return new THREE.Matrix4().compose(
    new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2),
    new THREE.Vector3(1, 1, 1),
  );
});
const clipOf = (i: number) => clips[i % clips.length]!;
const startTimes = Array.from({ length: COUNT }, () => Math.random() * 10);

// Three's own crowd: a clone of the soldier per place, each under its mixer.
// The source stays out of the scene: it is what the bake poses.
for (let i = 0; i < COUNT; i++) {
  const soldier = SkeletonUtils.clone(gltf.scene);
  places[i]!.decompose(soldier.position, soldier.quaternion, soldier.scale);
  soldier.traverse((object) => {
    if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = true;
  });
  const mixer = new THREE.AnimationMixer(soldier);
  mixer.clipAction(clipOf(i)).play();
  mixer.setTime(startTimes[i]!);
  mixers.push(mixer);
  skinned.add(soldier);
}

/** Put three's crowd on screen, under its mixers. */
function showSkinned() {
  scene.add(skinned);
  crowdObjects.clear();
  skinned.traverse((object) => crowdObjects.add(object));
}
showSkinned();

/** Put a bake's crowd on screen in place of three's, and hand it back. */
function showVAT(vat: DeltaVAT): VATCrowd {
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
  }
  const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
    clip: vat.clips.find((clip) => clip.name === clipOf(i).name)!,
    startTime: -startTimes[i]!,
  }));
  const crowd = createVATMesh(vat, instances, { time, maxTextureSize: options.maxTextureSize });
  const { mesh } = crowd;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  places.forEach((place, i) => mesh.setMatrixAt(i, place));
  mesh.computeBoundingSphere();
  scene.remove(skinned);
  scene.add(mesh);
  crowdObjects.clear();
  crowdObjects.add(mesh);
  return crowd;
}

/** Let a bake's crowd go, and the bake under it: nothing else holds either. */
function release(vat: DeltaVAT, { mesh, playback }: VATCrowd) {
  scene.remove(mesh);
  mesh.dispose();
  for (const material of [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial].flat()) material?.dispose();
  playback.texture.dispose();
  vat.geometry.dispose();
  vat.positionTexture.dispose();
  vat.normalTexture?.dispose();
}

// ---------------------------------------------------------------- bake
// The worker: a module that answers every `bakeVATInWorker` this page sends.
const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
// The vertex encoding at 60 fps, named on purpose: the slow bake. The rig
// bakes Soldier in milliseconds, too short a wait to show anything.
const options = { encoding: "delta", fps: 60, maxTextureSize: getMaxTextureSize(renderer) } as const;

type Thread = "worker" | "main";

/** One bake on one thread, and what it cost the page. */
async function bake(thread: Thread): Promise<{ vat: DeltaVAT; ms: number; longest: number }> {
  // The forge paints before the bake starts; the soldiers behind it are what a
  // main-thread bake freezes and a worker bake leaves moving.
  const { vat, ms } = await forging(async () => {
    longestFrame = 0;
    const started = performance.now();
    const vat =
      thread === "worker"
        ? await bakeVATInWorker(worker, gltf.scene, clips, options) // off the main thread
        : bakeVAT(gltf.scene, clips, options); // the same bake, here
    return { vat, ms: performance.now() - started };
  });
  // The first frame drawn after the bake returns: the one it held back, if any.
  await nextFrame();
  return { vat, ms, longest: longestFrame };
}

// ---------------------------------------------------------------- panel
const panel = createPanel();
const bakeAgain = panel.button("bake again", () => void round());
bakeAgain.hidden = true;
panel.source({ code: source, path: "examples/src/webgpu_worker.ts" });

// ---------------------------------------------------------------- compare
// What each thread's last bake cost, kept across rounds, so a visitor who
// bakes on both sees the two side by side.
const costs: Record<Thread, { ms: number; longest: number } | null> = { worker: null, main: null };
let baked: { vat: DeltaVAT; crowd: VATCrowd } | null = null;

/** Three's crowd, the bake button, a bake on the thread picked, and the comparison. */
async function round() {
  bakeAgain.hidden = true;
  if (baked) release(baked.vat, baked.crowd);
  baked = null;
  showSkinned();

  const thread = await askToBake("bake the soldiers into a VAT", [
    ["main", "on the main thread"],
    ["worker", "in a worker"],
  ]);
  const before = draws;
  const { vat, ms, longest } = await bake(thread);
  costs[thread] = { ms, longest };
  baked = { vat, crowd: showVAT(vat) };
  // Two frames: the first a new crowd is in may still be building its programs.
  await nextFrame();
  await nextFrame();
  const after = draws;

  showComparison(
    "thread-comparison",
    ["worker", "main thread"],
    [
      { label: "longest frame", unit: "ms", values: [costs.worker?.longest ?? null, costs.main?.longest ?? null] },
      { label: "bake time", unit: "ms", values: [costs.worker?.ms ?? null, costs.main?.ms ?? null] },
    ],
  );
  showComparison(
    "draw-comparison",
    ["VAT", "SkinnedMesh"],
    [
      { label: "draw calls", unit: "count", values: [after.main, before.main] },
      { label: "shadow draws", unit: "count", values: [after.shadow, before.shadow] },
    ],
  );
  bakeAgain.hidden = false;
}
void round();
