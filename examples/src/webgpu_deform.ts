// Deform, on WebGPU: your own node graph, run after the VAT has posed the vertex.
//
// A crowd that turns to watch a cube go by is the scene's idea, not the
// library's, and three-vat's job ends at the posed vertex. On this path there
// is nothing to hook into, because the decode already *is* a value: the
// material's `positionNode`. Wrap it in a graph of your own and the crowd is
// deformed after it is posed.
//
// The normal turns with the position — the decode wrote `normalLocal` in the
// same vertex stage, so the graph gives it the very same angle, or the crowd
// would be lit as though it had never turned. And the shadow pass reads
// `positionNode` too, so the shadows turn with the crowd for free.
//
// The same twist as webgl_deform.ts, where the WebGL path needs the
// post-decode hook's two GLSL chunks to say it (ADR-0021).
import * as THREE from "three/webgpu";
import {
  Fn,
  atan,
  clamp,
  cos,
  float,
  instanceIndex,
  int,
  ivec2,
  normalLocal,
  positionGeometry,
  sin,
  smoothstep,
  textureLoad,
  uniform,
  vec3,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { addFloorControls } from "./floor-fade.js";
import { forging } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgpu_deform.ts?raw";

type Vec3Node = THREE.Node<"vec3">;

const COLUMNS = 12;
const RANKS = 8;
const COUNT = COLUMNS * RANKS;
// Where the twist starts and where it has all arrived, as fractions of the
// baked height: knee to shoulder, so the feet stay planted.
const KNEE = 0.25;
const SPAN = 0.45;

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
camera.position.set(0, 7, 19);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
const cameraLimits = limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.4));
// Low and to the side, so the light rakes across the crowd: the shading is
// half of what this page shows.
const key = new THREE.DirectionalLight(palette.key, 2.6);
key.position.set(-14, 9, 10);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -14;
key.shadow.camera.right = key.shadow.camera.top = 14;
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
// The vertex encoding, by name: the twist eases in off the rest pose's
// `position.y`, which only this encoding keeps in the bake's own units. The
// rig encoding keeps the bind pose there — for Soldier, a hundredth of the
// height — and nothing would clear the knee.
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const idle = gltf.animations.find((clip) => clip.name === "Idle")!;
const vat = await forging(() => bakeVAT(gltf.scene, [idle], { encoding: "delta", maxTextureSize: getMaxTextureSize(renderer) }));

for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- your own data
// Where each soldier stands and how much of the angle it takes, one texel per
// instance in a texture of the page's own — read in the graph by the
// instance's index.
const size = vat.bounds.getSize(new THREE.Vector3());
const pitch = Math.max(size.x, size.z) * 1.6;
const homes = new Float32Array(COUNT * 4);
for (let i = 0; i < COUNT; i++) {
  const x = ((i % COLUMNS) - (COLUMNS - 1) / 2) * pitch;
  const z = ((RANKS - 1) / 2 - Math.floor(i / COLUMNS)) * pitch;
  const gain = 0.55 + ((i * 0.618034) % 1) * 0.45; // each its own, so they do not turn as one
  homes.set([x, z, gain, 0], i * 4);
}
const homeTexture = new THREE.DataTexture(homes, 1, COUNT, THREE.RGBAFormat, THREE.FloatType);
homeTexture.needsUpdate = true;

const target = new THREE.Vector3(); // where the cube is, set each frame
const uTarget = uniform(target);
const limit = uniform(THREE.MathUtils.degToRad(50));
const uKnee = uniform(vat.bounds.min.y + size.y * KNEE);
const uSpan = uniform(size.y * SPAN);

// ---------------------------------------------------------------- crowd
const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
  clip: vat.clips[0]!,
  startTime: -((i * 0.618034) % 1) * idle.duration,
}));
const { mesh, time } = createVATMesh(vat, instances);
mesh.castShadow = true;
mesh.receiveShadow = true;

// ---------------------------------------------------------------- the twist
// The decode `createVATMesh` put on the materials, wrapped in a graph of your
// own. One node for every material, as the decode was.
type NodeMaterial = THREE.Material & { positionNode: Vec3Node };
const materials = mesh.material as NodeMaterial[];
const decoded = materials[0]!.positionNode;

const twisted = Fn(() => {
  // The decode runs here: the posed vertex, instanced, with `normalLocal`
  // written beside it.
  const posed = vec3(decoded).toVar();

  // The yaw from where this instance stands to the target, clamped so the
  // crowd leans rather than spins, scaled by the instance's own gain.
  const home = textureLoad(homeTexture, ivec2(int(0), int(instanceIndex))).toVar();
  const angle = clamp(atan(uTarget.x.sub(home.x), uTarget.z.sub(home.y)), limit.negate(), limit).mul(home.z);
  // Eased in with the rest pose's height, so the position and the normal get
  // the very same angle.
  const eased = angle.mul(smoothstep(uKnee, uKnee.add(uSpan), positionGeometry.y)).toVar();
  const s = sin(eased).toVar();
  const c = cos(eased).toVar();
  const twistY = (v: Vec3Node): Vec3Node => vec3(c.mul(v.x).add(s.mul(v.z)), v.y, s.negate().mul(v.x).add(c.mul(v.z)));

  // Drop this line and the crowd still turns — and is still lit as if it had not.
  normalLocal.assign(twistY(vec3(normalLocal)));

  // About the instance's own axis: the decode has already placed it, so the
  // pivot is where it stands.
  const pivot = vec3(home.x, float(0), home.y);
  return pivot.add(twistY(posed.sub(pivot)));
}, "vec3")();

