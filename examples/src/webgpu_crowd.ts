// Crowd, on WebGPU: the shortest path from a glTF to a crowd.
//
// Bake the clips once with `bakeVAT`, describe each soldier as a clip and a
// start time, and hand both to `createVATMesh`. Every soldier then animates on
// the GPU — its own clip, its own phase, its own rate — and the crowd draws in
// one call however many there are. Nothing per soldier happens on
// the CPU after this file's last setup line: the loop writes one number.
//
// The same program as webgl_crowd.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, an awaited `init()`, and `drawCalls` where WebGL counts `calls`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { createFrameStats } from "./frame-stats.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_crowd.ts?raw";

const MAX_COUNT = 500;

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
camera.position.set(0, 22, 44);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -20;
key.shadow.camera.right = key.shadow.camera.top = 20;
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

// ---------------------------------------------------------------- bake
// Soldier's three moving clips; its fourth, TPose, would stand a soldier still.
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
// This GPU's real texture ceiling: the one renderer-shaped input to a bake.
const maxTextureSize = getMaxTextureSize(renderer);
// A draw call is per material, not per clip or per soldier, and Soldier has two:
// its body and its visor, each with its own texture. The studio's matte look
// goes on both *before* the bake, so nothing tells them apart but their names,
// and `mergeFlatMaterials` folds them into one. The crowd draws once.
const materials = new Set<THREE.MeshStandardMaterial>();
gltf.scene.traverse((object) => {
  if ((object as THREE.Mesh).isMesh) materials.add((object as THREE.Mesh).material as THREE.MeshStandardMaterial);
});
for (const material of materials) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}
const vat = await forging(() => bakeVAT(gltf.scene, clips, { mergeFlatMaterials: true, maxTextureSize }));

// ---------------------------------------------------------------- crowd
// One instance per soldier: a clip, and a start time in the past. The start
// time is the desync — it moves nobody, it only says how far into its clip a
// soldier already is — and the rate varies the rest.
const instances: VATInstance[] = [];
for (let i = 0; i < MAX_COUNT; i++) {
  instances.push({
    clip: vat.clips[i % vat.clips.length]!,
    startTime: -Math.random() * 10,
    speed: 0.8 + Math.random() * 0.4,
  });
}

const { mesh, time } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

// Placing them is ours: a sunflower spiral, so the first N soldiers of the
// full crowd are always a round crowd of N.
const size = vat.bounds.getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 0.8;
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
for (let i = 0; i < MAX_COUNT; i++) {
  const radius = spacing * Math.sqrt(i + 0.5);
  const angle = i * 2.39996; // the golden angle
  // Soldier is authored facing -z; turned to face the camera, give or take.
  turn.setFromAxisAngle(up, Math.PI + (Math.random() - 0.5) * 1.2);
  matrix.compose(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), turn, new THREE.Vector3(1, 1, 1));
  mesh.setMatrixAt(i, matrix);
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- panel
const setCount = readout("count");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);

function showCount(count: number) {
  // Draw the first `count` soldiers; the rest stay resident, and unread.
  mesh.count = count;
  setCount(count);
}
showCount(1);

const panel = createPanel();
panel.slider("count", { min: 1, max: MAX_COUNT, value: 1 }, showCount);
panel.source({ code: source, path: "examples/src/webgpu_crowd.ts" });

// Cost is this page's feature, so its frame timings stay on screen.
const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  time.value = timer.getElapsed(); // the one line that animates every soldier
  controls.update();
  renderer.render(scene, camera);
  // Measured: the renderer's own count, kept for the crowd's draws alone —
  // the shadow pass beside them, the floor and the rest of the studio left out.
  setDraws(formatVATDraws(takeDraws()));
  stats.end();
});
