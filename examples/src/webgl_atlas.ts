// Mix characters in one batch, on WebGL: Soldier, Robot and Michelle, one draw.
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
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, composeVATAtlas, createVATPlaybackTexture, setVATInstance, type RigVAT } from "three-vat";
import { createVATDepthMaterial, createVATUniforms, getMaxTextureSize, patchVATMaterial } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { headStartOf } from "./desync.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { createFrameStats } from "./frame-stats.js";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import { formatBytes } from "./vat-facts.js";
import source from "./webgl_atlas.ts?raw";

// The cast: who, which clips, and the colour each wears.
const CAST = [
  { file: "Soldier.glb", clips: ["Idle", "Walk", "Run"], colour: palette.cast[0]!, turn: Math.PI },
  { file: "RobotExpressive.glb", clips: ["Idle", "Walking", "Dance", "Wave"], colour: palette.cast[1]!, turn: 0 },
  { file: "Michelle.glb", clips: ["SambaDance"], colour: palette.cast[2]!, turn: 0 },
];
const COLUMNS = 4;
const ROWS = 3; // each character's block of instances
const PER_CHARACTER = COLUMNS * ROWS;

// ---------------------------------------------------------------- renderer
// alpha: the canvas clears to nothing, so the backdrop is the page's own colour (theme.css)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.append(renderer.domElement);

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 9, 21);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(8, 16, 10);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -14;
key.shadow.camera.right = key.shadow.camera.top = 14;
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

// ---------------------------------------------------------------- bake
const loader = new GLTFLoader();
const gltfs = await loading(() => Promise.all(CAST.map(({ file }) => loader.loadAsync(file))));
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
// 2. The rows, one an instance, and the clock every material reads.
const playback = createVATPlaybackTexture([], { capacity: CAST.length * PER_CHARACTER, maxTextureSize });
const uniforms = createVATUniforms();
// 3. One batch, one material: the matte studio look, coloured per instance.
const material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
const geometries = atlas.characters.map((character) => character.geometry);
const crowd = new THREE.BatchedMesh(
  CAST.length * PER_CHARACTER,
  geometries.reduce((n, geometry) => n + geometry.getAttribute("position").count, 0),
  geometries.reduce((n, geometry) => n + geometry.getIndex()!.count, 0),
  material,
);
const geometryIds = geometries.map((geometry) => crowd.addGeometry(geometry));
// 4. The decode, told its carrier and handed the atlas. The shadow pass gets the same.
patchVATMaterial(material, atlas.vat, uniforms, playback, crowd);
crowd.customDepthMaterial = createVATDepthMaterial(atlas.vat, uniforms, playback, crowd);
crowd.castShadow = true;
crowd.receiveShadow = true;
crowd.frustumCulled = false;
// Instances in the order they were added, character by character. WebGL draws
// the batch in one multi-draw either way; the WebGPU page needs the grouping.
crowd.sortObjects = false;
scene.add(crowd);

// ---------------------------------------------------------------- the crowd
// Each character in its own block, each instance playing one of its own
// clips, desynced.
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const colour = new THREE.Color();
atlas.characters.forEach((character, k) => {
  const { colour: hex, turn: facing } = CAST[k]!;
  const height = vats[k]!.bounds.getSize(new THREE.Vector3()).y;
  const scale = new THREE.Vector3().setScalar(1.8 / height); // every character 1.8 m tall
  for (let i = 0; i < PER_CHARACTER; i++) {
    const id = crowd.addInstance(geometryIds[k]!);
    const x = (k - (CAST.length - 1) / 2) * 7.5 + ((i % COLUMNS) - (COLUMNS - 1) / 2) * 1.6;
    const z = (Math.floor(i / COLUMNS) - (ROWS - 1) / 2) * 1.8;
    turn.setFromAxisAngle(up, facing);
    crowd.setMatrixAt(id, matrix.compose(new THREE.Vector3(x, 0, z), turn, scale));
    crowd.setColorAt(id, colour.setHex(hex));
    const clip = character.clips[i % character.clips.length]!;
    setVATInstance(playback, id, { clip, startTime: -headStartOf(i, PER_CHARACTER, clip.duration) });
  }
});

// ---------------------------------------------------------------- panel
const setDraws = readout("draw-count");
const setWhy = readout("draw-why");
const takeDraws = countVATDraws(renderer, scene, (object) => object === crowd);
/** Why the count is what it is: one multi-draw, whatever order the instances are in. */
function explain() {
  setWhy("one multi-draw a pass, every character in it, sorted or not");
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
panel.source({ code: source, path: "examples/src/webgl_atlas.ts" });

const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  uniforms.uVatTime.value = timer.getElapsed(); // the animation, for every instance
  controls.update();
  renderer.render(scene, camera);
  // Measured: every character, one multi-draw per pass.
  setDraws(formatVATDraws(takeDraws()));
  stats.end();
});
