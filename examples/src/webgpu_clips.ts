// Clips, on WebGPU: switch one instance's clip, and touch no other.
//
// A crowd from `createVATMesh` is one playback texture, a row per instance. To
// change what one soldier plays, write its row with `setVATInstance` — a clip
// and the moment it starts — and that row alone goes up to the GPU. The page
// diffs the texture around every write, so the figure it states is counted off
// the bytes, not assumed.
//
// The same program as webgl_clips.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, an awaited `init()`, and `drawCalls` where WebGL counts `calls`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, setVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { addFloorControls } from "./floor-fade.js";
import { forging } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_clips.ts?raw";

const COUNT = 7;

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
camera.position.set(0, 5, 15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
const cameraLimits = limitCamera(controls);

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

const floor = createFloor(camera.position.distanceTo(controls.target));
scene.add(floor.mesh);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- bake
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const clips = ["Idle", "Walk", "Run"].map((name) => gltf.animations.find((clip) => clip.name === name)!);
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, clips, { maxTextureSize }));
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- line
// Seven soldiers standing idle, each a little way into the clip. `instances`
// is the page's own copy of what each row says, kept for the texture panel.
const instances: VATInstance[] = Array.from({ length: COUNT }, () => ({
  clip: vat.clips[0]!,
  startTime: -Math.random() * 5,
}));
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

const matrix = new THREE.Matrix4();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Soldier faces -z
for (let i = 0; i < COUNT; i++) {
  const x = (i - (COUNT - 1) / 2) * 1.6;
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, 0, 0), facing, new THREE.Vector3(1, 1, 1)));
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- switch
// One soldier, the next along, moves on to the next clip — starting it now.
const pack = playback.texture.image.data as Float32Array;
const stride = pack.length / playback.count; // floats per instance row
const playing = new Array<number>(COUNT).fill(0); // each soldier's clip, by index
let next = 0;

/** How many rows of the playback texture differ from `before`. */
function rowsChanged(before: Float32Array): number {
  let rows = 0;
  for (let row = 0; row < playback.count; row++) {
    for (let at = row * stride; at < (row + 1) * stride; at++) {
      if (pack[at] !== before[at]) {
        rows++;
        break;
      }
    }
  }
  return rows;
}

function switchOne() {
  const index = next;
  next = (next + 1) % COUNT;
  playing[index] = (playing[index]! + 1) % vat.clips.length;
  const before = pack.slice();
  instances[index] = { clip: vat.clips[playing[index]!]!, startTime: time.value };
  setVATInstance(playback, index, instances[index]!); // the one write
  setRows(rowsChanged(before));
}

// ---------------------------------------------------------------- panel
const setRows = readout("rows-changed");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);
readout("count")(COUNT);

const texturePanel = createTexturePanel([{ name: "Soldier", vat, instances: () => instances }], {
  caption: "one cursor per soldier",
});
document.body.append(texturePanel.root);

const panel = createPanel();
panel.button("switch one", switchOne);
cameraLimits.addTo(panel);
addFloorControls(panel, floor.fade);
panel.source({ code: source, path: "examples/src/webgpu_clips.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  texturePanel.update(time.value);
  setDraws(formatVATDraws(takeDraws()));
});
