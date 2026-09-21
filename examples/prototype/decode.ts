// PROTOTYPE — throwaway. See ./README.md and issue #47.
//
// The bone decode, in four variants, against the VAT decode as the control.
// Everything above the sampling is the shipped 2.0 machinery untouched: the
// same playback texture, the same pack layout, the same row arithmetic. What
// changes is only what a row *holds* and how many texels a vertex reads out of
// it — which is the claim the whole second encoding rests on, so the prototype
// is built to make that claim falsifiable rather than to be tidy.
//
// `vatRows` below is the row half of `DECODE_PRELUDE` in src/webgl.ts, which is
// itself a transcription of `resolveVATFrame`. Kept as a transcription rather
// than shared, because a prototype that edits the shipped shader to fit itself
// stops measuring the shipped shader.
//
// The fade branch is deliberately absent: no instance changes clip during a
// sweep, so it never executes on either side, and leaving it out of one but not
// the other would have been the unfair comparison.
import { EndMode, INFINITE_REPETITIONS, LoopMode } from 'three-vat'
import type { Material } from 'three'
import type { BoneBake } from './bake-bones.js'

/** The four bone variants, plus the VAT control the page compares them to. */
export const VARIANTS = {
  'vat': {
    label: 'VAT (control)',
    note: 'the shipped decode — one texel pair per vertex',
    format: null,
    fps: 30,
    fetches: '4–6',
  },
  'mat4-lerp': {
    label: 'mat4, two rows',
    note: 'componentwise lerp of a rotation — cheap, and not a rotation',
    format: 'mat4',
    fps: 30,
    fetches: '32',
  },
  'mat4-near': {
    label: 'mat4, nearest row',
    note: 'no interpolation, so the bake doubles to 60 fps to hide it',
    format: 'mat4',
    fps: 60,
    fetches: '16',
  },
  'qt-near': {
    label: 'quat+trans, nearest row',
    note: 'the cheapest fetch, same no-interpolation bargain',
    format: 'qt',
    fps: 60,
    fetches: '8',
  },
  'qt-slerp': {
    label: 'quat+trans, two rows',
    note: 'correct rotation interpolation at half the frames — the hypothesis',
    format: 'qt',
    fps: 30,
    fetches: '16',
  },
} as const

export type VariantName = keyof typeof VARIANTS

/**
 * The bone pack's own declarations. Their own chunk, ahead of everything that
 * reads them: GLSL resolves identifiers top to bottom, and `vatSlot` — which
 * is assembled per variant below — would otherwise be compiled before the
 * sampler it fetches from exists.
 */
const BONE_DECLARATIONS = /* glsl */ `
  uniform highp sampler2D uVatBoneTex;
  attribute vec4 vatSlotIndex;
  attribute vec4 vatSlotWeight;
`

/** A GLSL float literal — `0` is not a `float`, and the mode constants must be. */
const glslFloat = (n: number) => n.toFixed(1)

/**
 * Which rows this instance is between, and how far. The whole of what the bone
 * decode borrows from the shipped one — and the reason ADR-0016's playback
 * texture makes a second encoding cheap: this arithmetic does not know or care
 * what a row holds.
 *
 * Returns `vec3( row0, row1, mix )`, absolute rows including the clip's band
 * offset, so the caller only has to fetch.
 */
