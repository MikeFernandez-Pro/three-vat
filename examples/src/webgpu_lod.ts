// Draw far characters simpler, on WebGPU: a field of Soldiers, three levels of
// detail, one bake.
//
// A level is the VAT at a lower detail from the same textures: every vertex
// kept, fewer triangles drawn (ADR-0043). meshoptimizer simplifies Soldier to
// a half and a quarter of his triangles, `createVATLODs` turns the two indices
// into levels, and the batch holds all three geometries. Each frame, an
// instance whose distance asks for another level gets it with three's own
// `setGeometryIdAt`, which keeps its id, so it keeps its row in the playback
// texture: its clip, its phase, mid-stride.
//
// The same program as webgl_lod.ts, but for the decode (ADR-0011) and the
// fold: WebGPU has no multi-draw, so three draws a batch once per visible
// instance, and `collapseBatchRuns` folds each run over one geometry back into
// one draw (ADR-0023). Levels interleave as the camera moves, so the runs are
// shorter than on a one-geometry batch.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptSimplifier } from "three/addons/libs/meshopt_simplifier.module.js";
import { bakeVAT, createVATLODs, createVATPlaybackTexture, setVATInstance } from "three-vat";
import { getMaxTextureSize, vatNodes, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { headStartOf } from "./desync.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { createFrameStats } from "./frame-stats.js";
import { levelFor } from "./levels.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { collapseBatchRuns } from "./webgpu/collapse.js";
import source from "./webgpu_lod.ts?raw";

const SIDE = 40; // a SIDE × SIDE field
const SPACING = 2.2;
const BANDS = [14, 30]; // metres: full detail nearer than 14, half nearer than 30, a quarter past it
const SLACK = 0.1; // a tenth of a band either side before an instance changes level, so none flickers on a boundary
const RATIOS = [0.5, 0.25];
const LEVEL_COLOURS = [palette.cast[0]!, palette.cast[1]!, palette.cast[2]!];

// ---------------------------------------------------------------- renderer
// The canvas clears to nothing, so the backdrop is the page's own colour (theme.css)
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setClearAlpha(0);
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
// One draw a run (ADR-0023).
collapseBatchRuns(renderer);

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 300);
camera.position.set(0, 6, 34);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 18);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(8, 16, 30);
key.target.position.set(0, 0, 18);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -16;
key.shadow.camera.right = key.shadow.camera.top = 16;
key.shadow.camera.far = 80;
key.shadow.bias = -0.0005;
key.shadow.radius = 3; // soft edges, as the studio wants them
scene.add(key, key.target);

scene.add(createFloor(SIDE * SPACING));

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- bake
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
const vat = await forging(() => {
  gltf.scene.updateMatrixWorld(true);
  const clips = gltf.animations.filter((clip) => ["Idle", "Walk", "Run"].includes(clip.name));
  return bakeVAT(gltf.scene, clips, { maxTextureSize: getMaxTextureSize(renderer) });
});

// ---------------------------------------------------------------- the levels
// 1. Simplify: an index over Soldier's own vertices, a ratio of his triangles.
//    meshoptimizer's, as three ships it; the library depends on no simplifier.
await MeshoptSimplifier.ready;
const positions = Float32Array.from(vat.geometry.getAttribute("position").array);
const index = Uint32Array.from(vat.geometry.getIndex()!.array);
const simplify = (ratio: number) => {
  const target = Math.floor((index.length * ratio) / 3) * 3;
  return MeshoptSimplifier.simplify(index, positions, 3, target, 0.05, ["LockBorder"])[0];
};
// 2. The levels: the full detail first, then a half and a quarter.
const lods = createVATLODs(vat, RATIOS.map(simplify));
const geometries = lods.levels.flat();
// 3. The rows, one an instance, and the clock the decode reads: a TSL uniform, set per frame.
const count = SIDE * SIDE;
const playback = createVATPlaybackTexture([], { capacity: count, maxTextureSize: getMaxTextureSize(renderer) });
const time: VATTimeUniform = uniform(0);
// 4. One batch holding every level, added in the order given, each at its own size.
const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
const crowd = new THREE.BatchedMesh(
  count,
  geometries.reduce((n, geometry) => n + geometry.getAttribute("position").count, 0),
  geometries.reduce((n, geometry) => n + geometry.getIndex()!.count, 0),
  material,
);
const levelIds = geometries.map((geometry) => crowd.addGeometry(geometry));
// 5. The decode, handed the VAT with levels — not the bake — and the batch. The shadow pass reads `positionNode` too.
material.positionNode = vatNodes(lods.vat, { time, playback, carrier: crowd }).positionNode;
crowd.castShadow = true;
crowd.receiveShadow = true;
scene.add(crowd);

// ---------------------------------------------------------------- the crowd
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const height = vat.bounds.getSize(new THREE.Vector3()).y;
const scale = new THREE.Vector3().setScalar(1.8 / height); // 1.8 m tall
const where: THREE.Vector3[] = [];
const level = new Int8Array(count); // each instance's level now
for (let i = 0; i < count; i++) {
  const id = crowd.addInstance(levelIds[0]!);
  const at = new THREE.Vector3(((i % SIDE) - (SIDE - 1) / 2) * SPACING, 0, (Math.floor(i / SIDE) - (SIDE - 1) / 2) * SPACING);
  where.push(at);
  turn.setFromAxisAngle(up, (i * 2.4) % (Math.PI * 2));
  crowd.setMatrixAt(id, matrix.compose(at, turn, scale));
  crowd.setColorAt(id, new THREE.Color(palette.body));
  const clip = vat.clips[i % vat.clips.length]!;
  setVATInstance(playback, id, { clip, startTime: -headStartOf(i, count, clip.duration) });
}

// ---------------------------------------------------------------- panel
let levelsOn = true;
let showLevels = false;
const colour = new THREE.Color();
/** Paint an instance by its level when the panel asks, in the characters' body colour otherwise. */
function paint(i: number) {
  crowd.setColorAt(i, colour.setHex(showLevels ? LEVEL_COLOURS[level[i]!]! : palette.body));
}

const panel = createPanel();
panel.toggle("levels of detail", levelsOn, (value) => (levelsOn = value));
panel.toggle("colour by level", showLevels, (value) => {
  showLevels = value;
  for (let i = 0; i < count; i++) paint(i);
});
panel.source({ code: source, path: "examples/src/webgpu_lod.ts" });

const setTriangles = readout("triangles");
const setByLevel = readout("by-level");
const triangles = geometries.map((geometry) => geometry.getIndex()!.count / 3);
readout("levels")(triangles.map((t) => t.toLocaleString("en")).join(" / "));
// The whole crowd's, culled or not: what levels save, against every Soldier at full detail.
readout("without")((count * triangles[0]!).toLocaleString("en"));

const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
const perLevel = [0, 0, 0];
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  time.value = timer.getElapsed(); // the animation, for every instance
  controls.update();

  // The level each instance's distance asks for, from the one it is on, written only where it changed.
  perLevel.fill(0);
  for (let i = 0; i < count; i++) {
    const wanted = levelsOn ? levelFor(camera.position.distanceTo(where[i]!), BANDS, level[i], SLACK) : 0;
    if (wanted !== level[i]) {
      level[i] = wanted;
      crowd.setGeometryIdAt(i, levelIds[wanted]!);
      if (showLevels) paint(i);
    }
    perLevel[wanted]!++;
  }
  setByLevel(perLevel.join(" / "));
  setTriangles(perLevel.reduce((n, instances, l) => n + instances * triangles[l]!, 0).toLocaleString("en"));

  renderer.render(scene, camera);
  stats.end();
});
