// Events, on WebGL: game logic off the clock, with nothing read from the GPU.
//
// A written instance is a pure function of the clock, so the CPU can know
// what the shader is showing without asking it. `endsAt` says the exact moment
// a finite play finishes — here a dash of two runs — and the page schedules
// its event for then: the soldier stops on its mark, the mark lights, and one
// more `setVATInstance` blends it back to idle. `resolveVATFrame` answers the
// shader's own question in between, for the count of who is still running.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, endsAt, resolveVATFrame, setVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_events.ts?raw";

const COUNT = 5;
const RUN_SPEED = 3.4; // metres per second: ours, the clip runs on the spot
const STAGGER = 0.25; // seconds between one soldier's start and the next's

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
scene.fog = new THREE.Fog(palette.studio, 20, 60);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(11, 6, 11);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

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

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 1 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- bake
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const clips = ["Idle", "Run"].map((name) => gltf.animations.find((clip) => clip.name === name)!);
const maxTextureSize = getMaxTextureSize(renderer);
// The vertex encoding, where 'auto' would pick the rig one for Soldier: the rig
// encoding's blend tears Soldier's arms mid-transition today, which a
// page that blends cannot show as its evidence.
const vat = bakeVAT(gltf.scene, clips, { maxTextureSize, encoding: "delta" });
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}
const [idle, run] = vat.clips as [(typeof vat.clips)[number], (typeof vat.clips)[number]];

/** The dash: two runs through the clip, then finished. */
const dash = (startTime: number): VATInstance => ({ clip: run, startTime, repetitions: 2, fadeDuration: 0.2 });

// The length of a dash is known before one is run: its duration, at our pace.
const LANE = RUN_SPEED * endsAt(dash(0))!;

// ---------------------------------------------------------------- line
const soldiers = Array.from({ length: COUNT }, (_, i) => ({
  x: (i - (COUNT - 1) / 2) * 1.8,
  z: -LANE / 2, // where it stands, or where it set off from
  heading: 1, // +z or -z along the lane
  dashing: null as { start: number; end: number } | null,
}));
const instances: VATInstance[] = soldiers.map(() => ({ clip: idle, startTime: -Math.random() * 5 }));
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.frustumCulled = false; // the matrices change every frame
scene.add(mesh);

// A mark on the floor at each end of each lane, lit by the event.
const accent = new THREE.Color(palette.accent);
const unlit = new THREE.Color(palette.floor).offsetHSL(0, 0, -0.06);
const markGeometry = new THREE.CircleGeometry(0.45, 40).rotateX(-Math.PI / 2);
const marks = soldiers.map((soldier) =>
  [-1, 1].map((end) => {
    const mark = new THREE.Mesh(markGeometry, new THREE.MeshStandardMaterial({ color: unlit, roughness: 1 }));
    mark.position.set(soldier.x, 0.01, (end * LANE) / 2);
    mark.receiveShadow = true;
    scene.add(mark);
    return mark;
  }),
);

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const heading = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
const scale = new THREE.Vector3(1, 1, 1);

// ---------------------------------------------------------------- events
// The schedule: what happens when, known at the moment of the write.
const pending: { at: number; index: number }[] = [];
let fired = 0;
let lastEvent: number | null = null;

function go() {
  for (const [i, soldier] of soldiers.entries()) {
    if (soldier.dashing) continue; // still on its way
    soldier.heading = soldier.z < 0 ? 1 : -1;
    for (const mark of marks[i]!) mark.material.color.copy(unlit);
    instances[i] = dash(time.value + i * STAGGER);
    setVATInstance(playback, i, instances[i]!);
    const end = endsAt(instances[i]!)!; // the moment the dash is over
    soldier.dashing = { start: instances[i]!.startTime, end };
    pending.push({ at: end, index: i });
  }
}

/** The event: the soldier is on its mark. One more write, and the mark lights. */
function arrive(i: number, at: number) {
  const soldier = soldiers[i]!;
  soldier.z += soldier.heading * LANE;
  soldier.dashing = null;
  instances[i] = { clip: idle, startTime: at, fadeDuration: 0.3 };
  setVATInstance(playback, i, instances[i]!);
  marks[i]![soldier.heading > 0 ? 1 : 0]!.material.color.copy(accent);
  fired++;
  lastEvent = at;
}

function place() {
  for (const [i, soldier] of soldiers.entries()) {
    // Along the lane at our pace, for exactly as long as the dash plays.
    const trip = soldier.dashing;
    const covered = trip ? RUN_SPEED * THREE.MathUtils.clamp(time.value - trip.start, 0, trip.end - trip.start) : 0;
    position.set(soldier.x, 0, soldier.z + soldier.heading * covered);
    heading.setFromAxisAngle(up, soldier.heading > 0 ? Math.PI : 0); // Soldier faces -z
    mesh.setMatrixAt(i, matrix.compose(position, heading, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- panel
const setRunning = readout("running");
const setFired = readout("events-fired");
const setLast = readout("last-event");

const panel = createPanel();
panel.button("go", go);
panel.source({ code: source, path: "examples/src/webgl_events.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  // Fire whatever is due, at the moment it was due rather than this frame's.
  for (let k = pending.length - 1; k >= 0; k--) {
    const { at, index } = pending[k]!;
    if (at > time.value) continue;
    pending.splice(k, 1);
    arrive(index, at);
  }
  place();
  controls.update();
  renderer.render(scene, camera);
  // Who is mid-dash, asked as the shader would: started, and not finished.
  const running = instances.filter((instance) => {
    const frame = resolveVATFrame(instance, time.value);
    return instance.clip === run && time.value >= instance.startTime && !frame.finished;
  });
  setRunning(running.length);
  setFired(fired);
  setLast(lastEvent === null ? "—" : `${lastEvent.toFixed(2)} s`);
});
