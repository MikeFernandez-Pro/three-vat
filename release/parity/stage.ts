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
import { BACKGROUND, CAMERA, CULLED_INSTANCE, FRAME, INSTANCES, LIGHTS, TARGET_HEIGHT } from "./scene.js";

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
 * Its own copy of the geometry, where a crowd now renders `vat.geometry`
 * itself (ADR-0016): this mesh is added and removed around the crowd frames,
 * and disposing the bake's geometry between them would put the gate's own
 * bookkeeping into the comparison.
 */
export function buildRestMesh(vat: VAT): THREE.Mesh {
  const geometry = vat.geometry.clone();
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
    startTime: instance.startTime,
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
 * {@link instancesOf} for the batched frames: the off-frustum instance first,
 * then the three visible ones — the order {@link buildBatch} adds them in.
 *
 * The order is the whole of why this exists. The playback texture is read by
 * the instance's logical index, so row `i` must be the pack of instance `i` of
 * the batch; a table in a different order would be the very fault the batched
 * frames are here to rule out, built into the harness.
 */
export function batchedInstancesOf(vat: VAT): VATInstance[] {
  const clips = vat.clips;
  return [
    {
      clip: clips[CULLED_INSTANCE.clipIndex % clips.length]!,
      startTime: CULLED_INSTANCE.startTime,
      speed: CULLED_INSTANCE.speed,
    },
    ...instancesOf(vat),
  ];
}

/**
 * The same crowd on the *second* carrier: one `BatchedMesh`, one geometry, one
 * instance per {@link INSTANCES} entry, standing where `placeInstances` stands
 * them.
 *
 * Shared by both paths for the reason everything else in this file is: the
 * batch's shape, its vertex budget and its matrices are not the thing being
 * compared, and a batch built two ways would be two scenes. What each path
 * does with it — patch a material for it, or build nodes from it — is decode,
 * and stays in the frame modules.
 *
 * Its `perObjectFrustumCulled` and `sortObjects` are left at three's defaults,
 * which is the point: the drawn slot is a permutation that changes every frame,
 * and a decode that read the pack by it would render the crowd's clips shuffled.
 * A fourth instance stands outside the frustum ({@link CULLED_INSTANCE}) so the
 * culling half of that is exercised and not just the sorting half — it is
 * culled from the head of the depth sort, which moves every visible instance's
 * drawn slot, and being invisible it can move no pixel.
 *
 * One material, because a `BatchedMesh` takes one — it has no geometry groups —
 * so the crowd's other materials have nowhere to go. That is a limit of the
 * carrier and not of the decode, and the frames still carry a full VAT
 * displacement lit by baked normals, which is what they are here to compare.
 */
export function buildBatch(vat: VAT, material: THREE.Material): THREE.BatchedMesh {
  const geometry = vat.geometry;
  const batch = new THREE.BatchedMesh(
    INSTANCES.length + 1,
    geometry.getAttribute("position").count,
    geometry.getIndex()?.count ?? 0,
    material,
  );
  const geometryId = batch.addGeometry(geometry);

  const matrix = new THREE.Matrix4();
  const scale = scaleOf(vat);
  const stand = (x: number, z: number) => {
    const instanceId = batch.addInstance(geometryId);
    batch.setMatrixAt(instanceId, matrix.makeScale(scale, scale, scale).setPosition(x, 0, z));
  };
  // The off-frustum instance first, so culling it takes the head of the drawn
  // list and not its tail — a hole at the end shifts nothing.
  stand(CULLED_INSTANCE.x, CULLED_INSTANCE.z);
  for (const instance of INSTANCES) stand(instance.x, 0);
  return batch;
}

/**
 * Reverse the order the batch draws its instances in, and nothing else.
 *
 * The gate's stripe test, reduced to its one moving part. A `BatchedMesh`
 * dereferences the drawn slot to a logical index every frame, and this makes
 * that dereference non-trivial on purpose: a decode reading the pack by the
 * drawn slot renders instance 0's clip on instance 2 and the frame moves. A
 * decode reading it by `getIndirectIndex( gl_DrawID )` / `batchIndirectIndex`
 * renders exactly the same pixels, which is what the verdict asks for.
 *
 * Pixel-identical rather than merely similar, because the three instances are
 * opaque, depth-tested and do not overlap — so the order they are rasterised in
 * cannot show.
 */
export function reverseDrawOrder(batch: THREE.BatchedMesh): void {
  batch.setCustomSort((list) => {
    list.reverse();
  });
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
  // Narrowed on the encoding first (ADR-0018): the fault corrupts the vertex
  // encoding's normal layer, which is the only encoding that has one.
  if (vat.encoding !== "delta") {
    throw new Error(`three-vat: the wrong-normals self-test needs the vertex encoding, not "${String(vat.encoding)}"`);
  }
  const source = vat.normalTexture;
  if (!source) {
    throw new Error(
      "three-vat: this self-test needs a baked normal to corrupt — the gate must bake with `bakeNormals: true`",
    );
  }
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

/**
 * Are these two bakes the same bake?
 *
 * The gate hands each path its own `bakeVAT` result rather than one shared VAT,
 * because a `DataTexture` is a GPU-resident object and this page holds two live
 * renderers — sharing one between a `WebGLRenderer` and a `WebGPURenderer` asks
 * a question about three's texture bookkeeping that the gate has no business
 * asking, and would answer as a decode divergence.
 *
 * Baking twice costs the guarantee that both paths saw identical texels, which
 * was the reason to share in the first place — so the guarantee is taken back
 * here as evidence instead of by construction. `bakeVAT` is deterministic CPU
 * math over the same posed subtree, so "the same bake" is a claim that can be
 * checked byte for byte, and is.
 *
 * @returns what differs, or `null` when nothing does.
 */
export function describeBakeMismatch(a: VAT, b: VAT): string | null {
  if (a.vertexCount !== b.vertexCount || a.totalFrames !== b.totalFrames) {
    return `different texture dimensions — ${a.vertexCount}x${a.totalFrames} against ${b.vertexCount}x${b.totalFrames}`;
  }

  const clips = (vat: VAT) => vat.clips.map((c) => `${c.name}:${c.startFrame}:${c.frames}:${c.fps}`).join(" ");
  if (clips(a) !== clips(b)) return `different clip tables — "${clips(a)}" against "${clips(b)}"`;

  // The texel comparison below reads the vertex encoding's layers, so both
  // sides are narrowed on the encoding first (ADR-0018).
  if (a.encoding !== b.encoding) return `different encodings — "${String(a.encoding)}" against "${String(b.encoding)}"`;
  if (a.encoding !== "delta" || b.encoding !== "delta") return null;

  for (const layer of ["positionTexture", "normalTexture"] as const) {
    // A VAT baked with `bakeNormals: false` has no normal layer. Two bakes that
    // disagree about *whether* it exists are already a mismatch.
    if (!a[layer] || !b[layer]) {
      if (a[layer] === b[layer]) continue;
      return `${layer} is baked on one side and not the other`;
    }
    const left = a[layer].image.data as Float32Array;
    const right = b[layer].image.data as Float32Array;
    if (left.length !== right.length) return `${layer} holds ${left.length} floats against ${right.length}`;
    for (let i = 0; i < left.length; i++) {
      if (left[i] !== right[i]) {
        return `${layer} differs at float ${i} (vertex ${(i >> 2) % a.vertexCount}, frame ${Math.floor(i / 4 / a.vertexCount)}): ${left[i]} against ${right[i]}`;
      }
    }
  }

  return null;
}