for (const material of materials) material.positionNode = twisted;

// A translation and a heading, nothing else. Soldier is authored facing -z;
// turned half round, the whole crowd faces +z, which is where the twist's
// angle is measured from.
const matrix = new THREE.Matrix4();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const one = new THREE.Vector3(1, 1, 1);
for (let i = 0; i < COUNT; i++) {
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(homes[i * 4], 0, homes[i * 4 + 1]), facing, one));
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- the target
// What the crowd is looking at: a red cube out in front of it, sweeping from
// right to left and back. Take hold of it and drag it along its line; let go,
// and it carries on the way it was going.
const CUBE = 0.8; // metres a side
const SPEED = 2.5; // metres per second
const front = ((RANKS - 1) / 2) * pitch + 2.5; // a few strides ahead of the front rank
const sweep = ((COLUMNS - 1) / 2) * pitch * 0.9; // most of the way to either end of the line
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(CUBE, CUBE, CUBE),
  new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.6 }),
);
cube.position.set(sweep, CUBE / 2, front); // on the right, as the camera sees it
cube.castShadow = true;
scene.add(cube);
let heading = -1; // right to left first

// The drag: along x only, on the plane through the cube's middle, from where
// it was taken hold of — so it does not jump to the pointer.
const grabPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUBE / 2);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hit = new THREE.Vector3();
let held: { offset: number } | null = null;

function aim(event: PointerEvent) {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}

// Heard on the way down, before OrbitControls hears it on the canvas: a press
// on the cube is a drag of the cube, never an orbit.
addEventListener(
  "pointerdown",
  (event) => {
    if (event.target !== renderer.domElement) return;
    aim(event);
    if (raycaster.intersectObject(cube).length === 0) return;
    if (!raycaster.ray.intersectPlane(grabPlane, hit)) return;
    held = { offset: cube.position.x - hit.x };
    controls.enabled = false;
    renderer.domElement.style.cursor = "grabbing";
  },
  { capture: true },
);
addEventListener("pointermove", (event) => {
  aim(event);
  if (!held) {
    if (event.target === renderer.domElement && controls.enabled) {
      renderer.domElement.style.cursor = raycaster.intersectObject(cube).length > 0 ? "grab" : "";
    }
    return;
  }
  if (!raycaster.ray.intersectPlane(grabPlane, hit)) return;
  cube.position.x = THREE.MathUtils.clamp(hit.x + held.offset, -sweep, sweep);
});
const letGo = () => {
  if (!held) return;
  held = null;
  controls.enabled = true;
  renderer.domElement.style.cursor = "grab";
};
addEventListener("pointerup", letGo);
addEventListener("pointercancel", letGo);

/** The sweep, while nobody is holding the cube: back and forth along its line. */
function move(delta: number) {
  if (!held) {
    cube.position.x += heading * SPEED * delta;
    if (Math.abs(cube.position.x) >= sweep) {
      cube.position.x = Math.sign(cube.position.x) * sweep;
      heading = -Math.sign(cube.position.x);
    }
  }
  target.set(cube.position.x, 0, cube.position.z);
}

// ---------------------------------------------------------------- panel
// The widest twist in the crowd right now, computed on the CPU by the rule
// the graph runs on the GPU.
const setTwist = readout("twist");
const setDraws = readout("draw-count");
readout("count")(COUNT);
// The crowd's draws alone: one, and one more for the shadow map — the pass the
// twist reaches through the same `positionNode`. The cube and the floor are not counted.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);

function showTwist() {
  let widest = 0;
  for (let i = 0; i < COUNT; i++) {
    const angle = Math.atan2(target.x - homes[i * 4]!, target.z - homes[i * 4 + 1]!);
    const clamped = Math.max(-limit.value, Math.min(limit.value, angle)) * homes[i * 4 + 2]!;
    widest = Math.max(widest, Math.abs(clamped));
  }
  setTwist(`${Math.round(THREE.MathUtils.radToDeg(widest))}°`);
}

const panel = createPanel();
panel.slider("twist limit °", { min: 0, max: 90, value: 50 }, (degrees) => {
  limit.value = THREE.MathUtils.degToRad(degrees);
});
cameraLimits.addTo(panel);
addFloorControls(panel, floor.fade);
panel.source({ code: source, path: "examples/src/webgpu_deform.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  move(Math.min(timer.getDelta(), 0.1)); // a tab left in the background does not fling it
  showTwist();
  controls.update();
  renderer.render(scene, camera);
  setDraws(formatVATDraws(takeDraws()));
});
