// Mix characters in one batch, on WebGPU: Soldier, Robot and Michelle, one draw each.
//
// A batch takes one material, and a material samples one VAT. So the three
// bakes are composed into one: an **atlas**, the characters side by side
// (ADR-0040). `composeVATAtlas` hands back that VAT and one geometry a
// character, each with its `skinIndex` moved onto its own columns, and the
// batch adds them in that order. An instance of a character then plays that
// character's own clips, written with `setVATInstance` as on its own VAT.
//
// The characters lose their own materials, because the batch has one. Each
// gets a colour instead, per instance, through three's own
// `BatchedMesh.setColorAt`.
//
// All three dance Michelle's samba, together, in one crowd packed to the
// middle, the characters mixed through it, each dancer turned to one of its
// neighbours. Soldier's and the robot's samba is hers, retargeted onto them by
// author-samba.mjs, which writes each a copy of
// itself with the clip added.
//
// The same program as webgl_atlas.ts, but for the decode (ADR-0011) — and for
// one line more. WebGPU has no multi-draw, so three draws a batch once per
// visible instance; `collapseBatchRuns` folds each run of draws over one
// geometry back into one draw (ADR-0023, ADR-0040). The instances stay grouped
// by character, so that is one draw a character. It reaches into three's
// backend, which is why it is this example's and not the library's.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, composeVATAtlas, createVATPlaybackTexture, setVATInstance, type RigVAT } from "three-vat";
import { getMaxTextureSize, vatNodes, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { headStartOf } from "./desync.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { createFrameStats } from "./frame-stats.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import { formatBytes } from "./vat-facts.js";
import { collapseBatchRuns } from "./webgpu/collapse.js";
import source from "./webgpu_atlas.ts?raw";

// The cast: who and which clips, and the colour each wears, the same in
// either look. `height` is each one standing, in metres: Soldier and Michelle
// their own, the robot a small one. `turn` is the yaw that faces a character
// down +z: Soldier is authored facing back.
const CAST = [
  { file: "Soldier.samba.glb", clips: ["SambaDance"], name: "soldier", colour: 0x14e4ff, height: 1.83, turn: Math.PI },
  { file: "RobotExpressive.samba.glb", clips: ["SambaDance"], name: "robot", colour: 0xff6666, height: 1.2, turn: 0 },
  { file: "Michelle.glb", clips: ["SambaDance"], name: "michelle", colour: 0xc997ff, height: 1.66, turn: 0 },
];
/** How many dance, a multiple of the cast, and the room each has: metres between neighbours, about. */
const DANCERS = 90;
const SPACING = 1.5;
const PER_CHARACTER = DANCERS / CAST.length;

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
// One draw a run (ADR-0023, ADR-0040). `false` where the backend is not
// WebGPU's or three is not the one it knows — then the HUD says so.
const folded = collapseBatchRuns(renderer);

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 10, 21);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
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
const loader = new GLTFLoader();
const gltfs = await loading(() => Promise.all(CAST.map(({ file }) => loader.loadAsync(file))));
// Each character standing, before the bake: its size, which the dance it was
// baked with would overstate, arms up and hips out.
const standing = gltfs.map((gltf) => {
  gltf.scene.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
});
const maxTextureSize = getMaxTextureSize(renderer);
// One bake a character, on the rig encoding: an atlas holds one encoding, and
// the rig's is the far smaller of the two (ADR-0040's table).
const vats = await forging(() =>
  gltfs.map((gltf, k) => {
    gltf.scene.updateMatrixWorld(true);
    const clips = gltf.animations.filter((clip) => CAST[k]!.clips.includes(clip.name));
    return bakeVAT(gltf.scene, clips, { encoding: "rig", maxTextureSize }) as RigVAT;
  }),
);

// ---------------------------------------------------------------- the atlas
// 1. The three bakes as one VAT, and one geometry a character, in this order.
const atlas = composeVATAtlas(vats, { maxTextureSize });
// 2. The rows, one an instance, and the clock the decode reads: a TSL uniform, set per frame.
const playback = createVATPlaybackTexture([], { capacity: DANCERS, maxTextureSize });
const time: VATTimeUniform = uniform(0);
// 3. One batch, one material: the matte studio look, coloured per instance.
const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
const geometries = atlas.characters.map((character) => character.geometry);
const crowd = new THREE.BatchedMesh(
  DANCERS,
  geometries.reduce((n, geometry) => n + geometry.getAttribute("position").count, 0),
  geometries.reduce((n, geometry) => n + geometry.getIndex()!.count, 0),
  material,
);
const geometryIds = geometries.map((geometry) => crowd.addGeometry(geometry));
// 4. The decode, told its carrier and handed the atlas. The shadow pass reads `positionNode` too.
material.positionNode = vatNodes(atlas.vat, { time, playback, carrier: crowd }).positionNode;
crowd.castShadow = true;
crowd.receiveShadow = true;
crowd.frustumCulled = false;
// Nor per instance: three culls a batch's instances against each pass's own
// camera, and on WebGPU a pass can then read another's map from draw to
// instance, drawing one character's shape as another. Every pass draws all.
crowd.perObjectFrustumCulled = false;
// Instances in the order they were added, character by character, so each
// character's draws are one run, and the fold makes each run one draw.
crowd.sortObjects = false;
scene.add(crowd);

