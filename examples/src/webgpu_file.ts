// A baked file, on WebGPU: `loadVAT`, and no bake on the page at all.
//
// A runtime bake is paid on every visit for a result that never changes. The
// bake command pays it once, at build time, and writes the VAT into a `.glb`
// of its own:
//
//   npx three-vat bake public/Soldier.glb --clips Idle,Walk,Run --out public/Soldier.vat.glb
//
// `loadVAT` reads that file back as the VAT `bakeVAT` returned, texel for
// texel, and `createVATMesh` cannot tell the two apart. Load the crowd either
// way and compare what each costs the page.
//
// The same program as webgl_file.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, loadVAT, type VAT, type VATCrowd, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette, partColour } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_file.ts?raw";

const COUNT = 60;

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

// ---------------------------------------------------------------- load
type From = "file" | "gltf";
const maxTextureSize = getMaxTextureSize(renderer);
const setDownload = readout("download");
const setLoadTime = readout("load-time");
const setBakeTime = readout("bake-time");

/** What the browser fetched for a URL, read off its resource timing. */
function bytesFetched(url: string): number {
  const href = new URL(url, location.href).href;
  const entries = performance.getEntriesByName(href);
  const entry = entries[entries.length - 1] as PerformanceResourceTiming | undefined;
  return entry ? entry.decodedBodySize : 0;
}

const megabytes = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`);

/** A VAT, and what getting it cost the page. */
interface Loaded {
  vat: VAT;
  loadMs: number;
  /** `null` for the file: nothing was baked. */
  bakeMs: number | null;
  bytes: number;
}

async function load(from: From): Promise<Loaded> {
  const started = performance.now();
  if (from === "file") {
    // The whole runtime path: one call, and the VAT is in hand.
    const vat = await loading(() => loadVAT("Soldier.vat.glb"));
    return { vat, loadMs: performance.now() - started, bakeMs: null, bytes: bytesFetched("Soldier.vat.glb") };
  }
  // The same VAT, the way every other page gets it: load the source, bake it.
  const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
  gltf.scene.updateMatrixWorld(true);
  const loadMs = performance.now() - started;
  const clips = gltf.animations.filter((clip) => clip.name !== "TPose");
  const { vat, bakeMs } = await forging(() => {
    const bakeStarted = performance.now();
    return { vat: bakeVAT(gltf.scene, clips, { maxTextureSize }), bakeMs: performance.now() - bakeStarted };
  });
  return { vat, loadMs, bakeMs, bytes: bytesFetched("Soldier.glb") };
}

// ---------------------------------------------------------------- crowd
const time: VATTimeUniform = uniform(0);
const phases = Array.from({ length: COUNT }, () => -Math.random() * 10);
const turns = Array.from({ length: COUNT }, () => Math.PI + (Math.random() - 0.5) * 1.2);
type Crowd = VATCrowd & { vat: VAT };
let shown: Crowd | null = null;
/** Bumped by every load, so a load a later one overtook is let go rather than shown. */
let latest = 0;

/** Let a crowd go, and the bake under it: nothing else holds either. */
function release({ vat, mesh, playback }: Crowd) {
  scene.remove(mesh);
  mesh.dispose();
  for (const material of [mesh.material, mesh.customDepthMaterial, mesh.customDistanceMaterial].flat()) material?.dispose();
  playback.texture.dispose();
  vat.geometry.dispose();
  const textures = vat.encoding === "rig" ? [vat.rigTexture] : [vat.positionTexture, vat.normalTexture];
  for (const texture of textures) texture?.dispose();
}

async function show(from: From) {
  const ticket = ++latest;
  const { vat, loadMs, bakeMs, bytes } = await load(from);
  if (ticket !== latest) return; // a later choice is loading; this one never reached the GPU
  if (shown) release(shown);
  setLoadTime(`${Math.round(loadMs)} ms`);
  setBakeTime(bakeMs === null ? "none" : `${Math.round(bakeMs)} ms`);
  setDownload(megabytes(bytes));

  // The file carries Soldier's materials, textures and all; the studio's
  // matte look goes on over them, as on any other page.
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    material.setValues({ map: null, normalMap: null, color: partColour(material.name), roughness: 0.9, metalness: 0 });
  }
  const instances: VATInstance[] = phases.map((startTime, i) => ({ clip: vat.clips[i % vat.clips.length]!, startTime }));
  const crowd = createVATMesh(vat, instances, { time, maxTextureSize });
  const { mesh } = crowd;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const size = vat.bounds.getSize(new THREE.Vector3());
  const spacing = Math.max(size.x, size.z) * 0.9;
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  for (let i = 0; i < COUNT; i++) {
    const radius = spacing * Math.sqrt(i + 0.5);
    const angle = i * 2.39996; // the golden angle
    // Soldier is authored facing -z; turned to face the camera, give or take.
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), turns[i]!);
    mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius), turn, new THREE.Vector3(1, 1, 1)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  shown = { ...crowd, vat };
}
await show("file");

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.select(
  "load",
  [
    ["file", "the baked file"],
    ["gltf", "the glTF, baked here"],
  ],
  "file",
  (from) => void show(from),
);
panel.source({ code: source, path: "examples/src/webgpu_file.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
});
