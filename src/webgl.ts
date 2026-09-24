import { InstancedMesh, Material, MeshDepthMaterial, MeshDistanceMaterial, RGBADepthPacking } from 'three'
import type { IUniform, Object3D, WebGLRenderer } from 'three'
import { assertBakedNormal } from './baked-normals.js'
import { assertVATCarrier, isBatchedCarrier } from './carrier.js'
import type { VATCarrier } from './carrier.js'
import {
  createVATPlaybackTexture,
  EndMode,
  INFINITE_REPETITIONS,
  LoopMode,
  PACK_TEXELS,
} from './instance-playback.js'
import type { VATInstance, VATPlaybackTexture } from './instance-playback.js'
import type { DeltaVAT, RigVAT, VAT, VATCrowd } from './types.js'
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'

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
// `createVATPlaybackTexture` and `VATInstance` from `three-vat` (ADR-0009).

/**
 * A number as a GLSL float literal. `0` is not a `float` in GLSL, and an `int`
 * compared against one is a compile error — so the mode constants have to carry
 * a decimal point across the boundary.
 */
const glslFloat = (n: number) => n.toFixed(1)

// The instance-playback pack is fetched from the playback texture that carries
// it (src/instance-playback.ts), by the instance's logical index — five texels
// of one row, every frame: three for the live band and the crossfade, and two
// for the band being left, which land on the live pair again while the weight
// is zero (ADR-0025, #72). They arrive as `vec4` locals with the same
// component order the attributes had in 1.x (ADR-0016).
//
// `vatBand` below is a line-for-line transcription of `resolveVATFrame`
// (src/instance-playback.ts), which is the one definition of what a loop mode
// means. Change the semantics there, not here — and the mode constants are
// interpolated from that module rather than retyped, so a renumbered `LoopMode`
// cannot leave this shader comparing against the old number.
//
// It is the half of the decode both encodings share, verbatim (ADR-0018): which
// rows of its band an instance is between and how far, and the same for the
// band it is crossfading out of. What a row *holds* — a vertex's delta, or a
// slot of the posed rig — is each encoding's own prelude, below.
//
// Self-contained decode: each injection point calls its own sampler, and the
// sampler calls vatRows(). This MUST NOT be split into shared decode locals
// across injection points — MeshDepthMaterial contains
// `#include <beginnormal_vertex>` inside a dead `#ifdef USE_DISPLACEMENTMAP`
// block, so anything injected there can silently vanish and break a later
// injection that depended on it (see ADR-0006).
const ROW_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatPlaybackTex;
  uniform float uVatTime;

  // One band resolved: the two rows an instance sits between and the blend
  // toward the second, plus the two facts those rows cannot be read back out
  // of — whether the sampling wrapped past the band's last row into its first,
  // and whether the repetitions have run out.
  struct VatBand {
    int row0;
    int row1;
    float blend;
    bool wraps;
    bool finished;
  };

  // Where an instance is reading: the band it is playing, and how much of the
  // band it is leaving still shows — a weight of zero being "not
  // transitioning".
  //
  // The outgoing band is *not* a field here. Each sampler resolves it for
  // itself, because what it costs to resolve is not the same on the two
  // encodings and #72 measured the difference: see vatOutgoingBand below.
  struct VatRows {
    VatBand live;
    float weight;
  };

  // resolveVATFrame for one (clip texel, playback texel) pair, branch for
  // branch: not started, finished, ping-pong, repeat — the resolver's own
  // order, each case falling out into the shared phase-to-row arithmetic below
  // rather than returning early, so all of them land on the same two rows.
  //
  // A function of the pair rather than of the instance, because the pair is
  // what there are two of: a crossfading instance resolves its outgoing band
  // by calling this a second time, not by transcribing it a second time.
  VatBand vatBand( const in vec4 vatClip, const in vec4 vatPlayback ) {
    float frames = vatClip.y;
    float last = frames - 1.0;
    float duration = frames / vatClip.z;
    // Local time: how far into its own animation this instance is. A start time
    // in the past is what desyncs a crowd; a start time in the future has not
    // begun, which is not the same thing as having finished.
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
      // Held at an end pose, and in neither case sampling past it.
      phase = vatPlayback.w == ${glslFloat(EndMode.Clamp)} ? 1.0 : 0.0;
      wraps = false;
    } else if ( vatPlayback.y == ${glslFloat(LoopMode.PingPong)} ) {
      // Halved rather than divided, so the remainder cannot land below zero.
      float m = loops - 2.0 * floor( loops * 0.5 );
      phase = m < 1.0 ? m : 2.0 - m;
      wraps = false; // a ping-pong bounces; it does not wrap
    } else {
      phase = fract( loops );
      wraps = true;  // and here the interpolation crossing back is correct
    }

    float f = phase * ( wraps ? frames : last );
    float f0 = min( floor( f ), last );
    // A compare, not a mod: a mod divides, and at the last row a quotient a hair
    // under 1 leaves f1 at frames, one row past the band (#79).
    float next = f0 + 1.0;
    float f1 = wraps ? ( next >= frames ? 0.0 : next ) : min( next, last );

    VatBand band;
    band.row0 = int( vatClip.x + f0 );
    band.row1 = int( vatClip.x + f1 );
    band.blend = f - f0;
    band.wraps = wraps;
    band.finished = finished;
    return band;
  }

  VatRows vatRows( const in int vatInstance ) {
    // The pack, fetched by this instance's *logical* index rather than read
    // off an attribute indexed by the drawn slot (ADR-0016). Three texels of
    // one row, in the order src/instance-playback.ts lays them out; the
    // arithmetic above is untouched by where they came from, because the pack
    // was already three vec4s.
    //
    // The index arrives as a parameter rather than being read here, because
    // where it comes from is the carrier's business and not the decode's:
    // gl_InstanceID on an InstancedMesh, getIndirectIndex( gl_DrawID ) on a
    // BatchedMesh — see INSTANCE_ID in src/webgl.ts. It also has to be a
    // parameter: getIndirectIndex is declared by batching_pars_vertex, which
    // three expands *after* this prelude, so naming it up here would not
    // compile.
    //
    // Fetched inside the function, so each injection point stays
    // self-contained (ADR-0006) — which costs a second set of fetches in the
    // normal decode. Every vertex of an instance reads the same texels of the
    // same row, whichever branch it takes, so the texture cache absorbs them;
    // the demo bench under ADR-0016's 5% bound is what said so for three of
    // them, and #72's idle-crowd bench is what says so for all five.
    //
    // Three texels here, the live pair and the crossfade; the other two are
    // vatOutgoingBand's, fetched every frame by every sampler that calls it.
    vec4 vatClip      = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.clip}, vatInstance ), 0 );
    vec4 vatPlayback  = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.playback}, vatInstance ), 0 );
    vec4 vatCrossfade = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.crossfade}, vatInstance ), 0 );

    VatRows rows;
    // The live band: the one clip this instance is playing, resolved from its
    // own pair of texels.
    rows.live = vatBand( vatClip, vatPlayback );

    // The crossfade's weight, transcribed from the resolver: wall clock, not
    // clip time — the incoming clip's speed does not stretch a transition — and
    // a duration of zero is what a cut is, which is what the pack writes when
    // there is no band to blend away.
    rows.weight = 0.0;
    if ( vatCrossfade.x > 0.0 ) {
      rows.weight = 1.0 - clamp( ( uVatTime - vatPlayback.x ) / vatCrossfade.x, 0.0, 1.0 );
    }

    return rows;
  }

  // The band the instance is leaving: two more texels and a second call of the
  // very same resolver, so the clip it is leaving keeps playing — keeping its
  // own speed and its own end policy — rather than standing still (ADR-0025).
  //
  // While the weight is zero the pair selected *is* the live pair, so the two
  // fetches land on texels this vertex has already read and the band resolves
  // to the one it is playing. That is what lets a caller resolve it without a
  // branch, and blending a pose into itself is what a weight of zero means.
  //
  // Selecting the live pair is also why this needs no counterpart to the TSL
  // path's max-of-one on the outgoing frames and fps (src/tsl.ts): that path
  // resolves a band from the zeroes "not transitioning" is written as, which is
  // a 0/0 duration and a NaN row. The pair selected here is always real.
  //
  // Whether the instance is transitioning is the parameter, not the weight, so
  // the caller is the one that says so — and the two encodings say it from
  // different places (#72): the vertex sampler calls this unconditionally,
  // because guarding two texel fetches cost an idle crowd 10%; the rig sampler
  // calls it unconditionally too but guards what it *does* with the band, where
  // what a guard skips is sixteen dependent fetches per vertex.
  VatBand vatOutgoingBand( const in int vatInstance, const in bool transitioning ) {
    int clipX     = transitioning ? ${PACK_TEXELS.outgoingClip} : ${PACK_TEXELS.clip};
    int playbackX = transitioning ? ${PACK_TEXELS.outgoingPlayback} : ${PACK_TEXELS.playback};
    vec4 vatOutClip     = texelFetch( uVatPlaybackTex, ivec2( clipX, vatInstance ), 0 );
    vec4 vatOutPlayback = texelFetch( uVatPlaybackTex, ivec2( playbackX, vatInstance ), 0 );
    return vatBand( vatOutClip, vatOutPlayback );
  }
