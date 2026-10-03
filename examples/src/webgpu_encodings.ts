// Bake a rigged character, on WebGPU: a skinned character, stored as its posed rig.
//
// `bakeVAT` stores a clip one of two ways. The **rig encoding** stores the
// posed rig, a rotation, a translation and a scale per bone, and skins the
// rest pose in the vertex shader. The **vertex encoding** stores where every
// vertex ended up. A skinned character can take either, and the rig is the
// default wherever the asset allows it. Bake Soldier both ways, flip between
// them, and compare the two textures at one scale: the same clips, the same
// crowd on screen, a fraction of the memory.
//
// And the asset the rig cannot take: RobotExpressive with a face that moves by
// morph targets, which no bone can store. It is baked the vertex way only, and
// its bone button is greyed out with the reason under it.
//
// The same program as webgl_encodings.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type BakeOptions, type VAT, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { createFrameStats } from "./frame-stats.js";
import { palette, wearPart } from "./palette.js";
import { createTrueScaleFigure } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import { formatBakeTime, formatBytes, vatFacts } from "./vat-facts.js";
import source from "./webgpu_encodings.ts?raw";

const COUNT = 60;

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

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(4, 12, 26);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -14;
key.shadow.camera.right = key.shadow.camera.top = 14;
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

// ---------------------------------------------------------------- assets
const loader = new GLTFLoader();
const [soldier, robot] = await loading(() => Promise.all([loader.loadAsync("Soldier.glb"), loader.loadAsync("RobotExpressive.glb")]));
soldier.scene.updateMatrixWorld(true);
robot.scene.updateMatrixWorld(true);
// Soldier's three moving clips; its fourth, TPose, would stand it still.
const soldierClips = soldier.animations.filter((clip) => clip.name !== "TPose");

// RobotExpressive's head carries three morph targets and ships them still, so
// the rig would bake it. Give its Idle a face that moves, "Surprised" up and
// back down, and the rig can no longer store it: a slot moves vertices only as
// a bone would.
function withMovingFace(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) =>
    track.name.endsWith(".morphTargetInfluences")
      ? // Three influences a keyframe: Angry, Surprised, Sad.
        new THREE.NumberKeyframeTrack(track.name, [0, clip.duration / 2, clip.duration], [0, 0, 0, 0, 1, 0, 0, 0, 0])
      : track,
  );
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
const robotClips = [
  withMovingFace(robot.animations.find((clip) => clip.name === "Idle")!),
  ...["Walking", "Dance"].map((name) => robot.animations.find((clip) => clip.name === name)!),
];

// ---------------------------------------------------------------- bake
type Encoding = "rig" | "delta";
type Model = "soldier" | "robot";
const maxTextureSize = getMaxTextureSize(renderer);
// One clock for every crowd, so a flip never moves an instance in time.
const time: VATTimeUniform = uniform(0);
// And one set of phases and places: the flip changes the encoding, nothing else.
const phases = Array.from({ length: COUNT }, () => -Math.random() * 10);
const yaws = Array.from({ length: COUNT }, () => (Math.random() - 0.5) * 1.2);

interface Baked {
  vat: VAT;
  ms: number;
  mesh: THREE.InstancedMesh;
}