const ROW_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatPlaybackTex;
  uniform float uVatTime;

  vec3 vatRows( const in int vatInstance ) {
    vec4 vatClip     = texelFetch( uVatPlaybackTex, ivec2( 0, vatInstance ), 0 );
    vec4 vatPlayback = texelFetch( uVatPlaybackTex, ivec2( 1, vatInstance ), 0 );

    float frames = vatClip.y;
    float last = frames - 1.0;
    float duration = frames / vatClip.z;
    float local = ( uVatTime - vatPlayback.x ) * vatClip.w;
    float loops = local / duration;
    float repetitions = vatPlayback.z;

    bool started = local >= 0.0;
    bool finished = started && repetitions != ${glslFloat(INFINITE_REPETITIONS)} && loops >= repetitions;

    float phase;
    bool wraps;
    if ( !started ) {
      phase = 0.0;
      wraps = false;
    } else if ( finished ) {
      phase = vatPlayback.w == ${glslFloat(EndMode.Clamp)} ? 1.0 : 0.0;
      wraps = false;
    } else if ( vatPlayback.y == ${glslFloat(LoopMode.PingPong)} ) {
      float m = mod( loops, 2.0 );
      phase = m < 1.0 ? m : 2.0 - m;
      wraps = false;
    } else {
      phase = fract( loops );
      wraps = true;
    }

    float f = phase * ( wraps ? frames : last );
    float f0 = min( floor( f ), last );
    float f1 = wraps ? mod( f0 + 1.0, frames ) : min( f0 + 1.0, last );
    return vec3( vatClip.x + f0, vatClip.x + f1, f - f0 );
  }
`

/**
 * Quaternion + translation + uniform scale back to the matrix the skinning
 * wants — `Matrix4.compose`, component for component, so the two encodings
 * feed the *same* linear blend and the measurement isolates the fetch.
 *
 * This is the design decision worth arguing with: rotations could be blended
 * across the four influences directly, which is arguably better skinning (no
 * candy-wrapper collapse), but it would be *different* skinning, and the
 * prototype would then be comparing two looks as well as two costs.
 */
const QT_PRELUDE = /* glsl */ `
  mat4 vatCompose( const in vec4 q, const in vec4 ts ) {
    float x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    float xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
    float yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
    float wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    float s = ts.w;
    return mat4(
      vec4( ( 1.0 - ( yy + zz ) ) * s, ( xy + wz ) * s, ( xz - wy ) * s, 0.0 ),
      vec4( ( xy - wz ) * s, ( 1.0 - ( xx + zz ) ) * s, ( yz + wx ) * s, 0.0 ),
      vec4( ( xz + wy ) * s, ( yz - wx ) * s, ( 1.0 - ( xx + yy ) ) * s, 0.0 ),
      vec4( ts.xyz, 1.0 )
    );
  }
