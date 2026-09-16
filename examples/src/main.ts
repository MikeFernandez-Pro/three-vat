// three-vat demo: a crowd of robots. One mesh, one VAT, many instances — each
// picking its own clip, phase and playback rate. The animation runs entirely on
// the GPU (zero per-frame CPU); only the walk/run transform is updated on the
// CPU each frame, and idle instances cost nothing at all.
//
// RobotExpressive is a hierarchy of 14 rigid, node-animated parts, not a single
// SkinnedMesh — see ADR-0008. `bakeVAT` merges the subtree and bakes where each
// vertex ended up, so the source of the deformation never matters.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { ColorEnvironment } from "three/addons/environments/ColorEnvironment.js";
import Stats from "stats-gl";
import { addVATInstanceAttributes, bakeVAT } from "three-vat";
import type { VATClip } from "three-vat";
import {
  createVATDepthMaterial,
  createVATUniforms,
  getMaxTextureSize,
  patchVATMaterial,
} from "three-vat/webgl";
import { createVATDebugPanel } from "./vat-debug.js";
import { layoutCrowd, ZONES, type Robot } from "./crowd.js";

const CLIP_NAMES: string[] = ZONES.map((z) => z.clip);
const TARGET_HEIGHT = 1.8; // world units, so the crowd reads at human scale

const params = {
  dancers: 60,
  walkers: 160,
  runners: 120,
  /** Ring spacing as a multiple of the robot's real width. 1 = shoulder to
   *  shoulder; below 1 they would overlap, so the slider stops there. */
  clearance: 1.25,
  /** Extra clear band between zones, in footprints. */
  zoneGap: 2,
  maxZoom: 120,
  animate: true,
  shadows: true,
  bgTop: "#8ec8ea",
  bgBottom: "#e8d5b0",
  exposure: 1.0,
  // lights
  ambientColor: "#eaf2fb",
  ambientIntensity: 0.6,
  sunColor: "#fff2df",
  sunIntensity: 2.2,
  sunX: 35,
  sunY: 55,
  sunZ: 25,
  // ground
  groundVisible: true,
  groundColor: "#8a9b6e",
  groundRoughness: 0.95,
  groundMetalness: 0.0,
  // environment
  envPreset: "sky" as EnvPresetName,
  envAsBackground: false,
  envIntensity: 1.0,
  // fog
  fogEnabled: true,
  fogColor: "#e8d5b0",
  fogNear: 25,
  fogFar: 90,
  // debug
  showVatTextures: false,
};

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = params.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
// ACES filmic rolls off the directional light's highlights instead of clipping
// them to white, which matters once an environment map is added on top.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = params.exposure;
document.body.appendChild(renderer.domElement);

function applyBackground() {
  document.body.style.background = `linear-gradient(to bottom, ${params.bgTop}, ${params.bgBottom})`;
}
applyBackground();

const scene = new THREE.Scene();

const fog = new THREE.Fog(params.fogColor, params.fogNear, params.fogFar);
function applyFog() {
  fog.color.set(params.fogColor);
  fog.near = Math.min(params.fogNear, params.fogFar);
  fog.far = Math.max(params.fogFar, fog.near + 0.001);
  scene.fog = params.fogEnabled ? fog : null;
  // scene.background is not fogged by the renderer, so paint it with the fog
  // color; otherwise empty pixels (and an env sky) stay crystal clear.
  applySceneBackground();
}

const camera = new THREE.PerspectiveCamera(
  50,
  innerWidth / innerHeight,
  0.1,
  400,
);
camera.position.set(0, 12, 34);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2, 0);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = params.maxZoom;

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const ambient = new THREE.AmbientLight(
  new THREE.Color(params.ambientColor),
  params.ambientIntensity,
);
scene.add(ambient);

const sun = new THREE.DirectionalLight(
  new THREE.Color(params.sunColor),
  params.sunIntensity,
);
sun.position.set(params.sunX, params.sunY, params.sunZ);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -40;
sun.shadow.camera.right = sun.shadow.camera.top = 40;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0005;
scene.add(sun);

// ---------------------------------------------------------------- ground
const groundMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(params.groundColor),
  roughness: params.groundRoughness,
  metalness: params.groundMetalness,
});
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1000, 1000),
  groundMaterial,
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.visible = params.groundVisible;
scene.add(ground);

