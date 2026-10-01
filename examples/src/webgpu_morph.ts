// The vertex encoding, on WebGPU: what the rig cannot store, baked anyway.
//
// The rig encoding stores a rotation, a translation and a scale per bone, and
// anything that moves vertices where no bone does is beyond it. The **vertex
// encoding** stores where every vertex ended up, so it does not care what moved
// them. Two subjects need it here. The Horse has no skeleton: it gallops by
// morph targets, fifteen shapes blended in turn, and a node track added to the
// same clip, a leap that moves the whole mesh, lands in the same texture. The
// robot's face moves by morph targets too. Neither declares an encoding: the
// default, `'auto'`, tries the rig, falls back, and keeps why on `vat.fallback`
// (ADR-0029).
//
// The same program as webgl_morph.ts (ADR-0011): `three/webgpu` and
// `three-vat/tsl`, an awaited `init()`, and a TSL uniform for the clock.
import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeVAT, type VAT, type VATInstance } from "three-vat";
import { uniform } from "three/tsl";
import { createVATMesh, getMaxTextureSize, type VATTimeUniform } from "three-vat/tsl";
import { limitCamera } from "./camera-limits.js";
import { trackKinds } from "./clip-tracks.js";
import { forging, loading } from "./forge.js";
import { createFloor } from "./webgpu/floor.js";
import { palette } from "./palette.js";
import { badge, createPanel, readout } from "./ui.js";
import source from "./webgpu_morph.ts?raw";

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
camera.position.set(0, 8, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.5, 0);
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

// ---------------------------------------------------------------- assets
const loader = new GLTFLoader();
const [horseFile, robotFile] = await loading(() => Promise.all([loader.loadAsync("Horse.glb"), loader.loadAsync("RobotExpressive.glb")]));
horseFile.scene.updateMatrixWorld(true);
robotFile.scene.updateMatrixWorld(true);
const horse = horseFile.scene.getObjectByProperty("type", "Mesh") as THREE.Mesh;
// The horse's height at rest, which every herd is scaled by: a leap must not shrink it.
const horseHeight = new THREE.Box3().setFromObject(horse).getSize(new THREE.Vector3()).y;

const STRIDES = 3;

// The gallop, repeated three strides long, so the leap below has strides either side to stand out from.
function repeatStrides(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.map((track) => {
    const size = track.getValueSize();
    const times: number[] = [];
    const values: number[] = [];
    for (let stride = 0; stride < STRIDES; stride++) {
      for (let key = 0; key < track.times.length; key++) {
        // A stride's closing key is the next one's opening key.
        if (stride < STRIDES - 1 && track.times[key]! >= clip.duration) continue;
        times.push(track.times[key]! + stride * clip.duration);
        values.push(...track.values.slice(key * size, (key + 1) * size));
      }
    }
    const repeated = track.clone();
    repeated.times = new Float32Array(times);
    repeated.values = new Float32Array(values);
    return repeated;
  });
  return new THREE.AnimationClip(clip.name, clip.duration * STRIDES, tracks);
}

// Node animation, written here and made to be seen: in the middle stride the
// horse leaps, its node rising half its height and pitching up, then down, as
// a rotation track and a position track on its node.
function withLeap(clip: THREE.AnimationClip): THREE.AnimationClip {
  const stride = clip.duration / STRIDES;
  const at = (strides: number[]) => strides.map((s) => s * stride);
  const pitch = (angle: number) =>
    horse.quaternion
      .clone()
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle))
      .toArray();
  const rise = (share: number) => horse.position.clone().add(new THREE.Vector3(0, share * horseHeight, 0)).toArray();
  const turn = new THREE.QuaternionKeyframeTrack(
    `${horse.name}.quaternion`,
    at([0, 1, 1.25, 1.75, 2, 3]),
    [0, 0, -0.35, 0.3, 0, 0].flatMap(pitch),
  );
  const lift = new THREE.VectorKeyframeTrack(`${horse.name}.position`, at([0, 1, 1.5, 2, 3]), [0, 0, 0.5, 0, 0].flatMap(rise));
  return new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks, turn, lift]);
}

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

const gallop = repeatStrides(horseFile.animations[0]!);
const idle = withMovingFace(robotFile.animations.find((clip) => clip.name === "Idle")!);

// ---------------------------------------------------------------- subjects
type Subject = "horse" | "robot";
const SUBJECTS: Record<
  Subject,
  {
    root: THREE.Object3D;
    clip: (leap: boolean) => THREE.AnimationClip;
    count: number;
    /** The studio's look, over what the bake kept of the source's. */
    dress: (material: THREE.MeshStandardMaterial) => void;
    /** Where each instance stands. */
    place: (mesh: THREE.InstancedMesh, vat: VAT) => void;
  }
