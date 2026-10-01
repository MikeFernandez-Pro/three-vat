// Normals off, on WebGL: `bakeNormals: false`, for a material that never reads one.
//
// Under the vertex encoding a bake stores two layers: where every vertex went,
// and which way it faced. An unlit material never reads a normal, and a
// flat-shaded one derives its own from the posed triangle, so for either the
// normal layer is pure waste. Bake with `bakeNormals: false` and it is never
// written, and the texture shrinks by its share. A smooth-shaded lit material
// does need it.
//
// Three groups on one floor, left to right: unlit and flat-shaded on the bake
// without normals, lit on the bake with them, each with its memory. And the
// case the library refuses, forced here so you can see why: the lit group on
// the bake without normals, shaded by the normals of its rest pose.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type DeltaVAT, type VATInstance } from "three-vat";
import { createVATMesh, createVATUniforms, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_normals.ts?raw";

const PER_GROUP = 4;

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
camera.position.set(0, 6, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.2, 0);
controls.enableDamping = true;
limitCamera(controls);

// A dim fill under a strong key: the page is about which way a surface faces,
// and a key light is what shows it.
scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 0.9));
const key = new THREE.DirectionalLight(palette.key, 3.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -7;
key.shadow.camera.right = key.shadow.camera.top = 7;
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
// RobotExpressive, for clips that take it far from its rest pose — lying dead,
// sitting — where a normal left at rest faces the wrong way and shows it.
const gltf = await loading(() => new GLTFLoader().loadAsync("RobotExpressive.glb"));
gltf.scene.updateMatrixWorld(true);
const clips = ["Death", "Sitting", "Dance", "Jump"].map((name) => gltf.animations.find((clip) => clip.name === name)!);
const maxTextureSize = getMaxTextureSize(renderer);
// The vertex encoding, named: the rig encoding has no normal layer to drop,
// and ignores the option.
const [withNormals, withoutNormals] = await forging(() => [
  bakeVAT(gltf.scene, clips, { encoding: "delta", maxTextureSize }) as DeltaVAT,
  bakeVAT(gltf.scene, clips, { encoding: "delta", bakeNormals: false, maxTextureSize }) as DeltaVAT,
]);

// ---------------------------------------------------------------- groups
// Each group is a material and the bake it is paired with, on its own spot of
// the floor: your material in place of the bake's, for every part. The
// studio's matte character, one draw call per pass. Every group plays the
// same clips from the same starts, so its robots pose as the others' do.
const instances: VATInstance[] = Array.from({ length: PER_GROUP }, (_, i) => ({
  clip: withNormals.clips[i % withNormals.clips.length]!,
  startTime: -Math.random() * 10,
}));
const uniforms = createVATUniforms();
const size = withNormals.bounds.getSize(new THREE.Vector3());
const scale = 1.8 / size.y; // RobotExpressive is authored a few metres tall
const spacing = Math.max(size.x, size.z) * scale * 0.9;
const matrix = new THREE.Matrix4();
const turn = new THREE.Quaternion();
const turns = instances.map(() => (Math.random() - 0.5) * 1.2);

function groupOf(vat: DeltaVAT, material: THREE.Material, x: number): THREE.InstancedMesh {
  vat.materials = vat.materials.map(() => material);
  const { mesh } = createVATMesh(vat, instances, { time: uniforms.uVatTime, maxTextureSize });
  mesh.castShadow = true;
  mesh.receiveShadow = !(material as { isMeshBasicMaterial?: boolean }).isMeshBasicMaterial; // an unlit material shades nothing, shadows included
  for (let i = 0; i < PER_GROUP; i++) {
    // Two by two, about the group's spot.
    const [column, row] = [(i % 2) - 0.5, Math.floor(i / 2) - 0.5];
    // Facing the camera, give or take: the same turn in every group.
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turns[i]!);
    mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(x + column * spacing, 0, row * spacing), turn, new THREE.Vector3(scale, scale, scale)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

const GAP = spacing * 2.2;
groupOf(withoutNormals, new THREE.MeshBasicMaterial({ color: palette.character }), -GAP);
groupOf(withoutNormals, new THREE.MeshStandardMaterial({ color: palette.character, roughness: 0.9, flatShading: true }), 0);
const lit = groupOf(withNormals, new THREE.MeshStandardMaterial({ color: palette.character, roughness: 0.9 }), GAP);

// ---------------------------------------------------------------- the refused case
// A smooth lit material on the bake without normals: `createVATMesh` refuses
// it, and says why. The page keeps what it said.
let refusal = "";
try {
  groupOf(withoutNormals, new THREE.MeshStandardMaterial({ color: palette.character, roughness: 0.9 }), GAP);
} catch (error) {
  refusal = (error as Error).message;
}
// …and forces it, to show what was refused: made flat-shaded, so the guard
// lets it through, then switched to smooth shading before it is ever drawn.
// Nothing decodes a normal, so three shades every robot with the normal of
// its rest pose.
const litWithoutNormals = groupOf(withoutNormals, new THREE.MeshStandardMaterial({ color: palette.character, roughness: 0.9, flatShading: true }), GAP);
for (const material of litWithoutNormals.material as THREE.MeshStandardMaterial[]) material.flatShading = false;

// ---------------------------------------------------------------- readouts
const megabytes = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`);
// Read off the bake: its position layer, and its normal layer if it has one.
const memoryOf = (vat: DeltaVAT) =>
  megabytes(
    (vat.positionTexture.image.data as ArrayBufferView).byteLength +
      ((vat.normalTexture?.image.data as ArrayBufferView | undefined)?.byteLength ?? 0),
  );
readout("memory-unlit")(memoryOf(withoutNormals));
readout("memory-flat")(memoryOf(withoutNormals));
const setLitMemory = readout("memory-lit");
// Its first sentence: what is wrong. The fixes it goes on to name are the other two groups.
const end = refusal.indexOf(". ");
readout("refusal")(end === -1 ? refusal : refusal.slice(0, end + 1));
const refusalRow = document.getElementById("refusal-row")!;

function dropLitNormals(drop: boolean) {
  lit.visible = !drop;
  litWithoutNormals.visible = drop;
  setLitMemory(memoryOf(drop ? withoutNormals : withNormals));
  refusalRow.hidden = !drop;
}
dropLitNormals(false);

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("lit without normals", false, dropLitNormals);
panel.source({ code: source, path: "examples/src/webgl_normals.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  uniforms.uVatTime.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
});
