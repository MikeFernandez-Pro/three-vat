// Encodings, on WebGL: the rig encoding, the vertex encoding, and the fallback.
//
// `bakeVAT` stores a clip one of two ways. The **rig encoding** stores the
// posed rig, a rotation, a translation and a scale per bone, and skins the
// rest pose in the vertex shader. The **vertex encoding** stores where every
// vertex ended up. The default, `'auto'`, bakes the rig wherever the asset
// allows it and falls back to the vertex encoding where it does not, keeping
// the reason on `vat.fallback`. Pick an encoding, or an asset the rig cannot
// store, and read what each bake cost.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VAT, type VATInstance } from "three-vat";
import { createVATMesh, createVATUniforms, getMaxTextureSize } from "three-vat/webgl";
import { createFrameStats } from "./frame-stats.js";
import { palette } from "./palette.js";
import { createTexturePanel } from "./texture-panel.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_encodings.ts?raw";

const COUNT = 60;

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
camera.position.set(4, 12, 26);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

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

// ---------------------------------------------------------------- assets
const loader = new GLTFLoader();
const [soldier, robot] = await Promise.all([loader.loadAsync("Soldier.glb"), loader.loadAsync("RobotExpressive.glb")]);
soldier.scene.updateMatrixWorld(true);
robot.scene.updateMatrixWorld(true);

// RobotExpressive's head carries three morph targets and ships them still, so
// the rig bakes it. Give its Idle a face that moves, "Surprised" up and back
// down, and the rig can no longer store it: a slot moves vertices only as a
// bone would.
function withMovingFace(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) =>
    track.name.endsWith(".morphTargetInfluences")
      ? // Three influences a keyframe: Angry, Surprised, Sad.
        new THREE.NumberKeyframeTrack(track.name, [0, clip.duration / 2, clip.duration], [0, 0, 0, 0, 1, 0, 0, 0, 0])
      : track,
  );
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

type AssetName = "soldier" | "robot";
const ASSETS: Record<AssetName, { root: THREE.Object3D; clips: THREE.AnimationClip[]; yaw: number }> = {
  // Soldier's three moving clips; its fourth, TPose, would stand it still.
  // Authored facing -z, so turned half a circle to face the camera.
  soldier: { root: soldier.scene, clips: soldier.animations.filter((clip) => clip.name !== "TPose"), yaw: Math.PI },
  robot: {
    root: robot.scene,
    clips: robot.animations
      .filter((clip) => ["Idle", "Walking", "Running"].includes(clip.name))
      .map((clip) => (clip.name === "Idle" ? withMovingFace(clip) : clip)),
    yaw: 0,
  },
};

// ---------------------------------------------------------------- bake
type Encoding = "auto" | "rig" | "delta";
const maxTextureSize = getMaxTextureSize(renderer);
// One clock for every crowd, so a flip never moves an instance in time.
const uniforms = createVATUniforms();

interface Baked {
  vat: VAT | null;
  /** Why the bake was refused, when it was: `encoding: 'rig'` on an asset the rig cannot store. */
  refused: string | null;
  ms: number;
  mesh: THREE.InstancedMesh | null;
  instances: VATInstance[];
  panel: ReturnType<typeof createTexturePanel> | null;
}
const bakes = new Map<string, Baked>();

