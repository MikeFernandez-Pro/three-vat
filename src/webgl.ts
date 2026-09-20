import { InstancedMesh, MeshDepthMaterial, MeshDistanceMaterial, RGBADepthPacking } from 'three'
import type { IUniform, Material, WebGLRenderer } from 'three'
import { assertBakedNormal } from './baked-normals.js'
import { createCrowdGeometry } from './instance-playback.js'
import type { VATInstance } from './instance-playback.js'
import type { VAT, VATCrowd } from './types.js'

/**
 * The real maximum texture dimension this GPU accepts, for
 * `bakeVAT(..., { maxTextureSize })`. The baker cannot query this itself — it
 * is renderer-agnostic so it can run in Node or a Web Worker — so read it
 * here and hand it over. Desktop typically reports 16384, but mobile GPUs
 * commonly report 4096 or 8192, which is exactly the case a hardcoded default
 * bakes straight past.
 */
export function getMaxTextureSize(renderer: WebGLRenderer): number {
  return renderer.capabilities.maxTextureSize
}

/** The shared uniform driving every VAT-patched material's playback clock. */
export interface VATUniforms {
  uVatTime: IUniform<number>
}

/** Create the shared time uniform. Update `uVatTime.value` once per frame. */
export function createVATUniforms(time = 0): VATUniforms {
  return { uVatTime: { value: time } }
}

// The instance-playback contract is core, not WebGL: import
// `addVATInstanceAttributes` and `VATInstance` from `three-vat` (ADR-0009). The
// deprecated aliases that stood here are gone — the pack they wrote no longer
// exists, so keeping their names would have promised a contract this path can
// no longer read.

// The instance-playback pack is read straight off the two vec4s that carry it
// (src/instance-playback.ts). `aVatFade` is written by the contract but read by
// nothing yet, so it is not declared below: an unused attribute is dead source,
// and the compiler would strip its binding regardless.
//
// Self-contained decode: each injection point calls vatSample() independently.
// This MUST NOT be split into shared decode locals across injection points —
// MeshDepthMaterial contains `#include <beginnormal_vertex>` inside a dead
// `#ifdef USE_DISPLACEMENTMAP` block, so anything injected there can silently
// vanish and break a later injection that depended on it (see ADR-0006).
const DECODE_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatPosTex;
  uniform float uVatTime;
  attribute vec4 aVatClip;      // x: clip start row, y: frames, z: fps, w: speed
  attribute vec4 aVatPlayback;  // x: start time, y: loop mode, z: repetitions, w: end mode
  vec3 vatSample( const in sampler2D tex ) {
    float frames = aVatClip.y;
    float duration = frames / aVatClip.z;
    // Local time: how far into its own animation this instance is. A start time
    // in the past is what desyncs a crowd; fract() wraps it either way.
    float t = fract( ( ( uVatTime - aVatPlayback.x ) * aVatClip.w ) / duration ) * frames;
    int f0 = int( t );
    int f1 = int( mod( float( f0 + 1 ), frames ) );
    vec3 s0 = texelFetch( tex, ivec2( gl_VertexID, f0 + int( aVatClip.x ) ), 0 ).xyz;
    vec3 s1 = texelFetch( tex, ivec2( gl_VertexID, f1 + int( aVatClip.x ) ), 0 ).xyz;
    return mix( s0, s1, fract( t ) );
  }
`

/**
 * The normal sampler, declared only when there is a normal texture to bind. A
 * VAT baked with `bakeNormals: false` has none, and leaving the uniform in the
 * source would leave a sampler declared, bound to nothing, and read by nothing.
 */
const NORMAL_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatNrmTex;
`

const DECODE_POSITION = /* glsl */ `
  vec3 transformed = position + vatSample( uVatPosTex );
`

const DECODE_NORMAL = /* glsl */ `
  vec3 objectNormal = normalize( vatSample( uVatNrmTex ) );
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`

/**
 * Patch any built-in material so its vertex stage samples the VAT instead of
 * skinning. Works on the render material and on `MeshDepthMaterial` (needed for
 * instanced shadows — see {@link createVATDepthMaterial}). Mutates and returns
 * the material.
 */
