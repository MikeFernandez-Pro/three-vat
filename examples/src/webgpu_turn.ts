// Turn, on WebGPU: an instance retracing its path from the pose it shows.
//
// `turnVATInstance` reads one soldier's row back out of the playback texture
// and writes it turned round at the given moment: from then on it shows at
// `time + x` the pose it showed at `time - x`. A walker backs up, legs and all,
// from wherever its stride was — with nothing to keep on the CPU but the
// instance it hands back. The page moves each soldier along its lane by the
// sign of that instance's speed, and turns it at the end of the lane.
//
// The same program as webgl_turn.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, and an awaited `init()`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, resolveVATFrame, turnVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_turn.ts?raw";

const COUNT = 5;
const LANE = 4; // metres either side of the line the lanes cross
const WALK_SPEED = 1.3; // metres per second: ours, the clip walks on the spot

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
camera.position.set(9, 6, 13);
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

// ---------------------------------------------------------------- lanes
// Five walkers, each somewhere along its own lane and somewhere in its stride.
const instances: VATInstance[] = Array.from({ length: COUNT }, () => ({
  clip: vat.clips[0]!,
  startTime: -Math.random() * 5,
}));
const along = Array.from({ length: COUNT }, (_, i) => -LANE + ((i * 3) % COUNT) * ((2 * LANE) / COUNT));
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.frustumCulled = false; // the matrices change every frame
scene.add(mesh);

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Soldier faces -z
const scale = new THREE.Vector3(1, 1, 1);

function place() {
  for (let i = 0; i < COUNT; i++) {
    position.set((i - (COUNT - 1) / 2) * 1.8, 0, along[i]!);
    mesh.setMatrixAt(i, matrix.compose(position, facing, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- turn
let turns = 0;
let jump = 0;

/**
 * Turn soldier `i` round now. The pose either side of the turn is asked of
 * `resolveVATFrame`, the shader's own arithmetic, so the jump the page reports
 * is measured rather than promised.
 */
function turn(i: number) {
  const before = resolveVATFrame(instances[i]!, time.value);
  instances[i] = turnVATInstance(playback, i, time.value); // the one write
  const after = resolveVATFrame(instances[i]!, time.value);
  const frames = vat.clips[0]!.frames;
  const d = Math.abs(before.row + before.mix - (after.row + after.mix));
  jump = Math.max(jump, Math.min(d, frames - d)); // across the seam, the short way round
  turns++;
}

/** Which way soldier `i`'s stride runs: the sign of the speed it was written with. */
const direction = (i: number) => Math.sign(instances[i]!.speed ?? 1);

// ---------------------------------------------------------------- panel
const setTurns = readout("turns");
const setBacking = readout("backing-up");
const setJump = readout("pose-jump");

const texturePanel = createTexturePanel([{ name: "Soldier", vat, instances: () => instances }], {
  caption: "one cursor per soldier",
});
document.body.append(texturePanel.root);

const panel = createPanel();
panel.button("turn", () => {
  for (let i = 0; i < COUNT; i++) turn(i);
});
panel.source({ code: source, path: "examples/src/webgpu_turn.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  time.value = timer.getElapsed();
  for (let i = 0; i < COUNT; i++) {
    along[i]! += direction(i) * WALK_SPEED * dt;
    // The end of the lane turns a soldier, whichever way it is going.
    if (Math.abs(along[i]!) > LANE && Math.sign(along[i]!) === direction(i)) turn(i);
  }
  place();
  controls.update();
  renderer.render(scene, camera);
  texturePanel.update(time.value);
  setTurns(turns);
  setBacking(instances.filter((_, i) => direction(i) < 0).length);
  setJump(`${jump.toFixed(2)} rows`);
});
