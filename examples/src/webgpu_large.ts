// A large mesh, on WebGPU: a bake past the texture ceiling, in rows per frame.
//
// Under the vertex encoding a frame is a row of the texture, one texel per
// vertex, and a GPU caps how wide a texture may be. Michelle has 16 340
// vertices, wider than many GPUs allow. The bake does not refuse her: past
// the ceiling, a frame's vertices continue onto the next row, and
// `vat.rowsPerFrame` says how many rows a frame takes. Both decode paths read
// it. Lower the ceiling and the texture folds narrower and taller, and the
// rows one frame takes up, lit on the texture panel, grow from one to two to
// four. The dance must not change: only the texture's shape does.
//
// The same program as webgl_large.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type DeltaVAT, type VAT, type VATCrowd, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_large.ts?raw";

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
camera.position.set(0, 4, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(8, 16, 10);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -8;
key.shadow.camera.right = key.shadow.camera.top = 8;
key.shadow.camera.far = 60;
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
const gltf = await new GLTFLoader().loadAsync("Michelle.glb");
gltf.scene.updateMatrixWorld(true);
const dance = gltf.animations.filter((clip) => clip.name === "SambaDance");

// The ceilings to try, none above this GPU's own: a bake is only ever told
// the truth about the texture it will be uploaded as.
const gpuMax = getMaxTextureSize(renderer);
const CEILINGS = [16384, 8192, 4096].filter((size) => size <= gpuMax);
if (CEILINGS.length === 0) CEILINGS.push(gpuMax);
// Opens on 8192, where her 16 340 vertices already fold onto two rows; at
// 16384 they fit one.
const OPENING = CEILINGS.includes(8192) ? 8192 : CEILINGS[0]!;

// ---------------------------------------------------------------- crowd
// A small troupe, in two rows facing the camera. Each bake builds its crowd
// again over the same phases.
const time: VATTimeUniform = uniform(0);
const phases = Array.from({ length: 7 }, () => -Math.random() * 10);
const setVertices = readout("vertices");
const setRows = readout("rows-per-frame");
const setTexture = readout("texture");
const setBakeTime = readout("bake-time");

type Crowd = VATCrowd & { vat: VAT; texturePanel: ReturnType<typeof createTexturePanel> };
let shown: Crowd | null = null;
// The texture panel opens with the page, and stays as the visitor leaves it.
let panelOpen = true;

/** Let a crowd go, and the bake under it: nothing else holds either. */
function release({ vat, mesh, playback, texturePanel }: Crowd) {
  texturePanel.root.remove();
  scene.remove(mesh);
  mesh.dispose();
  for (const material of [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial].flat()) material?.dispose();
  playback.texture.dispose();
  vat.geometry.dispose();
  const textures = vat.encoding === "rig" ? [vat.rigTexture] : [vat.positionTexture, vat.normalTexture];
  for (const texture of textures) texture?.dispose();
}

function bakeAt(maxTextureSize: number) {
  // The last bake goes before the next one: at 16 340 vertices a VAT is tens
  // of megabytes.
  if (shown) release(shown);

  // The vertex encoding, named: the rig encoding stores bones, not vertices,
  // and has no vertex ceiling to fold. 15 fps halves the texture of the
  // default 30, and the decode blends between rows.
  const started = performance.now();
  const vat = bakeVAT(gltf.scene, dance, { encoding: "delta", fps: 15, maxTextureSize }) as DeltaVAT;
  setBakeTime(`${Math.round(performance.now() - started)} ms`);

  // The studio's matte look in place of her textures.
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
  }
  const instances: VATInstance[] = phases.map((startTime) => ({ clip: vat.clips[0]!, startTime }));
  const crowd = createVATMesh(vat, instances, { time, maxTextureSize });
  const { mesh } = crowd;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const scale = 1.7 / vat.bounds.getSize(new THREE.Vector3()).y;
  const matrix = new THREE.Matrix4();
  for (const [i] of phases.entries()) {
    const back = i >= 4; // four in front, three behind
    const x = back ? (i - 5) * 2.4 : (i - 1.5) * 2.4;
    matrix.makeScale(scale, scale, scale).setPosition(x, 0, back ? -2.4 : 0);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);

  // The texture this bake wrote, a window of its rows at a time, following the
  // first dancer: the rows her frame takes up are lit, and that is the number
  // the ceiling changes.
  const texturePanel = createTexturePanel([{ name: "Michelle", vat, instances: () => instances }], {
    caption: "24 rows around the first dancer's frame; its own rows lit",
    frameWindow: 24,
  });
  texturePanel.root.style.display = panelOpen ? "flex" : "none";
  document.body.append(texturePanel.root);
  shown = { ...crowd, vat, texturePanel };

  // Read off the bake, and off the texture it wrote.
  const { width, height } = vat.positionTexture.image;
  setVertices(vat.vertexCount.toLocaleString("en"));
  setRows(vat.rowsPerFrame);
  setTexture(`${width} × ${height}`);
}
await forging(() => bakeAt(OPENING));

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.select(
  "texture ceiling",
  CEILINGS.map((size) => [String(size), `${size} px`] as const),
  String(OPENING),
  (value) => void forging(() => bakeAt(Number(value))),
);
panel.toggle("texture panel", panelOpen, (open) => {
  panelOpen = open;
  if (shown) shown.texturePanel.root.style.display = open ? "flex" : "none";
});
panel.source({ code: source, path: "examples/src/webgpu_large.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  if (panelOpen) shown?.texturePanel.update(time.value);
  controls.update();
  renderer.render(scene, camera);
});
