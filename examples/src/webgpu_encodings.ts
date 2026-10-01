// The rig encoding, on WebGPU: a skinned character, stored as its posed rig.
//
// `bakeVAT` stores a clip one of two ways. The **rig encoding** stores the
// posed rig, a rotation, a translation and a scale per bone, and skins the
// rest pose in the vertex shader. The **vertex encoding** stores where every
// vertex ended up. A skinned character can take either, and the rig is the
// default wherever the asset allows it. Bake Soldier both ways, flip between
// them, and compare the two textures at one scale: the same clips, the same
// crowd on screen, a fraction of the memory.
//
// The same program as webgl_encodings.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VAT, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { createFrameStats } from "./frame-stats.js";
import { palette } from "./palette.js";
import { createTrueScaleFigure } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import { formatBakeTime, formatBytes, vatFacts } from "./vat-facts.js";
import source from "./webgpu_encodings.ts?raw";

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
camera.position.set(4, 12, 26);
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

// ---------------------------------------------------------------- asset
const soldier = await new GLTFLoader().loadAsync("Soldier.glb");
soldier.scene.updateMatrixWorld(true);
// Soldier's three moving clips; its fourth, TPose, would stand it still.
const clips = soldier.animations.filter((clip) => clip.name !== "TPose");

// ---------------------------------------------------------------- bake
type Encoding = "rig" | "delta";
const maxTextureSize = getMaxTextureSize(renderer);
// One clock for both crowds, so a flip never moves an instance in time.
const time: VATTimeUniform = uniform(0);
// And one set of phases and places: the flip changes the encoding, nothing else.
const phases = Array.from({ length: COUNT }, () => -Math.random() * 10);
const yaws = Array.from({ length: COUNT }, () => Math.PI + (Math.random() - 0.5) * 1.2);

interface Baked {
  vat: VAT;
  ms: number;
  mesh: THREE.InstancedMesh;
}

function bake(encoding: Encoding): Baked {
  const started = performance.now();
  // The encoding, named: the rig would be the default here, and the page sets it beside the other.
  const vat = bakeVAT(soldier.scene, clips, { encoding, maxTextureSize });
  const ms = performance.now() - started;

  // The studio's matte look in place of Soldier's textures.
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
  }

  const instances: VATInstance[] = phases.map((startTime, i) => ({ clip: vat.clips[i % vat.clips.length]!, startTime }));
  const { mesh } = createVATMesh(vat, instances, { time, maxTextureSize });
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // A sunflower spiral, every soldier scaled to the same height.
  const size = vat.bounds.getSize(new THREE.Vector3());
  const scale = 1.8 / size.y;
  const spacing = Math.max(size.x, size.z) * scale * 0.9;
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  for (let i = 0; i < COUNT; i++) {
    const radius = spacing * Math.sqrt(i + 0.5);
    const angle = i * 2.39996; // the golden angle
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaws[i]!);
    const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    mesh.setMatrixAt(i, matrix.compose(position, turn, new THREE.Vector3(scale, scale, scale)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return { vat, ms, mesh };
}

// Both bakes up front: the figure compares them, whichever is on the floor.
const bakes = await forging(() => ({ rig: bake("rig"), delta: bake("delta") }));

// The two textures side by side, a texel the same size in each.
const figure = createTrueScaleFigure(
  [
    { name: "rig", vat: bakes.rig.vat },
    { name: "vertex", vat: bakes.delta.vat },
  ],
  { caption: "both of Soldier's bakes, at one scale: the same three clips" },
);
document.body.append(figure.root);

// ---------------------------------------------------------------- readouts
const setEncoding = readout("encoding");
const setTexture = readout("texture");
const setMemory = readout("texture-memory");
const setBakeTime = readout("bake-time");

let encoding: Encoding = "rig";

function show() {
  bakes.rig.mesh.visible = encoding === "rig";
  bakes.delta.mesh.visible = encoding === "delta";
  // Read off the bake on the floor, and off the textures it wrote.
  const { vat, ms } = bakes[encoding];
  const { width, height } = (vat.encoding === "rig" ? vat.rigTexture : vat.positionTexture).image;
  setEncoding(vat.encoding === "rig" ? "rig" : "vertex");
  setTexture(`${width} × ${height}`);
  setMemory(formatBytes(vatFacts(vat).bytes));
  setBakeTime(formatBakeTime(ms));
}
show();

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.select(
  "encoding",
  [
    ["rig", "rig"],
    ["delta", "vertex"],
  ],
  encoding,
  (value) => {
    encoding = value;
    show();
  },
);
panel.source({ code: source, path: "examples/src/webgpu_encodings.ts" });

// What an encoding costs to draw is part of choosing one: the timings stay on screen.
const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  stats.end();
});
