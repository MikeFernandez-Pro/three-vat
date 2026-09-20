// The gate's frames, rendered through the TSL decode path.
//
// Hold this file next to webgl-frame.ts. What remains in both is the
// renderer-shaped block, a deliberate near-copy (ADR-0011's reasoning) because
// it is the thing being compared and a shared harness across it would
// manufacture the parity the gate measures. What differs is the renderers' own:
//
//   * `three/webgpu` for the renderer, `three-vat/tsl` for the decode;
//   * the whole function is async, because a `WebGPURenderer` has no device
//     until `await renderer.init()`;
//   * a plain `RenderTarget`, and `readRenderTargetPixelsAsync`, which hands
//     rows back top-down already — no flip;
//   * no depth or distance material to dispose: `positionNode` feeds the depth
//     pass on this path.
//
// Everything that is *not* renderer-shaped — camera, lights, instance matrices,
// the two deliberate faults — comes from stage.ts, shared with the other path.
// The five frames it returns mean exactly what webgl-frame.ts's mean, the
// addressing probe included: `vertexIndex` here is what `gl_VertexID` is there,
// and whether those two are in fact the same number is precisely what the probe
// is asking.
import * as THREE from "three/webgpu";
import { attribute, float, int, vec3, vec4, vertexIndex } from "three/tsl";
import type { Node } from "three/webgpu";
import { createVATMesh } from "three-vat/tsl";
import type { VAT } from "three-vat";
import type { PathFrames } from "./compare.js";
import { FAULT_FRAMES, FPS, FRAME, PROBE, SAMPLE_PROBE, TIME } from "./scene.js";
import { buildCamera, buildRestMesh, buildScene, instancesOf, placeInstances, withWrongNormals } from "./stage.js";

// TSL's fluent nodes carry no node type for the compiler to infer, so — as in
// src/tsl.ts, which types its own decode this way — each term is named before it
// is composed. The pack arrives as vec4s, hence both spellings.
const asFloat = (node: unknown) => node as Node<"float">;
const asVec4 = (node: unknown) => node as Node<"vec4">;

/** Render the gate's four frames on this path, and dispose everything after. */
export async function renderTSLFrames(vat: VAT): Promise<PathFrames> {
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(FRAME.width, FRAME.height, false);
  // The device, before anything asks it to draw.
  await renderer.init();

  const target = new THREE.RenderTarget(FRAME.width, FRAME.height);
  const scene = buildScene();
  const camera = buildCamera();

  // --- calibration: the baked rest pose, drawn as an ordinary mesh.
  const rest = buildRestMesh(vat);
  scene.add(rest);
  const calibration = await read(renderer, target, scene, camera);
  scene.remove(rest);
  rest.geometry.dispose();

  // --- the crowd, through the decode, at the right time and one frame late.
  const crowd = addCrowd(scene, vat);
  crowd.time.value = TIME;
  const clean = await read(renderer, target, scene, camera);
  crowd.time.value = TIME + FAULT_FRAMES / FPS;
  const slipped = await read(renderer, target, scene, camera);
  removeCrowd(scene, crowd.mesh);

  // --- and again off a VAT whose normals are deliberately wrong.
  const bent = addCrowd(scene, withWrongNormals(vat));
  bent.time.value = TIME;
  const wrongNormals = await read(renderer, target, scene, camera);
  removeCrowd(scene, bent.mesh);

  // --- the two probes: same geometry, same matrices, no VAT sampled.
  const probeCrowd = addCrowd(scene, vat);
  const probeMaterial = buildProbeMaterial();
  probeCrowd.mesh.material = probeMaterial;
  const probe = await read(renderer, target, scene, camera);
  probeMaterial.dispose();

  const sampleMaterial = buildSampleProbeMaterial();
  probeCrowd.mesh.material = sampleMaterial;
  const sampleProbe = await read(renderer, target, scene, camera);
  sampleMaterial.dispose();
  removeCrowd(scene, probeCrowd.mesh);

  target.dispose();
  await renderer.dispose();

  return { calibration, clean, slipped, wrongNormals, probe, sampleProbe };
}

function addCrowd(scene: THREE.Scene, vat: VAT) {
  const crowd = createVATMesh(vat, instancesOf(vat));
  crowd.mesh.frustumCulled = false; // instances are placed by matrices, not by the geometry
  placeInstances(crowd.mesh, vat);
  scene.add(crowd.mesh);
  return crowd;
}

/**
 * Paint {@link PROBE} on this path — the same formula webgl-frame.ts spells in
 * GLSL, spelled in nodes, reading the `vertexIndex` and the instance attribute
 * the TSL decode itself reads.
 *
 * `MeshBasicNodeMaterial` with an explicit `fragmentNode`: no lighting, no
 * shading, nothing between the two integers and the pixel.
 */
function buildProbeMaterial(): THREE.MeshBasicNodeMaterial {
  const id = asFloat(float(vertexIndex));
  const clipStart = asFloat(asVec4(attribute("aVatClip", "vec4")).x);
  const probe = vec3(asFloat(id.mod(256)), asFloat(id.div(256).floor()), clipStart).div(PROBE.channelScale);
  const material = new THREE.MeshBasicNodeMaterial();
  material.fragmentNode = vec4(probe, 1);
  return material;
}

/**
 * Paint {@link SAMPLE_PROBE} on this path: the decode's own time-to-row
 * arithmetic, transcribed from `vatNodes` in src/tsl.ts and painted rather than
 * used to fetch a texel — term for term the same sequence webgl-frame.ts spells
 * in GLSL.
 *
 * Transcribed rather than shared, for the same reason as its twin: the point is
 * to compare the two paths' computation of the row, and reaching into the
 * library for it would compare one computation with itself.
 */
function buildSampleProbeMaterial(): THREE.MeshBasicNodeMaterial {
  // The pack arrives as vec4s, so every term of the decode is a swizzle
  // (src/instance-playback.ts). Component for component with its GLSL twin.
  const clip = asVec4(attribute("aVatClip", "vec4"));
  const playback = asVec4(attribute("aVatPlayback", "vec4"));

  const frames = asFloat(clip.y);
  const duration = asFloat(frames.div(asFloat(clip.z)));
  const t = asFloat(
    asFloat(asFloat(float(SAMPLE_PROBE.time).sub(asFloat(playback.x))).mul(asFloat(clip.w)))
      .div(duration)
      .fract()
      .mul(frames),
  );
  const row = asFloat(asFloat(float(int(t))).add(asFloat(clip.x)));

  const material = new THREE.MeshBasicNodeMaterial();
  material.fragmentNode = vec4(
    vec3(asFloat(row.mod(256)).div(PROBE.channelScale), asFloat(row.div(256).floor()).div(PROBE.channelScale), asFloat(t.fract())),
    1,
  );
  return material;
}

function removeCrowd(scene: THREE.Scene, mesh: THREE.InstancedMesh): void {
  scene.remove(mesh);
  mesh.geometry.dispose();
  const materials = mesh.material;
  for (const material of Array.isArray(materials) ? materials : [materials]) material.dispose();
}

/** Render into the target and read it back. Already top-down; see webgl-frame.ts. */
async function read(
  renderer: THREE.WebGPURenderer,
  target: THREE.RenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Promise<Uint8Array> {
  renderer.setRenderTarget(target);
  await renderer.renderAsync(scene, camera);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, FRAME.width, FRAME.height);
  renderer.setRenderTarget(null);
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}
