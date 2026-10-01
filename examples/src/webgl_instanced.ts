// Your own InstancedMesh, on WebGL: the VAT wired in by hand.
//
// `createVATMesh` is three calls composed in the one correct order, and this
// page makes them itself, onto a mesh and a material of its own: the playback
// texture that says what each instance plays, `patchVATMaterial` on the
// material, and `createVATDepthMaterial` so the shadows move with the pose.
// Then the mesh is an `InstancedMesh` like any other — its instances are moved
// by their matrices every frame, and the animation composes with them.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, createVATPlaybackTexture, type VATInstance } from "three-vat";
import { createVATDepthMaterial, createVATUniforms, getMaxTextureSize, patchVATMaterial } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { addFloorControls } from "./floor-fade.js";
import { forging } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgl_instanced.ts?raw";

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
camera.position.set(0, 12, 24);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
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

// ---------------------------------------------------------------- bake
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const walk = gltf.animations.find((clip) => clip.name === "Walk")!;
const run = gltf.animations.find((clip) => clip.name === "Run")!;
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, [walk, run], { maxTextureSize }));

// ---------------------------------------------------------------- rings
// Walkers on an inner ring, runners on an outer one going the other way. The
// ground speed is ours — the clips walk and run on the spot — and it is chosen
// so the feet roughly match the floor.
const RINGS = [
  { clip: vat.clips[0]!, count: 18, radius: 5, speed: 1.3 },
  { clip: vat.clips[1]!, count: 30, radius: 9, speed: -3.4 },
];
const soldiers = RINGS.flatMap((ring) =>
  Array.from({ length: ring.count }, (_, i) => ({
    ring,
    angle: (i / ring.count) * Math.PI * 2,
    instance: { clip: ring.clip, startTime: -Math.random() * 5 } satisfies VATInstance,
  })),
);

// ---------------------------------------------------------------- by hand
// 1. What each instance plays: one row of the playback texture per instance.
const playback = createVATPlaybackTexture(
  soldiers.map((soldier) => soldier.instance),
  { maxTextureSize },
);
// 2. The clock every material reads.
const uniforms = createVATUniforms();
// 3. Your own material, patched to decode the VAT in its vertex stage. One
//    material for the whole mesh: the matte studio look, one draw call.
const material = patchVATMaterial(
  new THREE.MeshStandardMaterial({ color: palette.character, roughness: 0.9 }),
  vat,
  uniforms,
  playback,
);
// 4. Your own InstancedMesh over the bake's geometry.
const mesh = new THREE.InstancedMesh(vat.geometry, material, soldiers.length);
// 5. And the shadow pass's material, patched the same way — without it the
//    shadows would stand still in the bind pose.
mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms, playback);
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.frustumCulled = false; // the matrices change every frame
scene.add(mesh);

// ---------------------------------------------------------------- matrices
// Plain InstancedMesh work: a position on the ring and a heading along it.
// Soldier faces -z, so a heading of `PI - angle` walks it the way its angle
// grows, and `-angle` the other way.
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const turn = new THREE.Quaternion();
const scale = new THREE.Vector3(1, 1, 1);
const up = new THREE.Vector3(0, 1, 0);

function place(): number {
  for (const [i, soldier] of soldiers.entries()) {
    const { radius, speed } = soldier.ring;
    position.set(Math.cos(soldier.angle) * radius, 0, Math.sin(soldier.angle) * radius);
    turn.setFromAxisAngle(up, speed > 0 ? Math.PI - soldier.angle : -soldier.angle);
    mesh.setMatrixAt(i, matrix.compose(position, turn, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return soldiers.length;
}
place();

// ---------------------------------------------------------------- panel
const setMatrixWrites = readout("matrix-writes");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);
readout("count")(soldiers.length);

let moving = true;
const panel = createPanel();
panel.toggle("move", moving, (value) => (moving = value));
cameraLimits.addTo(panel);
addFloorControls(panel, floor.fade);
panel.source({ code: source, path: "examples/src/webgl_instanced.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  uniforms.uVatTime.value = timer.getElapsed(); // the animation, for every instance
  let written = 0;
  if (moving) {
    for (const soldier of soldiers) soldier.angle += (soldier.ring.speed / soldier.ring.radius) * dt;
    written = place(); // the movement: one matrix per instance
  }
  controls.update();
  renderer.render(scene, camera);
  setMatrixWrites(written);
  setDraws(formatVATDraws(takeDraws()));
});
