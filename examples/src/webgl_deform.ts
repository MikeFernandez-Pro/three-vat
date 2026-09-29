// Deform, on WebGL: your own GLSL, run after the VAT has posed the vertex.
//
// A crowd that turns to watch the pointer is the scene's idea, not the
// library's, and three-vat's job ends at the posed vertex. What it owes you is
// somewhere to put the next lines: the **post-decode hook**. A `prelude` ahead
// of three's shader, a chunk at the `position` point and one at the `normal`
// point, with `vatInstanceIndex` declared at both so a chunk can read
// per-instance data of its own.
//
// Two points, because three takes the normal before the position: a twist of
// the position alone leaves the crowd lit as though it had never turned. And
// `createVATMesh` threads the hook into the shadow pass's materials too, so
// the shadows turn with the crowd.
//
// The same twist as webgpu_deform.ts, where `positionNode` is a value and the
// page simply composes with it — no hook needed (ADR-0021).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { palette } from "./palette.js";
import { createPanel, readout } from "./ui.js";
import source from "./webgl_deform.ts?raw";

const COLUMNS = 12;
const RANKS = 8;
const COUNT = COLUMNS * RANKS;
// Where the twist starts and where it has all arrived, as fractions of the
// baked height: knee to shoulder, so the feet stay planted.
const KNEE = 0.25;
const SPAN = 0.45;

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
camera.position.set(0, 7, 19);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.47;

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
// The vertex encoding, by name: the twist eases in off the rest pose's
// `position.y`, which only this encoding keeps in the bake's own units. The
// rig encoding keeps the bind pose there — for Soldier, a hundredth of the
// height — and nothing would clear the knee.
const gltf = await new GLTFLoader().loadAsync("Soldier.glb");
gltf.scene.updateMatrixWorld(true);
const idle = gltf.animations.find((clip) => clip.name === "Idle")!;
const vat = bakeVAT(gltf.scene, [idle], { encoding: "delta", maxTextureSize: getMaxTextureSize(renderer) });

for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: palette.character, roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- your own data
// Where each soldier stands and how much of the angle it takes, one texel per
// instance in a texture of the page's own — read in the chunk by the index the
// hook declares.
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

const target = new THREE.Vector3(6, 0, 8);
const limit = { value: THREE.MathUtils.degToRad(50) };

// ---------------------------------------------------------------- the hook
const hook = {
  // Folded into three-vat's program key: two crowds with different hooks must
  // not share a compiled program.
  key: "deform:twist",
  uniforms: {
    uHome: { value: homeTexture },
    uTarget: { value: target },
    uTwistLimit: limit,
    uKnee: { value: vat.bounds.min.y + size.y * KNEE },
    uSpan: { value: size.y * SPAN },
  },
  prelude: /* glsl */ `
    uniform highp sampler2D uHome;
    uniform vec3 uTarget;
    uniform float uTwistLimit;
    uniform float uKnee;
    uniform float uSpan;

    // The yaw from where this instance stands to the target, clamped so the
    // crowd leans rather than spins, scaled by the instance's own gain.
    float twistAngle( const in int instance ) {
      vec4 home = texelFetch( uHome, ivec2( 0, instance ), 0 );
      vec2 toTarget = uTarget.xz - home.xy;
      return clamp( atan( toTarget.x, toTarget.y ), -uTwistLimit, uTwistLimit ) * home.z;
    }

    // A yaw about the instance's own axis, eased in with the rest pose's
    // height — so the position and the normal get the very same angle.
    vec3 twistY( const in vec3 v, const in float angle ) {
      float a = angle * smoothstep( uKnee, uKnee + uSpan, position.y );
      float s = sin( a ), c = cos( a );
      return vec3( c * v.x + s * v.z, v.y, -s * v.x + c * v.z );
    }`,
  position: "transformed = twistY( transformed, twistAngle( vatInstanceIndex ) );",
  // Drop this line and the crowd still turns — and is still lit as if it had not.
  normal: "objectNormal = twistY( objectNormal, twistAngle( vatInstanceIndex ) );",
};

// ---------------------------------------------------------------- crowd
const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
  clip: vat.clips[0]!,
  startTime: -((i * 0.618034) % 1) * idle.duration,
}));
// The hook goes to the render materials and the shadow pass's, in one call.
const { mesh, time } = createVATMesh(vat, instances, { hook });
mesh.castShadow = true;
mesh.receiveShadow = true;

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
// What the crowd is looking at, visible on the floor.
const marker = new THREE.Mesh(
  new THREE.TorusGeometry(0.45, 0.06, 8, 36),
  new THREE.MeshBasicMaterial({ color: palette.accent }),
);
marker.rotation.x = -Math.PI / 2;
marker.position.copy(target);
scene.add(marker);

// The target follows the pointer over the floor — not while the camera is
// being dragged, or every orbit would drag the crowd's gaze with it.
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let orbiting = false;
controls.addEventListener("start", () => (orbiting = true));
controls.addEventListener("end", () => (orbiting = false));
renderer.domElement.addEventListener("pointermove", (event) => {
  if (orbiting) return;
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(ground, target)) return;
  target.y = 0;
  marker.position.copy(target);
  showTwist();
});

// ---------------------------------------------------------------- panel
// The widest twist in the crowd right now, computed on the CPU by the rule
// the chunk runs on the GPU.
const setTwist = readout("twist");
readout("count")(COUNT);

function showTwist() {
  let widest = 0;
  for (let i = 0; i < COUNT; i++) {
    const angle = Math.atan2(target.x - homes[i * 4]!, target.z - homes[i * 4 + 1]!);
    const clamped = Math.max(-limit.value, Math.min(limit.value, angle)) * homes[i * 4 + 2]!;
    widest = Math.max(widest, Math.abs(clamped));
  }
  setTwist(`${Math.round(THREE.MathUtils.radToDeg(widest))}°`);
}
showTwist();

const panel = createPanel();
panel.slider("twist limit °", { min: 0, max: 90, value: 50 }, (degrees) => {
  limit.value = THREE.MathUtils.degToRad(degrees);
  showTwist();
});
panel.source({ code: source, path: "examples/src/webgl_deform.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  controls.update();
  renderer.render(scene, camera);
});
