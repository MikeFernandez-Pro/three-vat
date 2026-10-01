// Use a BatchedMesh, on WebGL: a VAT crowd on a `BatchedMesh` that spawns and dies.
//
// `createVATMesh` builds an `InstancedMesh`; a `BatchedMesh` is wired by hand,
// as the instanced page wires its own mesh. What it buys is three's own
// per-instance frustum culling and depth sorting — the drawn slot becomes a
// permutation that changes every frame, and the decode reads each instance's
// row through the batch's indirect index rather than through the slot.
//
// The playback texture is made from a **capacity**, not from a crowd: its rows
// are reserved once, because a texture does not grow. Instances then come and
// go. `addInstance` reissues the lowest id a dead instance freed, and that row
// still holds the dead one's clip — so every spawn writes its row with
// `setVATInstance` before the instance is ever drawn.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, createVATPlaybackTexture, setVATInstance } from "three-vat";
import { createVATDepthMaterial, createVATUniforms, getMaxTextureSize, patchVATMaterial } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { createFrameStats } from "./frame-stats.js";
import { palette, partColour } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgl_batched.ts?raw";

const CAPACITY = 256;
const COLUMNS = 16; // the field is 16 × 16 cells, one per reserved row

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.append(renderer.domElement);

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();
scene.background = new THREE.Color(palette.studio);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 16, 30);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -18;
key.shadow.camera.right = key.shadow.camera.top = 18;
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
const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
const maxTextureSize = getMaxTextureSize(renderer);
// The studio's matte look in each part's own colour, by material name, *before*
// the bake: flat, the body and the visor merge into one material, their two
// colours moved into the vertices (mergeFlatMaterials), and the one material
// this page brings reads them.
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  for (const material of [object.material].flat() as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, color: partColour(material.name), roughness: 0.9, metalness: 0 });
  }
});
const vat = await forging(() => bakeVAT(gltf.scene, clips, { mergeFlatMaterials: true, maxTextureSize }));

// ---------------------------------------------------------------- by hand
// 1. The rows, reserved from a capacity: none of them live yet.
const playback = createVATPlaybackTexture([], { capacity: CAPACITY, maxTextureSize });
// 2. The clock every material reads.
const uniforms = createVATUniforms();
// 3. A `BatchedMesh` takes one material, at construction: the matte studio
//    look, for the whole crowd.
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
const crowd = new THREE.BatchedMesh(
  CAPACITY,
  vat.geometry.getAttribute("position").count,
  vat.geometry.getIndex()?.count ?? 0,
  material,
);
const geometryId = crowd.addGeometry(vat.geometry);
// 4. The decode, told its carrier, so it reads the pack row through the
//    batch's indirect index. The shadow pass gets the same.
patchVATMaterial(material, vat, uniforms, playback, crowd);
crowd.customDepthMaterial = createVATDepthMaterial(vat, uniforms, playback, crowd);
crowd.castShadow = true;
crowd.receiveShadow = true;
// Per-instance culling and sorting stay on — three's defaults, and the point.
// The batch's own bounds would change with every spawn, so it is not culled
// as a whole.
crowd.frustumCulled = false;
scene.add(crowd);

// ---------------------------------------------------------------- spawn, die
// The library does not allocate ids or remember which rows are live: the
// carrier hands the ids out, and the page keeps the rest.
const size = vat.bounds.getSize(new THREE.Vector3());
const pitch = Math.max(size.x, size.z) * 1.3;
const live: number[] = [];
const clipOfRow = new Map<number, number>(); // the clip each row last held
let reused = 0;
let time = 0;

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const turn = new THREE.Quaternion();
const one = new THREE.Vector3(1, 1, 1);
const up = new THREE.Vector3(0, 1, 0);

function spawn() {
  if (live.length >= CAPACITY) return;
  const id = crowd.addInstance(geometryId);
  // Row `id` stands in cell `id`, so a spawn drops into the hole a death left.
  const x = ((id % COLUMNS) - (COLUMNS - 1) / 2) * pitch;
  const z = (Math.floor(id / COLUMNS) - (COLUMNS - 1) / 2) * pitch;
  turn.setFromAxisAngle(up, Math.PI + (Math.random() - 0.5) * 0.8); // Soldier faces -z
  crowd.setMatrixAt(id, matrix.compose(position.set(x, 0, z), turn, one));

  // A recycled row still holds the last occupant's clip. The newcomer plays
  // the next one, from its first frame — written before it is drawn.
  const previous = clipOfRow.get(id);
  if (previous !== undefined) reused++;
  const clip = previous === undefined ? id % vat.clips.length : (previous + 1) % vat.clips.length;
  clipOfRow.set(id, clip);
  setVATInstance(playback, id, { clip: vat.clips[clip]!, startTime: time });
  live.push(id);
}

function kill() {
  if (live.length === 0) return;
  const [id] = live.splice(Math.floor(Math.random() * live.length), 1);
  crowd.deleteInstance(id!); // its row keeps its pack, until a spawn reuses it
}

// ---------------------------------------------------------------- panel
const setLive = readout("live");
const setReused = readout("reused");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === crowd);

function setPopulation(count: number) {
  while (live.length < count) spawn();
  while (live.length > count) kill();
  setLive(live.length);
  setReused(reused);
}
setPopulation(160);

let churn = 8; // deaths and spawns per second
const panel = createPanel();
panel.slider("live", { min: 0, max: CAPACITY, value: live.length }, setPopulation);
panel.slider("respawns / sec", { min: 0, max: 30, value: churn }, (value) => (churn = value));
panel.source({ code: source, path: "examples/src/webgl_batched.ts" });

// Cost is this page's feature, so its frame timings stay on screen.
const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
let owed = 0;
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  const dt = timer.getDelta();
  time += dt;
  // The churn: one dies, one spawns, as often as the slider says. The
  // population holds while the rows under it are recycled.
  owed += dt * churn;
  for (; owed >= 1 && live.length > 0; owed--) {
    kill();
    spawn();
  }
  if (live.length === 0) owed = 0;
  setLive(live.length);
  setReused(reused);

  uniforms.uVatTime.value = time; // the animation, for every instance
  controls.update();
  renderer.render(scene, camera);
  // Measured: the crowd is one multi-draw per pass, at any population.
  setDraws(formatVATDraws(takeDraws()));
  stats.end();
});
