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
// the batch, the three deliberate faults — comes from stage.ts, shared with the
// other path. The frames it returns mean exactly what webgl-frame.ts's mean,
// the addressing probe included: `vertexIndex` here is what `gl_VertexID` is
// there, and whether those two are in fact the same number is precisely what
// the probe is asking. The batched pair is the same again for the second
// carrier, where this path reads `batchIndirectIndex` and the other resolves
// `getIndirectIndex( gl_DrawID )`; and the rig pair for the second encoding,
// where this path skins from the rig texture in nodes and the other in GLSL.
import * as THREE from "three/webgpu";
import { float, instanceIndex, int, ivec2, textureLoad, uniform, vec3, vec4, vertexIndex } from "three/tsl";
import type { Node } from "three/webgpu";
import { createVATMesh, vatNodes } from "three-vat/tsl";
import type { VATTimeUniform } from "three-vat/tsl";
import { createVATPlaybackTexture } from "three-vat";
import type { DeltaVAT, RigVAT, VAT, VATCrowd, VATInstance } from "three-vat";
import type { PathFrames } from "./compare.js";
import { FAULT_FRAMES, FPS, FRAME, PROBE, RIG_CASE, SAMPLE_PROBE, TIME } from "./scene.js";
import {
  batchedInstancesOf,
  buildBatch,
  buildCamera,
  buildRestMesh,
  buildScene,
  instancesOf,
  placeInstances,
  reverseDrawOrder,
  withWrongNormals,
  withWrongWeight,
} from "./stage.js";

// TSL's fluent nodes carry no node type for the compiler to infer, so — as in
// src/tsl.ts, which types its own decode this way — each term is named before it
// is composed. The pack arrives as vec4s, hence both spellings.
const asFloat = (node: unknown) => node as Node<"float">;
const asVec4 = (node: unknown) => node as Node<"vec4">;

/**
 * One texel of this instance's row of the playback texture — `packTexel` in
 * src/tsl.ts. `field` is 0 for the clip texel, 1 for the playback texel, 2 for
 * the fade one: spelled as numbers rather than imported from the library's
 * `PACK_TEXELS`, because this file transcribes the decode instead of sharing
 * it, and a shared constant would be one more thing the gate cannot disagree
 * about.
 */
const packTexel = (crowd: VATCrowd, field: number) =>
  asVec4(textureLoad(crowd.playback.texture, ivec2(int(field), int(instanceIndex))));

/** Render the gate's frames on this path, and dispose everything after. */
export async function renderTSLFrames(vat: DeltaVAT, spannedVat: DeltaVAT, rig: RigVAT): Promise<PathFrames> {
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
  removeCrowd(scene, crowd);

  // --- the same robot baked at a phone's ceiling, its frames spanning two
  //     rows (SPAN_CASE, ADR-0030): the same texels elsewhere, so the same
  //     crowd at the same clock — or a stride this path reads wrong.
  const spannedCrowd = addCrowd(scene, spannedVat);
  spannedCrowd.time.value = TIME;
  const spanned = await read(renderer, target, scene, camera);
  removeCrowd(scene, spannedCrowd);

  // --- and again off a VAT whose normals are deliberately wrong.
  const bent = addCrowd(scene, withWrongNormals(vat));
  bent.time.value = TIME;
  const wrongNormals = await read(renderer, target, scene, camera);
  removeCrowd(scene, bent);

  // --- and again with the transitioning instance's fade twice as long: the
  //     same two bands on the same rows, mixed at the wrong weight.
  const mistimed = addCrowd(scene, vat, 0, withWrongWeight(instancesOf(vat)));
  mistimed.time.value = TIME;
  const wrongWeight = await read(renderer, target, scene, camera);
  removeCrowd(scene, mistimed);

  // --- the two probes: same geometry, same matrices, no VAT sampled.
  const probeCrowd = addCrowd(scene, vat);
  const probeMaterial = buildProbeMaterial(probeCrowd);
  probeCrowd.mesh.material = probeMaterial;
  const probe = await read(renderer, target, scene, camera);
  probeMaterial.dispose();

  const sampleMaterial = buildSampleProbeMaterial(probeCrowd);
  probeCrowd.mesh.material = sampleMaterial;
  const sampleProbe = await read(renderer, target, scene, camera);
  sampleMaterial.dispose();
  removeCrowd(scene, probeCrowd);

  // --- the second carrier, twice: as three draws it, and with the drawn slot
  //     permuted. The pack is keyed by the logical index, so both must match.
  const batch = addBatchedCrowd(scene, vat);
  const batched = await read(renderer, target, scene, camera);
  reverseDrawOrder(batch.mesh);
  const batchedReordered = await read(renderer, target, scene, camera);
  removeBatchedCrowd(scene, batch);

  // --- the second encoding: another asset's rig bake, in the same room at the
  //     same clock, through this path's own `createVATMesh` — which narrows on
  //     the encoding and skins from the rig texture. Its self-test is the slip
  //     alone; a rig has no normal texture to bend.
  const rigCrowd = addCrowd(scene, rig, RIG_CASE.yaw);
  rigCrowd.time.value = TIME;
  const rigClean = await read(renderer, target, scene, camera);
  rigCrowd.time.value = TIME + FAULT_FRAMES / FPS;
  const rigSlipped = await read(renderer, target, scene, camera);
  removeCrowd(scene, rigCrowd);

  target.dispose();
  await renderer.dispose();

  return { calibration, clean, spanned, slipped, wrongNormals, wrongWeight, probe, sampleProbe, batched, batchedReordered, rig: { clean: rigClean, slipped: rigSlipped } };
}

