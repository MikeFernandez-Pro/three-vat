// The gate's frames, rendered through the GLSL decode path.
//
// What is left in this file is only what is genuinely renderer-shaped: the
// renderer, the render target, the readback, and `createVATMesh` from
// `three-vat/webgl`. That block stays a deliberate near-copy of tsl-frame.ts
// (ADR-0011's reasoning): it is the thing being compared, and a shared harness
// across it would manufacture the parity the gate is trying to measure. The
// camera, the lights and the instance matrices are not that, and live in
// stage.ts — one place, because the gate's premise is that nothing differs
// between the two renders but the decode.
//
// Eleven frames come out of here, and each answers a different question:
//
//   calibration  — the rest-pose mesh, no VAT at all. A difference here is the
//                  *backends* disagreeing about shading, which is not what this
//                  gate is looking for and would otherwise be blamed on the decode.
//   clean        — the crowd at `TIME`. This is the comparison.
//   slipped      — the crowd one baked frame late: geometry in the wrong place.
//   wrongNormals — the crowd with every baked normal's x negated: geometry
//                  pixel-exact, shading wrong.
//   wrongWeight  — the crowd with the transitioning instance's fade twice as
//                  long: both bands right, on the rows they were, mixed at the
//                  wrong weight. The crossfade's own fault.
//   probe        — the decode's inputs painted as colour (see PROBE): which
//                  texel this vertex would read, and which clip band its
//                  instance sits in. No VAT sampled at all.
//   batched      — the same crowd on a BatchedMesh, with per-instance culling
//                  and sorting at three's defaults, and the same frame again
//                  with the draw order reversed. The carrier's own comparison,
//                  and the stripe test.
//   rig          — a second asset's rig-encoded bake (ADR-0018) at `TIME`, and
//                  one baked frame late. The second encoding is a second decode
//                  on this path, so the frames above prove nothing about it.
//
// `slipped`, `wrongNormals` and `wrongWeight` are the gate's self-test, and
// `rig.slipped` the rig case's. It has to fail on all of them, or its verdict on
// `clean` means nothing.
import * as THREE from "three";
import { createVATMesh, createVATUniforms, patchVATMaterial } from "three-vat/webgl";
import { createVATPlaybackTexture } from "three-vat";
import type { DeltaVAT, RigVAT, VAT, VATCrowd, VATInstance } from "three-vat";
import { flipRows, type PathFrames } from "./compare.js";
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

/**
 * Render the gate's frames on this path, and dispose everything after.
 *
 * Synchronous, where the TSL path is not: a `WebGLRenderer` needs no device, and
 * `readRenderTargetPixels` reads back in the call. That asymmetry is the
 * renderers', and is the same one the demo pages carry.
 */
