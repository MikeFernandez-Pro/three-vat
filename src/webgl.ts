import { MeshDepthMaterial, RGBADepthPacking } from 'three'
import type { IUniform, Material, WebGLRenderer } from 'three'
import { addVATInstanceAttributes } from './instance-playback.js'
import type { VATInstance as VATInstanceContract } from './instance-playback.js'
import type { VAT } from './types.js'

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

/**
 * The instance-playback contract now lives in the core entry point, so both
 * decode paths can read it (ADR-0009).
 *
 * @deprecated Renamed to `addVATInstanceAttributes` and moved to `three-vat`.
 * Removed from `three-vat/webgl` in the next minor version — import it from
 * `three-vat` instead.
 */
export const addInstancedVATAttributes = addVATInstanceAttributes

/**
 * @deprecated Moved to `three-vat`. Removed from `three-vat/webgl` in the next
 * minor version — import `VATInstance` from `three-vat` instead.
 */
// Aliased rather than `export type { VATInstance } from …`: TypeScript drops
// JSDoc from a re-export statement, so the deprecation would never reach a
// consumer's editor.
export type VATInstance = VATInstanceContract

// Self-contained decode: each injection point calls vatSample() independently.
// This MUST NOT be split into shared decode locals across injection points —
// MeshDepthMaterial contains `#include <beginnormal_vertex>` inside a dead
// `#ifdef USE_DISPLACEMENTMAP` block, so anything injected there can silently
// vanish and break a later injection that depended on it (see ADR-0006).
const DECODE_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatPosTex;
  uniform highp sampler2D uVatNrmTex;
  uniform float uVatTime;
  attribute float aClipStart;
  attribute float aClipFrames;
  attribute float aClipFps;
  attribute float aTimeOffset;
  attribute float aSpeed;
  vec3 vatSample( const in sampler2D tex ) {
    float duration = aClipFrames / aClipFps;
    float t = fract( ( uVatTime * aSpeed + aTimeOffset ) / duration ) * aClipFrames;
    int f0 = int( t );
    int f1 = int( mod( float( f0 + 1 ), aClipFrames ) );
    vec3 s0 = texelFetch( tex, ivec2( gl_VertexID, f0 + int( aClipStart ) ), 0 ).xyz;
    vec3 s1 = texelFetch( tex, ivec2( gl_VertexID, f1 + int( aClipStart ) ), 0 ).xyz;
    return mix( s0, s1, fract( t ) );
  }
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
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVatPosTex = { value: vat.positionTexture }
    shader.uniforms.uVatNrmTex = { value: vat.normalTexture }
    shader.uniforms.uVatTime = uniforms.uVatTime

    shader.vertexShader =
      DECODE_PRELUDE +
      shader.vertexShader
        .replace('#include <begin_vertex>', DECODE_POSITION)
        .replace('#include <beginnormal_vertex>', DECODE_NORMAL)
  }
  // Distinct cache key so patched materials never share a compiled program with
  // unpatched ones (see ADR-0006).
  material.customProgramCacheKey = () => 'three-vat'
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
