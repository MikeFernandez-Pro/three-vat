// Animated shadows, on WebGPU: why a VAT crowd needs a shadow pass of its own.
//
// A three.js rule, for any animation done in a vertex shader: the shadow pass
// draws every caster again, and unless it runs your animation too it draws the
// geometry as it was baked, the rest pose, standing still under a character
// that runs. On this path the shadow pass reads the material's `positionNode`,
// the VAT decode, so `createVATMesh` needs no depth material to make: the
// shadows match the pose for free. `castShadowPositionNode` is the override:
// set, the shadow pass draws that position instead.
//
// Two soldiers, one clip, one sun: the left as `createVATMesh` made it, the
// right with its shadow position set to the undecoded one, `positionLocal` —
// the shadow three would cast for a vertex-shader animation it was not told of.
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
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette, partColour } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_shadows.ts?raw";

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
camera.position.set(0, 4.5, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.6));
// A sun from the front and to one side, so each shadow falls clear of its soldier
// and reads as a pose.
const key = new THREE.DirectionalLight(palette.key, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -6;
key.shadow.camera.right = key.shadow.camera.top = 6;
key.shadow.camera.far = 80;
key.shadow.bias = -0.0005;
key.shadow.radius = 3; // soft edges, as the studio wants them
scene.add(key);

function placeSun(degrees: number) {
  const angle = THREE.MathUtils.degToRad(degrees);
  key.position.set(Math.cos(angle) * 10, 6, Math.sin(angle) * 10);
}
placeSun(55);

scene.add(createFloor(camera.position.distanceTo(controls.target)));

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
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const run = gltf.animations.find((clip) => clip.name === "Run")!;
const vat = await forging(() => bakeVAT(gltf.scene, [run], { encoding: "delta", maxTextureSize: getMaxTextureSize(renderer) }));

for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: partColour(material.name), roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- two soldiers
// The same clip from the same start, side by side and side on to the camera,
// so the two differ in their shadow pass and in nothing else.
type NodeMaterial = THREE.Material & { castShadowPositionNode: THREE.Node | null };
const instances: VATInstance[] = [{ clip: vat.clips[0]!, startTime: 0 }];
const time = uniform(0);
const up = new THREE.Vector3(0, 1, 0);

function soldierAt(x: number, castShadowPositionNode: THREE.Node | null) {
  const { mesh } = createVATMesh(vat, instances, { time });
  // Read when the mesh is first drawn, so set before it ever is.
  for (const material of mesh.material as NodeMaterial[]) material.castShadowPositionNode = castShadowPositionNode;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Soldier faces -z; a quarter turn runs it to the left.
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0), new THREE.Quaternion().setFromAxisAngle(up, -Math.PI / 2), new THREE.Vector3(1, 1, 1)));
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

// Left: as `createVATMesh` made it, the decode read by the shadow pass too.
const posed = soldierAt(-1.6, null);
// Right: the shadow pass told to draw `positionLocal` — the geometry
// undecoded, placed by its instance matrix and nothing more.
const resting = soldierAt(1.6, positionLocal);

// ---------------------------------------------------------------- readouts
// Read off each mesh, every frame: the position its shadow pass draws.
const shadowOf = (mesh: THREE.InstancedMesh) =>
  (mesh.material as NodeMaterial[])[0]!.castShadowPositionNode === null
    ? "follows the pose: the decode's positionNode"
    : "stands still: castShadowPositionNode = positionLocal";
const setLeft = readout("shadow-left");
const setRight = readout("shadow-right");

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.slider("sun °", { min: 0, max: 360, value: 55 }, placeSun);
panel.source({ code: source, path: "examples/src/webgpu_shadows.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  setLeft(shadowOf(posed));
  setRight(shadowOf(resting));
});