`

/**
 * The vertex encoding's sampler: a row holds where this vertex ended up, so
 * the decode is two fetches at `x = gl_VertexID` and a mix — the same shape
 * for the position layer and the normal layer, each injection point calling it
 * for itself.
 *
 * The two layers no longer share one function, because they no longer hold the
 * same thing: a position texel is a delta in three float channels, a normal
 * texel is an octahedral unit vector in two unsigned bytes (#29). Two samplers
 * rather than one with a flag — a flag would be a branch, and #72 measured
 * what a branch in this decode costs.
 */
const VERTEX_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatPosTex;

  // One band of the position layer: the two rows this band sits between,
  // mixed. The same function for the live band and the outgoing one, as
  // vatBand is the same function for both pairs.
  vec3 vatBandSample( const in sampler2D tex, const in VatBand band ) {
    vec3 s0 = texelFetch( tex, ivec2( gl_VertexID, band.row0 ), 0 ).xyz;
    vec3 s1 = texelFetch( tex, ivec2( gl_VertexID, band.row1 ), 0 ).xyz;
    return mix( s0, s1, band.blend );
  }

  vec3 vatSample( const in sampler2D tex, const in int vatInstance ) {
    VatRows rows = vatRows( vatInstance );
    // The outgoing band — still playing, two rows of its own — mixed in by the
    // weight the rows resolved, and mixed in *unconditionally*: at a weight of
    // zero the band resolved is the live one, so this blends a pose into
    // itself. The normal layer is renormalised by the caller after the mix, as
    // it is for a single band.
    //
    // No branch, and that is measured rather than reasoned (#72): here the
    // outgoing band is two more fetches of one layer, and guarding them cost an
    // idle crowd 10% where paying them costs nothing measurable — 0.283 ms
    // against the 0.282 ms it cost before the crossfade existed. A branch is
    // not free because it is not taken: the compiler still holds registers for
    // the side it skips, and that is what an idle crowd was paying for.
    VatBand outgoing = vatOutgoingBand( vatInstance, rows.weight > 0.0 );
    return mix( vatBandSample( tex, rows.live ), vatBandSample( tex, outgoing ), rows.weight );
  }
`

