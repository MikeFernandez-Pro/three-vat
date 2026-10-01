// Loop, repeat and speed, on WebGPU: how an instance repeats its clip, how often, what
// it does when it is done, and how fast — backwards included.
//
// Four soldiers, each named over its head for its loop: Repeat forever,
// Repeat × count, Once and PingPong × count. Four fields of
// the instance a soldier is written with, the same four
// `THREE.AnimationAction` has: `loopMode` (Repeat, Once or PingPong),
// `repetitions`, `endMode` (Clamp holds the last pose, Rewind returns to the
// first) and `speed`, whose sign is the direction — a negative speed plays the
// band already baked backwards, with nothing baked for it. The shader resolves
// all four from the clock; the page asks `resolveVATFrame` and `endsAt` the
// same question on the CPU for its readouts.
//
// The same program as webgl_policy.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, and an awaited `init()`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EndMode, INFINITE_REPETITIONS, LoopMode, bakeVAT, endsAt, resolveVATFrame, setVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { createLabelRenderer, css2dLabel } from "./css2d-labels.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette, partColour } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_policy.ts?raw";

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
  material.setValues({ map: null, normalMap: null, color: partColour(material.name), roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- policy
// One soldier per loop mode, side by side, named over its head. Once plays the
// clip through one time, so the count is only read under Repeat and PingPong.
const LOOPS = [
  { name: "Repeat forever", loopMode: LoopMode.Repeat, counted: false },
  { name: "Repeat × count", loopMode: LoopMode.Repeat, counted: true },
  { name: "Once", loopMode: LoopMode.Once, counted: false },
  { name: "PingPong × count", loopMode: LoopMode.PingPong, counted: true },
] as const;
const COUNT = LOOPS.length;
const ENDS = { clamp: EndMode.Clamp, rewind: EndMode.Rewind };
const policy = { repetitions: 2, end: "clamp" as keyof typeof ENDS, speed: 1 };

/** Soldier `i` under its own loop mode and the panel's policy, all four started together at `now`. */
function instanceAt(i: number, now: number): VATInstance {
  const { loopMode, counted } = LOOPS[i]!;
  return {
    clip: vat.clips[0]!,
    startTime: now,
    loopMode,
    // Forever is a count too, spelled INFINITE_REPETITIONS; Once needs none.
    repetitions: counted ? policy.repetitions : loopMode === LoopMode.Repeat ? INFINITE_REPETITIONS : undefined,
    endMode: ENDS[policy.end],
    speed: policy.speed,
  };
}

const instances = Array.from({ length: COUNT }, (_, i) => instanceAt(i, 0));
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

const labelRenderer = createLabelRenderer();
const matrix = new THREE.Matrix4();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Soldier faces -z
const labels = LOOPS.map(({ name }, i) => {
  const x = (i - (COUNT - 1) / 2) * 2.4;
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, 0, 0), facing, new THREE.Vector3(1, 1, 1)));
  const label = css2dLabel(name);
  label.position.set(x, 2.3, 0);
  scene.add(label);
  return label;
});
mesh.computeBoundingSphere();
scene.add(mesh);

/** Start the four again under the policy as it stands: one write per soldier. */
function play() {
  for (let i = 0; i < COUNT; i++) {
    instances[i] = instanceAt(i, time.value);
    setVATInstance(playback, i, instances[i]!);
  }
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

  // The shader's own question, asked on the CPU: which soldiers have stopped,
  // their names greyed out as they do.
  const frames = instances.map((instance) => resolveVATFrame(instance, time.value));
  for (const [i, frame] of frames.entries()) labels[i]!.textElement.dataset.finished = String(frame.finished);
  setFinished(`${frames.filter((frame) => frame.finished).length} / ${COUNT}`);
  // When the last soldier that stops does: `endsAt` is `null` for a play that
  // never stops, Repeat forever always and every one at speed 0.
  const ends = instances.map((instance) => endsAt(instance)).filter((end): end is number => end !== null);
  setEndsIn(ends.length === 0 ? "never" : `${Math.max(0, ...ends.map((end) => end - time.value)).toFixed(1)} s`);
});
