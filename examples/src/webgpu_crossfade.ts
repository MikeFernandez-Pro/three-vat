// Crossfade, on WebGPU: switch clip with a blend, both clips still playing.
//
// Give `setVATInstance` a `fadeDuration` and the clip a soldier was playing is
// not frozen but kept running, read back from its own row, and blended away
// over that many seconds while the new one starts. Each soldier here changes
// its mind on its own timer; the texture panel draws the clip it is leaving as
// a second cursor, still moving down its band as it fades.
//
// The same program as webgl_crossfade.ts, line for line where the library is
// concerned (ADR-0011): `three/webgpu` for the renderer, `three-vat/tsl` for
// the decode, an awaited `init()`, and `drawCalls` where WebGL counts `calls`.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, resolveVATFrame, setVATInstance, type VATInstance, type VATPlaybackState } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_crossfade.ts?raw";

const COUNT = 7;

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
camera.position.set(0, 5, 15);
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
const clips = ["Idle", "Walk", "Run"].map((name) => gltf.animations.find((clip) => clip.name === name)!);
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, clips, { maxTextureSize }));
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- line
const soldiers = Array.from({ length: COUNT }, (_, i) => ({
  playing: i % vat.clips.length, // which clip, by index
  dwell: 2 + Math.random() * 2, // seconds it holds a clip before the next
  due: 0.5 + Math.random() * 2, // when it next switches
}));
// The page's copy of what each row says, kept for the texture panel.
const instances: VATInstance[] = soldiers.map((soldier) => ({
  clip: vat.clips[soldier.playing]!,
  startTime: -Math.random() * 5,
}));
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

const matrix = new THREE.Matrix4();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI); // Soldier faces -z
for (let i = 0; i < COUNT; i++) {
  const x = (i - (COUNT - 1) / 2) * 1.6;
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x, 0, 0), facing, new THREE.Vector3(1, 1, 1)));
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- switch
let fadeDuration = 0.6;

/** One clip playing, without the transition it may be in the middle of. */
const playingOf = ({ from: _from, fadeDuration: _duration, fadeStart: _start, ...playing }: VATInstance): VATPlaybackState =>
  playing;

function switchClip(i: number) {
  const soldier = soldiers[i]!;
  soldier.playing = (soldier.playing + 1) % vat.clips.length;
  const next: VATInstance = { clip: vat.clips[soldier.playing]!, startTime: time.value, fadeDuration };
  // The one write. The clip it leaves is read back from the row and keeps
  // playing under the blend: nothing here describes it.
  setVATInstance(playback, i, next);
  // What the row now holds, `from` and all, for the panel's second cursor.
  instances[i] = { ...next, from: playingOf(instances[i]!) };
}

// ---------------------------------------------------------------- panel
const setBlending = readout("mid-transition");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);
readout("count")(COUNT);

const texturePanel = createTexturePanel([{ name: "Soldier", vat, instances: () => instances }], {
  caption: "one cursor per soldier — two while it crossfades",
});
document.body.append(texturePanel.root);

const panel = createPanel();
panel.slider("fade (s)", { min: 0, max: 1.5, step: 0.1, value: fadeDuration }, (value) => (fadeDuration = value));
panel.source({ code: source, path: "examples/src/webgpu_crossfade.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  for (const [i, soldier] of soldiers.entries()) {
    if (time.value < soldier.due) continue;
    switchClip(i);
    soldier.due = time.value + soldier.dwell;
  }
  controls.update();
  renderer.render(scene, camera);
  texturePanel.update(time.value);
  // Measured off the resolver the shader transcribes: a band still showing.
  const blending = instances.filter((instance) => (resolveVATFrame(instance, time.value).outgoing?.weight ?? 0) > 0);
  setBlending(blending.length);
  setDraws(formatVATDraws(takeDraws()));
});