function bake(name: AssetName, encoding: Encoding): Baked {
  const asset = ASSETS[name];
  const started = performance.now();
  let vat: VAT | null = null;
  let refused: string | null = null;
  try {
    vat = bakeVAT(asset.root, asset.clips, { encoding, maxTextureSize });
  } catch (error) {
    refused = (error as Error).message;
  }
  const ms = performance.now() - started;
  if (!vat) return { vat, refused, ms, mesh: null, instances: [], panel: null };

  // The studio's matte look in place of Soldier's textures; the robot keeps
  // its flat colours.
  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    if (name === "soldier") material.setValues({ map: null, normalMap: null, color: palette.character });
    material.setValues({ roughness: 0.9, metalness: 0 });
  }

  const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
    clip: vat.clips[i % vat.clips.length]!,
    startTime: -Math.random() * 10,
  }));
  const { mesh } = createVATMesh(vat, instances, { time: uniforms.uVatTime, maxTextureSize });
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // A sunflower spiral, every character scaled to the same height.
  const size = vat.bounds.getSize(new THREE.Vector3());
  const scale = 1.8 / size.y;
  const spacing = Math.max(size.x, size.z) * scale * 0.9;
  const matrix = new THREE.Matrix4();
  const turn = new THREE.Quaternion();
  for (let i = 0; i < COUNT; i++) {
    const radius = spacing * Math.sqrt(i + 0.5);
    const angle = i * 2.39996; // the golden angle
    turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), asset.yaw + (Math.random() - 0.5) * 1.2);
    const position = new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    mesh.setMatrixAt(i, matrix.compose(position, turn, new THREE.Vector3(scale, scale, scale)));
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);

  // The texture this bake wrote, drawn as it is, with a cursor per instance.
  const panel = createTexturePanel([{ name: name === "soldier" ? "Soldier" : "RobotExpressive", vat, instances: () => instances }], {
    caption: "one cursor per instance",
  });
  document.body.append(panel.root);
  return { vat, refused, ms, mesh, instances, panel };
}

// ---------------------------------------------------------------- readouts
const setEncoding = readout("encoding");
const setTexture = readout("texture");
const setMemory = readout("texture-memory");
const setBakeTime = readout("bake-time");
const setFallback = readout("fallback");

/** Every texture a bake keeps on the GPU: the rig texture, or the position and normal layers. */
function texturesOf(vat: VAT): THREE.DataTexture[] {
  if (vat.encoding === "rig") return [vat.rigTexture];
  return vat.normalTexture ? [vat.positionTexture, vat.normalTexture] : [vat.positionTexture];
}

const megabytes = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.round(bytes / 1e3)} kB`);

let shown: Baked | null = null;
let assetName: AssetName = "soldier";
let encoding: Encoding = "auto";

function show() {
  const key = `${assetName}/${encoding}`;
  if (!bakes.has(key)) bakes.set(key, bake(assetName, encoding));
  shown = bakes.get(key)!;
  for (const baked of bakes.values()) {
    if (baked.mesh) baked.mesh.visible = baked === shown;
    if (baked.panel) baked.panel.root.style.display = baked === shown ? "flex" : "none";
  }

  const { vat, refused, ms } = shown;
  setBakeTime(`${Math.round(ms)} ms`);
  if (!vat) {
    setEncoding("refused");
    setTexture("—");
    setMemory("—");
    setFallback(refused!);
    return;
  }
  const textures = texturesOf(vat);
  setEncoding(vat.encoding === "rig" ? "rig" : "vertex");
  setTexture(`${textures[0]!.image.width} × ${textures[0]!.image.height}`);
  setMemory(megabytes(textures.reduce((bytes, texture) => bytes + (texture.image.data as ArrayBufferView).byteLength, 0)));
  // Read off the VAT: why `'auto'` fell back, or nothing when it did not.
  setFallback(vat.encoding === "delta" && vat.fallback ? vat.fallback : "—");
}
show();

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.select(
  "asset",
  [
    ["soldier", "Soldier, skinned"],
    ["robot", "Robot, with a moving face"],
  ],
  assetName,
  (value) => {
    assetName = value;
    show();
  },
);
panel.select(
  "encoding",
  [
    ["auto", "auto"],
    ["rig", "rig"],
    ["delta", "vertex"],
  ],
  encoding,
  (value) => {
    encoding = value;
    show();
  },
);
panel.source({ code: source, path: "examples/src/webgl_encodings.ts" });

// What an encoding costs to draw is part of choosing one: the timings stay on screen.
const stats = await createFrameStats(renderer);

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  stats.begin();
  timer.update();
  uniforms.uVatTime.value = timer.getElapsed();
  shown?.panel?.update(uniforms.uVatTime.value);
  controls.update();
  renderer.render(scene, camera);
  stats.end();
});