export function renderWebGLFrames(vat: DeltaVAT, rig: RigVAT): PathFrames {
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(FRAME.width, FRAME.height, false);

  const target = new THREE.WebGLRenderTarget(FRAME.width, FRAME.height);
  const scene = buildScene();
  const camera = buildCamera();

  // --- calibration: the baked rest pose, drawn as an ordinary mesh.
  const rest = buildRestMesh(vat);
  scene.add(rest);
  const calibration = read(renderer, target, scene, camera);
  scene.remove(rest);
  rest.geometry.dispose();

  // --- the crowd, through the decode, at the right time and one frame late.
  const crowd = addCrowd(scene, vat);
  crowd.time.value = TIME;
  const clean = read(renderer, target, scene, camera);
  crowd.time.value = TIME + FAULT_FRAMES / FPS;
  const slipped = read(renderer, target, scene, camera);
  removeCrowd(scene, crowd);

  // --- and again off a VAT whose normals are deliberately wrong.
  const bent = addCrowd(scene, withWrongNormals(vat));
  bent.time.value = TIME;
  const wrongNormals = read(renderer, target, scene, camera);
  removeCrowd(scene, bent);

  // --- and again with the transitioning instance's fade twice as long: the
  //     same two bands on the same rows, mixed at the wrong weight.
  const mistimed = addCrowd(scene, vat, 0, withWrongWeight(instancesOf(vat)));
  mistimed.time.value = TIME;
  const wrongWeight = read(renderer, target, scene, camera);
  removeCrowd(scene, mistimed);

  // --- the two probes: same geometry, same matrices, no VAT sampled.
  const probeCrowd = addCrowd(scene, vat);
  const probeMaterial = buildProbeMaterial(probeCrowd);
  probeCrowd.mesh.material = probeMaterial;
  const probe = read(renderer, target, scene, camera);
  probeMaterial.dispose();

  const sampleMaterial = buildSampleProbeMaterial(probeCrowd);
  probeCrowd.mesh.material = sampleMaterial;
  const sampleProbe = read(renderer, target, scene, camera);
  sampleMaterial.dispose();
  removeCrowd(scene, probeCrowd);

  // --- the second carrier, twice: as three draws it, and with the drawn slot
  //     permuted. The pack is keyed by the logical index, so both must match.
  const batch = addBatchedCrowd(scene, vat);
  const batched = read(renderer, target, scene, camera);
  reverseDrawOrder(batch.mesh);
  const batchedReordered = read(renderer, target, scene, camera);
  removeBatchedCrowd(scene, batch);

  // --- the second encoding: another asset's rig bake, in the same room at the
  //     same clock, through this path's own `createVATMesh` — which narrows on
  //     the encoding and skins from the rig texture. Its self-test is the slip
  //     alone; a rig has no normal texture to bend.
  const rigCrowd = addCrowd(scene, rig, RIG_CASE.yaw);
  rigCrowd.time.value = TIME;
  const rigClean = read(renderer, target, scene, camera);
  rigCrowd.time.value = TIME + FAULT_FRAMES / FPS;
  const rigSlipped = read(renderer, target, scene, camera);
  removeCrowd(scene, rigCrowd);

  target.dispose();
  renderer.dispose();

  return { calibration, clean, slipped, wrongNormals, wrongWeight, probe, sampleProbe, batched, batchedReordered, rig: { clean: rigClean, slipped: rigSlipped } };
}

function addCrowd(scene: THREE.Scene, vat: VAT, yaw = 0, instances: VATInstance[] = instancesOf(vat)) {
  const crowd = createVATMesh(vat, instances);
  crowd.mesh.frustumCulled = false; // instances are placed by matrices, not by the geometry
  placeInstances(crowd.mesh, vat, yaw);
  scene.add(crowd.mesh);
  return crowd;
}

/**
 * The crowd on a `BatchedMesh`, through this path's decode.
 *
 * The primitives rather than `createVATMesh`, because `createVATMesh` builds an
 * `InstancedMesh` and the second carrier is reached by hand — which is the
 * arrangement the docs describe, rendered here so the gate covers the code a
 * reader would write. The material is patched *with the batch*, so the decode
 * resolves the logical index through `getIndirectIndex( gl_DrawID )` instead of
 * the drawn slot.
 */
