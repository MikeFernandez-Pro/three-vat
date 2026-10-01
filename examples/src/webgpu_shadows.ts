// Shadows, on WebGPU: a crowd whose shadows match its pose.
//
// The shadow pass draws every caster again — and on this path it reads the
// material's `positionNode`, the VAT decode, so the shadows match the pose
// with no depth material to make. `castShadowPositionNode` is the override:
// set, the shadow pass draws that position instead. This page sets it to the
// undecoded one, `positionLocal`, on a crowd of its own, so you can see what
// the decode in the shadow pass is doing for you.
//
// The same program as webgl_shadows.ts, where the WebGL path needs
// `createVATDepthMaterial` in the shadow pass to say the same (ADR-0011).
import * as THREE from "three/webgpu";
import { positionLocal, uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { addFloorControls } from "./floor-fade.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_shadows.ts?raw";

const COUNT = 40;

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
camera.position.set(0, 11, 18);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
const cameraLimits = limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.6));
// A low sun, so the shadows fall long and read as poses.
const key = new THREE.DirectionalLight(palette.key, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -14;
key.shadow.camera.right = key.shadow.camera.top = 14;
key.shadow.camera.far = 80;
key.shadow.bias = -0.0005;
key.shadow.radius = 3; // soft edges, as the studio wants them
scene.add(key);

function placeSun(degrees: number) {
  const angle = THREE.MathUtils.degToRad(degrees);
  key.position.set(Math.cos(angle) * 16, 9, Math.sin(angle) * 16);
}
placeSun(30);

const floor = createFloor(camera.position.distanceTo(controls.target));
scene.add(floor.mesh);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- bake
// The vertex encoding, so the geometry the shadow pass draws without the
// decode is the rest pose at full size — what this page shows it drawing.
// Under the rig encoding the decode in the shadow pass matters just the
// same; the shadow left without it is only harder to see.
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
const vat = bakeVAT(gltf.scene, clips, { encoding: "delta", maxTextureSize: getMaxTextureSize(renderer) });

for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- crowd
const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
  clip: vat.clips[i % vat.clips.length]!,
  startTime: -Math.random() * 10,
}));

// A sunflower spiral, as the crowd page stands its soldiers.
const size = vat.bounds.getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 1.1;
const up = new THREE.Vector3(0, 1, 0);
const placements = Array.from({ length: COUNT }, (_, i) => {
  const radius = spacing * Math.sqrt(i + 0.5);
  const angle = i * 2.39996; // the golden angle
  return new THREE.Matrix4().compose(
    new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
    new THREE.Quaternion().setFromAxisAngle(up, Math.random() * Math.PI * 2),
    new THREE.Vector3(1, 1, 1),
  );
});

// ---------------------------------------------------------------- the shadow's position
// Read when a mesh is first drawn: three keeps the shadow pass it compiled
// for a mesh, so a change of shadow position is a new crowd — the same
// instances, the same clock, a fresh mesh.
type NodeMaterial = THREE.Material & { castShadowPositionNode: THREE.Node | null };
const time = uniform(0);
let shown: ReturnType<typeof createVATMesh> | null = null;

const setShadow = readout("shadow");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === shown?.mesh);
readout("count")(COUNT);

function useVATDepth(on: boolean) {
  const next = createVATMesh(vat, instances, { time });
  const crowd = next.mesh;
  for (const material of crowd.material as NodeMaterial[]) {
    // Off, the shadow pass draws `positionLocal` — the geometry undecoded,
    // placed by its instance matrix and nothing more.
    material.castShadowPositionNode = on ? null : positionLocal;
  }
  placements.forEach((matrix, i) => crowd.setMatrixAt(i, matrix));
  crowd.computeBoundingSphere();
  crowd.castShadow = true;
  crowd.receiveShadow = true;
  if (shown) {
    scene.remove(shown.mesh);
    for (const material of shown.mesh.material as THREE.Material[]) material.dispose();
    shown.mesh.dispose();
    shown.playback.texture.dispose();
  }
  scene.add(crowd);
  shown = next;
}
useVATDepth(true);

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("posed shadows", true, useVATDepth);
panel.slider("sun °", { min: 0, max: 360, value: 30 }, placeSun);
cameraLimits.addTo(panel);
addFloorControls(panel, floor.fade);
panel.source({ code: source, path: "examples/src/webgpu_shadows.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  // Measured: the crowd is drawn twice a frame, once for the shadow map.
  // Read off the mesh the shadow pass draws: its own position, or the geometry's.
  setShadow((shown!.mesh.material as NodeMaterial[])[0]!.castShadowPositionNode === null ? "posed" : "rest pose");
  setDraws(formatVATDraws(takeDraws()));
});