/**
 * The normal sampler, declared only when there is a normal texture to bind. A
 * VAT baked with `bakeNormals: false` has none, and leaving the uniform in the
 * source would leave a sampler declared, bound to nothing, and read by nothing.
 *
 * `vatOctDecode` is `decodeOctahedral` from src/octahedral.ts, term for term —
 * that module is the definition, this is a transcription of it, and the CPU
 * test over it is the only proof of this arithmetic that does not need a GPU.
 * The sampler hands over the two bytes already divided by 255, which is the
 * whole of the difference. The fold is undone without a branch, by the
 * identity that a negative z is exactly the overshoot to take back off both
 * components, each toward its own zero.
 *
 * Decoded per texel and mixed afterwards, not mixed in the encoded square: two
 * octahedral pairs either side of the fold interpolate through the wrong half
 * of the sphere. So the lerp stays the lerp the float layer did, over the
 * vectors themselves, and the caller renormalises it as it always has.
 */
const NORMAL_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatNrmTex;

  vec2 vatOctSign( const in vec2 v ) {
    return vec2( v.x >= 0.0 ? 1.0 : -1.0, v.y >= 0.0 ? 1.0 : -1.0 );
  }

  vec3 vatOctDecode( const in vec2 stored ) {
    vec2 e = stored * 2.0 - 1.0;
    float z = 1.0 - abs( e.x ) - abs( e.y );
    vec2 xy = e - vatOctSign( e ) * max( -z, 0.0 );
    return normalize( vec3( xy, z ) );
  }

  // One band of the normal layer — vatBandSample, over decoded normals.
  vec3 vatBandSampleNormal( const in VatBand band ) {
    vec3 s0 = vatOctDecode( texelFetch( uVatNrmTex, ivec2( gl_VertexID, band.row0 ), 0 ).xy );
    vec3 s1 = vatOctDecode( texelFetch( uVatNrmTex, ivec2( gl_VertexID, band.row1 ), 0 ).xy );
    return mix( s0, s1, band.blend );
  }

  // vatSample, for the one layer whose texel is not what it decodes to. The
  // outgoing band is resolved and mixed unconditionally here too, for the
  // reason spelled out on vatSample.
  vec3 vatSampleNormal( const in int vatInstance ) {
    VatRows rows = vatRows( vatInstance );
    VatBand outgoing = vatOutgoingBand( vatInstance, rows.weight > 0.0 );
    return mix( vatBandSampleNormal( rows.live ), vatBandSampleNormal( outgoing ), rows.weight );
  }
