// Switch one character's clip, on WebGL: switch one instance's clip, and touch no other.
//
// A crowd from `createVATMesh` is one playback texture, a row per instance. To
// change what one robot plays, write its row with `setVATInstance`, a clip and
// the moment it starts, and that row alone goes up to the GPU. Here the write
// is a shot: click a robot and it switches to Death. The page counts the
// robots down, from the shot until each stands again.
//
// The end of Death is `endsAt` of the write, known the moment the shot lands,
// with nothing read back from the GPU. Then the robot turns round
// (`turnVATInstance`) and plays its death backwards, alive again, and dances
// once. A robot falling or getting up ignores shots: each death plays out in
// full.
//
// Point at an idle robot and it says No, once. A shot cuts No or the dance
// short: the write that switches it to Death carries a `fadeDuration`, and
// `setVATInstance` blends out of whatever the row was showing, from the pose
// it was in.
//
// A shot hits a robot where it is drawn. `resolveVATBounds` gives each robot's
// box at the moment, from the frame bounds the bake measured: the frames its
// row is showing, both clips mid-crossfade, so a robot lying in its Death pose
// is hit where it lies. The boxes are drawn from the start; "show boxes"
// hides them.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, endsAt, LoopMode, resolveVATBounds, setVATInstance, turnVATInstance, type VATInstance } from "three-vat";
import { createVATMesh, getMaxTextureSize } from "three-vat/webgl";
import { limitCamera } from "./camera-limits.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./floor.js";
import { onLook, palette, partColour, wearPart } from "./palette.js";
import { paint, verticesOf } from "./repaint.js";
import { ended, endOf, entered, isDown, pickInstance, shot, type Phase, type Step } from "./shooting-gallery.js";
import { createTexturePanel } from "./texture-panel.js";
import { createPanel, readout } from "./ui.js";
import { countVATDraws, formatVATDraws } from "./vat-draws.js";
import source from "./webgl_clips.ts?raw";

const COUNT = 6;
/** A shooter's crosshair for the cursor: four accent strokes round a gap and a dot, edged in white to read on any robot, centred on the point it shoots. */
const RETICLE = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" stroke-linecap="round">' +
    '<path d="M24 5v11M24 32v11M5 24h11M32 24h11" stroke="#ffffff" stroke-width="9"/><circle cx="24" cy="24" r="4.5" fill="#ffffff"/>' +
    `<path d="M24 5v11M24 32v11M5 24h11M32 24h11" stroke="#${palette.accent.toString(16).padStart(6, "0")}" stroke-width="5"/>` +
    `<circle cx="24" cy="24" r="2.5" fill="#${palette.accent.toString(16).padStart(6, "0")}"/></svg>`,
)}") 24 24, crosshair`;

// ---------------------------------------------------------------- renderer
// alpha: the canvas clears to nothing, so the backdrop is the page's own colour (theme.css)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
document.body.append(renderer.domElement);

// ---------------------------------------------------------------- studio
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 4, 13);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
limitCamera(controls);

scene.add(new THREE.HemisphereLight(palette.fill, palette.floor, 1.8));
const key = new THREE.DirectionalLight(palette.key, 2.2);
key.position.set(10, 20, 12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -10;
key.shadow.camera.right = key.shadow.camera.top = 10;
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
const gltf = await loading(() => new GLTFLoader().loadAsync("RobotExpressive.glb"));
gltf.scene.updateMatrixWorld(true);
// The robot's three parts in the studio's colours for it, by material name,
// before the bake reads them.
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  for (const material of [object.material].flat() as THREE.MeshStandardMaterial[]) wearPart(material);
});
const clips = ["Idle", "Death", "No", "Dance"].map((name) => gltf.animations.find((clip) => clip.name === name)!);
const maxTextureSize = getMaxTextureSize(renderer);
const vat = await forging(() => bakeVAT(gltf.scene, clips, { mergeFlatMaterials: true, maxTextureSize }));
for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
  material.setValues({ roughness: 0.8, metalness: 0 });
}
const [idle, death, no, dance] = vat.clips as [(typeof vat.clips)[number], (typeof vat.clips)[number], (typeof vat.clips)[number], (typeof vat.clips)[number]];
// Death plays faster than authored, so the gallery keeps its rhythm. The revive
// is the same write turned round, so it gets up as fast as it fell.
const deathSpeed = 1.75;

