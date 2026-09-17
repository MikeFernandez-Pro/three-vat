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
// The four frames it returns mean exactly what webgl-frame.ts's mean.
import * as THREE from "three/webgpu";
import { createVATMesh } from "three-vat/tsl";
import type { VAT } from "three-vat";
import type { PathFrames } from "./compare.js";
import { FAULT_FRAMES, FPS, FRAME, TIME } from "./scene.js";
import { buildCamera, buildRestMesh, buildScene, instancesOf, placeInstances, withWrongNormals } from "./stage.js";

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

  target.dispose();
  await renderer.dispose();

  return { calibration, clean, slipped, wrongNormals };
}

function addCrowd(scene: THREE.Scene, vat: VAT) {
  const crowd = createVATMesh(vat, instancesOf(vat));
  crowd.mesh.frustumCulled = false; // instances are placed by matrices, not by the geometry
  placeInstances(crowd.mesh, vat);
  scene.add(crowd.mesh);
  return crowd;
}

function removeCrowd(scene: THREE.Scene, mesh: THREE.InstancedMesh): void {
  scene.remove(mesh);
  mesh.geometry.dispose();
  for (const material of mesh.material as THREE.Material[]) material.dispose();
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