`

/**
 * The rig encoding's sampler (ADR-0018): a row holds the posed rig, one slot per
 * bone as a rotation, a translation and a uniform scale, and the vertex skins
 * itself from the four slots its `skinIndex` names — three's own
 * `skinning_vertex` with a frame axis. Sixteen dependent fetches per vertex
 * against the vertex encoding's four; measured on the prototype (#47), where
 * the fetch count turned out not to be the cost, the dependent read was.
 *
 * `skinIndex` and `skinWeight` are declared here because three only declares
 * them under `USE_SKINNING`, which no carrier of a crowd sets: the geometry
 * carries them, remapped to slots by the bake, and the binding is by name.
 */
const RIG_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatRigTex;
  attribute vec4 skinIndex;
  attribute vec4 skinWeight;

  // Matrix4.compose, component for component: a rotation, a translation and
  // one scale back to the matrix the skinning wants — so both encodings feed
  // the same linear blend, and a rig crowd deforms as its vertex bake does.
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

  // One slot of the posed rig, at one band: a rotation and a placement, each
  // between the two rows that band sits between. The same function for the live
  // band and the outgoing one, as vatBand is the same function for both pairs.
  struct VatPose {
    vec4 q;
    vec4 ts;
  };

  VatPose vatSlotPose( const in int rotation, const in int placement, const in VatBand band ) {
    vec4 q0 = texelFetch( uVatRigTex, ivec2( rotation, band.row0 ), 0 );
    vec4 ts0 = texelFetch( uVatRigTex, ivec2( placement, band.row0 ), 0 );
    vec4 q1 = texelFetch( uVatRigTex, ivec2( rotation, band.row1 ), 0 );
    vec4 ts1 = texelFetch( uVatRigTex, ivec2( placement, band.row1 ), 0 );
    // The bake keeps consecutive rows on one hemisphere, but a looping clip
    // blends its band's last row into its first, and a bone that turned a full
    // circle over the clip arrives there on the far side: one dot product per
    // slot, or the blend passes through zero on the wrap frame.
    if ( dot( q0, q1 ) < 0.0 ) q1 = -q1;
    VatPose pose;
    // A normalised lerp, not a slerp: at a bake's frame step the angular error
    // against a true slerp is far below anything visible. It is still a
    // *rotation* at every blend, which is what a componentwise matrix lerp is
    // not — that one shortens a limb as it turns (ADR-0018).
    pose.q = normalize( mix( q0, q1, band.blend ) );
    pose.ts = mix( ts0, ts1, band.blend );
    return pose;
  }

  // One slot's matrix: its pose in the band the instance is playing and, while
  // it is transitioning, its pose in the band it is leaving — blended per slot
  // before the matrix is composed, so the crowd skins from one rig rather than
  // from the average of two matrices.
  //
  // The guard stays here, where the vertex sampler dropped its own. What it
  // skips is four dependent fetches of the rig texture per slot, sixteen per
  // vertex, against the two of one layer the vertex encoding skips — and #72
  // measured it worth keeping: this encoding did not get slower when the
  // crossfade landed, and the vertex encoding did.
  mat4 vatSlot( const in int slot, const in VatRows rows, const in VatBand outgoing ) {
    int rotation = slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.rotation};
    int placement = slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.placement};
    VatPose pose = vatSlotPose( rotation, placement, rows.live );
    vec4 q = pose.q;
    vec4 ts = pose.ts;
    if ( rows.weight > 0.0 ) {
      VatPose leaving = vatSlotPose( rotation, placement, outgoing );
      vec4 qo = leaving.q;
      // The outgoing band is any row of the bake, not this row's neighbour, so
      // the same check.
      if ( dot( q, qo ) < 0.0 ) qo = -qo;
      q = normalize( mix( q, qo, rows.weight ) );
      ts = mix( ts, leaving.ts, rows.weight );
    }
    return vatCompose( q, ts );
  }

  // Linear blend skinning: the weighted sum of slot matrices, which is the
  // blend the bake did on the CPU for the bounds and three's own
  // skinning_vertex does on the GPU. A zero weight skips its four fetches.
  //
  // The band being left is resolved once for the vertex rather than once per
  // slot, and unconditionally — two pack texels this encoding's old guard
  // skipped, against the sixteen rig fetches per vertex the guard inside
  // vatSlot still skips. At a weight of zero those two land on texels already
  // read, and every slot below skips the pose.
  mat4 vatSkinMatrix( const in int vatInstance ) {
    VatRows rows = vatRows( vatInstance );
    VatBand outgoing = vatOutgoingBand( vatInstance, rows.weight > 0.0 );
    mat4 skin = mat4( 0.0 );
    for ( int i = 0; i < 4; i ++ ) {
      float w = skinWeight[ i ];
      if ( w == 0.0 ) continue;
      skin += w * vatSlot( int( skinIndex[ i ] ), rows, outgoing );
    }
    return skin;
  }
`

/**
 * How each carrier spells this vertex's *logical* instance index, at the
 * injection point — which is the whole of what the second carrier changes.
 *
 * `gl_InstanceID` is the drawn slot and the instance at once on an
 * `InstancedMesh`. A `BatchedMesh` draws indirectly — it culls and sorts per
 * instance by default, so the drawn slot is a permutation that changes every
 * frame — and three dereferences it exactly as it does for its own matrices:
 * `getIndirectIndex( gl_DrawID )`, declared by `batching_pars_vertex` and in
 * scope here because `batching_vertex` is expanded before both injection
 * points in every material this patches.
 */
const INSTANCE_ID = {
  instance: 'gl_InstanceID',
  batch: 'int( getIndirectIndex( gl_DrawID ) )',
} as const

type InstanceIdSource = keyof typeof INSTANCE_ID

const vertexPosition = (id: InstanceIdSource) => /* glsl */ `
  vec3 transformed = position + vatSample( uVatPosTex, ${INSTANCE_ID[id]} );
`

const vertexNormal = (id: InstanceIdSource) => /* glsl */ `
  vec3 objectNormal = normalize( vatSampleNormal( ${INSTANCE_ID[id]} ) );
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`

// Each injection point resolves the skin matrix for itself, under its own name
// (ADR-0006): the normal's may sit inside MeshDepthMaterial's dead block, and
// the position's must not depend on it.
const rigPosition = (id: InstanceIdSource) => /* glsl */ `
  mat4 vatSkin = vatSkinMatrix( ${INSTANCE_ID[id]} );
  vec3 transformed = ( vatSkin * vec4( position, 1.0 ) ).xyz;
`

