// Step-by-step setup, on WebGL: the VAT wired into your own InstancedMesh.
//
// `createVATMesh` is three calls composed in the one correct order, and this
// page makes them itself, onto a mesh and a material of its own: the playback
// texture that says what each instance plays, `patchVATMaterial` on the
// material, and `createVATDepthMaterial` so the shadows move with the pose.
// Then the mesh is an `InstancedMesh` like any other — its instances are moved
// by their matrices every frame, and the animation composes with them.
//
// Each step has a switch that swaps in its unpatched counterpart, so you can
// see what the step is for — the HUD lists them, in the panel's order, with
// what breaks: without the per-instance playback every soldier plays the same
// frame, without the clock they freeze mid-stride, without the material patch
// they stand in the rest pose, and without the depth material their shadows
// stop moving.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, createVATPlaybackTexture, type VATInstance } from "three-vat";
import { createVATDepthMaterial, createVATUniforms, getMaxTextureSize, patchVATMaterial } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette, partColour } from "./palette.js";
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

// ---------------------------------------------------------------- bake
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const walk = gltf.animations.find((clip) => clip.name === "Walk")!;
const run = gltf.animations.find((clip) => clip.name === "Run")!;
const maxTextureSize = getMaxTextureSize(renderer);
// The vertex encoding, so the geometry a switched-off step leaves undecoded is
// the rest pose at full size. Under the rig encoding it is the skinned mesh's
// bind pose in its own units, a hundred times too big to read as a soldier.
// The studio's matte look in each part's own colour, by material name, *before*
// the bake: flat, the body and the visor merge into one material, their two
// colours moved into the vertices (mergeFlatMaterials), and the one material
// this page brings reads them.
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  for (const material of [object.material].flat() as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, color: partColour(material.name), roughness: 0.9, metalness: 0 });
  }
});
const vat = await forging(() => bakeVAT(gltf.scene, [walk, run], { encoding: "delta", mergeFlatMaterials: true, maxTextureSize }));

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
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  vat,
  uniforms,
  playback,
);
// 4. And the shadow pass's material, patched the same way — without it the
//    shadows would stand still in the bind pose.
const depth = createVATDepthMaterial(vat, uniforms, playback);
// 5. Your own InstancedMesh over the bake's geometry, wearing both, and moved
//    by its matrices below.
const mesh = new THREE.InstancedMesh(vat.geometry, material, soldiers.length);
mesh.customDepthMaterial = depth;
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.frustumCulled = false; // the matrices change every frame
scene.add(mesh);

// ---------------------------------------------------------------- the switches
// Each step's counterpart, built the same way but without what the step adds.
// 1 off: a playback texture with every instance on the same start, and the
//    material and depth material patched to read it instead.
const lockstep = createVATPlaybackTexture(
  soldiers.map((soldier) => ({ ...soldier.instance, startTime: 0 })),
  { maxTextureSize },
);
const lockstepMaterial = patchVATMaterial(
  new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  vat,
  uniforms,
  lockstep,
);
const lockstepDepth = createVATDepthMaterial(vat, uniforms, lockstep);
// 3 off: your material as three ships it, decoding nothing.
const plainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
// 4 off: no depth material at all, so three draws the shadow with its own.
const steps = { playback: true, clock: true, patch: true, depth: true };

function wire() {
  mesh.material = !steps.patch ? plainMaterial : steps.playback ? material : lockstepMaterial;
  mesh.customDepthMaterial = !steps.depth ? undefined : steps.playback ? depth : lockstepDepth;
}

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
for (const [step, label] of [
  ["playback", "per-instance playback"],
  ["clock", "clock"],
  ["patch", "material patch"],
  ["depth", "depth pass"],
] as const) {
  panel.toggle(label, true, (on) => {
    steps[step] = on;
    wire();
  });
}
panel.toggle("move", moving, (value) => (moving = value));
panel.source({ code: source, path: "examples/src/webgl_instanced.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  // The animation, for every instance. 2 off: the clock stops where it is.
  if (steps.clock) uniforms.uVatTime.value += dt;
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