// ---------------------------------------------------------------- gallery
// One row of robots, idling out of step, none behind another. `instances` is
// the page's own copy of what each row of the playback texture says, kept for the
// texture panel; `robots`, what each is doing and when that next changes.
const instances: VATInstance[] = Array.from({ length: COUNT }, () => ({ clip: idle, startTime: -Math.random() * 5 }));
const robots = instances.map(() => ({ phase: "idle" as Phase, next: null as number | null }));
const { mesh, time, playback } = createVATMesh(vat, instances, { maxTextureSize });
mesh.castShadow = true;
mesh.receiveShadow = true;

// The robot as it stands, for its size: the gallery's spacing and scale.
const standing = new THREE.Box3().setFromObject(gltf.scene);
const size = standing.getSize(new THREE.Vector3());
const scale = 1.8 / size.y; // RobotExpressive is authored a few metres tall
const spacing = Math.max(size.x, size.z) * scale * 1.6;
const placed = Array.from({ length: COUNT }, (_, i) => {
  const x = (i - (COUNT - 1) / 2) * spacing;
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.6);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, 0, 0), turn, new THREE.Vector3(scale, scale, scale));
});
placed.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
mesh.computeBoundingSphere();
scene.add(mesh);

// Each robot's box at the moment, in its own space: the frame bounds of what
// its row shows, which is what a shot is tested against. All six are drawn as
// one set of lines, each box's corners carried into the scene by its robot's
// matrix, so the boxes are one draw however many robots there are.
const boxes = instances.map(() => new THREE.Box3());
function boxesAt(now: number) {
  instances.forEach((instance, i) => resolveVATBounds(vat, instance, now, boxes[i]!));
}
/** A box's twelve edges, as pairs of its eight corners: bit 0 of a corner is max x, bit 1 max y, bit 2 max z. */
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
const boxLines = new THREE.LineSegments(
  new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(COUNT * EDGES.length * 3), 3)),
  new THREE.LineBasicMaterial({ color: palette.bounds }),
);
boxLines.frustumCulled = false; // its vertices move every frame, and no bounding sphere follows them
scene.add(boxLines);
onLook(() => boxLines.material.color.setHex(palette.bounds));
const corner = new THREE.Vector3();
/** Write each robot's box, as `boxesAt` left it, into the lines. */
function drawBoxes() {
  const position = boxLines.geometry.getAttribute("position") as THREE.BufferAttribute;
  boxes.forEach((box, i) => {
    EDGES.forEach((k, j) => {
      corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z);
      corner.applyMatrix4(placed[i]!);
      position.setXYZ(i * EDGES.length + j, corner.x, corner.y, corner.z);
    });
  });
  position.needsUpdate = true;
}

// ---------------------------------------------------------------- shots
/**
 * Make the one write a step asks for, at `at`: a clip from its first frame, or
 * a turn at the pose the robot shows. Idle loops; Death, No and Dance play
 * once, Death faster than authored. A write with a `fade` crossfades out of
 * whatever the row shows now, which `setVATInstance` reads back itself; the
 * turn is a cut, so it never meets a blend. When the clip written ends is
 * `endsAt` of the write, known now, with nothing read back from the GPU, and
 * that is when the robot next changes by itself.
 */
