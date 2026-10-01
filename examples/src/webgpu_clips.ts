// Clips, on WebGPU: switch one instance's clip, and touch no other.
//
// A crowd from `createVATMesh` is one playback texture, a row per instance. To
// change what one robot plays, write its row with `setVATInstance`, a clip and
// the moment it starts, and that row alone goes up to the GPU. Here the write
// is a shot: click a robot and it switches to Death. The page diffs the
// texture around every shot, so the figure it states is counted off the bytes,
// not assumed.
//
// The end of Death is `endsAt` of the write, known the moment the shot lands,
// with nothing read back from the GPU. Then the robot turns round
// (`turnVATInstance`) and plays its death backwards, alive again, and idles.
// A robot falling or getting up ignores shots: each death plays out in full.
//
// The same program as webgl_clips.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, an awaited `init()`, and `drawCalls` where WebGL counts `calls`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, endsAt, LoopMode, setVATInstance, turnVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { ended, endOf, pickInstance, shot, type Phase, type Step } from "./shooting-gallery.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_clips.ts?raw";

const COUNT = 6;
/** A reticle for the cursor, in the accent, centred on the point it shoots. */
const RETICLE = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" stroke="#${palette.accent.toString(16).padStart(6, "0")}" stroke-width="2">` +
    '<circle cx="16" cy="16" r="9"/><path d="M16 1v8M16 23v8M1 16h8M23 16h8"/></svg>',
)}") 16 16, crosshair`;

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
camera.position.set(0, 4, 13);
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
const gltf = await loading(() => new GLTFLoader().loadAsync("RobotExpressive.glb"));
gltf.scene.updateMatrixWorld(true);
const clips = ["Idle", "Death"].map((name) => gltf.animations.find((clip) => clip.name === name)!);
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, clips, { mergeFlatMaterials: true, maxTextureSize }));
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ roughness: 0.8, metalness: 0 });
}
const [idle, death] = vat.clips as [(typeof vat.clips)[number], (typeof vat.clips)[number]];
// Death plays faster than authored, so the gallery keeps its rhythm. The revive
// is the same write turned round, so it gets up as fast as it fell.
let deathSpeed = 1.75;

// ---------------------------------------------------------------- gallery
// One row of robots, idling out of step, none behind another. `instances` is
// the page's own copy of what each row of the playback texture says, kept for the
// texture panel; `robots`, what each is doing and when that next changes.
const instances: VATInstance[] = Array.from({ length: COUNT }, () => ({ clip: idle, startTime: -Math.random() * 5 }));
const robots = instances.map(() => ({ phase: "idle" as Phase, next: null as number | null }));
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

// A robot is picked by the box it stands in, before any clip moves it: a
// fallen robot is still hit where it stood.
const standing = new THREE.Box3().setFromObject(gltf.scene);
const size = standing.getSize(new THREE.Vector3());
const scale = 1.8 / size.y; // RobotExpressive is authored a few metres tall
const spacing = Math.max(size.x, size.z) * scale * 1.6;
const placed = Array.from({ length: COUNT }, (_, i) => {
  const x = (i - (COUNT - 1) / 2) * spacing;
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.6);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0), turn, new THREE.Vector3(scale, scale, scale));
});
placed.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- shots
const data = playback.texture.image.data as Float32Array;
const stride = data.length / playback.count; // floats per instance row

/** How many rows of the playback texture differ from `before`. */
function rowsChanged(before: Float32Array): number {
  let rows = 0;
  for (let row = 0; row < playback.count; row++) {
    for (let at = row * stride; at < (row + 1) * stride; at++) {
      if (data[at] !== before[at]) {
        rows++;
        break;
      }
    }
  }
  return rows;
}

/**
 * Make the one write a step asks for, at `at`: Death or Idle from its first
 * frame, or a turn at the pose the robot shows. Each is a cut, so a turn never
 * meets a blend. When the clip written ends is `endsAt` of the write, known
 * now, with nothing read back from the GPU, and that is when the robot next
 * changes by itself.
 */
function apply(i: number, { phase, write }: Step, at: number) {
  if (write === "turn") {
    instances[i] = turnVATInstance(playback, i, at);
  } else {
    instances[i] = write === "death" ? { clip: death, startTime: at, loopMode: LoopMode.Once, speed: deathSpeed } : { clip: idle, startTime: at };
    setVATInstance(playback, i, instances[i]!);
  }
  robots[i] = { phase, next: endOf(phase, endsAt(instances[i]!)) };
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function shootAt(event: PointerEvent) {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const i = pickInstance(raycaster.ray, standing, placed);
  const before = data.slice();
  if (i !== null) {
    const step = shot(robots[i]!.phase);
    if (step) apply(i, step, time.value);
  }
  setRows(rowsChanged(before)); // a miss, or a robot not yet back up, writes nothing, and says so
}

/** Every phase that has ended by `now`, each moved on at the moment it ended rather than this frame's. */
function endPhases(now: number) {
  for (let i = 0; i < COUNT; i++) {
    for (let robot = robots[i]!; robot.phase !== "idle" && robot.next !== null && robot.next <= now; robot = robots[i]!) {
      apply(i, ended(robot.phase), robot.next);
    }
  }
}

// A click shoots; a drag orbits, and shoots nothing.
let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (event) => (down = { x: event.clientX, y: event.clientY }));
renderer.domElement.addEventListener("pointerup", (event) => {
  if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) shootAt(event);
  down = null;
});
renderer.domElement.style.cursor = RETICLE;

// ---------------------------------------------------------------- panel
const setRows = readout("rows-changed");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);
readout("count")(COUNT);

const texturePanel = createTexturePanel([{ name: "RobotExpressive", vat, instances: () => instances }], {
  caption: "one cursor per robot",
});
document.body.append(texturePanel.root);

const panel = createPanel();
// Temporary, to settle the death's speed by eye; it goes once the value is set.
panel.slider("death speed", { min: 0.5, max: 3, step: 0.05, value: deathSpeed }, (value) => (deathSpeed = value));
panel.source({ code: source, path: "examples/src/webgpu_clips.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  endPhases(time.value);
  controls.update();
  renderer.render(scene, camera);
  texturePanel.update(time.value);
  setDraws(formatVATDraws(takeDraws()));
});