// ---------------------------------------------------------------- environment
// Every preset is generated procedurally through PMREMGenerator.fromScene, so
// the demo stays asset-free (no .hdr to ship or fetch) and works offline.
type EnvPresetName = "none" | "sky" | "sunset" | "dusk" | "room" | "neutral";

// A vertical two-stop gradient sphere — cheap stand-in for a sky HDR.
function gradientEnv(top: string, bottom: string): THREE.Scene {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const env = new THREE.Scene();
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 32),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide }),
    ),
  );
  return env;
}

const ENV_PRESETS: Record<EnvPresetName, (() => THREE.Scene) | null> = {
  none: null,
  sky: () => gradientEnv("#8ec8ea", "#e8d5b0"),
  sunset: () => gradientEnv("#2b3a67", "#ff8c42"),
  dusk: () => gradientEnv("#1b2140", "#6d4f8c"),
  room: () => new RoomEnvironment(),
  neutral: () => new ColorEnvironment(new THREE.Color(0xbfbfbf)),
};

const pmrem = new THREE.PMREMGenerator(renderer);
// Hold the render target, not just its texture: the target owns the GPU memory,
// and disposing only the texture leaks a cubemap per preset switch.
let envTarget: THREE.WebGLRenderTarget | null = null;

function applyEnvironment() {
  envTarget?.dispose();
  envTarget = null;

  const make = ENV_PRESETS[params.envPreset];
  if (make) {
    const envScene = make();
    envTarget = pmrem.fromScene(envScene);
    // The source scene has served its purpose once the PMREM is generated.
    // RoomEnvironment/ColorEnvironment ship their own dispose(); the gradient
    // scenes are plain Scenes, so walk them by hand.
    const disposable = envScene as THREE.Scene & { dispose?: () => void };
    if (typeof disposable.dispose === "function") {
      disposable.dispose();
    } else {
      envScene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.map?.dispose();
        mat.dispose();
      });
    }
  }

  const envTexture = envTarget ? envTarget.texture : null;

  scene.environment = envTexture;
  scene.environmentIntensity = params.envIntensity;
  scene.backgroundIntensity = params.envIntensity;
  applySceneBackground();
}

// Fog does not affect scene.background, so when fog is on the backdrop has to
// *be* the fog color. Otherwise the env/CSS sky shows through unfogged.
function applySceneBackground() {
  if (params.fogEnabled) {
    scene.background = fog.color;
    return;
  }
  scene.background =
    params.envAsBackground && envTarget ? envTarget.texture : null;
}

applyEnvironment();
applyFog();

// ---------------------------------------------------------------- load + bake
const uniforms = createVATUniforms(); // shared playback clock for the crowd
const gltf = await new GLTFLoader().loadAsync("/RobotExpressive.glb");
gltf.scene.updateMatrixWorld(true);

const clips = gltf.animations.filter((c) => CLIP_NAMES.includes(c.name));
// The whole subtree is baked — 14 rigid parts merged into one vertex set.
const vat = bakeVAT(gltf.scene, clips, {
  fps: 30,
  maxTextureSize: getMaxTextureSize(renderer),
});

// Normalize to a human-ish height from the baked bounds, which already cover
// every frame of every clip — so the footprint accounts for the widest moment
// of the widest animation (arms out mid-dance), not just the rest pose.
const size = vat.bounds.getSize(new THREE.Vector3());
const normScale = TARGET_HEIGHT / size.y;
// The robot's real world-space width; the clearance slider scales it.
const baseFootprint = Math.max(size.x, size.z) * normScale;

let mesh: THREE.InstancedMesh | null = null;
let robots: Robot<VATClip>[] = [];