// Normal and tangent through the skin matrix, as three's `skinnormal_vertex`
// takes them: the matrix itself rather than its inverse-transpose, exact for
// the rigid and uniformly scaled slots this encoding stores.
const rigNormal = (id: InstanceIdSource) => /* glsl */ `
  mat4 vatSkinN = vatSkinMatrix( ${INSTANCE_ID[id]} );
  vec3 objectNormal = normalize( mat3( vatSkinN ) * normal );
  #ifdef USE_TANGENT
    vec3 objectTangent = normalize( mat3( vatSkinN ) * tangent.xyz );
  #endif
`

/**
 * What one encoding contributes to a patched material: the GLSL ahead of
 * three's shader, the uniforms it binds, what stands at each of the two
 * injection points, and the program key that keeps its compiled program its
 * own. The row arithmetic is not in here — it is the prelude both share.
 *
 * `position` and `normal` are the GLSL that *replaces* three's own chunk, not
 * the replacement itself: the post-decode hook is appended to each of them
 * (ADR-0021), so the composition happens once, in {@link injectVAT}, rather
 * than once per encoding. A `normal` of `null` is an encoding that leaves
 * three's `beginnormal_vertex` where it is — the caller's chunk still follows
 * it, because a hook is not a property of what the bake stored.
 */
interface EncodingDecode {
  prelude: string
  bind(uniforms: Record<string, IUniform>): void
  position: string
  normal: string | null
  key: string
  /**
   * How this carrier spells the logical instance index, for the hook to declare
   * at both points. Carried here rather than passed beside a decode that was
   * built from it — the two always travelled together.
   */
  instanceIndex: string
}

function vertexDecode({ positionTexture, normalTexture }: DeltaVAT, id: InstanceIdSource): EncodingDecode {
  return {
    prelude: (normalTexture ? NORMAL_PRELUDE : '') + VERTEX_PRELUDE,
    bind(uniforms) {
      uniforms.uVatPosTex = { value: positionTexture }
      if (normalTexture) uniforms.uVatNrmTex = { value: normalTexture }
    },
    position: vertexPosition(id),
    // No normal texture, no normal decode, and no uniform bound for one: the
    // material either does not read a normal or derives it from the deformed
    // position itself (`flatShading`), so three's own `beginnormal_vertex` is
    // left exactly where it is.
    normal: normalTexture ? vertexNormal(id) : null,
    // A normal-less VAT injects a different vertex shader off the same material
    // parameters, so the variant is in the key (see `patchVATMaterial`).
    key: `three-vat:${id}${normalTexture ? '' : ':no-normal'}`,
    instanceIndex: INSTANCE_ID[id],
  }
}

function rigDecode({ rigTexture }: RigVAT, id: InstanceIdSource): EncodingDecode {
  return {
    prelude: RIG_PRELUDE,
    bind(uniforms) {
      uniforms.uVatRigTex = { value: rigTexture }
    },
    position: rigPosition(id),
    normal: rigNormal(id),
    key: `three-vat:rig:${id}`,
    instanceIndex: INSTANCE_ID[id],
  }
}

/**
 * The caller's own GLSL, run after the decode has posed the vertex (ADR-0021):
 * a wind sway, a twist toward a target, a per-instance squash — deformation
 * that is the scene's and never the library's. The WebGL path's answer to what
 * `positionNode` already gives the TSL path, which needs none of this.
 *
 * It has **two** injection points because three expands `beginnormal_vertex`
 * *before* `begin_vertex` and derives `transformedNormal` between them: a chunk
 * that only moves the position cannot repair a normal that was already taken,
 * and the crowd would shade as though it had never moved. One point is a hook
 * that looks right in the viewport and is wrong in the light.
 *
 * ```ts
 * const hook = {
 *   key: 'twist',
 *   uniforms: { uTarget: { value: new Vector3() } },
 *   prelude: `
 *     uniform vec3 uTarget;
 *     vec3 twistY( vec3 p, float a ) {
 *       float s = sin( a ), c = cos( a );
 *       return vec3( c * p.x + s * p.z, p.y, -s * p.x + c * p.z );
 *     }`,
 *   position: 'transformed = twistY( transformed, vatTwistAngle( vatInstanceIndex ) );',
 *   normal: 'objectNormal = twistY( objectNormal, vatTwistAngle( vatInstanceIndex ) );',
 * }
 * const { mesh } = createVATMesh(vat, instances, { hook })
 * ```
 */
export interface VATPostDecodeHook {
  /**
   * What tells this hook's compiled program from another's. Required, and
   * folded into the library's own key rather than replacing it: without it two
   * crowds whose materials are identical in every parameter three looks at
   * share one program, and one of them renders the other's GLSL (ADR-0006).
   */
  key: string
  /**
   * GLSL emitted ahead of three's shader — helper functions, the `uniform`
   * declarations {@link uniforms} binds. Not an injection point, so ADR-0006
   * does not govern it: this is where a helper the two chunks share is declared
   * once.
   */
  prelude?: string
  /**
   * The chunk run where three takes the position, with `transformed` in object
   * space and already posed by the decode. Assign to it.
   */
  position?: string
  /**
   * The chunk run where three takes the normal, with `objectNormal` already
   * posed. Assign to it — otherwise a deformed crowd shades undeformed.
   */
  normal?: string
  /** Uniforms bound beside the library's own, so the chunks can be driven by your game state. */
  uniforms?: Record<string, IUniform>
}

