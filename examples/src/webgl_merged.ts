// Merged materials, on WebGL: `mergeFlatMaterials: true`, many parts, one draw.
//
// A crowd draws once per material, whatever its count. RobotExpressive ships
// three materials that differ only in their flat colour, so it draws three
// times a pass. Bake it with `mergeFlatMaterials: true` and those three become
// one white material with the colours moved into the vertices: the same robot,
// drawn once. Nothing else about the crowd changes.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VAT, type VATInstance } from "three-vat";
import { createVATMesh, createVATUniforms, getMaxTextureSize } from "three-vat/webgl";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_merged.ts?raw";

const COUNT = 100;

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
camera.position.set(0, 18, 38);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

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
// The same subtree and clips, twice: the option is the whole difference.
const gltf = await new GLTFLoader().loadAsync("RobotExpressive.glb");
gltf.scene.updateMatrixWorld(true);
const clips = gltf.animations.filter((clip) => ["Idle", "Walking", "Running", "Dance"].includes(clip.name));
const maxTextureSize = getMaxTextureSize(renderer);
const bakes: Record<"merged" | "plain", VAT> = {
  merged: bakeVAT(gltf.scene, clips, { mergeFlatMaterials: true, maxTextureSize }),
  plain: bakeVAT(gltf.scene, clips, { maxTextureSize }),
};

// ---------------------------------------------------------------- crowd
// One crowd per bake, over one clock and the same placement; the toggle
// shows one of them.
const uniforms = createVATUniforms();
const size = bakes.plain.bounds.getSize(new THREE.Vector3());
const scale = 1.8 / size.y; // RobotExpressive is authored a few metres tall
const spacing = Math.max(size.x, size.z) * scale * 0.9;
const phases = Array.from({ length: COUNT }, () => -Math.random() * 10);
const turns = Array.from({ length: COUNT }, () => (Math.random() - 0.5) * 1.2);

function crowdOf(vat: VAT): THREE.InstancedMesh {
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) material.setValues({ roughness: 0.8, metalness: 0 });
  const instances: VATInstance[] = phases.map((startTime, i) => ({ clip: vat.clips[i % vat.clips.length]!, startTime }));
  const { mesh } = createVATMesh(vat, instances, { time: uniforms.uVatTime, maxTextureSize });
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

// ---------------------------------------------------------------- readouts
const setMaterials = readout("materials");
const setDraws = readout("draw-count");

function show(merged: boolean) {
  crowds.merged.visible = merged;
  crowds.plain.visible = !merged;
  // Read off the bake: the materials the crowd draws with.
  setMaterials((merged ? bakes.merged : bakes.plain).materials.length);
}
show(true);

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("merge flat materials", true, show);
panel.source({ code: source, path: "examples/src/webgl_merged.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  uniforms.uVatTime.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
  // Measured: the renderer's own count for the frame just drawn, the crowd's
  // shadow pass and the floor included.
  setDraws(renderer.info.render.calls);
});
