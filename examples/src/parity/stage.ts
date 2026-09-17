// The room the gate renders the crowd in, and the two VATs it renders.
//
// Shared by both paths, which is the opposite of the call ADR-0011 makes for the
// demo pages — and for the same underlying reason. A demo page duplicates its
// renderer setup so a reader can see what each renderer genuinely costs; drift
// between two demos is a cosmetic problem. This gate's entire premise is that
// *nothing differs between the two renders but the decode*, so a camera that
// drifted in one file and not the other would not be cosmetic: it would be the
// gate silently comparing two framings and reporting a decode divergence. The
// only safe place for the camera, the lights and the instance matrices is one
// place.
//
// Everything here is renderer-agnostic — `Scene`, `PerspectiveCamera`, the
// lights, `Matrix4`, `DataTexture` — and imports bare `three`, which is sound
// rather than lucky: `three` and `three/webgpu` re-export one `three.core.js`,
// so both frame modules get the same classes from it (the same reasoning
// examples/src/webgpu/stage.ts records for the addons). What stays duplicated in
// webgl-frame.ts and tsl-frame.ts is what is genuinely renderer-shaped: the
// renderer, the render target, the readback, and the decode path's own
// `createVATMesh` — the block where a shared harness would manufacture the
// parity the gate is trying to measure.
import * as THREE from "three";
import type { VAT, VATInstance } from "three-vat";
import { BACKGROUND, CAMERA, FRAME, INSTANCES, LIGHTS, TARGET_HEIGHT } from "./scene.js";

/** An empty room, lit. The crowd is added by whichever path is rendering. */
export function buildScene(): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(new THREE.AmbientLight(LIGHTS.ambient.color, LIGHTS.ambient.intensity));
  const sun = new THREE.DirectionalLight(LIGHTS.sun.color, LIGHTS.sun.intensity);
  sun.position.set(...LIGHTS.sun.position);
  scene.add(sun);
  return scene;
}

export function buildCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, FRAME.width / FRAME.height, CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.position);
  camera.lookAt(new THREE.Vector3(...CAMERA.target));
  return camera;
}

/**
 * The bake's rest pose as an ordinary mesh — the calibration subject.
 *
 * No VAT, no decode, no instancing: the same geometry and the same materials
 * under the same lights on both backends. Whatever the two paths make of *this*
 * is the backends disagreeing about shading, and the gate needs to know that
 * number before it reads anything into the decode comparison.
 *
 * The bake's own morph targets come off: a VAT supersedes them (the same thing
 * `addVATInstanceAttributes` does to a crowd geometry), and leaving them on
 * would have three animating a mesh the gate means to hold still.
 */
export function buildRestMesh(vat: VAT): THREE.Mesh {
  const geometry = vat.geometry.clone();
  geometry.morphAttributes = {};
  const mesh = new THREE.Mesh(geometry, vat.materials);
  mesh.scale.setScalar(scaleOf(vat));
  return mesh;
}

/** Uniform scale that brings the bake to {@link TARGET_HEIGHT}. */
export function scaleOf(vat: VAT): number {
  return TARGET_HEIGHT / vat.bounds.getSize(new THREE.Vector3()).y;
}

/** {@link INSTANCES}, resolved against this bake's clip table. */
export function instancesOf(vat: VAT): VATInstance[] {
  return INSTANCES.map((instance) => ({
    clip: vat.clips[instance.clipIndex % vat.clips.length]!,
    timeOffset: instance.timeOffset,
    speed: instance.speed,
  }));
}

/** Stand the crowd across the frame, facing the camera. */
export function placeInstances(mesh: THREE.InstancedMesh, vat: VAT): void {
  const matrix = new THREE.Matrix4();
  const scale = scaleOf(vat);
  INSTANCES.forEach((instance, i) => {
    mesh.setMatrixAt(i, matrix.makeScale(scale, scale, scale).setPosition(instance.x, 0, 0));
  });
  mesh.instanceMatrix.needsUpdate = true;
}

/**
 * The same VAT with one deliberate bug in it: every baked normal's x component
 * negated.
 *
 * The second of the gate's two self-tests, and the one that keeps the first
 * honest. A clock slip (see `FAULT_FRAMES`) moves geometry, so it proves the
 * gate notices a silhouette in the wrong place — which is the easy half. A
 * wrong normal moves *no* geometry: the silhouette is pixel-exact and only the
 * shading inside it is wrong, which is exactly the shape of the bug a VAT is
 * most likely to have on one path only (a normal texture is half of what a VAT
 * ships, and lighting is the whole reason it ships one — ADR-0002). If the
 * tolerance cannot see this, it cannot see the failure the gate is for.
 *
 * Injected into the data rather than into a shader, so it is the same bug on
 * both paths and neither decode is edited to receive it: both read the normal
 * texture the VAT hands them, and this hands them a wrong one.
 */
export function withWrongNormals(vat: VAT): VAT {
  const source = vat.normalTexture;
  const data = (source.image.data as Float32Array).slice();
  for (let i = 0; i < data.length; i += 4) data[i] = -data[i]!;

  const normalTexture = new THREE.DataTexture(
    data,
    source.image.width,
    source.image.height,
    THREE.RGBAFormat,
    source.type,
  );
  normalTexture.minFilter = THREE.NearestFilter;
  normalTexture.magFilter = THREE.NearestFilter;
  normalTexture.generateMipmaps = false;
  normalTexture.needsUpdate = true;

  return { ...vat, normalTexture };
}
