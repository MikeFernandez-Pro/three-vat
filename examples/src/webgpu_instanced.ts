// Your own InstancedMesh, on WebGPU: the VAT wired in by hand.
//
// `createVATMesh` is a few calls composed in the one correct order, and this
// page makes them itself, onto a mesh and a material of its own: the playback
// texture that says what each instance plays, and `vatNodes` for the node
// material's `positionNode` — which the shadow pass reads too, so there is no
// depth material to make. Then the mesh is an `InstancedMesh` like any other —
// its instances are moved by their matrices every frame, and the animation
// composes with them.
//
// The same program as webgl_instanced.ts, but for the decode (ADR-0011): a
// patched classic material there, a node material's `positionNode` here.
import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, createVATPlaybackTexture, type VATInstance } from "three-vat";
import { getMaxTextureSize, vatNodes, type VATTimeUniform } from "three-vat/tsl";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_instanced.ts?raw";

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
scene.fog = new THREE.Fog(palette.studio, 30, 80);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 12, 24);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

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
const walk = gltf.animations.find((clip) => clip.name === "Walk")!;
const run = gltf.animations.find((clip) => clip.name === "Run")!;
const maxTextureSize = getMaxTextureSize(renderer);
const vat = bakeVAT(gltf.scene, [walk, run], { maxTextureSize });

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
// 2. The clock the decode reads: a TSL uniform, set per frame.
const time: VATTimeUniform = uniform(0);
// 3. Your own node material — the matte studio look, one draw call — and your
//    own InstancedMesh over the bake's geometry.
const material = new THREE.MeshStandardNodeMaterial({ color: palette.character, roughness: 0.9 });
const mesh = new THREE.InstancedMesh(vat.geometry, material, soldiers.length);
// 4. The decode, as the material's position. Built from the mesh, its carrier:
//    three applies the instance matrix before `positionNode`, so the decode
//    re-applies it itself, and reads this instance's row of the playback.
material.positionNode = vatNodes(vat, { time, playback, carrier: mesh }).positionNode;
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
panel.source({ code: source, path: "examples/src/webgpu_instanced.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  const dt = timer.getDelta();
  time.value = timer.getElapsed(); // the animation, for every instance
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
