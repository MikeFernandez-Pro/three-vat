// Add your own shader code, on WebGL: your own GLSL, run after the VAT has posed the vertex.
//
// A crowd that turns to watch a cube go by is the scene's idea, not the
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
// And a freak show on top: every soldier's own seed, in the same texture,
// swells its belly, stretches it or wrings it round — so per-instance data is
// not only where a soldier stands, but what it is.
//
// And a panel to light it by: the two lights, the tone mapping, the crowd's
// colour, and a toon material. The toon crowd is patched with the same hook,
// or it would stand up straight; and every swap disposes the materials it
// replaces.
//
// The same twist as webgpu_deform.ts, where `positionNode` is a value and the
// page simply composes with it — no hook needed (ADR-0021).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize, patchVATMaterial } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { FREAKS, WRING_BAND, freaksOf } from "./freaks.js";
import { createFloor } from "./floor.js";
import { palette, partColour } from "./palette.js";
import { headingAt, phaseAt, sweepAt } from "./sweep.js";
import { GRADIENTS, crispGradient, gradientFile, type Tones } from "./toon.js";
import { createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
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

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 10, 28);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.4));
// Low and to the side, so the light rakes across the crowd: the shading is
// half of what this page shows. 55 degrees round the crowd, 28 above the floor.
const key = new THREE.DirectionalLight(palette.key, 2.6);
key.position.setFromSphericalCoords(24, THREE.MathUtils.degToRad(90 - 28), THREE.MathUtils.degToRad(-55));
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -20;
key.shadow.camera.right = key.shadow.camera.top = 20;
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
// The vertex encoding, by name: the twist eases in off the rest pose's
// `position.y`, which only this encoding keeps in the bake's own units. The
// rig encoding keeps the bind pose there — for Soldier, a hundredth of the
// height — and nothing would clear the knee.
const gltf = await loading(() => new GLTFLoader().loadAsync("Soldier.glb"));
gltf.scene.updateMatrixWorld(true);
const idle = gltf.animations.find((clip) => clip.name === "Idle")!;
const vat = await forging(() => bakeVAT(gltf.scene, [idle], { encoding: "delta", maxTextureSize: getMaxTextureSize(renderer) }));

for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ map: null, normalMap: null, color: partColour(material.name), roughness: 0.9, metalness: 0 });
}

// ---------------------------------------------------------------- your own data
// Where each soldier stands, how much of the angle it takes and the seed of
// its own shape, one texel per instance in a texture of the page's own — read
// in the chunk by the index the hook declares.
const size = vat.bounds.getSize(new THREE.Vector3());
// Wide apart, so each soldier's own shape reads on its own.
const pitch = Math.max(size.x, size.z) * 2.4;
const freaks = freaksOf(COUNT);
const homes = new Float32Array(COUNT * 4);
for (let i = 0; i < COUNT; i++) {
  const x = ((i % COLUMNS) - (COLUMNS - 1) / 2) * pitch;
  const z = ((RANKS - 1) / 2 - Math.floor(i / COLUMNS)) * pitch;
  const gain = 0.55 + ((i * 0.618034) % 1) * 0.45; // each its own, so they do not turn as one
  homes.set([x, z, gain, freaks[i]!.seed], i * 4);
}
const homeTexture = new THREE.DataTexture(homes, 1, COUNT, THREE.RGBAFormat, THREE.FloatType);
homeTexture.needsUpdate = true;

const target = new THREE.Vector3(); // where the cube is, set each frame
const limit = { value: THREE.MathUtils.degToRad(50) };

