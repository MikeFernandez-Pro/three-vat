// The studio's floor on WebGPU: a disc that fades out into the backdrop, as
// 73-tsl-shield's does — its opacity, a node, falls from 1 at `inner` to 0 at
// `outer` from the origin. The WebGL pages' twin is ../floor.ts.
import * as THREE from "three/webgpu";
import { positionLocal, smoothstep, uniform } from "three/tsl";
import { floorFadeFor, type FloorFade } from "../floor-fade.js";
import { palette } from "../palette.js";

export interface Floor {
  mesh: THREE.Mesh;
  fade: FloorFade;
}

/** The floor for a page whose camera starts `reach` from its target. */
export function createFloor(reach: number): Floor {
  const { inner, outer } = floorFadeFor(reach);
  const fade = { inner: uniform(inner), outer: uniform(outer) };
  const material = new THREE.MeshStandardNodeMaterial({ color: palette.floor, roughness: 1, transparent: true });
  material.opacityNode = smoothstep(fade.inner, fade.outer, positionLocal.xy.length()).oneMinus();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  // Drawn first of anything see-through, so it never covers what stands on it.
  mesh.renderOrder = -1;
  return { mesh, fade };
}
