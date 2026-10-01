// Merge materials into one draw, on WebGPU: `mergeFlatMaterials: true`, many parts, one draw.
//
// A crowd draws once per material, whatever its count. RobotExpressive ships
// three materials that differ only in their flat colour, so it draws three
// times a pass. Bake it with `mergeFlatMaterials: true` and those three become
// one white material with the colours moved into the vertices: the same robot,
// drawn once. Nothing else about the crowd changes.
//
// Both are on screen in the HUD, read off the two bakes: each material, its
// colour and the draw it costs. "Tint by draw" paints each draw a loud colour,
// so the three draws are three colours on the robot, and the merged one is one.
//
// The same program as webgl_merged.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VAT, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette, partColour } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { showSwatches, swatchFacts, tintOf } from "./swatches.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_merged.ts?raw";

const COUNT = 100;

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
camera.position.set(0, 18, 38);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -16;
key.shadow.camera.right = key.shadow.camera.top = 16;
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
// The same subtree and clips, twice: the option is the whole difference.
const gltf = await loading(() => new GLTFLoader().loadAsync("RobotExpressive.glb"));
gltf.scene.updateMatrixWorld(true);

// The robot's three parts in the studio's colours for it, by material name,
// before the bake reads them.
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  for (const material of [object.material].flat() as THREE.MeshStandardMaterial[]) material.color.setHex(partColour(material.name));
});
const clips = gltf.animations.filter((clip) => ["Idle", "Walking", "Running", "Dance"].includes(clip.name));
const maxTextureSize = getMaxTextureSize(renderer);
const bakes: Record<"merged" | "plain", VAT> = await forging(() => ({
  merged: bakeVAT(gltf.scene, clips, { mergeFlatMaterials: true, maxTextureSize }),
  plain: bakeVAT(gltf.scene, clips, { maxTextureSize }),
}));

// ---------------------------------------------------------------- crowd
// One crowd per bake, over one clock and the same placement; the toggle
// shows one of them.
const time: VATTimeUniform = uniform(0);
const size = bakes.plain.bounds.getSize(new THREE.Vector3());
const scale = 1.8 / size.y; // RobotExpressive is authored a few metres tall
const spacing = Math.max(size.x, size.z) * scale * 0.9;
const phases = Array.from({ length: COUNT }, () => -Math.random() * 10);
const turns = Array.from({ length: COUNT }, () => (Math.random() - 0.5) * 1.2);

function crowdOf(vat: VAT): THREE.InstancedMesh {
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) material.setValues({ roughness: 0.8, metalness: 0 });
  const instances: VATInstance[] = phases.map((startTime, i) => ({ clip: vat.clips[i % vat.clips.length]!, startTime }));
  const { mesh } = createVATMesh(vat, instances, { time, maxTextureSize });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  for (let i = 0; i < COUNT; i++) {
    const radius = spacing * Math.sqrt(i + 0.5);
    const angle = i * 2.39996; // the golden angle
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turns[i]!);
    const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    mesh.setMatrixAt(i, matrix.compose(position, turn, new THREE.Vector3(scale, scale, scale)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}
const crowds = { merged: crowdOf(bakes.merged), plain: crowdOf(bakes.plain) };

// ---------------------------------------------------------------- tint by draw call
// One draw per material, so painting each material a loud colour paints each
// draw: the colour a part comes out in says which draw drew it. The crowd's
// own materials, kept to put back.
const untinted = new Map<THREE.MeshStandardMaterial, { color: THREE.Color; vertexColors: boolean }>();
for (const crowd of Object.values(crowds)) {
  for (const material of crowd.material as THREE.MeshStandardMaterial[]) {
    untinted.set(material, { color: material.color.clone(), vertexColors: material.vertexColors });
  }
}

function tint(on: boolean) {
  for (const crowd of Object.values(crowds)) {
    (crowd.material as THREE.MeshStandardMaterial[]).forEach((material, draw) => {
      const { color, vertexColors } = untinted.get(material)!;
      material.color.set(on ? new THREE.Color(tintOf(draw)) : color);
      // A merged material's colours are in its vertices: off, so its one draw shows as one colour.
      material.vertexColors = on ? false : vertexColors;
      material.needsUpdate = true;
    });
  }
}

// ---------------------------------------------------------------- readouts
const setMaterials = readout("materials");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === crowds.merged || object === crowds.plain);

function show(merged: boolean) {
  crowds.merged.visible = merged;
  crowds.plain.visible = !merged;
  // Read off the bake: the materials the crowd draws with, their colours, their draws.
  const vat = merged ? bakes.merged : bakes.plain;
  setMaterials(vat.materials.length);
  showSwatches("swatches", swatchFacts(vat));
}
show(true);

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("merge flat materials", true, show);
panel.toggle("tint by draw call", false, tint);
panel.source({ code: source, path: "examples/src/webgpu_merged.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  // Measured: the renderer's own count, kept for the crowd's draws alone —
  // the shadow pass beside them, the floor and the rest of the studio left out.
  setDraws(formatVATDraws(takeDraws()));
});
