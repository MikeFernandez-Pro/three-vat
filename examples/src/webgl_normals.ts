// Normals off, on WebGL: `bakeNormals: false`, for a material that never reads one.
//
// Under the vertex encoding a bake stores two layers: where every vertex went,
// and which way it faced. An unlit material never reads a normal, and a
// flat-shaded one derives its own from the posed triangle, so for either the
// normal layer is pure waste. Bake with `bakeNormals: false` and it is never
// written. A smooth-shaded lit material does need it, and pairing one with a
// normal-less VAT is refused rather than lit by the rest pose.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type DeltaVAT, type VATInstance } from "three-vat";
import { createVATMesh, createVATUniforms, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { addFloorControls } from "./floor-fade.js";
import { forging } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_normals.ts?raw";

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

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 7, 16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
const cameraLimits = limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -12;
key.shadow.camera.right = key.shadow.camera.top = 12;
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
const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
const maxTextureSize = getMaxTextureSize(renderer);
// The vertex encoding, named: the rig encoding has no normal layer to drop,
// and ignores the option.
const [withNormals, withoutNormals] = await forging(() => [
  bakeVAT(gltf.scene, clips, { encoding: "delta", maxTextureSize }) as DeltaVAT,
  bakeVAT(gltf.scene, clips, { encoding: "delta", bakeNormals: false, maxTextureSize }) as DeltaVAT,
]);

// ---------------------------------------------------------------- materials
// Each choice is a material and the bake it may be paired with. One material
// for every part: the studio's matte character, one draw call per pass.
type Choice = "unlit" | "flat" | "lit";
const CHOICES: Record<Choice, { vat: DeltaVAT; material: THREE.Material }> = {
  unlit: { vat: withoutNormals, material: new THREE.MeshBasicMaterial({ color: palette.character }) },
  flat: {
    vat: withoutNormals,
    material: new THREE.MeshStandardMaterial({ color: palette.character, roughness: 0.9, flatShading: true }),
  },
  lit: { vat: withNormals, material: new THREE.MeshStandardMaterial({ color: palette.character, roughness: 0.9 }) },
};

// ---------------------------------------------------------------- crowd
// One crowd per choice, over the same instances and one clock; the select
// shows one of them.
const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
  clip: withNormals.clips[i % withNormals.clips.length]!,
  startTime: -Math.random() * 10,
}));
const uniforms = createVATUniforms();
const size = withNormals.bounds.getSize(new THREE.Vector3());
const spacing = Math.max(size.x, size.z) * 0.9;
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();

const crowds = {} as Record<Choice, THREE.InstancedMesh>;
for (const [choice, { vat, material }] of Object.entries(CHOICES) as [Choice, (typeof CHOICES)[Choice]][]) {
  // Your material in place of the bake's, one for each of the source's parts.
  vat.materials = vat.materials.map(() => material);
  const { mesh } = createVATMesh(vat, instances, { time: uniforms.uVatTime, maxTextureSize });
  mesh.castShadow = true;
  mesh.receiveShadow = choice !== "unlit"; // an unlit material shades nothing, shadows included
  for (let i = 0; i < COUNT; i++) {
    const radius = spacing * Math.sqrt(i + 0.5);
    const angle = i * 2.39996; // the golden angle
    // Soldier is authored facing -z; turned to face the camera, give or take.
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + (Math.random() - 0.5) * 1.2);
    mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), turn, new THREE.Vector3(1, 1, 1)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  crowds[choice] = mesh;
}

// ---------------------------------------------------------------- readouts
const setLayer = readout("normal-layer");
const setMemory = readout("texture-memory");

const megabytes = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`);
const bytesOf = (vat: DeltaVAT) =>
  (vat.positionTexture.image.data as ArrayBufferView).byteLength +
  ((vat.normalTexture?.image.data as ArrayBufferView | undefined)?.byteLength ?? 0);

function show(choice: Choice) {
  for (const [name, mesh] of Object.entries(crowds)) mesh.visible = name === choice;
  const { vat } = CHOICES[choice];
  // Read off the bake: the layer is there, or it is `null`.
  setLayer(vat.normalTexture ? "baked" : "dropped");
  setMemory(megabytes(bytesOf(vat)));
}
show("unlit");

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.select(
  "material",
  [
    ["unlit", "unlit, no normals"],
    ["flat", "flat-shaded, no normals"],
    ["lit", "lit, normals baked"],
  ],
  "unlit",
  show,
);
cameraLimits.addTo(panel);
addFloorControls(panel, floor.fade);
panel.source({ code: source, path: "examples/src/webgl_normals.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  uniforms.uVatTime.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
});