> = {
  horse: {
    root: horseFile.scene,
    clip: (leap) => (leap ? withLeap(gallop) : gallop),
    count: 12,
    // Its vertex colours give way to the studio's.
    dress: (material) => material.setValues({ vertexColors: false, color: palette.character }),
    // A herd in three staggered rows, side on to the camera.
    place: (mesh) => {
      const scale = 2.4 / horseHeight;
      const matrix = new THREE.Matrix4();
      const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
      for (let i = 0; i < mesh.count; i++) {
        const row = i % 3;
        const position = new THREE.Vector3((Math.floor(i / 3) - 1.5) * 5 + (row - 1) * 1.6, 0, (row - 1) * 3.2);
        mesh.setMatrixAt(i, matrix.compose(position, turn, new THREE.Vector3(scale, scale, scale)));
      }
    },
  },
  robot: {
    root: robotFile.scene,
    // The leap is the horse's: the robot's clip is its Idle, face and all.
    clip: () => idle,
    count: 7,
    // Its flat colours stay.
    dress: () => {},
    // A line of robots facing the camera, near enough to read a face.
    place: (mesh, vat) => {
      const scale = 1.8 / vat.bounds.getSize(new THREE.Vector3()).y;
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < mesh.count; i++) {
        mesh.setMatrixAt(i, matrix.makeScale(scale, scale, scale).setPosition((i - (mesh.count - 1) / 2) * 2.2, 0, 2));
      }
    },
  },
};

// ---------------------------------------------------------------- bake
const maxTextureSize = getMaxTextureSize(renderer);
// One clock for every bake, and every instance close to its start, so the
// herd leaps together and the track lines below speak for all of it.
const time: VATTimeUniform = uniform(0);

interface Baked {
  vat: VAT;
  clip: THREE.AnimationClip;
  mesh: THREE.InstancedMesh;
}
const bakes = new Map<string, Baked>();

function bake(subject: Subject, leap: boolean): Baked {
  const { root, clip: clipFor, count, dress, place } = SUBJECTS[subject];
  const clip = clipFor(leap);
  // Nothing about the source to declare: the default tries the rig, finds
  // what it cannot store, and bakes vertices.
  const vat = bakeVAT(root, [clip], { maxTextureSize });

  for (const material of vat.materials as THREE.MeshStandardMaterial[]) {
    dress(material);
    material.setValues({ roughness: 0.9, metalness: 0 });
  }
  const instances: VATInstance[] = Array.from({ length: count }, () => ({
    clip: vat.clips[0]!,
    startTime: -Math.random() * 0.12,
  }));
  const { mesh } = createVATMesh(vat, instances, { time, maxTextureSize });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  place(mesh, vat);
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return { vat, clip, mesh };
}

// ---------------------------------------------------------------- readouts
const setEncoding = readout("encoding");
const setMorphs = readout("morph-targets");
const setNodeTracks = readout("node-tracks");
const setPlaying = readout("tracks");
const setFallback = readout("fallback");

/**
 * The VAT's reason, as it gives it, with its first refusal kept and the rest
 * counted: the Horse's names every one of its fifteen targets.
 */
function condensed(reason: string): string {
  const [refusals, ...rest] = reason.split(". ");
  const each = refusals!.split("; ");
  if (each.length < 2) return reason;
  return [`${each[0]}; and ${each.length - 1} more like it`, ...rest].join(". ");
}

let shown: Baked | null = null;
let subject: Subject = "horse";
let leap = true;
let leapToggle: HTMLElement | null = null;

async function show() {
  const key = () => `${subject}/${subject === "horse" && leap}`;
  // The leap is the horse's, so its switch is gone the moment the robot is
  // picked, before its bake, and back the moment the horse is.
  if (leapToggle) leapToggle.hidden = subject !== "horse";
  // A bake not made yet is made under the forge, and looked up again after
  // it: the visitor may have picked another while the forge painted.
  if (!bakes.has(key())) {
    await forging(() => {
      if (!bakes.has(key())) bakes.set(key(), bake(subject, leap));
    });
  }
  const picked = bakes.get(key());
  if (!picked) return; // a later pick is baking, and shows itself
  shown = picked;
  for (const baked of bakes.values()) baked.mesh.visible = baked === shown;

  // Read off the bake, and off the clip it baked.
  const { vat, clip } = shown;
  let targets = 0;
  SUBJECTS[subject].root.traverse((node) => {
    targets += (node as THREE.Mesh).morphTargetInfluences?.length ?? 0;
  });
  setEncoding(vat.encoding === "rig" ? "rig" : "vertex");
  setMorphs(targets);
  setNodeTracks(clip.tracks.filter((track) => !track.name.endsWith(".morphTargetInfluences")).length);
  setFallback(vat.encoding === "delta" && vat.fallback ? condensed(vat.fallback) : "—");
}
await show();

// ---------------------------------------------------------------- panel
const panel = createPanel();
panel.select(
  "subject",
  [
    ["horse", "Horse, by morph targets"],
    ["robot", "Robot, with a moving face"],
  ],
  subject,
  (value) => {
    subject = value;
    void show();
  },
);
leapToggle = panel.toggle("horse's leap (node tracks)", leap, (value) => {
  leap = value;
  void show();
});
panel.source({ code: source, path: "examples/src/webgpu_morph.ts" });

// ---------------------------------------------------------------- loop
const timer = new THREE.Timer();
renderer.setAnimationLoop(() => {
  timer.update();
  time.value = timer.getElapsed();
  // Every kind of track the shown clip holds, lit while it moves: the clock
  // read as the clip's own time, which every instance is close to.
  if (shown) {
    const local = time.value % shown.clip.duration;
    setPlaying(
      trackKinds(shown.clip.tracks, local)
        .map(({ kind, tracks, active }) => `${active ? "●" : "○"} ${kind} · ${tracks} ${tracks === 1 ? "track" : "tracks"}`)
        .join("\n"),
    );
  }
  controls.update();
  renderer.render(scene, camera);
});
