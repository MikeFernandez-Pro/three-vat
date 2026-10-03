// Bake in a worker, on WebGL: `bakeVATInWorker`, and a page that keeps drawing.
//
// A bake is CPU work, and on the main thread the page draws nothing until it
// returns. `bakeVATInWorker` runs the same bake in a Web Worker instead: the
// page hands over the subtree and the clips, the worker calls `bakeVAT` on a
// copy, and the VAT comes back as it would have from the call itself. The
// worker's side is two lines (src/bake.worker.ts). Bake on either thread and
// compare the longest frame the page drew while it waited.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, bakeVATInWorker, type DeltaVAT, type VATInstance } from "three-vat";
import { createVATMesh, createVATUniforms, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette, wearPart } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_worker.ts?raw";

const COUNT = 60;

// ---------------------------------------------------------------- renderer
// alpha: the canvas clears to nothing, so the backdrop is the page's own colour (theme.css)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.append(renderer.domElement);

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();

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
// Started before the first bake, so the page is drawing while it runs. Each
// frame notes how long it has been since the last one: while a bake runs,
// the longest of those gaps is how long the page stood still.
const uniforms = createVATUniforms();
const timer = new THREE.Timer();
let lastFrame = performance.now();
let longestFrame = 0;
let afterBake: (() => void) | null = null;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  longestFrame = Math.max(longestFrame, now - lastFrame);
  lastFrame = now;
  // The first frame drawn after a bake returns: the one it held back, if any.
  afterBake?.();
  afterBake = null;

  timer.update();
  uniforms.uVatTime.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------- bake
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
// The worker: a module that answers every `bakeVATInWorker` this page sends.
const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });
// The vertex encoding at 60 fps, named on purpose: the slow bake. The rig
// bakes Soldier in milliseconds, too short a wait to show anything.
const options = { encoding: "delta", fps: 60, maxTextureSize: getMaxTextureSize(renderer) } as const;

type Thread = "worker" | "main";
const setWhere = readout("where");
const setBakeTime = readout("bake-time");
const setLongest = readout("longest-frame");
let baking = false;

async function bake(thread: Thread): Promise<DeltaVAT> {
  baking = true;
  setWhere("baking…");
  // The forge paints before the bake starts; the scene behind it is what a
  // main-thread bake freezes and a worker bake leaves walking.
  const { vat, ms } = await forging(async () => {
    longestFrame = 0;
    const started = performance.now();
    const vat =
      thread === "worker"
        ? await bakeVATInWorker(worker, gltf.scene, clips, options) // off the main thread
        : bakeVAT(gltf.scene, clips, options); // the same bake, here
    return { vat, ms: performance.now() - started };
  });
  await new Promise<void>((resolve) => (afterBake = resolve));

  setWhere(thread === "worker" ? "worker" : "main thread");
  setBakeTime(`${Math.round(ms)} ms`);
  setLongest(`${Math.round(longestFrame)} ms`);
  baking = false;
  return vat;
}

// ---------------------------------------------------------------- crowd
// Built from the first bake, which runs in the worker.
const vat = await bake("worker");
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, roughness: 0.9, metalness: 0 });
  wearPart(material);
}
const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
  clip: vat.clips[i % vat.clips.length]!,
  startTime: -Math.random() * 10,
}));
const { mesh } = createVATMesh(vat, instances, { time: uniforms.uVatTime, maxTextureSize: options.maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;
const size = vat.bounds.getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 0.9;
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
for (let i = 0; i < COUNT; i++) {
  const radius = spacing * Math.sqrt(i + 0.5);
  const angle = i * 2.39996; // the golden angle
  turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), turn, new THREE.Vector3(1, 1, 1)));
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- panel
// Later bakes are measured and let go: the crowd on screen is the first.
let thread: Thread = "worker";
const panel = createPanel();
panel.select(
  "bake on",
  [
    ["worker", "a worker"],
    ["main", "the main thread"],
  ],
  thread,
  (value) => (thread = value),
);
panel.button("bake again", () => {
  if (!baking) void bake(thread);
});
panel.source({ code: source, path: "examples/src/webgl_worker.ts" });
