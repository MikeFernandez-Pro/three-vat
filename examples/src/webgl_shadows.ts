// Shadows, on WebGL: why a VAT crowd needs a shadow pass of its own.
//
// A three.js rule, for any animation done in a vertex shader: the shadow pass
// draws every caster again, with a material of its own, and three's default
// one knows nothing of your shader. So it draws the geometry as it was baked,
// the rest pose, standing still under a character that runs. The fix is the
// same decode for the shadow pass: `createVATDepthMaterial`, set as the mesh's
// `customDepthMaterial`. `createVATMesh` does it for you; a mesh of your own
// must do it too (the "Build it by hand" page).
//
// Two soldiers, one clip, one sun: the left keeps the depth material
// `createVATMesh` gave it, the right has it taken off.
//
// Point lights draw their shadows through `customDistanceMaterial` instead,
// which `createVATMesh` sets too; this studio's one sun needs only the depth.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette, partColour } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_shadows.ts?raw";

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
// The vertex encoding, so the geometry the default shadow material draws is
// the rest pose at full size — what this page shows it drawing. Under the rig
// encoding the depth material is needed just the same; the shadow it leaves
// behind without it is only harder to see.
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
const instances: VATInstance[] = [{ clip: vat.clips[0]!, startTime: 0 }];
const time = { value: 0 };
const up = new THREE.Vector3(0, 1, 0);

function soldierAt(x: number) {
  const { mesh } = createVATMesh(vat, instances, { time });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Soldier faces -z; a quarter turn runs it to the left.
  mesh.setMatrixAt(0, new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0), new THREE.Quaternion().setFromAxisAngle(up, -Math.PI / 2), new THREE.Vector3(1, 1, 1)));
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

// Left: as `createVATMesh` made it, the VAT's decode in the shadow pass too.
const posed = soldierAt(-1.6);
// Right: the depth material taken off, so three falls back to its own, which
// draws the geometry undecoded.
const resting = soldierAt(1.6);
resting.customDepthMaterial = undefined;

// ---------------------------------------------------------------- readouts
// Read off each mesh, every frame: the material its shadow pass draws with.
const shadowOf = (mesh: THREE.InstancedMesh) =>
  mesh.customDepthMaterial ? "follows the pose: createVATDepthMaterial" : "stands still: three's own depth material";
const setLeft = readout("shadow-left");
const setRight = readout("shadow-right");

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.slider("sun °", { min: 0, max: 360, value: 55 }, placeSun);
panel.source({ code: source, path: "examples/src/webgl_shadows.ts" });

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