/**
 * What {@link patchVATMaterial} and {@link createVATDepthMaterial} take in
 * place of a bare carrier — so a batched crowd with a hook passes one object
 * rather than a positional carrier plus something else.
 */
export interface VATPatchOptions {
  /** The mesh this material will draw on. Means exactly what the bare argument means. */
  carrier?: VATCarrier
  /** The caller's own GLSL, after the decode. */
  hook?: VATPostDecodeHook
}

/**
 * The fifth argument, either way it was passed. A carrier is an `Object3D` and
 * an options object is not, so the two are told apart at runtime and every call
 * written against the carrier-only signature keeps compiling and behaving.
 */
function patchOptionsOf(fifth?: VATCarrier | VATPatchOptions): VATPatchOptions {
  if (!fifth) return {}
  return (fifth as Object3D).isObject3D ? { carrier: fifth as VATCarrier } : (fifth as VATPatchOptions)
}

/**
 * Refuse a hook that cannot do what a hook is for, at the patch rather than in
 * a WebGL log — or, for the keyless case, nowhere at all.
 */
function assertHook(hook: VATPostDecodeHook): void {
  if (!hook.key.trim()) {
    throw new Error(
      'three-vat: a post-decode hook needs a non-empty `key`. It is folded into the library’s own ' +
        'program cache key, and two hooks that fold in nothing share a compiled program — so one ' +
        'crowd renders the other’s GLSL.',
    )
  }
  if (!hook.position && !hook.normal) {
    throw new Error(
      'three-vat: a post-decode hook with neither `position` nor `normal` injects nothing. ' +
        'Give it the chunk you meant — `position` deforms the posed vertex, `normal` repairs the ' +
        'normal that was taken before it, and a deformation wants both.',
    )
  }
}

/**
 * One hook chunk, at one injection point.
 *
 * In its own block for two reasons. `vatInstanceIndex` is declared at *both*
 * points, because each point has to stand alone (ADR-0006) and the caller
 * cannot spell it themselves — and two declarations of one name at one scope
 * would not compile. And a chunk's own locals then cannot collide with the
 * decode's, or with the other point's. `transformed` and `objectNormal` are
 * declared outside it, so a chunk still assigns to the real ones.
 */
const hookChunk = (chunk: string | undefined, instanceIndex: string) =>
  chunk
    ? /* glsl */ `
  {
    int vatInstanceIndex = ${instanceIndex};
${chunk}
  }
`
    : ''

/**
 * Compose one vertex shader: the decode at each of three's two chunks, and the
 * caller's own GLSL after it.
 *
 * Replaced through a function rather than a replacement string, because a
 * caller's chunk is not the library's own text and `$&` in it would otherwise
 * be a substitution pattern rather than two characters of GLSL.
 */
function injectVAT(vertexShader: string, decode: EncodingDecode, hook: VATPostDecodeHook | undefined): string {
  const position = decode.position + hookChunk(hook?.position, decode.instanceIndex)
  // An encoding that decodes no normal leaves three's own chunk where it is —
  // and the hook still follows it, because whether a caller deforms is not a
  // property of what the bake stored.
  const normal = (decode.normal ?? '#include <beginnormal_vertex>') + hookChunk(hook?.normal, decode.instanceIndex)
  return vertexShader
    .replace('#include <begin_vertex>', () => position)
    .replace('#include <beginnormal_vertex>', () => normal)
}

/**
 * Every `onBeforeCompile` this module has assigned, so a second patch of one
 * material replaces the first rather than chaining onto it. A `WeakSet` because
 * the entry must not outlive the material that holds the function.
 */
const VAT_PATCHES = new WeakSet<object>()

/** Was this `onBeforeCompile` put here by three, or by us? Either way, not the caller's. */
const ours = (onBeforeCompile: Material['onBeforeCompile']): boolean =>
  onBeforeCompile === Material.prototype.onBeforeCompile || VAT_PATCHES.has(onBeforeCompile)

/**
 * The decode for a VAT's encoding, narrowed on `encoding` before a texture is
 * read (ADR-0018). A third encoding is a compile error at the `never` below,
 * never a silent sample of a texture the VAT does not have.
 */
function decodeFor(vat: VAT, id: InstanceIdSource): EncodingDecode {
  switch (vat.encoding) {
    case 'delta':
      return vertexDecode(vat, id)
    case 'rig':
      return rigDecode(vat, id)
    default: {
      const unhandled: never = vat
      throw new Error(
        `three-vat: patchVATMaterial has no decode for encoding "${String((unhandled as VAT).encoding)}"`,
      )
    }
  }
}

/**
 * Patch any built-in material so its vertex stage samples the VAT instead of
 * skinning. Works on the render material and on `MeshDepthMaterial` (needed for
 * instanced shadows — see {@link createVATDepthMaterial}). Mutates and returns
 * the material.
 *
 * `playback` is the crowd's playback texture — the decode reads the pack out of
 * it by this instance's logical index, so a material patched for one crowd
 * renders that crowd's playback and no other's.
 *
 * `carrier` is the mesh this material will draw on, and it is needed for one
 * reason: how the shader names that logical index. Omit it for an
 * `InstancedMesh`, where the index is `gl_InstanceID`. Pass a `BatchedMesh` and
 * the decode resolves the index through `getIndirectIndex( gl_DrawID )`
 * instead, because that carrier culls and sorts per instance and its drawn slot
 * is a permutation that changes every frame (ADR-0016). A batch a VAT cannot be
 * decoded on is refused here rather than rendered wrong.
 *
 * That fifth argument also takes a {@link VATPatchOptions} object, which is how
 * a {@link VATPostDecodeHook} is passed — the caller's own GLSL after the
 * decode, and the carrier beside it in one object.
 */
