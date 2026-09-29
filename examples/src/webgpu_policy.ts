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
// The same program as webgl_policy.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, and an awaited `init()`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EndMode, INFINITE_REPETITIONS, LoopMode, bakeVAT, endsAt, resolveVATFrame, setVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { palette } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_policy.ts?raw";

const COUNT = 5;
const STAGGER = 0.4; // seconds between one soldier's start and the next's

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
scene.fog = new THREE.Fog(palette.studio, 20, 60);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 5, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

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

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- bake
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const walk = gltf.animations.find((clip) => clip.name === "Walk")!;
const maxTextureSize = getMaxTextureSize(renderer);
const vat = bakeVAT(gltf.scene, [walk], { maxTextureSize });
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- policy
// What the panel sets: one policy for the whole line. Once plays the clip
// through one time, so the count is only read under Repeat and PingPong.
const LOOPS = {
  forever: { loopMode: LoopMode.Repeat, counted: false },
  repeat: { loopMode: LoopMode.Repeat, counted: true },
  once: { loopMode: LoopMode.Once, counted: false },
  pingpong: { loopMode: LoopMode.PingPong, counted: true },
};
const ENDS = { clamp: EndMode.Clamp, rewind: EndMode.Rewind };
const policy = { loop: "repeat" as keyof typeof LOOPS, repetitions: 2, end: "clamp" as keyof typeof ENDS, speed: 1 };

/** Soldier `i` under the policy, starting `STAGGER` seconds after the one before it. */
function instanceAt(i: number, now: number): VATInstance {
  const { loopMode, counted } = LOOPS[policy.loop];
  return {
    clip: vat.clips[0]!,
    startTime: now + i * STAGGER,
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

const matrix = new THREE.Matrix4();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Soldier faces -z
for (let i = 0; i < COUNT; i++) {
  const x = (i - (COUNT - 1) / 2) * 1.8;
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, 0, 0), facing, new THREE.Vector3(1, 1, 1)));
}
mesh.computeBoundingSphere();
scene.add(mesh);

/** Start the line again under the policy as it stands: one write per soldier. */
function play() {
  for (let i = 0; i < COUNT; i++) {
    instances[i] = instanceAt(i, time.value);
    setVATInstance(playback, i, instances[i]!);
  }
}

// ---------------------------------------------------------------- panel
const setFinished = readout("finished");
const setPhase = readout("phase");
const setEndsIn = readout("ends-in");

const texturePanel = createTexturePanel([{ name: "Soldier", vat, instances: () => instances }], {
  caption: "one cursor per soldier",
});
document.body.append(texturePanel.root);

const panel = createPanel();
panel.select(
  "loop",
  [["forever", "Repeat forever"], ["repeat", "Repeat × count"], ["once", "Once"], ["pingpong", "PingPong × count"]] as const,
  policy.loop,
  (value) => {
    policy.loop = value;
    play();
  },
);
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
  texturePanel.update(time.value);

  // The shader's own question, asked on the CPU: where each soldier is now.
  const frames = instances.map((instance) => resolveVATFrame(instance, time.value));
  setFinished(`${frames.filter((frame) => frame.finished).length} / ${COUNT}`);
  setPhase(frames[0]!.phase.toFixed(2));
  // When the last soldier to start stops — `null` for a play that never does.
  const end = endsAt(instances[COUNT - 1]!);
  setEndsIn(end === null ? "never" : `${Math.max(0, end - time.value).toFixed(1)} s`);
});
