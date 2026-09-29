// Shadows, on WebGL: a crowd whose shadows match its pose.
//
// The shadow pass draws every caster again, with a material of its own — and
// three's default one knows nothing of the VAT, so it draws the geometry as it
// was baked: the rest pose, standing still under a crowd that walks. The fix
// is one line: `createVATDepthMaterial`, the same decode for the shadow pass,
// set as the mesh's `customDepthMaterial`. `createVATMesh` does it for you;
// this page takes it off and puts it back, so you can see what it is for.
//
// Point lights draw their shadows through `customDistanceMaterial` instead,
// which `createVATMesh` sets too; this studio's one sun needs only the depth.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgl_shadows.ts?raw";

const COUNT = 40;

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
scene.fog = new THREE.Fog(palette.studio, 30, 80);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 11, 18);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

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
// The vertex encoding, so the geometry the default shadow material draws is
// the rest pose at full size — what this page shows it drawing. Under the rig
// encoding the depth material is needed just the same; the shadow it leaves
// behind without it is only harder to see.
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
const { mesh, time } = createVATMesh(vat, instances);
mesh.castShadow = true;
mesh.receiveShadow = true;

// A sunflower spiral, as the crowd page stands its soldiers.
const size = vat.bounds.getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 1.1;
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0);
for (let i = 0; i < COUNT; i++) {
  const radius = spacing * Math.sqrt(i + 0.5);
  const angle = i * 2.39996; // the golden angle
  turn.setFromAxisAngle(up, Math.random() * Math.PI * 2);
  matrix.compose(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), turn, new THREE.Vector3(1, 1, 1));
  mesh.setMatrixAt(i, matrix);
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- the depth material
// What `createVATMesh` set, held so the toggle can put it back.
const vatDepth = mesh.customDepthMaterial;

const setShadow = readout("shadow");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);
readout("count")(COUNT);

function useVATDepth(on: boolean) {
  // Off, three falls back to its own depth material, which draws the
  // geometry undecoded.
  mesh.customDepthMaterial = on ? vatDepth : undefined;
}
useVATDepth(true);

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("posed shadows", true, useVATDepth);
panel.slider("sun °", { min: 0, max: 360, value: 30 }, placeSun);
panel.source({ code: source, path: "examples/src/webgl_shadows.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  // Measured: the crowd is drawn twice a frame, once for the shadow map.
  // Read off the mesh the shadow pass draws: its own position, or the geometry's.
  setShadow(mesh.customDepthMaterial === vatDepth ? "posed" : "rest pose");
  setDraws(formatVATDraws(takeDraws()));
});