export function patchVATMaterial<T extends Material>(
  material: T,
  vat: VAT,
  uniforms: VATUniforms,
  playback: VATPlaybackTexture,
  options?: VATCarrier | VATPatchOptions,
): T {
  const { carrier, hook } = patchOptionsOf(options)
  // A normal-less VAT under a material that shades from a normal is refused
  // here, before a single frame renders it by the rest pose.
  assertBakedNormal(vat, material)
  // And a batch holding anything but this VAT's single geometry, for the same
  // reason and at the same moment.
  if (carrier) assertVATCarrier(carrier, vat)
  // And a hook that injects nothing, or that folds nothing into the key.
  if (hook) assertHook(hook)
  const id: InstanceIdSource = isBatchedCarrier(carrier) ? 'batch' : 'instance'
  // Narrowed on the encoding before a texture is read (ADR-0018): each
  // encoding samples its own layers behind the one shared row arithmetic.
  const decode = decodeFor(vat, id)

  // Chained rather than assigned, as `guardCarrierMismatch` chains
  // `onBeforeRender`: a caller's own patch used to be overwritten silently, and
  // now it runs. First, against three's own shader — which is what it was
  // written against, and which still carries the two chunks the decode replaces.
  // The chaining is a net; the hook is the supported seam.
  //
  // A *previous patch of ours* is not chained but replaced, which is what
  // assigning outright always did. Chaining one would emit the preludes twice
  // and leave the second decode with no `#include <begin_vertex>` left to
  // replace — a material patched twice would compile duplicate functions and
  // decode by the first patch's VAT.
  const previous = ours(material.onBeforeCompile) ? null : material.onBeforeCompile.bind(material)

  const patch: Material['onBeforeCompile'] = (shader, renderer) => {
    previous?.(shader, renderer)
    // The caller's uniforms first, the library's after, so a name collision
    // cannot leave the decode reading something else.
    if (hook?.uniforms) Object.assign(shader.uniforms, hook.uniforms)
    shader.uniforms.uVatPlaybackTex = { value: playback.texture }
    shader.uniforms.uVatTime = uniforms.uVatTime
    decode.bind(shader.uniforms)
    shader.vertexShader =
      ROW_PRELUDE +
      decode.prelude +
      // Ahead of three's shader, where a declaration is safe from a dead block.
      (hook?.prelude ? `\n${hook.prelude}\n` : '') +
      injectVAT(shader.vertexShader, decode, hook)
  }
  material.onBeforeCompile = patch
  VAT_PATCHES.add(patch)
  // Distinct cache key so patched materials never share a compiled program with
  // unpatched ones (see ADR-0006) — and so the *variants of the patch* never
  // share one either. A normal-less VAT, or a rig-encoded one, injects a
  // different vertex shader off the same material parameters, and the shadow
  // materials have nothing else to tell them apart: `createVATDepthMaterial`
  // builds the identical `MeshDepthMaterial({ depthPacking })` for every kind
  // of VAT, so one key would hand the second crowd the first's compiled
  // program. The carrier is in the key for the same reason — the two spell the
  // instance index differently, and three's own `USE_BATCHING` define is not in
  // scope when a program is reused across objects. A hook's key is *folded into*
  // this rather than replacing it, so a caller cannot collapse the library's own
  // variants by naming two crowds the same thing.
  const key = hook ? `${decode.key}+${hook.key}` : decode.key
  material.customProgramCacheKey = () => key
  guardCarrierMismatch(material, id)
  return material
}

/**
 * Catch the one mistake this parameter being optional makes possible: patching
 * for the default carrier and then drawing on a `BatchedMesh`.
 *
 * It is worth a guard because of how completely it fails and how quietly. A
 * batch is multi-drawn, not instanced, so `gl_InstanceID` is `0` for every
 * vertex of every instance — the whole crowd plays instance 0's clip, in
 * lockstep, with nothing in the picture to say the pack was misread rather than
 * written that way. The reverse mistake is just as silent: `getIndirectIndex`
 * is declared inside `#ifdef USE_BATCHING`, so a batch-patched material on an
 * `InstancedMesh` fails to compile, which at least says *something* — but it
 * says it in a WebGL log and not in these terms.
 *
 * The TSL path needs no twin. There, omitting the carrier does not merely
 * misread the pack, it adds the delta in the carrier's space, and a crowd whose
 * limbs stretch according to each instance's own matrix announces itself.
 *
 * Chained rather than assigned, so a caller's own `onBeforeRender` survives,
 * and it throws once per material: the render loop would otherwise raise the
 * same error sixty times a second.
 */