function build() {
  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    for (const mat of mesh.material as THREE.Material[]) mat.dispose();
    (mesh.customDepthMaterial as THREE.Material | undefined)?.dispose();
  }
  robots = layoutCrowd(
    vat.clips,
    params,
    baseFootprint * params.clearance,
    params.zoneGap,
  );
  const count = robots.length;

  // The baker owns the vertex ordering now (the textures are indexed by it), so
  // the geometry comes from the VAT rather than from the source mesh.
  const geometry = vat.geometry.clone();
  addVATInstanceAttributes(
    geometry,
    robots.map((r) => ({
      clip: r.clip,
      timeOffset: r.timeOffset,
      speed: r.speed,
    })),
  );

  // One material per source material, patched identically and sharing one
  // clock. Materials are never merged (ADR-0008), so the whole crowd is 3 draw
  // calls — not 3 per robot.
  const materials = vat.materials.map((source) => {
    const material = (source as THREE.MeshStandardMaterial).clone();
    patchVATMaterial(material, vat, uniforms);
    return material;
  });

  mesh = new THREE.InstancedMesh(geometry, materials, count);
  mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms);
  mesh.castShadow = params.shadows;
  mesh.receiveShadow = params.shadows;
  mesh.frustumCulled = false; // instances are placed by per-frame matrices
  scene.add(mesh);
  place(time); // lay the crowd out before the first render
  updateInfo();
}

/**
 * Toggle the whole shadow pass. Turning it off drops the depth-pass draw calls
 * (one per material group, plus the ground), which is visible live in the draw
 * counter — the point of exposing it.
 *
 * `shadowMap.enabled` is baked into each material's compiled program, so every
 * material has to be flagged for recompile or the flip is silently ignored.
 */
function applyShadows() {
  const on = params.shadows;
  renderer.shadowMap.enabled = on;
  sun.castShadow = on;
  ground.receiveShadow = on;
  if (mesh) {
    mesh.castShadow = on;
    mesh.receiveShadow = on;
  }
  scene.traverse((o) => {
    const material = (o as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      m.needsUpdate = true;
    }
  });
}

const infoEl = document.getElementById("info")!;
function updateInfo() {
  const byClip = new Map<string, number>();
  for (const r of robots) {
    byClip.set(r.clip.name, (byClip.get(r.clip.name) ?? 0) + 1);
  }
  const mix = ZONES.filter((z) => byClip.get(z.clip))
    .map((z) => `${byClip.get(z.clip)} ${z.key}`)
    .join(" · ");
  infoEl.textContent = `${robots.length} robots — ${mix} — one mesh, one VAT, zero per-frame CPU animation`;
}

// ---------------------------------------------------------------- loop helpers
// Declared up here because build() lays the crowd out immediately, and place()
// reads the clock.
let time = 0;
const up = new THREE.Vector3(0, 1, 0);
const q = new THREE.Quaternion();
const s = new THREE.Vector3();
const pos = new THREE.Vector3();
const m = new THREE.Matrix4();

// Only the ground transform is CPU work. The animation itself never touches the
// CPU, at any instance count — that is the whole claim.
//
// The angle is derived from absolute time rather than accumulated per frame, so
// robots on a ring stay *exactly* in formation however long the demo runs;
// accumulating `+= dt * omega` would let rounding drift them into each other.
function place(time: number) {
  if (!mesh) return;
  for (let i = 0; i < robots.length; i++) {
    const r = robots[i]!;
    const a = r.angle0 + r.omega * time;
    pos.set(Math.cos(a) * r.radius, 0, Math.sin(a) * r.radius);
    // Movers face along the tangent of travel; dancers keep a fixed heading.
    const facing = r.omega === 0 ? r.heading : -a + (r.omega > 0 ? 0 : Math.PI);
    q.setFromAxisAngle(up, facing);
    s.setScalar(normScale);
    mesh.setMatrixAt(i, m.compose(pos, q, s));
  }
  mesh.instanceMatrix.needsUpdate = true;
}

build();

// ---------------------------------------------------------------- VAT debug view
const vatPanel = createVATDebugPanel([
  { name: "RobotExpressive", vat, instances: () => robots },
]);
vatPanel.root.style.display = params.showVatTextures ? "flex" : "none";
document.body.append(vatPanel.root);

// ---------------------------------------------------------------- GUI
const gui = new GUI({ title: "robot crowd" });
gui.add(params, "animate").name("animate");
const crowdFolder = gui.addFolder("crowd");
for (const zone of ZONES) {
  crowdFolder
    .add(params, zone.key, 0, 800, 10)
    .name(zone.key)
    .onFinishChange(build); // rebuild only when the drag ends
}
// 1 = shoulder to shoulder. The non-overlap guarantee is "at least one
// footprint apart", so anything below 1 would let robots intersect.
crowdFolder
  .add(params, "clearance", 1, 4, 0.05)
  .name("ring spacing")
  .onFinishChange(build);