function apply(i: number, { phase, write, fade }: Step, at: number) {
  if (write === "turn") {
    instances[i] = turnVATInstance(playback, i, at);
  } else {
    const clip = { idle, death, no, dance }[write];
    const instance: VATInstance =
      write === "idle" ? { clip, startTime: at } : { clip, startTime: at, loopMode: LoopMode.Once, speed: write === "death" ? deathSpeed : 1 };
    if (fade > 0) instance.fadeDuration = fade;
    // What the row now holds, the band it crossfades out of included: the bounds read it.
    instances[i] = setVATInstance(playback, i, instance);
  }
  robots[i] = { phase, next: endOf(phase, endsAt(instances[i]!)) };
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/** The robot under the pointer, or `null`. */
function robotAt(event: PointerEvent) {
  pointer.set((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  boxesAt(time.value);
  return pickInstance(raycaster.ray, boxes, placed);
}

function shootAt(event: PointerEvent) {
  const i = robotAt(event);
  if (i !== null) {
    const step = shot(robots[i]!.phase);
    if (step) apply(i, step, time.value);
  }
}

// The pointer coming onto a robot, or a finger touching one: once per
// arrival, so a pointer resting on a robot does not make it say no again.
let pointed: number | null = null;
function pointAt(event: PointerEvent) {
  const i = robotAt(event);
  if (i !== null && i !== pointed) {
    const step = entered(robots[i]!.phase);
    if (step) apply(i, step, time.value);
  }
  pointed = i;
}

/** Every phase that has ended by `now`, each moved on at the moment it ended rather than this frame's. */
function endPhases(now: number) {
  for (let i = 0; i < COUNT; i++) {
    for (let robot = robots[i]!; robot.phase !== "idle" && robot.next !== null && robot.next <= now; robot = robots[i]!) {
      apply(i, ended(robot.phase), robot.next);
    }
  }
}

// A click shoots; a drag orbits, and shoots nothing.
let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
  down = { x: event.clientX, y: event.clientY };
  if (event.pointerType !== "mouse") pointAt(event);
});
renderer.domElement.addEventListener("pointermove", pointAt);
renderer.domElement.addEventListener("pointerleave", () => (pointed = null));
renderer.domElement.addEventListener("pointerup", (event) => {
  if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 5) shootAt(event);
  down = null;
  if (event.pointerType !== "mouse") pointed = null;
});
renderer.domElement.style.cursor = RETICLE;

// ---------------------------------------------------------------- panel
const setDown = readout("robots-down");
const setDraws = readout("draw-count");
// The crowd's draws alone, by pass: the frame strip's DRAWS is every one.
const takeDraws = countVATDraws(renderer, scene, (object) => object === mesh);
readout("count")(COUNT);

const texturePanel = createTexturePanel([{ name: "RobotExpressive", vat, instances: () => instances }], {
  caption: "one cursor per robot",
});
document.body.append(texturePanel.root);

const panel = createPanel();
// The robots' colours, a picker per part. The merge left one white material and
// moved each part's colour into the vertices, so it is those vertices that are
// repainted: found once by the colour the bake wrote, painted on every pick.
const colours = vat.geometry.getAttribute("color") as THREE.BufferAttribute;
const colourGroup = panel.group("robot");
for (const [label, part] of [
  ["body", "Main"],
  ["trim", "Grey"],
  ["eyes", "Black"],
] as const) {
  const vertices = verticesOf(colours.array, new THREE.Color(partColour(part)));
  const swatch = colourGroup.color(label, partColour(part), (picked) => {
    paint(colours.array, vertices, new THREE.Color(picked));
    colours.needsUpdate = true;
  });
  // A change of look paints the part the look's colour, picked or not.
  onLook(() => {
    paint(colours.array, vertices, new THREE.Color(partColour(part)));
    colours.needsUpdate = true;
    swatch.querySelector("input")!.value = `#${new THREE.Color(partColour(part)).getHexString()}`;
  });
}

panel.toggle("show boxes", boxLines.visible, (on) => (boxLines.visible = on));

panel.source({ code: source, path: "examples/src/webgl_clips.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  endPhases(time.value);
  if (boxLines.visible) {
    boxesAt(time.value);
    drawBoxes();
  }
  // Down from the shot until it stands again: falling, lying, getting up.
  setDown(`${robots.filter((robot) => isDown(robot.phase)).length} / ${COUNT}`);
  controls.update();
  renderer.render(scene, camera);
  texturePanel.update(time.value);
  setDraws(formatVATDraws(takeDraws()));
});
