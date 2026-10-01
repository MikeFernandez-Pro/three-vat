// The studio's floor on WebGL: a disc that fades out into the backdrop rather
// than running on to a fogged horizon, as 73-tsl-shield's does. Its alpha
// falls from 1 at `inner` to 0 at `outer` from the origin — threaded into
// MeshStandardMaterial's own shader, since WebGLRenderer has no opacityNode.
// The WebGPU pages' twin is webgpu/floor.ts; the fade is the same numbers.
import * as THREE from "three";
import { floorFadeFor, type FloorFade } from "./floor-fade.js";
import { palette } from "./palette.js";

export interface Floor {
  mesh: THREE.Mesh;
  fade: FloorFade;
}

/** The floor for a page whose camera starts `reach` from its target. */
export function createFloor(reach: number): Floor {
  const { inner, outer } = floorFadeFor(reach);
  const fade = { inner: { value: inner }, outer: { value: outer } };
  const material = new THREE.MeshStandardMaterial({ color: palette.floor, roughness: 1, transparent: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.floorFadeInner = fade.inner;
    shader.uniforms.floorFadeOuter = fade.outer;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFloorPosition;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFloorPosition = position.xy;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float floorFadeInner;\nuniform float floorFadeOuter;\nvarying vec2 vFloorPosition;")
      .replace(
        "#include <opaque_fragment>",
        "#include <opaque_fragment>\ngl_FragColor.a *= 1.0 - smoothstep(floorFadeInner, floorFadeOuter, length(vFloorPosition));",
      );
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  // Drawn first of anything see-through, so it never covers what stands on it.
  mesh.renderOrder = -1;
  return { mesh, fade };
}