// ---------------------------------------------------------------- the crowd
// Every place in the crowd, a sunflower's seeds: packed evenly out from the
// middle, with no hole in it and no rings.
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const places = Array.from({ length: DANCERS }, (_, i) => {
  const radius = SPACING * 0.55 * Math.sqrt(i + 0.5);
  return { at: new THREE.Vector3(Math.sin(i * GOLDEN) * radius, 0, Math.cos(i * GOLDEN) * radius), character: i % CAST.length, yaw: 0 };
});
/** Each place's six nearest, nearest first. */
const neighbours = places.map((place) =>
  places
    .map((other, j) => ({ j, d: other === place ? Infinity : other.at.distanceTo(place.at) }))
    .sort((p, q) => p.d - q.d)
    .slice(0, 6)
    .map(({ j }) => j),
);
// Who dances where: an equal share each, swapped about at random, a swap kept
// when it leaves no more dancers in the crowd beside one of their own. Taken
// in turn, seed by seed, the characters would line up along the sunflower's
// spirals: 28% of neighbours alike, against about 12% once swapped.
const alike = () => places.reduce((n, place, i) => n + neighbours[i]!.filter((j) => places[j]!.character === place.character).length, 0);
for (let n = 0; n < 20000; n++) {
  const [i, j] = [Math.floor(Math.random() * DANCERS), Math.floor(Math.random() * DANCERS)];
  const [p, q] = [places[i]!, places[j]!];
  if (p.character === q.character) continue;
  const before = alike();
  [p.character, q.character] = [q.character, p.character];
  if (alike() > before) [p.character, q.character] = [q.character, p.character];
}
// Each dancer turned to one of its three nearest, picked at random.
places.forEach((place, i) => {
  const partner = places[neighbours[i]![Math.floor(Math.random() * 3)]!]!;
  place.yaw = Math.atan2(partner.at.x - place.at.x, partner.at.z - place.at.z);
});
// The instances are still added character by character, though their places
// interleave: the batch draws them in the order they were added, and the fold
// makes each character's run one draw.
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const colour = new THREE.Color();
/** Each character's colour, the panel's. */
const tints = CAST.map(({ colour }) => new THREE.Color(colour));
/** Which of the cast each instance is, by its id: a pick repaints it. */
const wearer: [id: number, k: number][] = [];
atlas.characters.forEach((character, k) => {
  const { height, turn: facing } = CAST[k]!;
  const scale = new THREE.Vector3().setScalar(height / standing[k]!);
  const clip = character.clips[0]!;
  places
    .filter((place) => place.character === k)
    .forEach(({ at, yaw }, i) => {
      const id = crowd.addInstance(geometryIds[k]!);
      crowd.setMatrixAt(id, matrix.compose(at, turn.setFromAxisAngle(up, yaw + facing), scale));
      wearer.push([id, k]);
      // Each a different moment of the dance, so the crowd does not move in lockstep.
      setVATInstance(playback, id, { clip, startTime: -headStartOf(i, PER_CHARACTER, clip.duration) });
    });
});
/** Paint every dancer its character's colour. */
function paint() {
  for (const [id, k] of wearer) crowd.setColorAt(id, colour.copy(tints[k]!));
}
paint();

// ---------------------------------------------------------------- panel
const setDraws = readout("draw-count");
const setWhy = readout("draw-why");
const takeDraws = countVATDraws(renderer, scene, (object) => object === crowd);
/** Why the count is what it is: WebGPU folds runs, and sorting by depth breaks them. */
function explain() {
  if (!folded) setWhy("three's own count: WebGPU has no multi-draw, so one draw per visible instance per pass");
  else if (crowd.sortObjects) setWhy("WebGPU has no multi-draw: one draw a run, and sorting by depth interleaves the characters");
  else setWhy("WebGPU has no multi-draw: one draw a character, each a run of its instances");
}
explain();

const texture = atlas.vat.rigTexture;
// The atlas against the three VATs it was made from: every character pays for
// the tallest one's rows.
readout("atlas-size")(`${texture.image.width} × ${texture.image.height}, ${formatBytes(texture.image.data!.byteLength)}`);
readout("memory")(formatBytes(vats.reduce((n, vat) => n + vat.rigTexture.image.data!.byteLength, 0)));

const panel = createPanel();
panel.toggle("sort by depth", crowd.sortObjects, (value) => {
  crowd.sortObjects = value;
  explain();
});
const castGroup = panel.group("characters");
CAST.forEach(({ name }, k) =>
  castGroup.color(name, tints[k]!.getHex(), (picked) => {
    tints[k]!.setHex(picked);
    paint();
  }),
);
panel.source({ code: source, path: "examples/src/webgpu_atlas.ts" });

const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  time.value = timer.getElapsed(); // the animation, for every instance
  controls.update();
  renderer.render(scene, camera);
  // Measured: one draw a character per pass, while they stay grouped.
  setDraws(formatVATDraws(takeDraws()));
  stats.end();
});
