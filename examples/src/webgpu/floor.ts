// The studio's floor on WebGPU: a disc that fades out into the backdrop, as
// 73-tsl-shield's does — its opacity, a node, falls from 1 at `inner` to 0 at
// `outer` from the origin. The WebGL pages' twin is ../floor.ts.
import * as THREE from "three/webgpu";
import { positionLocal, smoothstep } from "three/tsl";
import { floorFadeFor } from "../floor-fade.js";
import { onLook, palette } from "../palette.js";
import { repaintCharacters } from "../look-repaint.js";

/** The floor for a page whose camera starts `reach` from its target. */
export function createFloor(reach: number): THREE.Mesh {
  const { inner, outer } = floorFadeFor(reach);
  const material = new THREE.MeshStandardNodeMaterial({ color: palette.floor, roughness: 1, transparent: true });
  material.opacityNode = smoothstep(inner, outer, positionLocal.xy.length()).oneMinus();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  // Drawn first of anything see-through, so it never covers what stands on it.
  mesh.renderOrder = -1;
  // A change of look repaints the floor, the ground of the scene's hemisphere
  // light, which every page sets to the floor it stands on, and the characters
  // standing on it.
  onLook((from) => {
    material.color.setHex(palette.floor);
    const scene = mesh.parent;
    if (!scene) return;
    scene.traverse((object) => {
      if (object instanceof THREE.HemisphereLight) object.groundColor.setHex(palette.floor);
    });
    repaintCharacters(scene, from, (hex) => new THREE.Color(hex));
  });
  return mesh;
}
