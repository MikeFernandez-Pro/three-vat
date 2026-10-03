// Make post-processing follow the animation, on WebGL: a hover outline and depth of field over a running squad.
//
// A three.js rule, for any animation done in a vertex shader, and the same one
// the shadow pass taught: a pass that needs the scene's depth or a mask of what
// is selected draws the scene again, under a material of its own —
// `scene.overrideMaterial`. `OutlinePass` draws a depth material and then a
// mask, `BokehPass` a depth material, `SSAOPass` normals and depth. None of
// them knows the VAT, so each draws the geometry as baked: the rest pose,
// standing still where the soldier runs.
//
// The fix is three-vat's decode in those renders too: around each one, every
// soldier draws a `patchVATMaterial`-ed copy of the pass's own material, and
// gets its own back after (pose-in-passes.ts). It is a recipe rather than a
// library function because which material a pass draws with is three's
// private detail.
//
// Seven soldiers, each its own mesh, because OutlinePass outlines a mesh, not
// an instance. Hover one to outline it; turn the fix off to see the outline
// trace the rest pose, and the depth of field blur round it.
//
// The same squad as webgpu_postprocessing.ts, where `pass()` draws the crowd's
// own `positionNode` and only `outline()`'s mask needs telling (ADR-0011).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutlinePass } from "three/addons/postprocessing/OutlinePass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { bakeVAT } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { headStartOf } from "./desync.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { palette, wearPart } from "./palette.js";
import { followThePose } from "./pose-in-passes.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_postprocessing.ts?raw";

const COUNT = 7;

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
const time = { value: 0 };
const clip = vat.clips[0]!;
const squad = Array.from({ length: COUNT }, (_, i) => {
  const crowd = createVATMesh(vat, [{ clip, startTime: -headStartOf(i, COUNT, clip.duration) }], { time });
  const { mesh } = crowd;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const across = i - (COUNT - 1) / 2;
  mesh.position.set(across * 1.3, 0, -Math.abs(across) * 1.6 + 1);
  // Soldier faces -z; a quarter turn runs it to the left.
  mesh.rotation.y = -Math.PI / 2;
  scene.add(mesh);
  return crowd;
});
const meshes = squad.map(({ mesh }) => mesh);

// ---------------------------------------------------------------- passes
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bokeh = new BokehPass(scene, camera, { focus: Math.round(camera.position.distanceTo(meshes[3]!.position) * 10) / 10, aperture: 0.004, maxblur: 0.01 });
composer.addPass(bokeh);
const lens = bokeh.uniforms as Record<"focus" | "aperture", THREE.IUniform<number>>;
// After the depth of field, so the outline is not blurred with what it rings.
const outline = new OutlinePass(new THREE.Vector2(innerWidth, innerHeight), scene, camera);
outline.visibleEdgeColor.set(palette.accent);
outline.hiddenEdgeColor.set(palette.accent).multiplyScalar(0.35);
outline.edgeStrength = 4;
outline.edgeThickness = 1.5;
composer.addPass(outline);
composer.addPass(new OutputPass());

// The fix: every render a pass makes under a material of its own draws the
// squad through a VAT-patched copy of that material.
const fix = followThePose(scene, vat, squad);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
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
  for (const mesh of meshes) {
    if (!ray.intersectBox(box.copy(vat.bounds).applyMatrix4(mesh.matrixWorld), at)) continue;
    if (at.distanceTo(ray.origin) < distance) [nearest, distance] = [mesh, at.distanceTo(ray.origin)];
  }
  return nearest;
}
addEventListener("pointermove", (event) => {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hovered = soldierUnder(raycaster.ray);
  outline.selectedObjects = hovered ? [hovered] : [];
});

// ---------------------------------------------------------------- readouts
const setOutline = readout("outline");
const setDof = readout("dof");
function describe() {
  setOutline(
    outline.selectedObjects.length === 0
      ? "hover a soldier"
      : fix.enabled
        ? "hugs the running pose: a VAT-patched copy of its mask"
        : "traces the rest pose: OutlinePass's own mask material",
  );
  setDof(fix.enabled ? "follows the pose: a VAT-patched copy of BokehPass's depth" : "follows the rest pose: BokehPass's own depth material");
}

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.toggle("fix", true, (on) => (fix.enabled = on));
panel.slider("focus", { min: 4, max: 16, step: 0.1, value: lens.focus.value }, (value) => (lens.focus.value = value));
panel.slider("aperture", { min: 0, max: 0.01, step: 0.0005, value: lens.aperture.value }, (value) => (lens.aperture.value = value));
panel.source({ code: source, path: "examples/src/webgl_postprocessing.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  composer.render();
  describe();
});