function guardCarrierMismatch(material: Material, id: InstanceIdSource): void {
  const previous = material.onBeforeRender.bind(material)
  let checked = false
  material.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
    if (!checked) {
      checked = true
      const drawnOn: InstanceIdSource = isBatchedCarrier(object as VATCarrier) ? 'batch' : 'instance'
      if (drawnOn !== id) {
        throw new Error(
          `three-vat: this material was patched for ${CARRIER_NAME[id]} and is being drawn on ` +
            `${CARRIER_NAME[drawnOn]}. Pass the carrier as \`patchVATMaterial\`'s fifth argument ` +
            '— the two spell the instance index differently, and a batch drawn with the ' +
            'instanced spelling plays instance 0’s clip on every instance.',
        )
      }
    }
    previous(renderer, scene, camera, geometry, object, group)
  }
}

/** How the error above names each carrier. */
const CARRIER_NAME: Record<InstanceIdSource, string> = {
  instance: 'an InstancedMesh',
  batch: 'a BatchedMesh',
}

/**
 * Build the `customDepthMaterial` a VAT crowd needs so it casts
 * correctly-deformed shadows instead of bind-pose shadows. Assign the result to
 * `mesh.customDepthMaterial` (and, for point lights, mirror with a patched
 * `MeshDistanceMaterial`).
 *
 * The fourth argument means what it means in {@link patchVATMaterial}: omit it
 * for an `InstancedMesh`, pass the `BatchedMesh` for a batched crowd, so the
 * shadow pass resolves the same instance index the render pass does — or pass
 * the options object, so a hand-wired crowd's shadow deforms with the hook its
 * render material carries. A deformed crowd casting an undeformed shadow is
 * exactly the class of mistake this library exists to take off the caller.
 */
export function createVATDepthMaterial(
  vat: VAT,
  uniforms: VATUniforms,
  playback: VATPlaybackTexture,
  options?: VATCarrier | VATPatchOptions,
): MeshDepthMaterial {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  patchVATMaterial(depth, vat, uniforms, playback, options)
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
  /**
   * Your own GLSL after the decode (ADR-0021), threaded to every material this
   * crowd draws with — the render materials, the depth material and the
   * distance material. Threaded here rather than applied by hand afterwards
   * because omitting one of the three is the bug: a twisted crowd casting an
   * untwisted shadow.
   */
  hook?: VATPostDecodeHook
  /**
   * The GPU's real texture ceiling — {@link getMaxTextureSize} — which the
   * playback texture checks the crowd against, one row per instance. Defaults
   * to `MAX_TEXTURE_SIZE`, a desktop figure (`VATPlaybackTextureOptions`).
   */
  maxTextureSize?: number
}

/**
 * Turn a baked VAT and a list of instances into a crowd ready to render: an
 * `InstancedMesh` rendering the bake's geometry, a playback texture carrying
 * the instance-playback contract, materials that decode the VAT, and shadows
 * that are deformed rather than frozen in the bind pose.
 *
 * ```ts
 * const { mesh, time, playback } = createVATMesh(vat, instances)
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
 * Everything here is the exported primitives — `createVATPlaybackTexture`,
 * {@link patchVATMaterial}, {@link createVATDepthMaterial} — composed in the one
 * order that is correct. Reach for them directly only when rendering onto
 * something other than a plain `InstancedMesh` — a `BatchedMesh`, for three's
 * own per-instance culling and sorting, being the other carrier this library
 * supports (docs/usage.md); the returned `playback` is what
 * {@link setVATInstance} writes into either way.
 */
export function createVATMesh(
  vat: VAT,
  instances: VATInstance[],
  options: CreateVATMeshOptions = {},
): VATCrowd {
  const uniforms: VATUniforms = options.time ? { uVatTime: options.time } : createVATUniforms()

  // The crowd's playback, in the texture that carries it. Built before the
  // materials, because every one of them binds it.
  const playback = createVATPlaybackTexture(instances, { maxTextureSize: options.maxTextureSize })

  // The hook, if the caller brought one, goes to every material below — and to
  // all three kinds of them, which is the whole reason it is threaded here.
  const patch: VATPatchOptions = { hook: options.hook }

  // One patched material per VAT material, never merged here (ADR-0008 — a bake
  // asked to merge flat materials has already done it, ADR-0028): a
  // three-material crowd is three draw calls, not three per instance.
  const materials = vat.materials.map((source) => patchVATMaterial(source.clone(), vat, uniforms, playback, patch))

  // The bake's own geometry, not a clone of it. The clone existed for the
  // instance-playback attributes and for nothing else (ADR-0016): with the
  // pack in a texture there is nothing per-crowd left on the geometry, so two
  // crowds over one bake share it — and its all-frames bounds, which is what
  // stops a deformed crowd culling mid-animation — and its disposal follows
  // the bake's rather than the crowd's.
  const mesh = new InstancedMesh(vat.geometry, materials, instances.length)
  // Without these the shadow passes render the undeformed bind pose — the step
  // most easily missed when wiring a VAT crowd by hand. Both are attached
  // because which one a scene needs is a property of its lights, not of the
  // crowd: directional and spot lights take the depth material, point lights
  // the distance material. Neither costs anything in a scene with no shadows.
  mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms, playback, patch)
  mesh.customDistanceMaterial = patchVATMaterial(new MeshDistanceMaterial(), vat, uniforms, playback, patch)

  return { mesh, time: uniforms.uVatTime, playback }
}
