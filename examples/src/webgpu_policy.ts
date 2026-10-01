// Playback policy, on WebGPU: how an instance repeats its clip, how often, what
// it does when it is done, and how fast — backwards included.
//
// Four fields of the instance a soldier is written with, the same four
// `THREE.AnimationAction` has: `loopMode` (Repeat, Once or PingPong),
// `repetitions`, `endMode` (Clamp holds the last pose, Rewind returns to the
// first) and `speed`, whose sign is the direction — a negative speed plays the
// band already baked backwards, with nothing baked for it. The shader resolves
// all four from the clock; the page asks `resolveVATFrame` and `endsAt` the
// same question on the CPU for its readouts.
//
// One soldier per loop mode, side by side under a label, and the panel's
// count, end mode and speed apply to the whole line: every loop mode answers
// the same input.
//
// The same program as webgl_policy.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, and an awaited `init()`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EndMode, bakeVAT, endsAt, resolveVATFrame, setVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { labelOf, LINEUP } from "./policy-lineup.js";
import { createLabelRenderer, css2dLabel } from "./css2d-labels.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_policy.ts?raw";

const COUNT = LINEUP.length;

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
camera.position.set(0, 5, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -10;
key.shadow.camera.right = key.shadow.camera.top = 10;
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
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const walk = gltf.animations.find((clip) => clip.name === "Walk")!;
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, [walk], { maxTextureSize }));
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- policy
// What the panel sets: one policy for the whole line. Each soldier's loop mode
// is its own, and Once plays the clip through one time, so it reads no count.
const ENDS = { clamp: EndMode.Clamp, rewind: EndMode.Rewind };
const policy = { repetitions: 2, end: "clamp" as keyof typeof ENDS, speed: 1 };

/** The line under the policy, every soldier played from `now`: only its loop mode tells it apart. */
function lineAt(now: number): VATInstance[] {
  return LINEUP.map(({ loopMode, counted }) => ({
    clip: vat.clips[0]!,
    startTime: now,
    loopMode,
    repetitions: counted ? policy.repetitions : undefined,
    endMode: ENDS[policy.end],
    speed: policy.speed,
  }));
}

const instances = lineAt(0);
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

// Each soldier under its label, just over its head.
const labelRenderer = createLabelRenderer();
const labelHeight = vat.bounds.max.y + 0.35;
const matrix = new THREE.Matrix4();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Soldier faces -z
const labels = LINEUP.map((entry, i) => {
  const x = (i - (COUNT - 1) / 2) * 2.4;
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, 0, 0), facing, new THREE.Vector3(1, 1, 1)));
  const label = css2dLabel(labelOf(entry, policy.repetitions));
  label.position.set(x, labelHeight, 0);
  scene.add(label);
  return label;
});
mesh.computeBoundingSphere();
scene.add(mesh);

/** Start the line again under the policy as it stands: one write per soldier. */
function play() {
  lineAt(time.value).forEach((instance, i) => {
    instances[i] = instance;
    setVATInstance(playback, i, instance);
  });
  LINEUP.forEach((entry, i) => (labels[i]!.textElement.textContent = labelOf(entry, policy.repetitions)));
}

// ---------------------------------------------------------------- panel
const setFinished = readout("finished");
const setEndsIn = readout("ends-in");

const texturePanel = createTexturePanel([{ name: "Soldier", vat, instances: () => instances }], {
  caption: "one cursor per soldier",
});
document.body.append(texturePanel.root);

const panel = createPanel();
panel.slider("count", { min: 1, max: 4, value: policy.repetitions }, (value) => {
  policy.repetitions = value;
  play();
});
panel.select("end", [["clamp", "Clamp"], ["rewind", "Rewind"]] as const, policy.end, (value) => {
  policy.end = value;
  play();
});
panel.slider("speed", { min: -2, max: 2, step: 0.25, value: policy.speed }, (value) => {
  policy.speed = value;
  play();
});
panel.button("play again", play);
panel.source({ code: source, path: "examples/src/webgpu_policy.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  texturePanel.update(time.value);

  // The shader's own question, asked on the CPU: where each soldier is now.
  const frames = instances.map((instance) => resolveVATFrame(instance, time.value));
  frames.forEach((frame, i) => (labels[i]!.textElement.dataset.finished = String(frame.finished)));
  setFinished(`${frames.filter((frame) => frame.finished).length} / ${COUNT}`);
  // When the last soldier stops: `null` for a play that never does, at speed 0.
  const ends = instances.map(endsAt);
  const end = ends.includes(null) ? null : Math.max(...(ends as number[]));
  setEndsIn(end === null ? "never" : `${Math.max(0, end - time.value).toFixed(1)} s`);
});