/**
 * The crowd on a `BatchedMesh`, through this path's decode.
 *
 * The primitives rather than `createVATMesh`, because `createVATMesh` builds an
 * `InstancedMesh` and the second carrier is reached by hand — the arrangement
 * the docs describe, rendered here so the gate covers the code a reader would
 * write. Handing `vatNodes` the batch as its `carrier` is what makes the decode read the pack at
 * `batchIndirectIndex` and re-apply `batch( mesh )` rather than the instance
 * matrix.
 */
function addBatchedCrowd(scene: THREE.Scene, vat: VAT) {
  const time = uniform(TIME) as VATTimeUniform;
  // Four rows, not three: the batch carries an off-frustum instance whose slot
  // the visible ones are read past (`batchedInstancesOf`).
  const playback = createVATPlaybackTexture(batchedInstancesOf(vat));
  // A batch takes its material at construction, so the clone comes first and
  // the decode is assigned onto it once the carrier exists.
  const material = vat.materials[0]!.clone() as THREE.Material & { positionNode: Node<"vec3"> };
  const mesh = buildBatch(vat, material);
  material.positionNode = vatNodes(vat, { time, playback, carrier: mesh }).positionNode;
  scene.add(mesh);
  return { mesh, material, playback };
}

function removeBatchedCrowd(scene: THREE.Scene, batch: ReturnType<typeof addBatchedCrowd>): void {
  scene.remove(batch.mesh);
  batch.playback.texture.dispose();
  batch.material.dispose();
  // The batch's own copy of the geometry, which it made and the bake did not.
  batch.mesh.dispose();
}

function addCrowd(scene: THREE.Scene, vat: VAT, yaw = 0, instances: VATInstance[] = instancesOf(vat)) {
  const crowd = createVATMesh(vat, instances);
  crowd.mesh.frustumCulled = false; // instances are placed by matrices, not by the geometry
  placeInstances(crowd.mesh, vat, yaw);
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
function buildProbeMaterial(crowd: VATCrowd): THREE.MeshBasicNodeMaterial {
  const id = asFloat(float(vertexIndex));
  const clipStart = asFloat(packTexel(crowd, 0).x);
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
function buildSampleProbeMaterial(crowd: VATCrowd): THREE.MeshBasicNodeMaterial {
  // The pack arrives as vec4 texels of this instance's row, so every term of
  // the decode is a swizzle (src/instance-playback.ts). Component for
  // component with its GLSL twin.
  const clip = packTexel(crowd, 0);
  const playback = packTexel(crowd, 1);

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

function removeCrowd(scene: THREE.Scene, crowd: VATCrowd): void {
  const { mesh } = crowd;
  scene.remove(mesh);
  // Not the geometry: a crowd renders the bake's own now (ADR-0016), and the
  // gate builds several crowds off one bake.
  crowd.playback.texture.dispose();
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
  // `render`, not the deprecated `renderAsync`: the device was awaited at
  // `init`, and the readback below is queued behind the draw on the same queue.
  renderer.render(scene, camera);
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, FRAME.width, FRAME.height);
  renderer.setRenderTarget(null);
  return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
}