function addBatchedCrowd(scene: THREE.Scene, vat: VAT) {
  const uniforms = createVATUniforms(TIME);
  // Four rows, not three: the batch carries an off-frustum instance whose slot
  // the visible ones are read past (`batchedInstancesOf`).
  const playback = createVATPlaybackTexture(batchedInstancesOf(vat));
  // Cloned before the batch is built, because a `BatchedMesh` takes its
  // material at construction — and patched after, because the patch needs the
  // carrier it will draw on.
  const material = vat.materials[0]!.clone();
  const mesh = buildBatch(vat, material);
  patchVATMaterial(material, vat, uniforms, playback, mesh);
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

/**
 * Paint {@link PROBE} on this path, reading `gl_VertexID` — the very thing the
 * GLSL decode uses for the texture's x — and the clip band the decode reads out
 * of the playback texture for its y, at the same `gl_InstanceID` row.
 *
 * A `ShaderMaterial` rather than a patched standard one: the probe must show the
 * addressing and nothing else, and a lit material would fold shading into a
 * frame whose whole purpose is to carry two integers.
 */
function buildProbeMaterial(crowd: VATCrowd): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uVatPlaybackTex: { value: crowd.playback.texture } },
    vertexShader: /* glsl */ `
      uniform highp sampler2D uVatPlaybackTex;
      varying vec3 vProbe;
      void main() {
        vec4 vatClip = texelFetch( uVatPlaybackTex, ivec2( 0, gl_InstanceID ), 0 ); // x = 0: the clip texel
        float id = float( gl_VertexID );
        vProbe = vec3( mod( id, 256.0 ), floor( id / 256.0 ), vatClip.x ) / ${PROBE.channelScale}.0;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vProbe;
      void main() {
        gl_FragColor = vec4( vProbe, 1.0 );
      }
    `,
  });
}

/**
 * Paint {@link SAMPLE_PROBE} on this path: the decode's own time-to-row
 * arithmetic, transcribed from `ROW_PRELUDE` in src/webgl.ts and painted
 * rather than used to fetch a texel.
 *
 * Transcribed rather than shared, because the point is to compare the two
 * paths' *computation* of the row — reaching into the library for it would
 * compare one computation with itself.
 */
function buildSampleProbeMaterial(crowd: VATCrowd): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uVatPlaybackTex: { value: crowd.playback.texture } },
    vertexShader: /* glsl */ `
      uniform highp sampler2D uVatPlaybackTex;
      varying vec3 vProbe;
      void main() {
        vec4 vatClip = texelFetch( uVatPlaybackTex, ivec2( 0, gl_InstanceID ), 0 );     // x = 0: the clip texel
        vec4 vatPlayback = texelFetch( uVatPlaybackTex, ivec2( 1, gl_InstanceID ), 0 ); // x = 1: the playback texel
        float frames = vatClip.y;
        float duration = frames / vatClip.z;
        float t = fract( ( ( ${SAMPLE_PROBE.time} - vatPlayback.x ) * vatClip.w ) / duration ) * frames;
        float row = float( int( t ) ) + vatClip.x;
        vProbe = vec3( mod( row, 256.0 ) / ${PROBE.channelScale}.0, floor( row / 256.0 ) / ${PROBE.channelScale}.0, fract( t ) );
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vProbe;
      void main() {
        gl_FragColor = vec4( vProbe, 1.0 );
      }
    `,
  });
}

function removeCrowd(scene: THREE.Scene, crowd: VATCrowd): void {
  const { mesh } = crowd;
  scene.remove(mesh);
  // Not the geometry: a crowd renders the bake's own now (ADR-0016), and the
  // gate builds several crowds off one bake.
  crowd.playback.texture.dispose();
  const materials = mesh.material;
  for (const material of Array.isArray(materials) ? materials : [materials]) material.dispose();
  // Both shadow materials, which this path attaches and the TSL path does not.
  (mesh.customDepthMaterial as THREE.Material | undefined)?.dispose();
  (mesh.customDistanceMaterial as THREE.Material | undefined)?.dispose();
}

/**
 * Render into the target and read it back, top-down.
 *
 * Flipped here rather than at the comparison: GL's framebuffer origin is at the
 * bottom left, WebGPU's texture origin is at the top left, and the one place
 * that difference belongs is next to the call that causes it. The verdict checks
 * that this guess is still right rather than trusting it (`orientationOf`).
 */
function read(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
  scene: THREE.Scene,
  camera: THREE.Camera,
): Uint8Array {
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(FRAME.width * FRAME.height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, FRAME.width, FRAME.height, pixels);
  renderer.setRenderTarget(null);
  return flipRows(pixels, FRAME);
}
