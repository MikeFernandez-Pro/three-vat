import { InstancedMesh, MeshDepthMaterial, MeshDistanceMaterial, RGBADepthPacking } from 'three'
import type { IUniform, Material, WebGLRenderer } from 'three'
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
// it (src/instance-playback.ts), by the instance's logical index — three texels
// of one row, as three `vec4` locals with the same names and the same component
// order the attributes had in 1.x (ADR-0016).
//
// `vatRows` below is a line-for-line transcription of `resolveVATFrame`
// (src/instance-playback.ts), which is the one definition of what a loop mode
// means. Change the semantics there, not here — and the mode constants are
// interpolated from that module rather than retyped, so a renumbered `LoopMode`
// cannot leave this shader comparing against the old number.
//
// It is the half of the decode both encodings share, verbatim (ADR-0018): which
// rows of its band an instance is between and how far, and the frozen row the
// pose-freeze fade blends in. What a row *holds* — a vertex's delta, or a slot
// of the posed rig — is each encoding's own prelude, below.
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

  // Where an instance is reading: the two rows of its band it sits between and
  // the blend toward the second; and the pose-freeze fade's frozen row and
  // weight, a weight of zero being "not fading".
  struct VatRows {
    int row0;
    int row1;
    float blend;
    int fadeRow;
    float fadeWeight;
  };

  VatRows vatRows( const in int vatInstance ) {
    // The pack, fetched by this instance's *logical* index rather than read
    // off an attribute indexed by the drawn slot (ADR-0016). Three texels of
    // one row, in the order src/instance-playback.ts lays them out; the
    // arithmetic below is untouched by where they came from, because the pack
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
    // normal decode. Every vertex of an instance reads the same three texels,
    // so the texture cache absorbs them; the 5% demo bench is what says so.
    vec4 vatClip     = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.clip}, vatInstance ), 0 );
    vec4 vatPlayback = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.playback}, vatInstance ), 0 );
    vec4 vatFade     = texelFetch( uVatPlaybackTex, ivec2( ${PACK_TEXELS.fade}, vatInstance ), 0 );

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
      float m = mod( loops, 2.0 );
      phase = m < 1.0 ? m : 2.0 - m;
      wraps = false; // a ping-pong bounces; it does not wrap
    } else {
      phase = fract( loops );
      wraps = true;  // and here the interpolation crossing back is correct
    }

    float f = phase * ( wraps ? frames : last );
    float f0 = min( floor( f ), last );
    float f1 = wraps ? mod( f0 + 1.0, frames ) : min( f0 + 1.0, last );

    VatRows rows;
    rows.row0 = int( vatClip.x + f0 );
    rows.row1 = int( vatClip.x + f1 );
    rows.blend = f - f0;

    // The pose-freeze fade, transcribed from the same resolver: one frozen row
    // of the clip this instance was playing when it changed, blended away over
    // vatFade.w. Wall clock, not clip time — the incoming clip's speed does
    // not stretch a fade. A duration of zero is what "not fading" is, and the
    // pack never writes one without a band to go with it.
    rows.fadeRow = 0;
    rows.fadeWeight = 0.0;
    if ( vatFade.w > 0.0 ) {
      float weight = 1.0 - clamp( ( uVatTime - vatPlayback.x ) / vatFade.w, 0.0, 1.0 );
      float fromRow = max( min( floor( vatFade.z * vatFade.y ), vatFade.y - 1.0 ), 0.0 );
      rows.fadeRow = int( vatFade.x + fromRow );
      rows.fadeWeight = weight;
    }
    return rows;
  }