export function patchVATMaterial<T extends Material>(material: T, vat: VAT, uniforms: VATUniforms): T {
  // A normal-less VAT under a material that shades from a normal is refused
  // here, before a single frame renders it by the rest pose.
  assertBakedNormal(vat, material)
  const normalTexture = vat.normalTexture

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVatPosTex = { value: vat.positionTexture }
    shader.uniforms.uVatTime = uniforms.uVatTime

    let vertexShader = shader.vertexShader.replace('#include <begin_vertex>', DECODE_POSITION)
    // No normal texture, no normal decode, and no uniform bound for one: the
    // material either does not read a normal or derives it from the deformed
    // position itself (`flatShading`), so three's own `beginnormal_vertex` is
    // left exactly where it is.
    if (normalTexture) {
      shader.uniforms.uVatNrmTex = { value: normalTexture }
      vertexShader = vertexShader.replace('#include <beginnormal_vertex>', DECODE_NORMAL)
    }

    shader.vertexShader = (normalTexture ? NORMAL_PRELUDE : '') + DECODE_PRELUDE + vertexShader
  }
  // Distinct cache key so patched materials never share a compiled program with
  // unpatched ones (see ADR-0006) — and so the two *patches* never share one
  // either. A normal-less VAT injects a different vertex shader off the same
  // material parameters, and the shadow materials have nothing else to tell
  // them apart: `createVATDepthMaterial` builds the identical
  // `MeshDepthMaterial({ depthPacking })` for either kind of VAT, so one key
  // would hand the second crowd the first's compiled program.
  const key = normalTexture ? 'three-vat' : 'three-vat:no-normal'
  material.customProgramCacheKey = () => key
  return material
}

/**
 * Build the `customDepthMaterial` an `InstancedMesh` needs so a VAT crowd casts
 * correctly-deformed shadows instead of bind-pose shadows. Assign the result to
 * `mesh.customDepthMaterial` (and, for point lights, mirror with a patched
 * `MeshDistanceMaterial`).
 */
export function createVATDepthMaterial(vat: VAT, uniforms: VATUniforms): MeshDepthMaterial {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  patchVATMaterial(depth, vat, uniforms)
  return depth
}

/** Options for {@link createVATMesh}. */
export interface CreateVATMeshOptions {
  /**
   * The playback clock to drive this crowd from, in seconds. Pass one — from
   * {@link createVATUniforms} or any `{ value }` — to run several VAT meshes off
   * a single time value. Defaults to a fresh clock at `0`, returned to you as
   * `time`. The TSL path's `vatNodes` takes its clock the same way.
   */
  time?: IUniform<number>
}

/**
 * Turn a baked VAT and a list of instances into a crowd ready to render: an
 * `InstancedMesh` whose geometry carries the instance-playback contract, whose
 * materials decode the VAT, and whose shadows are deformed rather than frozen
 * in the bind pose.
 *
 * ```ts
 * const { mesh, time } = createVATMesh(vat, instances)
 * mesh.castShadow = mesh.receiveShadow = true
 * scene.add(mesh)
 * // per frame:
 * time.value = clock.elapsedTime
 * ```
 *
 * Two things stay yours, because only you can know them:
 *
 * - **Instance matrices.** Write them with `mesh.setMatrixAt`, then
 *   `mesh.instanceMatrix.needsUpdate = true`. An `InstancedMesh` caches the
 *   bounding sphere it culls against, so call `mesh.computeBoundingSphere()`
 *   after placing the crowd, or set `mesh.frustumCulled = false` when the
 *   matrices change every frame.
 * - **`castShadow` / `receiveShadow`**, which are scene decisions. The depth and
 *   distance materials the shadow passes need are already attached either way.
 *
 * Everything here is the exported primitives — {@link addVATInstanceAttributes},
 * {@link patchVATMaterial}, {@link createVATDepthMaterial} — composed in the one
 * order that is correct. Reach for them directly only when rendering onto
 * something other than a plain `InstancedMesh`.
 */
export function createVATMesh(
  vat: VAT,
  instances: VATInstance[],
  options: CreateVATMeshOptions = {},
): VATCrowd {
  const uniforms: VATUniforms = options.time ? { uVatTime: options.time } : createVATUniforms()

  const geometry = createCrowdGeometry(vat, instances)

  // One patched material per source material, never merged (ADR-0008): a
  // three-material crowd is three draw calls, not three per instance.
  const materials = vat.materials.map((source) => patchVATMaterial(source.clone(), vat, uniforms))

  const mesh = new InstancedMesh(geometry, materials, instances.length)
  // Without these the shadow passes render the undeformed bind pose — the step
  // most easily missed when wiring a VAT crowd by hand. Both are attached
  // because which one a scene needs is a property of its lights, not of the
  // crowd: directional and spot lights take the depth material, point lights
  // the distance material. Neither costs anything in a scene with no shadows.
  mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms)
  mesh.customDistanceMaterial = patchVATMaterial(new MeshDistanceMaterial(), vat, uniforms)

  return { mesh, time: uniforms.uVatTime }
}