// ---------------------------------------------------------------- the hook
/** A freak range, as the GLSL that walks `amount` along it: floats, always. */
const alongInGLSL = ([min, max]: readonly [number, number]) => `${min.toFixed(3)} + ${(max - min).toFixed(3)} * amount`;

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
    uFeet: { value: vat.bounds.min.y },
    uHeight: { value: size.y },
  },
  prelude: /* glsl */ `
    uniform highp sampler2D uHome;
    uniform vec3 uTarget;
    uniform float uTwistLimit;
    uniform float uKnee;
    uniform float uSpan;
    uniform float uFeet;
    uniform float uHeight;

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
    }

    // The instance's own shape, from its seed: the seed's third says which,
    // where it falls in that third says how much (shapeOf, in freaks.ts, whose
    // ranges these are). x: the bulge; y: the stretch; z: the wring, in radians.
    vec3 freakOf( const in int instance ) {
      float third = texelFetch( uHome, ivec2( 0, instance ), 0 ).w * 3.0;
      float kind = floor( third ), amount = fract( third );
      return vec3(
        kind == 0.0 ? ${alongInGLSL(FREAKS.bulge)} : 0.0,
        kind == 1.0 ? ${alongInGLSL(FREAKS.stretch)} : 1.0,
        kind == 2.0 ? ${alongInGLSL(FREAKS.wring)} : 0.0 );
    }

    // What the shape does to the width, the height and the heading at this
    // vertex's rest height: the belly swells, the height trades for the width,
    // and the wring winds the waist and unwinds by the shoulders (wringAt, in
    // freaks.ts), so the head still faces where the cube's pull turns it.
    vec3 freakAt( const in vec3 freak ) {
      float h = ( position.y - uFeet ) / uHeight;
      float swell = 1.0 + freak.x * ( 1.0 - smoothstep( 0.0, 0.2, abs( h - 0.55 ) ) );
      return vec3( swell / sqrt( freak.y ), freak.y, freak.z * sin( ${Math.PI.toFixed(6)} * smoothstep( ${WRING_BAND[0].toFixed(3)}, ${WRING_BAND[1].toFixed(3)}, h ) ) );
    }

    // The shape, about the instance's own axis and its origin, where its feet stand.
    vec3 freakPosition( const in vec3 v, const in vec3 freak ) {
      vec3 at = freakAt( freak );
      float s = sin( at.z ), c = cos( at.z );
      vec2 xz = v.xz * at.x;
      return vec3( c * xz.x + s * xz.y, v.y * at.y, -s * xz.x + c * xz.y );
    }

    // And to the normal: a scale's inverse, then the same wring.
    vec3 freakNormal( const in vec3 n, const in vec3 freak ) {
      vec3 at = freakAt( freak );
      float s = sin( at.z ), c = cos( at.z );
      vec2 xz = n.xz / at.x;
      return normalize( vec3( c * xz.x + s * xz.y, n.y / at.y, -s * xz.x + c * xz.y ) );
    }`,
  // The freak first, then the cube's pull on top of it.
  position: `
    vec3 freak = freakOf( vatInstanceIndex );
    transformed = twistY( freakPosition( transformed, freak ), twistAngle( vatInstanceIndex ) );`,
  // Drop this line and the crowd still turns — and is still lit as if it had not.
  normal: "objectNormal = twistY( freakNormal( objectNormal, freakOf( vatInstanceIndex ) ), twistAngle( vatInstanceIndex ) );",
};

// ---------------------------------------------------------------- crowd
const instances: VATInstance[] = Array.from({ length: COUNT }, (_, i) => ({
  clip: vat.clips[0]!,
  startTime: -((i * 0.618034) % 1) * idle.duration,
}));
// The hook goes to the render materials and the shadow pass's, in one call.
const { mesh, time, playback } = createVATMesh(vat, instances, { hook });
mesh.castShadow = true;
mesh.receiveShadow = true;

// A translation, a heading and a size. Soldier is authored facing -z; turned
// half round, the whole crowd faces +z, which is where the twist's angle is
// measured from. The size is each soldier's own, and the matrix's business:
// no shader needs to know it.
const matrix = new THREE.Matrix4();
const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const scale = new THREE.Vector3();
for (let i = 0; i < COUNT; i++) {
  scale.setScalar(freaks[i]!.scale);
  mesh.setMatrixAt(i, matrix.compose(new THREE.Vector3(homes[i * 4], 0, homes[i * 4 + 1]), facing, scale));
}
mesh.computeBoundingSphere();
scene.add(mesh);

// ---------------------------------------------------------------- the material
// The crowd's own material, or a toon one shading in three.js's own bands. A
// swap builds the crowd fresh materials, patched with the very same hook, or
// the toon crowd would stand up straight; and disposes the ones it replaces.
type Look = "standard" | "toon";
const look = { material: "standard" as Look, tones: "three" as Tones };