crowdFolder
  .add(params, "zoneGap", 0, 10, 0.5)
  .name("zone gap")
  .onFinishChange(build);
gui
  .add(params, "maxZoom", 20, 240, 5)
  .name("max zoom out")
  .onChange((v: number) => {
    controls.maxDistance = v;
  });
gui.addColor(params, "bgTop").name("bg top").onChange(applyBackground);
gui.addColor(params, "bgBottom").name("bg bottom").onChange(applyBackground);
gui
  .add(params, "exposure", 0.1, 3, 0.05)
  .name("exposure")
  .onChange((v: number) => {
    renderer.toneMappingExposure = v;
  });
gui.add(params, "shadows").name("shadows").onChange(applyShadows);
gui
  .add(params, "showVatTextures")
  .name("show VAT textures")
  .onChange((v: boolean) => {
    vatPanel.root.style.display = v ? "flex" : "none";
  });

const lightFolder = gui.addFolder("lights");
lightFolder
  .addColor(params, "ambientColor")
  .name("ambient color")
  .onChange((v: string) => {
    ambient.color.set(v);
  });
lightFolder
  .add(params, "ambientIntensity", 0, 25, 0.05)
  .name("ambient intensity")
  .onChange((v: number) => {
    ambient.intensity = v;
  });
lightFolder
  .addColor(params, "sunColor")
  .name("sun color")
  .onChange((v: string) => {
    sun.color.set(v);
  });
lightFolder
  .add(params, "sunIntensity", 0, 8, 0.05)
  .name("sun intensity")
  .onChange((v: number) => {
    sun.intensity = v;
  });
// The shadow camera is a fixed ±40 box aimed at the origin, so dragging the sun
// too far off moves the crowd out of its frustum and shadows clip. 100 keeps
// the useful range without needing a per-frame shadow-camera fit.
for (const [key, axis] of [
  ["sunX", "x"],
  ["sunY", "y"],
  ["sunZ", "z"],
] as const) {
  lightFolder
    .add(params, key, -100, 100, 1)
    .name(`sun ${axis}`)
    .onChange((v: number) => {
      sun.position[axis] = v;
    });
}

const groundFolder = gui.addFolder("ground");
groundFolder
  .add(params, "groundVisible")
  .name("visible")
  .onChange((v: boolean) => {
    ground.visible = v;
  });
groundFolder
  .addColor(params, "groundColor")
  .name("color")
  .onChange((v: string) => {
    groundMaterial.color.set(v);
  });
groundFolder
  .add(params, "groundRoughness", 0, 1, 0.01)
  .name("roughness")
  .onChange((v: number) => {
    groundMaterial.roughness = v;
  });
groundFolder
  .add(params, "groundMetalness", 0, 1, 0.01)
  .name("metalness")
  .onChange((v: number) => {
    groundMaterial.metalness = v;
  });

const envFolder = gui.addFolder("environment");
envFolder
  .add(params, "envPreset", Object.keys(ENV_PRESETS) as EnvPresetName[])
  .name("preset")
  .onChange(applyEnvironment);
envFolder
  .add(params, "envAsBackground")
  .name("as background")
  .onChange(applyEnvironment);
envFolder
  .add(params, "envIntensity", 0, 3, 0.05)
  .name("intensity")
  .onChange((v: number) => {
    scene.environmentIntensity = v;
    scene.backgroundIntensity = v;
  });

const fogFolder = gui.addFolder("fog");
fogFolder.add(params, "fogEnabled").name("enabled").onChange(applyFog);
fogFolder.addColor(params, "fogColor").name("color").onChange(applyFog);
fogFolder.add(params, "fogNear", 0, 200, 1).name("near").onChange(applyFog);
fogFolder.add(params, "fogFar", 1, 400, 1).name("far").onChange(applyFog);

// ---------------------------------------------------------------- perf panel
const stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);
stats.dom.style.cssText = "position:fixed;bottom:0;left:0";
await stats.init(renderer);
const drawsEl = document.getElementById("draws")!;

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  stats.begin();
  const dt = clock.getDelta();
  if (params.animate) {
    time += dt;
    place(time);
  }
  uniforms.uVatTime.value = time;
  if (params.showVatTextures) vatPanel.update(time);
  controls.update();
  renderer.render(scene, camera);
  drawsEl.textContent = `${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles.toLocaleString()} tris`;
  stats.end();
  stats.update();
});
