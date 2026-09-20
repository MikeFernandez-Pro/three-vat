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
// Four frames come out of here, and each answers a different question:
//
//   calibration  — the rest-pose mesh, no VAT at all. A difference here is the
//                  *backends* disagreeing about shading, which is not what this
//                  gate is looking for and would otherwise be blamed on the decode.
//   clean        — the crowd at `TIME`. This is the comparison.
//   slipped      — the crowd one baked frame late: geometry in the wrong place.
//   wrongNormals — the crowd with every baked normal's x negated: geometry
//                  pixel-exact, shading wrong.
//   probe        — the decode's inputs painted as colour (see PROBE): which
//                  texel this vertex would read, and which clip band its
//                  instance sits in. No VAT sampled at all.
//
// The last two are the gate's self-test. It has to fail on both of them, or its
// verdict on the second frame means nothing.
import * as THREE from "three";
import { createVATMesh } from "three-vat/webgl";
import type { VAT } from "three-vat";
import { flipRows, type PathFrames } from "./compare.js";
import { FAULT_FRAMES, FPS, FRAME, PROBE, SAMPLE_PROBE, TIME } from "./scene.js";
import { buildCamera, buildRestMesh, buildScene, instancesOf, placeInstances, withWrongNormals } from "./stage.js";

/**
 * Render the gate's four frames on this path, and dispose everything after.
 *
 * Synchronous, where the TSL path is not: a `WebGLRenderer` needs no device, and
 * `readRenderTargetPixels` reads back in the call. That asymmetry is the
 * renderers', and is the same one the demo pages carry.
 */
export function renderWebGLFrames(vat: VAT): PathFrames {
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
  removeCrowd(scene, crowd.mesh);

  // --- and again off a VAT whose normals are deliberately wrong.
  const bent = addCrowd(scene, withWrongNormals(vat));
  bent.time.value = TIME;
  const wrongNormals = read(renderer, target, scene, camera);
  removeCrowd(scene, bent.mesh);

  // --- the two probes: same geometry, same matrices, no VAT sampled.
  const probeCrowd = addCrowd(scene, vat);
  const probeMaterial = buildProbeMaterial();
  probeCrowd.mesh.material = probeMaterial;
  const probe = read(renderer, target, scene, camera);
  probeMaterial.dispose();

  const sampleMaterial = buildSampleProbeMaterial();
  probeCrowd.mesh.material = sampleMaterial;
  const sampleProbe = read(renderer, target, scene, camera);
  sampleMaterial.dispose();
  removeCrowd(scene, probeCrowd.mesh);

  target.dispose();
  renderer.dispose();

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
 * Paint {@link PROBE} on this path, reading `gl_VertexID` — the very thing the
 * GLSL decode uses for the texture's x — and the instance-playback attribute the
 * decode uses for its y.
 *
 * A `ShaderMaterial` rather than a patched standard one: the probe must show the
 * addressing and nothing else, and a lit material would fold shading into a
 * frame whose whole purpose is to carry two integers.
 */
function buildProbeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aVatClip;
      varying vec3 vProbe;
      void main() {
        float id = float( gl_VertexID );
        vProbe = vec3( mod( id, 256.0 ), floor( id / 256.0 ), aVatClip.x ) / ${PROBE.channelScale}.0;
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
 * arithmetic, transcribed from `DECODE_PRELUDE` in src/webgl.ts and painted
 * rather than used to fetch a texel.
 *
 * Transcribed rather than shared, because the point is to compare the two
 * paths' *computation* of the row — reaching into the library for it would
 * compare one computation with itself.
 */
function buildSampleProbeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec4 aVatClip;
      attribute vec4 aVatPlayback;
      varying vec3 vProbe;
      void main() {
        float frames = aVatClip.y;
        float duration = frames / aVatClip.z;
        float t = fract( ( ( ${SAMPLE_PROBE.time} - aVatPlayback.x ) * aVatClip.w ) / duration ) * frames;
        float row = float( int( t ) ) + aVatClip.x;
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

function removeCrowd(scene: THREE.Scene, mesh: THREE.InstancedMesh): void {
  scene.remove(mesh);
  mesh.geometry.dispose();
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
