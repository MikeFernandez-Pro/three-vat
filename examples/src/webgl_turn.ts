// Reverse mid-stride, on WebGL: an instance retracing its path from the pose
// it shows.
//
// `turnVATInstance` reads one soldier's row back out of the playback texture
// and writes it turned round at the given moment: from then on it shows at
// `time + x` the pose it showed at `time - x`. A walker backs up, legs and all,
// from wherever its stride was — with nothing to keep on the CPU but the
// instance it hands back. The page moves each soldier along its lane by the
// sign of that instance's speed, and turns it at the end of the lane.
//
// `pauseVATInstance` stops one soldier's own clock while the shared one runs
// on, and `resumeVATInstance` carries on from exactly there (ADR-0041). Paused
// mid-way into a run, the blend stops too; a turn on a paused soldier leaves
// it where it is, because a soldier standing still has nothing to retrace.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  bakeVAT,
  pauseVATInstance,
  resolveVATFrame,
  resumeVATInstance,
  setVATInstance,
  turnVATInstance,
  type VATInstance,
  type VATPlaybackState,
} from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette, partColour } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_turn.ts?raw";

const COUNT = 5;
const LANE = 4; // metres either side of the line the lanes cross
const WALK_SPEED = 1.3; // metres per second: ours, the clip walks on the spot
const RUN_SPEED = 3.2;
const FADE = 2; // seconds from a walk into a run: long enough to pause in the middle of

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
const run = gltf.animations.find((clip) => clip.name === "Run")!;
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, [walk, run], { maxTextureSize }));
const [walking, running] = vat.clips as [(typeof vat.clips)[number], (typeof vat.clips)[number]];
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: partColour(material.name), roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- lanes
// Five walkers, each somewhere along its own lane and somewhere in its stride.
const instances: VATInstance[] = Array.from({ length: COUNT }, () => ({
  clip: walking,
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
let ignored = 0;
let jump = 0;

/**
 * Turn soldier `i` round now. The pose either side of the turn is asked of
 * `resolveVATFrame`, the shader's own arithmetic, so the jump the page reports
 * is measured rather than promised — for a soldier on one clip, since mid-blend
 * the turn swaps which band is live.
 */
function turn(i: number) {
  const before = resolveVATFrame(instances[i]!, time.value);
  const turned = turnVATInstance(playback, i, time.value); // the one write
  // Paused, the turn writes nothing and hands the paused soldier back.
  if (turned.pausedAt !== undefined) {
    ignored++;
    return;
  }
  instances[i] = turned;
  const after = resolveVATFrame(turned, time.value);
  if (!before.outgoing?.weight) {
    const frames = turned.clip.frames;
    const d = Math.abs(before.row + before.mix - (after.row + after.mix));
    jump = Math.max(jump, Math.min(d, frames - d)); // across the seam, the short way round
  }
  turns++;
}

/** Metres per second one band moves a soldier: its clip's pace, in the direction it plays. */
const paceOf = (band: VATPlaybackState) =>
  Math.sign(band.speed ?? 1) * (band.clip.startFrame === running.startFrame ? RUN_SPEED : WALK_SPEED);

/**
 * How fast soldier `i` goes along its lane: both bands' paces, mixed as the
 * shader mixes their poses — and nothing while it is paused, its blend stopped.
 */
function pace(i: number): number {
  const instance = instances[i]!;
  if (instance.pausedAt !== undefined) return 0;
  const weight = resolveVATFrame(instance, time.value).outgoing?.weight ?? 0;
  return paceOf(instance) * (1 - weight) + (instance.from ? paceOf(instance.from) * weight : 0);
}

// ---------------------------------------------------------------- pause
/** Stop every soldier's own clock now, or start them all again from where they stopped. */
function setPaused(paused: boolean) {
  for (let i = 0; i < COUNT; i++) {
    instances[i] = (paused ? pauseVATInstance : resumeVATInstance)(playback, i, time.value); // one write each
  }
  gait.disabled = paused;
}

/**
 * Walk into a run, or a run back into a walk, over {@link FADE} seconds. The
 * band being left is written as the page holds it, so the copy here stays the
 * row the shader reads.
 */
function changeGait() {
  for (let i = 0; i < COUNT; i++) {
    const { from: _from, fadeDuration: _fadeDuration, fadeStart: _fadeStart, ...leaving } = instances[i]!;
    const next = instances[i]!.clip.startFrame === running.startFrame ? walking : running;
    instances[i] = { clip: next, startTime: time.value, from: leaving, fadeDuration: FADE };
    setVATInstance(playback, i, instances[i]!);
  }
}

// ---------------------------------------------------------------- panel
const setTurns = readout("turns");
const setBacking = readout("backing-up");
const setJump = readout("pose-jump");
const setPausedCount = readout("paused");
const setIgnored = readout("turns-ignored");

const texturePanel = createTexturePanel([{ name: "Soldier", vat, instances: () => instances }], {
  caption: "one cursor per soldier",
});
document.body.append(texturePanel.root);

const panel = createPanel();
panel.button("turn", () => {
  for (let i = 0; i < COUNT; i++) turn(i);
});
// A change of gait is a new animation, written while the soldiers play; it
// would clear their pause, so it waits for the resume.
const gait = panel.button("walk ⇄ run", changeGait).querySelector("button")!;
panel.toggle("pause", false, setPaused);
panel.source({ code: source, path: "examples/src/webgl_turn.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  time.value = timer.getElapsed();
  for (let i = 0; i < COUNT; i++) {
    const speed = pace(i);
    along[i]! += speed * dt;
    // The end of the lane turns a soldier, whichever way it is going.
    if (Math.abs(along[i]!) > LANE && Math.sign(along[i]!) === Math.sign(speed)) turn(i);
  }
  place();
  controls.update();
  renderer.render(scene, camera);
  texturePanel.update(time.value);
  setTurns(turns);
  setBacking(instances.filter((_, i) => pace(i) < 0).length);
  setJump(`${jump.toFixed(2)} rows`);
  setPausedCount(instances.filter((instance) => instance.pausedAt !== undefined).length);
  setIgnored(ignored);
});