`

/**
 * The vertex encoding's sampler: a row holds where this vertex ended up, so
 * the decode is two fetches at `x = gl_VertexID` and a mix — the same function
 * for the position layer and the normal layer, each injection point calling it
 * for itself.
 */
const VERTEX_PRELUDE = /* glsl */ `
  uniform highp sampler2D uVatPosTex;
  vec3 vatSample( const in sampler2D tex, const in int vatInstance ) {
    VatRows rows = vatRows( vatInstance );
    vec3 s0 = texelFetch( tex, ivec2( gl_VertexID, rows.row0 ), 0 ).xyz;
    vec3 s1 = texelFetch( tex, ivec2( gl_VertexID, rows.row1 ), 0 ).xyz;
    vec3 sampled = mix( s0, s1, rows.blend );
    // The frozen row, blended in by the weight the rows resolved.
    float weight = rows.fadeWeight;
    if ( weight > 0.0 ) {
      vec3 frozen = texelFetch( tex, ivec2( gl_VertexID, rows.fadeRow ), 0 ).xyz;
      sampled = mix( sampled, frozen, weight );
    }
    return sampled;
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

  // One slot's matrix between the two rows the instance sits between — and
  // through the fade, blended before it is composed.
  mat4 vatSlot( const in int slot, const in VatRows rows ) {
    int rotation = slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.rotation};
    int placement = slot * ${RIG_TEXELS_PER_SLOT} + ${RIG_TEXELS.placement};
    vec4 q0 = texelFetch( uVatRigTex, ivec2( rotation, rows.row0 ), 0 );
    vec4 ts0 = texelFetch( uVatRigTex, ivec2( placement, rows.row0 ), 0 );
    vec4 q1 = texelFetch( uVatRigTex, ivec2( rotation, rows.row1 ), 0 );
    vec4 ts1 = texelFetch( uVatRigTex, ivec2( placement, rows.row1 ), 0 );
    // The bake keeps consecutive rows on one hemisphere, but a looping clip
    // blends its band's last row into its first, and a bone that turned a full
    // circle over the clip arrives there on the far side: one dot product per
    // slot, or the blend passes through zero on the wrap frame.
    if ( dot( q0, q1 ) < 0.0 ) q1 = -q1;
    // A normalised lerp, not a slerp: at a bake's frame step the angular error
    // against a true slerp is far below anything visible. It is still a
    // *rotation* at every blend, which is what a componentwise matrix lerp is
    // not — that one shortens a limb as it turns (ADR-0018).
    vec4 q = normalize( mix( q0, q1, rows.blend ) );
    vec4 ts = mix( ts0, ts1, rows.blend );
    if ( rows.fadeWeight > 0.0 ) {
      vec4 qf = texelFetch( uVatRigTex, ivec2( rotation, rows.fadeRow ), 0 );
      vec4 tsf = texelFetch( uVatRigTex, ivec2( placement, rows.fadeRow ), 0 );
      // The frozen row is any row of the bake, not this row's neighbour, so
      // the same check.
      if ( dot( q, qf ) < 0.0 ) qf = -qf;
      q = normalize( mix( q, qf, rows.fadeWeight ) );
      ts = mix( ts, tsf, rows.fadeWeight );
    }
    return vatCompose( q, ts );
  }

  // Linear blend skinning: the weighted sum of slot matrices, which is the
  // blend the bake did on the CPU for the bounds and three's own
  // skinning_vertex does on the GPU. A zero weight skips its four fetches.
  mat4 vatSkinMatrix( const in int vatInstance ) {
    VatRows rows = vatRows( vatInstance );
    mat4 skin = mat4( 0.0 );
    for ( int i = 0; i < 4; i ++ ) {
      float w = skinWeight[ i ];
      if ( w == 0.0 ) continue;
      skin += w * vatSlot( int( skinIndex[ i ] ), rows );
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
  vec3 objectNormal = normalize( vatSample( uVatNrmTex, ${INSTANCE_ID[id]} ) );
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
 * three's shader, the uniforms it binds, the two injections, and the program
 * key that keeps its compiled program its own. The row arithmetic is not in
 * here — it is the prelude both share.
 */
interface EncodingDecode {
  prelude: string
  bind(uniforms: Record<string, IUniform>): void
  inject(vertexShader: string): string
  key: string
}

function vertexDecode({ positionTexture, normalTexture }: DeltaVAT, id: InstanceIdSource): EncodingDecode {
  return {
    prelude: (normalTexture ? NORMAL_PRELUDE : '') + VERTEX_PRELUDE,
    bind(uniforms) {
      uniforms.uVatPosTex = { value: positionTexture }
      if (normalTexture) uniforms.uVatNrmTex = { value: normalTexture }
    },
    inject(vertexShader) {
      const positioned = vertexShader.replace('#include <begin_vertex>', vertexPosition(id))
      // No normal texture, no normal decode, and no uniform bound for one: the
      // material either does not read a normal or derives it from the deformed
      // position itself (`flatShading`), so three's own `beginnormal_vertex` is
      // left exactly where it is.
      return normalTexture ? positioned.replace('#include <beginnormal_vertex>', vertexNormal(id)) : positioned
    },
    // A normal-less VAT injects a different vertex shader off the same material
    // parameters, so the variant is in the key (see `patchVATMaterial`).
    key: `three-vat:${id}${normalTexture ? '' : ':no-normal'}`,
  }
}

function rigDecode({ rigTexture }: RigVAT, id: InstanceIdSource): EncodingDecode {
  return {
    prelude: RIG_PRELUDE,
    bind(uniforms) {
      uniforms.uVatRigTex = { value: rigTexture }
    },
    inject(vertexShader) {
      return vertexShader
        .replace('#include <begin_vertex>', rigPosition(id))
        .replace('#include <beginnormal_vertex>', rigNormal(id))
    },
    key: `three-vat:rig:${id}`,
  }
}

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
 */
export function patchVATMaterial<T extends Material>(
  material: T,
  vat: VAT,
  uniforms: VATUniforms,
  playback: VATPlaybackTexture,
  carrier?: VATCarrier,
): T {
  // A normal-less VAT under a material that shades from a normal is refused
  // here, before a single frame renders it by the rest pose.
  assertBakedNormal(vat, material)
  // And a batch holding anything but this VAT's single geometry, for the same
  // reason and at the same moment.
  if (carrier) assertVATCarrier(carrier, vat)
  const id: InstanceIdSource = isBatchedCarrier(carrier) ? 'batch' : 'instance'
  // Narrowed on the encoding before a texture is read (ADR-0018): each
  // encoding samples its own layers behind the one shared row arithmetic.
  const decode = decodeFor(vat, id)

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVatPlaybackTex = { value: playback.texture }
    shader.uniforms.uVatTime = uniforms.uVatTime
    decode.bind(shader.uniforms)
    shader.vertexShader = ROW_PRELUDE + decode.prelude + decode.inject(shader.vertexShader)
  }
  // Distinct cache key so patched materials never share a compiled program with
  // unpatched ones (see ADR-0006) — and so the *variants of the patch* never
  // share one either. A normal-less VAT, or a rig-encoded one, injects a
  // different vertex shader off the same material parameters, and the shadow
  // materials have nothing else to tell them apart: `createVATDepthMaterial`
  // builds the identical `MeshDepthMaterial({ depthPacking })` for every kind
  // of VAT, so one key would hand the second crowd the first's compiled
  // program. The carrier is in the key for the same reason — the two spell the
  // instance index differently, and three's own `USE_BATCHING` define is not in
  // scope when a program is reused across objects.
  material.customProgramCacheKey = () => decode.key
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
 * `carrier` means what it means in {@link patchVATMaterial}: omit it for an
 * `InstancedMesh`, pass the `BatchedMesh` for a batched crowd, so the shadow
 * pass resolves the same instance index the render pass does.
 */
export function createVATDepthMaterial(
  vat: VAT,
  uniforms: VATUniforms,
  playback: VATPlaybackTexture,
  carrier?: VATCarrier,
): MeshDepthMaterial {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  patchVATMaterial(depth, vat, uniforms, playback, carrier)
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
  const playback = createVATPlaybackTexture(instances)

  // One patched material per source material, never merged (ADR-0008): a
  // three-material crowd is three draw calls, not three per instance.
  const materials = vat.materials.map((source) => patchVATMaterial(source.clone(), vat, uniforms, playback))

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
  mesh.customDepthMaterial = createVATDepthMaterial(vat, uniforms, playback)
  mesh.customDistanceMaterial = patchVATMaterial(new MeshDistanceMaterial(), vat, uniforms, playback)

  return { mesh, time: uniforms.uVatTime, playback }
}
