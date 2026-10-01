// Events, on WebGL: game logic off the clock, with nothing read from the GPU.
//
// The gameplay problem: the GPU plays the clip, so the CPU never sees it end,
// and a game has to react the moment it does. Reading the answer back from
// the GPU would stall the frame, and it need not: a written instance is a pure
// function of the clock, so the CPU can know what the shader is showing
// without asking it. `endsAt` says the exact moment a finite play finishes —
// here a dash of two runs — and the page schedules its event for then: the
// soldier stops on its mark, the mark lights, and one more `setVATInstance`
// blends it back to idle. `resolveVATFrame` answers the shader's own question
// in between, for the count of who is still running.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, endsAt, resolveVATFrame, setVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_events.ts?raw";

const COUNT = 5;
const RUN_SPEED = 3.4; // metres per second: ours, the clip runs on the spot
const STAGGER = 0.25; // seconds between one soldier's start and the next's
const SETTLE = 0.3; // seconds an arrival takes to blend back into idle

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
camera.position.set(11, 6, 11);
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
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const clips = ["Idle", "Run"].map((name) => gltf.animations.find((clip) => clip.name === name)!);
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, clips, { maxTextureSize }));
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
  facing: 1, // the way it stands while it waits: down the lane, or the way it came
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
//
// A press of go is a wave — the whole line, staggered — and a wave only
// leaves a line at rest. Pressed while one is still out, it is *queued* for
// the moment the last soldier has settled onto its mark, which is known the
// moment go is pressed: every arrival is an `endsAt`. So spamming go never
// splits the line, never turns a soldier round mid-dash, and never writes a
// dash over an idle that is still fading in — the one blend the pack cannot
// keep, since a transition remembers one band to leave, not two.
type Scheduled = { at: number; index: number } | { at: number; wave: true };
const pending: Scheduled[] = [];
let fired = 0;
let lastEvent: number | null = null;
let queued = false; // a wave waiting for the line to settle
let restsAt = 0; // when the last soldier to arrive has faded into idle

/** A wave, starting at `start`: every soldier dashes back the way it came. */
function launch(start: number) {
  for (const [i, soldier] of soldiers.entries()) {
    soldier.heading = soldier.z < 0 ? 1 : -1;
    for (const mark of marks[i]!) mark.material.color.copy(unlit);
    instances[i] = dash(start + i * STAGGER);
    setVATInstance(playback, i, instances[i]!);
    const end = endsAt(instances[i]!)!; // the moment the dash is over
    soldier.dashing = { start: instances[i]!.startTime, end };
    pending.push({ at: end, index: i });
    restsAt = Math.max(restsAt, end + SETTLE);
  }
}

function go() {
  if (queued) return; // one wave waiting is enough: the next press is the same wave
  if (time.value >= restsAt) return launch(time.value);
  queued = true;
  goButton.textContent = "go — queued";
  pending.push({ at: restsAt, wave: true });
}

/** The event: the soldier is on its mark. One more write, and the mark lights. */
function arrive(i: number, at: number) {
  const soldier = soldiers[i]!;
  soldier.z += soldier.heading * LANE;
  soldier.dashing = null;
  soldier.facing = soldier.heading;
  instances[i] = { clip: idle, startTime: at, fadeDuration: SETTLE };
  setVATInstance(playback, i, instances[i]!);
  marks[i]![soldier.heading > 0 ? 1 : 0]!.material.color.copy(accent);
  fired++;
  lastEvent = at;
}

/** Everything due by `now`, earliest first, each at the moment it was due. */
function fire(now: number) {
  for (;;) {
    let next = -1;
    for (let k = 0; k < pending.length; k++) {
      if (pending[k]!.at <= now && (next < 0 || pending[k]!.at < pending[next]!.at)) next = k;
    }
    if (next < 0) return;
    const [event] = pending.splice(next, 1);
    if ("wave" in event!) {
      queued = false;
      goButton.textContent = "go";
      launch(event.at); // and its arrivals, should they be due already, next in turn
    } else {
      arrive(event!.index, event!.at);
    }
  }
}

function place() {
  for (const [i, soldier] of soldiers.entries()) {
    // Along the lane at our pace, for exactly as long as the dash plays.
    const trip = soldier.dashing;
    const covered = trip ? RUN_SPEED * THREE.MathUtils.clamp(time.value - trip.start, 0, trip.end - trip.start) : 0;
    position.set(soldier.x, 0, soldier.z + soldier.heading * covered);
    // Still waiting for its turn in the wave, it faces the way it arrived.
    const facing = trip && time.value < trip.start ? soldier.facing : soldier.heading;
    heading.setFromAxisAngle(up, facing > 0 ? Math.PI : 0); // Soldier faces -z
    mesh.setMatrixAt(i, matrix.compose(position, heading, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- panel
const setRunning = readout("running");
const setFired = readout("events-fired");
const setLast = readout("last-event");

const panel = createPanel();
const goButton = panel.button("go", go).querySelector("button")!;
panel.source({ code: source, path: "examples/src/webgl_events.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  // Fire whatever is due, at the moment it was due rather than this frame's.
  fire(time.value);
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
