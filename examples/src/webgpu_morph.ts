// Morph targets and node animation, on WebGPU: a non-skinned source, baked.
//
// The Horse has no skeleton. It gallops by morph targets, fifteen shapes
// blended in turn, and `bakeVAT` bakes that as it bakes a skin: it plays the
// clip and writes down where every vertex went. The rig encoding cannot store
// a morph, so the default falls back to the vertex encoding by itself. Node
// animation, a track that moves a whole part, bakes the same way. Add one to
// the clip and it lands in the same texture.
//
// The same program as webgl_morph.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VAT, type VATCrowd, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { addFloorControls } from "./floor-fade.js";
import { forging } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_morph.ts?raw";

const COUNT = 12;

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
camera.position.set(0, 8, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
controls.enableDamping = true;
const cameraLimits = limitCamera(controls);

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

const floor = createFloor(camera.position.distanceTo(controls.target));
scene.add(floor.mesh);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- asset
const gltf = await new GLTFLoader().loadAsync("Horse.glb");
gltf.scene.updateMatrixWorld(true);
const horse = gltf.scene.getObjectByProperty("type", "Mesh") as THREE.Mesh;
const gallop = gltf.animations[0]!;

// Node animation, written here: the horse's one part rocking nose-down and
// back twice a stride, as a quaternion track on its node.
function withRock(clip: THREE.AnimationClip): THREE.AnimationClip {
  const times = [0, 0.25, 0.5, 0.75, 1].map((t) => t * clip.duration);
  const pitch = [0, 0.08, 0, -0.08, 0];
  const values = pitch.flatMap((angle) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle).toArray());
  const rock = new THREE.QuaternionKeyframeTrack(`${horse.name}.quaternion`, times, values);
  return new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks, rock]);
}

// ---------------------------------------------------------------- bake
const maxTextureSize = getMaxTextureSize(renderer);
const time: VATTimeUniform = uniform(0);
const phases = Array.from({ length: COUNT }, () => -Math.random() * 2);
const setEncoding = readout("encoding");
const setMorphs = readout("morph-targets");
const setNodeTracks = readout("node-tracks");
setMorphs(horse.morphTargetInfluences?.length ?? 0);

type Crowd = VATCrowd & { vat: VAT };
let shown: Crowd | null = null;

/** Let a crowd go, and the bake under it: nothing else holds either. */
function release({ vat, mesh, playback }: Crowd) {
  scene.remove(mesh);
  mesh.dispose();
  for (const material of [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial].flat()) material?.dispose();
  playback.texture.dispose();
  vat.geometry.dispose();
  const textures = vat.encoding === "rig" ? [vat.rigTexture] : [vat.positionTexture, vat.normalTexture];
  for (const texture of textures) texture?.dispose();
}

function bake(rock: boolean) {
  if (shown) release(shown);
  const clip = rock ? withRock(gallop) : gallop;
  // Nothing about the source to declare: the default encoding sees the morphs
  // and bakes vertices.
  const vat = bakeVAT(gltf.scene, [clip], { maxTextureSize });

  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    material.setValues({ vertexColors: false, color: palette.character, roughness: 0.9, metalness: 0 });
  }
  const instances: VATInstance[] = phases.map((startTime) => ({ clip: vat.clips[0]!, startTime }));
  const crowd = createVATMesh(vat, instances, { time, maxTextureSize });
  const { mesh } = crowd;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // A herd in three staggered rows, side on to the camera.
  const scale = 2.4 / vat.bounds.getSize(new THREE.Vector3()).y;
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  for (let i = 0; i < COUNT; i++) {
    const row = i % 3;
    const position = new THREE.Vector3((Math.floor(i / 3) - 1.5) * 5 + (row - 1) * 1.6, 0, (row - 1) * 3.2);
    mesh.setMatrixAt(i, matrix.compose(position, turn, new THREE.Vector3(scale, scale, scale)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  shown = { ...crowd, vat };

  // Read off the bake and the clip it baked.
  setEncoding(vat.encoding === "rig" ? "rig" : "vertex");
  setNodeTracks(clip.tracks.filter((track) => !track.name.endsWith(".morphTargetInfluences")).length);
}
await forging(() => bake(false));

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("node track", false, (rock) => void forging(() => bake(rock)));
cameraLimits.addTo(panel);
addFloorControls(panel, floor.fade);
panel.source({ code: source, path: "examples/src/webgpu_morph.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
});
