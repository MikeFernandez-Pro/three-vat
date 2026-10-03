// Animated crowd, on WebGL: the shortest path from a glTF to a crowd.
//
// Bake the clips once with `bakeVAT`, describe each soldier as a clip and a
// start time, and hand both to `createVATMesh`. Every soldier then animates on
// the GPU — its own clip, its own phase, its own rate — and the crowd draws in
// one call however many there are. Nothing per soldier happens on
// the CPU after this file's last setup line: the loop writes one number.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera, limitsFor } from "./camera-limits.js";
import { framingDistance } from "./crowd-framing.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { createFrameStats } from "./frame-stats.js";
import { onLook, palette, partColour, wearPart } from "./palette.js";
import { paint, verticesOf } from "./repaint.js";
import { createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgl_crowd.ts?raw";

const MAX_COUNT = 500;

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
camera.position.set(0, 22, 44);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
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
// Soldier's three moving clips; its fourth, TPose, would stand a soldier still.
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
// This GPU's real texture ceiling: the one renderer-shaped input to a bake.
const maxTextureSize = getMaxTextureSize(renderer);
// A draw call is per material, not per clip or per soldier, and Soldier has two:
// its body and its visor, each with its own texture. The studio's matte look
// goes on both *before* the bake, each in its own colour, so nothing tells
// them apart but their names and their colour, and `mergeFlatMaterials`
// folds them into one, the two colours moved into the vertices. The crowd
// draws once.
const materials = new Set<THREE.MeshStandardMaterial>();
gltf.scene.traverse((object) => {
  if ((object as THREE.Mesh).isMesh) materials.add((object as THREE.Mesh).material as THREE.MeshStandardMaterial);
});
for (const material of materials) {
  material.setValues({ map: null, normalMap: null, roughness: 0.9, metalness: 0 });
  wearPart(material);
}
const vat = await forging(() => bakeVAT(gltf.scene, clips, { mergeFlatMaterials: true, maxTextureSize }));

// ---------------------------------------------------------------- crowd
// One instance per soldier: a clip, and a start time in the past. The start
// time is the desync — it moves nobody, it only says how far into its clip a
// soldier already is — and the rate varies the rest.
const instances: VATInstance[] = [];
for (let i = 0; i < MAX_COUNT; i++) {
  instances.push({
    clip: vat.clips[i % vat.clips.length]!,
    startTime: -Math.random() * 10,
    speed: 0.8 + Math.random() * 0.4,
  });
}

const { mesh, time } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

// Placing them is ours: a sunflower spiral, so the first N soldiers of the
// full crowd are always a round crowd of N.
const size = vat.bounds.getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 0.8;
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const homes: THREE.Vector3[] = []; // where each soldier stands, for the camera to frame
for (let i = 0; i < MAX_COUNT; i++) {
  const radius = spacing * Math.sqrt(i + 0.5);
  const angle = i * 2.39996; // the golden angle
  // Soldier is authored facing -z; turned to face the camera, give or take.
  turn.setFromAxisAngle(up, Math.PI + (Math.random() - 0.5) * 1.2);
  homes.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  matrix.compose(homes[i]!, turn, new THREE.Vector3(1, 1, 1));
  mesh.setMatrixAt(i, matrix);
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- framing
// The camera frames the soldiers on show: a close-up of the one soldier, then
// backing off as the count goes up, to where the page starts, which frames all
// of them (crowd-framing.ts). It looks at the middle of the soldiers drawn —
// the one soldier, then the crowd's centre as it fills in round it. Along the
// camera's own line, so an orbit is kept; eased, so a drag of the count is a
// dolly; and dropped the moment a hand takes the camera, so it never fights
// the wheel.
const FULL = camera.position.distanceTo(controls.target);
const CLOSE = size.y * 4; // one soldier, about a third of the frame's height
const LOOK_HEIGHT = controls.target.y; // the page's own: about a soldier's chest
/** Where the camera is easing to, while it is. */
let framing: { distance: number; target: THREE.Vector3 } | null = null;
const offset = new THREE.Vector3();

/** The middle of the first `count` soldiers, at the height the camera looks at. */
function middleOf(count: number): THREE.Vector3 {
  const middle = new THREE.Vector3();
  for (let i = 0; i < count; i++) middle.add(homes[i]!);
  return middle.divideScalar(count).setY(LOOK_HEIGHT);
}

/** Look at `target` from `distance`, along the line the camera looks along now. */
function placeCamera(target: THREE.Vector3, distance: number) {
  offset.subVectors(camera.position, controls.target).setLength(distance);
  controls.target.copy(target);
  camera.position.copy(target).add(offset);
}

/** The zoom limits round a framing, widened to take in the camera on its way there. */
function limitAround(goal: number) {
  const { minDistance, maxDistance } = limitsFor(goal);
  const at = camera.position.distanceTo(controls.target);
  controls.minDistance = Math.min(minDistance, at);
  controls.maxDistance = Math.max(maxDistance, at);
}

/** Frame the first `count` soldiers: eased there, or straight there for the first frame. */
function frameCount(count: number, ease: boolean) {
  const goal = { distance: framingDistance(count, MAX_COUNT, CLOSE, FULL), target: middleOf(count) };
  framing = ease ? goal : null;
  if (!ease) placeCamera(goal.target, goal.distance);
  limitAround(goal.distance);
}

const EASE = 10; // how fast the camera closes on its framing: higher is quicker
const easedTarget = new THREE.Vector3();

/** One frame's step of the framing, while there is one. */
function frame(delta: number) {
  if (framing === null) return;
  const distance = THREE.MathUtils.damp(camera.position.distanceTo(controls.target), framing.distance, EASE, delta);
  // The same ease for the target, as a share of the way still to go.
  easedTarget.copy(controls.target).lerp(framing.target, 1 - Math.exp(-EASE * delta));
  const arrived = Math.abs(distance - framing.distance) < 0.01 && easedTarget.distanceTo(framing.target) < 0.01;
  if (arrived) placeCamera(framing.target, framing.distance);
  else placeCamera(easedTarget, distance);
  limitAround(framing.distance);
  if (arrived) framing = null;
}
controls.addEventListener("start", () => (framing = null));

// ---------------------------------------------------------------- panel
const setCount = readout("count");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);

function showCount(count: number, ease = true) {
  // Draw the first `count` soldiers; the rest stay resident, and unread.
  mesh.count = count;
  setCount(count);
  frameCount(count, ease);
}
showCount(1, false);

const panel = createPanel();
panel.slider("count", { min: 1, max: MAX_COUNT, value: 1 }, showCount);
// The soldiers' colours, a picker per part. The merge left one white material and
// moved each part's colour into the vertices, so it is those vertices that are
// repainted: found once by the colour the bake wrote, painted on every pick.
const colours = vat.geometry.getAttribute("color") as THREE.BufferAttribute;
const colourGroup = panel.group("soldier");
for (const [label, part] of [
  ["body", "VanguardBodyMat"],
  ["visor", "Vanguard_VisorMat"],
] as const) {
  const vertices = verticesOf(colours.array, new THREE.Color(partColour(part)));
  const swatch = colourGroup.color(label, partColour(part), (picked) => {
    paint(colours.array, vertices, new THREE.Color(picked));
    colours.needsUpdate = true;
  });
  // A change of look paints the part the look's colour, picked or not.
  onLook(() => {
    paint(colours.array, vertices, new THREE.Color(partColour(part)));
    colours.needsUpdate = true;
    swatch.querySelector("input")!.value = `#${new THREE.Color(partColour(part)).getHexString()}`;
  });
}

panel.source({ code: source, path: "examples/src/webgl_crowd.ts" });

// Cost is this page's feature, so its frame timings stay on screen.
const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  time.value = timer.getElapsed(); // the one line that animates every soldier
  frame(Math.min(timer.getDelta(), 0.1)); // a tab left in the background does not jump
  controls.update();
  renderer.render(scene, camera);
  // Measured: the renderer's own count, kept for the crowd's draws alone —
  // the shadow pass beside them, the floor and the rest of the studio left out.
  setDraws(formatVATDraws(takeDraws()));
  stats.end();
});
