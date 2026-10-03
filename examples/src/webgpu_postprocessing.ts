// Make post-processing follow the animation, on WebGPU: a hover outline and depth of field over a running squad.
//
// A three.js rule, for any animation done in a vertex shader: a pass that
// draws the scene again under a material of its own draws the rest pose,
// unless that material runs the animation too. On this path most of them do
// without being asked. `pass()` draws each mesh with its own material, the
// VAT decode in its `positionNode`, so the depth the depth of field reads is
// the running pose, and an override on the scene is handed the material's
// `positionNode` by the renderer itself — `ao()` follows the pose for that
// reason.
//
// `outline()` is the exception. It draws its depth and mask materials through
// the renderer directly, past the step that hands an override the
// `positionNode`, so its mask draws the rest pose: an outline round a soldier
// standing still where one runs. The fix is to hand the mask the hovered
// soldier's `positionNode` yourself. Its mask material is the node's private
// `_prepareMaskMaterial`, which is why this is a recipe rather than a library
// function.
//
// Seven soldiers, each its own mesh, because `outline()` outlines a mesh, not
// an instance — and so each its own `positionNode`, which is why the mask is
// handed the hovered one's as the pointer moves.
//
// The same squad as webgl_postprocessing.ts, where every pass draws under a
// material of its own and needs the decode in a copy of it (ADR-0011).
import * as THREE from "three/webgpu";
import { pass, uniform, vec4 } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { outline } from "three/addons/tsl/display/OutlineNode.js";
import { bakeVAT } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { headStartOf } from "./desync.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette, wearPart } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_postprocessing.ts?raw";

const COUNT = 7;

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
// The depth of field writes an opaque frame, so the backdrop is drawn rather
// than left to the page: the page's own colour (theme.css).
scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--studio").trim());

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 2.6, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.9, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.6));
const key = new THREE.DirectionalLight(palette.key, 2.6);
key.position.set(5, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -8;
key.shadow.camera.right = key.shadow.camera.top = 8;
key.shadow.camera.far = 80;
key.shadow.bias = -0.0005;
key.shadow.radius = 3;
scene.add(key);

scene.add(createFloor(camera.position.distanceTo(controls.target)));

// ---------------------------------------------------------------- bake
// The vertex encoding, so the geometry a pass draws without the decode is the
// rest pose at full size — what this page shows it drawing. Under the rig
// encoding the fix is needed just the same; the rest pose is only harder to see.
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const run = gltf.animations.find((clip) => clip.name === "Run")!;
const vat = await forging(() => bakeVAT(gltf.scene, [run], { encoding: "delta", maxTextureSize: getMaxTextureSize(renderer) }));

for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, roughness: 0.9, metalness: 0 });
  wearPart(material);
}

// ---------------------------------------------------------------- the squad
// Running on the spot, side on to the camera so the pose reads, staggered in
// depth so the depth of field has a near and a far. One clock, each soldier
// its own way into the clip.
const time = uniform(0);
const clip = vat.clips[0]!;
const squad = Array.from({ length: COUNT }, (_, i) => {
  const { mesh } = createVATMesh(vat, [{ clip, startTime: -headStartOf(i, COUNT, clip.duration) }], { time });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const across = i - (COUNT - 1) / 2;
  mesh.position.set(across * 1.3, 0, -Math.abs(across) * 1.6 + 1);
  // Soldier faces -z; a quarter turn runs it to the left.
  mesh.rotation.y = -Math.PI / 2;
  scene.add(mesh);
  return mesh;
});

// ---------------------------------------------------------------- passes
// `pass()` draws every mesh with its own material, the decode included, so
// the depth of field needs nothing.
const scenePass = pass(scene, camera);
const focus = uniform(Math.round(camera.position.distanceTo(squad[3]!.position) * 10) / 10);
const blur = uniform(1);
// Typed as a bare TempNode by @types/three; it is the blurred colour.
const focused = dof(scenePass.getTextureNode(), scenePass.getViewZNode(), focus, 2, blur) as unknown as THREE.Node<"vec4">;

const selectedObjects: THREE.Object3D[] = [];
const outlined = outline(scene, camera, { selectedObjects, edgeThickness: uniform(1.5) });
const edge = outlined.visibleEdge.add(outlined.hiddenEdge.mul(0.35)).mul(4);
const pipeline = new THREE.RenderPipeline(renderer);
// After the depth of field, so the outline is not blurred with what it rings.
pipeline.outputNode = focused.add(vec4(edge.mul(uniform(new THREE.Color(palette.accent))), 0));

// ---------------------------------------------------------------- the fix
// The outline's mask, drawn past the renderer's override step, is handed the
// hovered soldier's `positionNode`. Private to three, so check it on upgrade.
type NodeMaterial = THREE.NodeMaterial & { positionNode: THREE.Node | null };
const mask = (outlined as unknown as { _prepareMaskMaterial: NodeMaterial })._prepareMaskMaterial;
const fix = { enabled: true };
function maskTheHovered() {
  const hovered = selectedObjects[0] as THREE.Mesh | undefined;
  mask.positionNode = fix.enabled && hovered ? (hovered.material as NodeMaterial[])[0]!.positionNode : null;
  mask.needsUpdate = true;
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- hover
// Each soldier is hit by the VAT's bounds, the box round every frame it can
// show, placed where the soldier stands.
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const box = new THREE.Box3();
const at = new THREE.Vector3();
function soldierUnder(ray: THREE.Ray): THREE.InstancedMesh | undefined {
  let nearest: THREE.InstancedMesh | undefined;
  let distance = Infinity;
  for (const mesh of squad) {
    if (!ray.intersectBox(box.copy(vat.bounds).applyMatrix4(mesh.matrixWorld), at)) continue;
    if (at.distanceTo(ray.origin) < distance) [nearest, distance] = [mesh, at.distanceTo(ray.origin)];
  }
  return nearest;
}
addEventListener("pointermove", (event) => {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hovered = soldierUnder(raycaster.ray);
  if (hovered === selectedObjects[0]) return;
  selectedObjects.length = 0;
  if (hovered) selectedObjects.push(hovered);
  maskTheHovered();
});

// ---------------------------------------------------------------- readouts
const setOutline = readout("outline");
// The one thing a fix would change here is the outline: said once.
readout("dof")("follows the pose, fix or none: pass() draws the crowd's own positionNode");
function describe() {
  setOutline(
    selectedObjects.length === 0
      ? "hover a soldier"
      : fix.enabled
        ? "hugs the running pose: the mask given the crowd's positionNode"
        : "traces the rest pose: outline()'s own mask material",
  );
}

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("fix", true, (on) => {
  fix.enabled = on;
  maskTheHovered();
});
panel.slider("focus", { min: 4, max: 16, step: 0.1, value: focus.value }, (value) => (focus.value = value));
panel.slider("blur", { min: 0, max: 3, step: 0.1, value: blur.value }, (value) => (blur.value = value));
panel.source({ code: source, path: "examples/src/webgpu_postprocessing.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  pipeline.render();
  describe();
});