`

/** One slot's matrix for this frame — the only line that differs per variant. */
const SLOT_FETCH: Record<Exclude<VariantName, 'vat'>, string> = {
  'mat4-lerp': /* glsl */ `
    mat4 vatSlot( const in int slot, const in int r0, const in int r1, const in float t ) {
      int x = slot * 4;
      mat4 a = mat4(
        texelFetch( uVatBoneTex, ivec2( x, r0 ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 1, r0 ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 2, r0 ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 3, r0 ), 0 ) );
      mat4 b = mat4(
        texelFetch( uVatBoneTex, ivec2( x, r1 ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 1, r1 ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 2, r1 ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 3, r1 ), 0 ) );
      // Componentwise. A rotation lerped this way shortens as it turns, which
      // is the artefact the A/B toggle on the page is there to show.
      return a * ( 1.0 - t ) + b * t;
    }
  `,
  'mat4-near': /* glsl */ `
    mat4 vatSlot( const in int slot, const in int r0, const in int r1, const in float t ) {
      int r = t < 0.5 ? r0 : r1;
      int x = slot * 4;
      return mat4(
        texelFetch( uVatBoneTex, ivec2( x, r ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 1, r ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 2, r ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 3, r ), 0 ) );
    }
  `,
  'qt-near': /* glsl */ `
    mat4 vatSlot( const in int slot, const in int r0, const in int r1, const in float t ) {
      int r = t < 0.5 ? r0 : r1;
      int x = slot * 2;
      return vatCompose(
        texelFetch( uVatBoneTex, ivec2( x, r ), 0 ),
        texelFetch( uVatBoneTex, ivec2( x + 1, r ), 0 ) );
    }
  `,
  'qt-slerp': /* glsl */ `
    mat4 vatSlot( const in int slot, const in int r0, const in int r1, const in float t ) {
      int x = slot * 2;
      vec4 q0 = texelFetch( uVatBoneTex, ivec2( x, r0 ), 0 );
      vec4 p0 = texelFetch( uVatBoneTex, ivec2( x + 1, r0 ), 0 );
      vec4 q1 = texelFetch( uVatBoneTex, ivec2( x, r1 ), 0 );
      vec4 p1 = texelFetch( uVatBoneTex, ivec2( x + 1, r1 ), 0 );
      // nlerp, not slerp: the bake already put consecutive rows on one
      // hemisphere, and at a 30 fps step the angular error against a true
      // slerp is far below what the A/B toggle can show. It is still a
      // *rotation* at every t, which is the whole difference from mat4-lerp.
      return vatCompose( normalize( mix( q0, q1, t ) ), mix( p0, p1, t ) );
    }
  `,
}

/**
 * The skinning itself: one weighted sum of slot matrices, identical for every
 * variant. `sum( w_i * M_i )` is linear blend skinning, the same blend
 * src/bake.ts does on the CPU and three's `skinning_vertex` does on the GPU.
 */
const SKIN_PRELUDE = /* glsl */ `
  mat4 vatSkinMatrix( const in int vatInstance ) {
    vec3 rows = vatRows( vatInstance );
    int r0 = int( rows.x );
    int r1 = int( rows.y );
    mat4 skin = mat4( 0.0 );
    for ( int i = 0; i < 4; i ++ ) {
      float w = vatSlotWeight[ i ];
      if ( w == 0.0 ) continue;
      skin += w * vatSlot( int( vatSlotIndex[ i ] ), r0, r1, rows.z );
    }
    return skin;
  }
`

// Each injection point resolves the skin matrix for itself. Two sets of fetches
// rather than one shared local, for the reason ADR-0006 gives: MeshDepthMaterial
// hides `#include <beginnormal_vertex>` inside a dead `#ifdef`, so anything a
// later injection depends on can silently vanish. The shipped VAT decode pays
// the same price, so the comparison stays honest.
const DECODE_POSITION = /* glsl */ `
  mat4 vatSkinP = vatSkinMatrix( gl_InstanceID );
  vec3 transformed = ( vatSkinP * vec4( position, 1.0 ) ).xyz;
`

const DECODE_NORMAL = /* glsl */ `
  mat4 vatSkinN = vatSkinMatrix( gl_InstanceID );
  vec3 objectNormal = normalize( mat3( vatSkinN ) * normal );
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`

/**
 * Patch a material to skin from the bone texture. The shape of
 * `patchVATMaterial`, deliberately — same injection points, same cache-key
 * discipline — so what the measurement compares is the sampling and not two
 * different ways of getting into three's shader.
 */
export function patchBoneMaterial<T extends Material>(
  material: T,
  bake: BoneBake,
  variant: Exclude<VariantName, 'vat'>,
  time: { value: number },
  playback: { texture: unknown },
): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVatBoneTex = { value: bake.texture }
    shader.uniforms.uVatPlaybackTex = { value: playback.texture }
    shader.uniforms.uVatTime = time as { value: number }

    const prelude =
      ROW_PRELUDE +
      BONE_DECLARATIONS +
      (bake.format === 'qt' ? QT_PRELUDE : '') +
      SLOT_FETCH[variant] +
      SKIN_PRELUDE

    shader.vertexShader =
      prelude +
      shader.vertexShader
        .replace('#include <begin_vertex>', DECODE_POSITION)
        .replace('#include <beginnormal_vertex>', DECODE_NORMAL)
  }
  // Per variant, so the five programs never share a compiled shader — the bug
  // that would make every variant time the same.
  material.customProgramCacheKey = () => `three-vat-prototype:${variant}`
  return material
}