// Both gradients up front, read texel by texel so the bands keep their edges.
const textureLoader = new THREE.TextureLoader();
const gradients = Object.fromEntries(
  await Promise.all(
    GRADIENTS.map(async ([tones]) => {
      // Left out of any colour space, as three's own toon examples leave it:
      // its texels are where each band falls, not a colour.
      const texture = crispGradient(await textureLoader.loadAsync(gradientFile(tones)), THREE.NearestFilter);
      return [tones, texture] as const;
    }),
  ),
) as Record<Tones, THREE.Texture>;

function dressCrowd() {
  const outgoing = mesh.material as THREE.Material[];
  mesh.material = vat.materials.map((source) => {
    const material =
      look.material === "toon"
        ? new THREE.MeshToonMaterial({ name: source.name, gradientMap: gradients[look.tones] })
        : (source.clone() as THREE.MeshStandardMaterial);
    material.color.copy((source as THREE.MeshStandardMaterial).color); // each part its own colour
    // On the clock and the playback the crowd already runs on.
    return patchVATMaterial(material, vat, { uVatTime: time }, playback, { hook });
  });
  for (const material of outgoing) material.dispose();
}

// ---------------------------------------------------------------- the target
// What the crowd is looking at: an orange cube out in front of it, swinging from
// right to left and back, easing into each end. Take hold of it and drag it
// along its line; let go, and it carries on the way it was going.
const CUBE = 0.8; // metres a side
const SWING = 9; // seconds, there and back
let swingSpeed = 1; // the panel's: 0 parks the cube, 2 swings it twice as fast
const front = ((RANKS - 1) / 2) * pitch + 4; // a few strides ahead of the front rank
const sweep = ((COLUMNS - 1) / 2) * pitch * 0.9; // most of the way to either end of the line
const cube = new THREE.Mesh(
  new RoundedBoxGeometry(CUBE, CUBE, CUBE, 4, CUBE * 0.15),
  // A plain orange, apart from the visors' red, in the parts' matte finish.
  new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.9, metalness: 0 }),
);
let phase = 0; // on the right, as the camera sees it, and heading left
cube.position.set(sweepAt(phase) * sweep, CUBE / 2, front);
cube.castShadow = true;
scene.add(cube);

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
  // The swing picks up from where the cube was dropped, the way it was going.
  phase = phaseAt(cube.position.x / sweep, headingAt(phase));
  controls.enabled = true;
  renderer.domElement.style.cursor = "grab";
};
addEventListener("pointerup", letGo);
addEventListener("pointercancel", letGo);

/** The swing, while nobody is holding the cube: back and forth along its line. */
function move(delta: number) {
  if (!held) {
    phase += ((delta * swingSpeed) / SWING) * 2 * Math.PI;
    cube.position.x = sweepAt(phase) * sweep;
  }
  target.set(cube.position.x, 0, cube.position.z);
}

// ---------------------------------------------------------------- panel
// The widest twist in the crowd right now, computed on the CPU by the rule
// the chunk runs on the GPU.
const setTwist = readout("twist");
const setDraws = readout("draw-count");
readout("count")(COUNT);
// The crowd's draws alone: one, and one more for the shadow map — the pass the
// twist is threaded into by the same hook. The cube and the floor are not counted.
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

const cubeGroup = panel.group("cube");
cubeGroup.slider("speed", { min: 0, max: 3, step: 0.25, value: swingSpeed }, (value) => {
  swingSpeed = value;
});

const crowd = panel.group("crowd");
crowd.select(
  "material",
  [
    ["standard", "standard"],
    ["toon", "toon"],
  ],
  look.material,
  (material) => {
    look.material = material;
    gradient.hidden = material !== "toon";
    dressCrowd();
  },
);
const gradient = crowd.select("gradient", GRADIENTS, look.tones, (tones) => {
  look.tones = tones;
  dressCrowd();
});
gradient.hidden = true;

panel.source({ code: source, path: "examples/src/webgl_deform.ts" });

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