// `facing` turns a crowd to the camera: Soldier was modelled looking down -z, the robot down +z.
function bake(root: THREE.Object3D, clips: THREE.AnimationClip[], encoding: BakeOptions["encoding"], facing: number): Baked {
  const started = performance.now();
  // The encoding, named: Soldier is baked both ways, the robot the vertex way.
  const vat = bakeVAT(root, clips, { encoding, maxTextureSize });
  const ms = performance.now() - started;

  // The studio's matte look in place of the asset's own.
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, roughness: 0.9, metalness: 0 });
    wearPart(material);
  }

  const instances: VATInstance[] = phases.map((startTime, i) => ({ clip: vat.clips[i % vat.clips.length]!, startTime }));
  const { mesh } = createVATMesh(vat, instances, { time, maxTextureSize });
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // A sunflower spiral, every character scaled to the same height.
  const size = vat.bounds.getSize(new THREE.Vector3());
  const scale = 1.8 / size.y;
  const spacing = Math.max(size.x, size.z) * scale * 0.9;
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  for (let i = 0; i < COUNT; i++) {
    const radius = spacing * Math.sqrt(i + 0.5);
    const angle = i * 2.39996; // the golden angle
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing + yaws[i]!);
    const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    mesh.setMatrixAt(i, matrix.compose(position, turn, new THREE.Vector3(scale, scale, scale)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return { vat, ms, mesh };
}

// Both of Soldier's bakes up front: the figure compares them, whichever is on the floor.
const bakes = await forging(() => ({
  rig: bake(soldier.scene, soldierClips, "rig", Math.PI),
  delta: bake(soldier.scene, soldierClips, "delta", Math.PI),
}));

// The robot's, the first time it is picked. Never the rig: asked for it by
// name, the bake would refuse, its face moving where no bone does.
let robotBake: Baked | null = null;

// Soldier's two textures side by side, a texel the same size in each.
const figure = createTrueScaleFigure(
  [
    { name: "rig", vat: bakes.rig.vat },
    { name: "vertex", vat: bakes.delta.vat },
  ],
  { caption: "both of Soldier's bakes, at one scale: the same three clips" },
);
document.body.append(figure.root);

// ---------------------------------------------------------------- readouts
const setEncoding = readout("encoding");
const setTexture = readout("texture");
const setMemory = readout("texture-memory");
const setBakeTime = readout("bake-time");

let model: Model = "soldier";
let encoding: Encoding = "rig";

function show() {
  const shownRobot = model === "robot" ? robotBake : null;
  bakes.rig.mesh.visible = !shownRobot && encoding === "rig";
  bakes.delta.mesh.visible = !shownRobot && encoding === "delta";
  if (robotBake) robotBake.mesh.visible = shownRobot !== null;
  // The figure is Soldier's: the robot has no rig texture to set beside its own.
  figure.root.style.display = shownRobot ? "none" : "flex"; // its own style sets display, which `hidden` cannot beat
  // The robot's bone button is greyed out and edged in red, with the reason under it.
  encodingButtons.rig.disabled = shownRobot !== null;
  encodingButtons.rig.classList.toggle("ui-refused", shownRobot !== null);
  rigNote.hidden = shownRobot === null;

  // Read off the bake on the floor, and off the textures it wrote.
  const { vat, ms } = shownRobot ?? bakes[encoding];
  const { width, height } = (vat.encoding === "rig" ? vat.rigTexture : vat.positionTexture).image;
  setEncoding(vat.encoding === "rig" ? "rig" : "vertex");
  setTexture(`${width} × ${height}`);
  setMemory(formatBytes(vatFacts(vat).bytes));
  setBakeTime(formatBakeTime(ms));
}

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.select(
  "model",
  [
    ["soldier", "Soldier (skinned)"],
    ["robot", "Robot (morph targets)"],
  ],
  model,
  async (value) => {
    model = value;
    if (model === "robot") robotBake ??= await forging(() => bake(robot.scene, robotClips, "delta", 0));
    show();
  },
);
// Soldier's two bakes, one button each.
const encodingGroup = panel.group("encoding");
const encodingButton = (label: string, value: Encoding) =>
  encodingGroup.button(label, () => {
    encoding = value;
    show();
  });
const encodingButtons: Record<Encoding, HTMLButtonElement> = {
  delta: encodingButton("Vertex Animation Texture", "delta").querySelector("button")!,
  rig: encodingButton("Bone Animation Texture", "rig").querySelector("button")!,
};
const rigNote = document.createElement("p");
rigNote.className = "ui-note";
rigNote.textContent = "Not for the robot: its face moves by morph targets, and a bone texture holds only bones.";
encodingButtons.rig.after(rigNote);
show();
panel.source({ code: source, path: "examples/src/webgpu_encodings.ts" });

// What an encoding costs to draw is part of choosing one: the timings stay on screen.
const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  stats.end();
});
