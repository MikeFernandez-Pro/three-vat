import {
  AdditiveAnimationBlendMode,
  AnimationMixer,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataUtils,
  HalfFloatType,
  InterleavedBufferAttribute,
  LoopOnce,
  LoopPingPong,
  LoopRepeat,
  Matrix4,
  PropertyBinding,
  Quaternion,
  Sphere,
  Vector3,
  Vector4,
} from 'three'
import type {
  AnimationAction,
  AnimationClip,
  Bone,
  Material,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
} from 'three'
import {
  FORWARD_ONLY_REASON,
  INFINITE_REPETITIONS,
  LIBRARY_PLAYBACK_DEFAULTS,
  LoopMode,
} from './instance-playback.js'
// The ceiling a bake is checked against and the flags its textures carry live
// in `vat-texture.ts` rather than here, because the playback texture
// (ADR-0016) needs both and cannot import the baker without closing a cycle.
import { FLAT_MERGE, planFlatMerge } from './flat-materials.js'
import type { FlatMerge, FlatMergeHooks } from './flat-materials.js'
import { encodeOctahedral } from './octahedral.js'
import { HALF_FLOAT_MAX, makeVATNormalTexture, makeVATTexture, MAX_TEXTURE_SIZE } from './vat-texture.js'
// The rig texture's layout, shared with the decode that reads it (ADR-0018).
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import type { DeltaVAT, RigVAT, VAT, VATClip, VATClipDefaults } from './types.js'

/**
 * What {@link bakeVAT} takes for each animation: the clip itself, or an
 * `AnimationAction` already configured the way three taught you.
 *
 * An action costs the baker nothing — it builds an `AnimationMixer` to pose the
 * mesh either way — and buys the caller per-clip defaults every instance of
 * that clip inherits ({@link VATClipDefaults}).
 */
export type BakeInput = AnimationClip | AnimationAction

/**
 * A resolved bake input: the clip to sample, and the playback defaults to
 * record beside it in the clip table.
 */
interface ResolvedAnimation {
  clip: AnimationClip
  defaults: VATClipDefaults
}

/** three's loop constants, to the library's own. */
const LOOP_MODES = new Map<number, LoopMode>([
  [LoopRepeat, LoopMode.Repeat],
  [LoopOnce, LoopMode.Once],
  [LoopPingPong, LoopMode.PingPong],
])

/** An `AnimationAction` is the one of the two that can produce a clip. */
function isAction(input: BakeInput): input is AnimationAction {
  return typeof (input as AnimationAction).getClip === 'function'
}

/**
 * Resolve one bake input to its clip and its defaults.
 *
 * One rule decides what an action contributes: **read configuration, ignore
 * transport state, refuse loudly what a VAT cannot represent.**
 *
 * - `loop`, `repetitions` and `timeScale` are configuration, and land in the
 *   clip table.
 * - `clampWhenFinished` is not read: `false` is what it holds on every action
 *   three hands out, so it cannot be told apart from a caller who said nothing
 *   — and a crowd's answer to nothing is to clamp (#43, ADR-0017).
 * - `time` and `paused` are where the playhead happens to be sitting, not how
 *   the animation is meant to play, and are ignored. A VAT has no playhead of
 *   its own to seed: every instance's position is a function of the shared
 *   clock and its own `startTime`.
 * - A non-unit `weight` and an additive `blendMode` both describe *several
 *   actions blended at once*, which a VAT band cannot be. Refused here rather
 *   than silently dropped, for the reason `assertBakedNormal` already refuses:
 *   a pairing a VAT cannot honour is better met at the bake than in a frame
 *   rendered wrong. Crossfade between two baked clips is #30.
 * - A negative `timeScale` is refused for the same reason: a band is sampled
 *   forward from its own first row, so backwards is not something it can play
 *   — and the decode would hold its first row for ever instead of saying so (#45).
 *   Zero is legal, and is a held first row on purpose.
 */
function resolveAnimation(input: BakeInput): ResolvedAnimation {
  // A bare clip carries no configuration, so the simple case needs no mixer at
  // all — and takes the library's own answers, spelled once in core.
  if (!isAction(input)) return { clip: input, defaults: { ...LIBRARY_PLAYBACK_DEFAULTS } }

  const clip = input.getClip()
  const name = clip.name || '(unnamed)'
  const cannotBlend = (field: string, value: string) =>
    new Error(
      `three-vat: action for clip "${name}" has ${field} ${value}; that blends several actions at once, ` +
        'which a single baked band cannot represent — bake the clips separately and crossfade between ' +
        'them (three-vat#30), or reset the action before baking',
    )
  if (input.weight !== 1) throw cannotBlend('weight', String(input.weight))
  if (input.blendMode === AdditiveAnimationBlendMode) throw cannotBlend('blendMode', 'additive')
  if (input.timeScale < 0) {
    throw new Error(
      `three-vat: action for clip "${name}" has timeScale ${input.timeScale}; ${FORWARD_ONLY_REASON}.`,
    )
  }

  const loopMode = LOOP_MODES.get(input.loop)
  if (loopMode === undefined) {
    throw new Error(
      `three-vat: action for clip "${name}" has an unrecognised loop mode ${input.loop}; ` +
        'expected THREE.LoopRepeat, LoopOnce or LoopPingPong',
    )
  }

  return {
    clip,
    defaults: {
      loopMode,
      // three's `repetitions` defaults to Infinity and `LoopOnce` ignores it
      // outright — so a one-shot is one play whatever the field says, and an
      // endless count becomes the sentinel a Float32Array can carry.
      repetitions:
        loopMode === LoopMode.Once
          ? 1
          : Number.isFinite(input.repetitions)
            ? input.repetitions
            : INFINITE_REPETITIONS,
      // Not read off the action (see the rule above), so a bake clamps whichever
      // input it was handed. Uniform across loop modes on purpose: an instance
      // may override a repeating clip's `loopMode` to `Once` and inherit this
      // field, so there is no mode whose end mode is safely unreachable and
      // could hold a different answer. Rewind is per instance:
      // `{ ..., endMode: EndMode.Rewind }` (#43, ADR-0017).
      endMode: LIBRARY_PLAYBACK_DEFAULTS.endMode,
      speed: input.timeScale,
    },
  }
}

export interface BakeOptions {
  /** Sample rate in frames per second. Default `30`. */
  fps?: number
  /**
   * Largest texture dimension the target GPU accepts. Both VAT axes are checked
   * against it: `vertexCount` (width) and `totalFrames` (height). Defaults to
   * {@link MAX_TEXTURE_SIZE}; pass the renderer's real limit to avoid baking a
   * VAT that allocates on your desktop and fails on a phone.
   */
  maxTextureSize?: number
  /**
   * Bake the normal texture. Default `true`.
   *
   * Turning it off drops the normal layer — `verts x frames x (8 B + 2 B)`
   * becomes `x 8 B` — and is correct for exactly two material setups:
   *
   * - **Unlit** (`MeshBasicMaterial`, and its node twin), which never reads a
   *   normal, so the texture was pure waste.
   * - **`flatShading: true`**, where three derives the normal from screen-space
   *   derivatives of the *deformed* position in the fragment stage. That is the
   *   correct normal for the posed mesh, computed for free — the baked one is
   *   not merely unnecessary there, it is redundant work.
   *
   * Anything else that shades — a smooth-shaded lit material — would light the
   * crowd by its rest-pose normals, which is visibly wrong (ADR-0002). Both
   * decode paths refuse that pairing loudly rather than render it.
   *
   * Accepted and ignored under the rig encoding, which has no normal texture to
   * drop: normals come out of the skin matrix there. Refusing a no-op would
   * punish the caller who switched encodings and left their options alone.
   */
  bakeNormals?: boolean
  /**
   * What a frame row holds (ADR-0018). Default `'auto'` (ADR-0027).
   *
   * - **`'auto'`** — the rig encoding where the asset allows it, and the
   *   vertex encoding where the rig encoding refuses it. Read `vat.encoding` to
   *   learn which one a bake chose. The default since 4.0: the rig texture is
   *   two orders of magnitude smaller, bakes in milliseconds, and decodes
   *   faster where memory bandwidth is scarce, as on a phone.
   * - **`'delta'`** — the vertex encoding: where every vertex ended up, as a
   *   position delta and a normal. Source-agnostic — skinning, morph targets
   *   and node animation alike.
   * - **`'rig'`** — the rig encoding: the posed rig, one **slot** per bone as a
   *   rotation, a translation and a uniform scale, skinned in the vertex shader
   *   from the rest-pose geometry. Two orders of magnitude smaller, no vertex
   *   ceiling, and unable to store what a rig cannot express — refused at the
   *   bake by name, before a frame is sampled: a morph target whose influence a
   *   baked clip animates, or a bone (or rigid part) scaled unevenly. A morph
   *   influence no clip animates is folded into the rest pose; a rigid,
   *   node-animated part is one slot of weight one; parts reading the same
   *   bones through the same bind matrix share slots.
   */
  encoding?: 'auto' | 'delta' | 'rig'
  /**
   * Collapse materials that differ only in their flat colour into one, so the
   * crowd draws once instead of once per material (ADR-0028). Default `false`.
   *
   * A material is **flat** when it has a `color`, no texture map of any kind,
   * and `vertexColors` off. Two or more flat materials that agree on every
   * other property — type, roughness, metalness, emissive, side, opacity and
   * the rest — become one clone of the first, white, with `vertexColors` on,
   * and each part's colour moves into the merged geometry's `color` attribute.
   * A material that is not flat, or is the only one of its kind, is left
   * exactly as it was. `vat.materials` therefore holds a material you did not
   * create wherever a merge happened.
   *
   * Off by default because it is only ever right for flat-shaded assets: a
   * textured character has nothing to collapse, and merging never guesses.
   */
  mergeFlatMaterials?: boolean
}

/**
 * One source mesh in the subtree, resolved to its slice of the merged vertex
 * range plus whatever deformation sources it carries. Rigid parts carry none —
 * all their motion lives in `mesh.matrixWorld`, which is exactly the case the
 * single-mesh baker used to miss.
 */
interface Part {
  mesh: Mesh
  material: Material
  materialIndex: number
  /** Offset of this part's vertices within the merged range. */
  vertexStart: number
  vertexCount: number
  basePos: BufferAttribute
  baseNrm: BufferAttribute
  isSkinned: boolean
  skeleton: Skeleton | undefined
  /**
   * Where this part's rig writes its skin matrices each frame. Assigned by
   * {@link attachPoseBuffers}; `undefined` for a rigid or morph-only part.
   */
  pose: PosedSkeleton | undefined
  skinIndex: BufferAttribute | undefined
  skinWeight: BufferAttribute | undefined
  morphPos: BufferAttribute[] | undefined
  morphNrm: BufferAttribute[] | undefined
  morphRelative: boolean
  /**
   * The flat colour this part's material carried before a merge folded it into
   * a shared white one (`mergeFlatMaterials`), written into the merged `color`
   * attribute; `null` when no merge touched this part.
   */
  tint: Color | null
}

/**
 * How many morph targets a part's influence list drives. three drives both
 * morph attributes off one influence list, and sizes that list from whichever
 * attribute the geometry happens to declare first (`Mesh.updateMorphTargets`) —
 * so the influences, not either target array, bound the loop. A target may
 * morph the position, the normal, or both. Zero for a part with no morphs, or
 * no influence list.
 */
function morphCountOf({ mesh, morphPos, morphNrm }: Part): number {
  const influences = mesh.morphTargetInfluences
  return influences ? Math.min(influences.length, Math.max(morphPos?.length ?? 0, morphNrm?.length ?? 0)) : 0
}

/**
 * Interleaved buffers would need a different read path; reject them loudly
 * rather than silently baking garbage.
 */
function asAttribute(value: unknown, mesh: Mesh, name: string): BufferAttribute {
  if (!(value instanceof BufferAttribute)) {
    throw new Error(
      `three-vat: mesh "${mesh.name || '(unnamed)'}" has an interleaved or unsupported "${name}" attribute; ` +
        'VAT bakes plain BufferAttributes',
    )
  }
  return value
}

/**
 * Vertex normals for a geometry that ships without them, derived without
 * touching it.
 *
 * The merged rest geometry carries normals whatever the bake decides about the
 * normal *texture* — the merge needs something to transform, and a flat-shaded
 * crowd still wants a well-formed attribute behind it. But the geometry is the
 * caller's, who may still render it, and a worker bake, which copies the
 * subtree, never adds one (ADR-0026). So they are computed on a scratch
 * geometry that shares only the position and index they are derived from.
 */
function deriveNormals(position: BufferAttribute, index: BufferAttribute | null): BufferAttribute {
  const scratch = new BufferGeometry()
  scratch.setAttribute('position', position)
  scratch.setIndex(index)
  scratch.computeVertexNormals()
  return scratch.attributes.normal as BufferAttribute
}

/**
 * Collect every `Mesh` under `root`, ordered so that parts sharing a material
 * are contiguous — that ordering is what lets the merged geometry express each
 * material as a single group, and therefore a single draw call.
 */
function collectParts(root: Object3D, hooks: FlatMergeHooks | null): Part[] {
  const found: Mesh[] = []
  root.traverse((o) => {
    const mesh = o as Mesh
    if (mesh.isMesh && mesh.geometry) found.push(mesh)
  })
  if (found.length === 0) {
    throw new Error('three-vat: no Mesh found under root; nothing to bake')
  }

  // Planned over every material before any part takes an index, so the parts
  // of one merged group share one index and sort into one group below.
  const flat: FlatMerge | null = hooks
    ? planFlatMerge(
        found.flatMap((mesh) => (Array.isArray(mesh.material) ? [] : [mesh.material])),
        hooks,
      )
    : null

  const materials: Material[] = []
  const parts: Part[] = []

  for (const mesh of found) {
    if (Array.isArray(mesh.material)) {
      // GLTFLoader emits one Mesh per primitive, so this does not arise from
      // glTF. Splitting a multi-material mesh by its groups is future work.
      throw new Error(
        `three-vat: mesh "${mesh.name || '(unnamed)'}" uses a material array; ` +
          'split it into one mesh per material before baking',
      )
    }
    const geometry = mesh.geometry

    const source = mesh.material as Material
    const merged = flat?.targetOf(source)
    const material = merged?.material ?? source
    let materialIndex = materials.indexOf(material)
    if (materialIndex === -1) materialIndex = materials.push(material) - 1

    const skinned = mesh as SkinnedMesh
    const basePos = asAttribute(geometry.attributes.position, mesh, 'position')
    parts.push({
      mesh,
      material,
      materialIndex,
      vertexStart: 0, // assigned below, after material sorting
      vertexCount: geometry.attributes.position!.count,
      basePos,
      baseNrm: geometry.attributes.normal
        ? asAttribute(geometry.attributes.normal, mesh, 'normal')
        : deriveNormals(basePos, geometry.index),
      isSkinned: !!geometry.attributes.skinWeight && !!skinned.skeleton,
      skeleton: skinned.skeleton,
      pose: undefined, // assigned below, once the distinct rigs are known
      skinIndex: geometry.attributes.skinIndex as BufferAttribute | undefined,
      skinWeight: geometry.attributes.skinWeight as BufferAttribute | undefined,
      morphPos: geometry.morphAttributes.position as BufferAttribute[] | undefined,
      morphNrm: geometry.morphAttributes.normal as BufferAttribute[] | undefined,
      morphRelative: geometry.morphTargetsRelative,
      tint: merged?.tint ?? null,
    })
  }

  parts.sort((a, b) => a.materialIndex - b.materialIndex)
  let offset = 0
  for (const part of parts) {
    part.vertexStart = offset
    offset += part.vertexCount
  }
  return parts
}

/**
 * Build the merged rest-pose geometry in root space. Its `position` attribute
 * is the delta reference the shader adds to, so it must be produced by exactly
 * the transform the bake loop uses at rest.
 *
 * Skinning attributes and morph targets are deliberately dropped: the VAT
 * replaces them, and carrying them would only bloat the geometry.
 *
 * What survives is `position` and `normal` always, plus `uv`, `color` and
 * `tangent` when *every* part carries them — all-or-nothing, because a merged
 * buffer half-filled with real values and half with zeroes shades worse than
 * the attribute's absence does. Anything else a source geometry carried is
 * dropped.
 *
 * `tangent` is preserved, never computed: a bake that generated tangents for
 * parts lacking them would be inventing a UV basis the artist did not author.
 * It is also a *rest-pose* tangent — only `position` and `normal` are baked per
 * frame — so under heavy deformation the TBN's tangent lags its normal
 * slightly, which is the same approximation three's own skinning makes. A
 * mirrored part keeps the handedness it shipped with, three's own
 * `applyMatrix4` having the same blind spot.
 */
function mergeGeometry(parts: Part[], restMatrices: Matrix4[], total: number): BufferGeometry {
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)

  const want = optionalAttributes(parts)
  const uv = want.uv ? new Float32Array(total * 2) : null
  const color = want.color ? new Float32Array(total * 3) : null
  const merging = parts.some((p) => p.tint)
  const tangent = want.tangent ? new Float32Array(total * 4) : null

  const _v = new Vector3()
  const _n = new Vector3()
  const _t = new Vector3()

  parts.forEach((part, pi) => {
    const m = restMatrices[pi]!
    const geometry = part.mesh.geometry
    const start = part.vertexStart
    const srcUV = uv ? asAttribute(geometry.attributes.uv, part.mesh, 'uv') : null
    const srcColor = colorSource(part, !!color, merging)
    // Already known to be a plain vec4 `BufferAttribute` by `wantTangent`.
    const srcTangent = tangent ? (geometry.attributes.tangent as BufferAttribute) : null

    for (let v = 0; v < part.vertexCount; v++) {
      _v.fromBufferAttribute(part.basePos, v).applyMatrix4(m)
      _n.fromBufferAttribute(part.baseNrm, v).transformDirection(m)
      const o3 = (start + v) * 3
      position[o3] = _v.x
      position[o3 + 1] = _v.y
      position[o3 + 2] = _v.z
      normal[o3] = _n.x
      normal[o3 + 1] = _n.y
      normal[o3 + 2] = _n.z

      if (uv && srcUV) {
        uv[(start + v) * 2] = srcUV.getX(v)
        uv[(start + v) * 2 + 1] = srcUV.getY(v)
      }
      if (color) writeColor(color, o3, part, srcColor, v)
      if (tangent && srcTangent) {
        // Direction into root space like the normal; `w` copied across
        // untouched, exactly as three's own `BufferGeometry.applyMatrix4`
        // treats a tangent. Note this inherits three's blind spot rather than
        // fixing it: a mirrored part (negative determinant) really does flip
        // handedness, and neither three nor this flips `w` to match.
        _t.fromBufferAttribute(srcTangent, v).transformDirection(m)
        const o4 = (start + v) * 4
        tangent[o4] = _t.x
        tangent[o4 + 1] = _t.y
        tangent[o4 + 2] = _t.z
        tangent[o4 + 3] = srcTangent.getW(v)
      }
    }

  })

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(position, 3))
  merged.setAttribute('normal', new BufferAttribute(normal, 3))
  if (uv) merged.setAttribute('uv', new BufferAttribute(uv, 2))
  if (color) merged.setAttribute('color', new BufferAttribute(color, 3))
  if (tangent) merged.setAttribute('tangent', new BufferAttribute(tangent, 4))
  indexParts(merged, parts)
  return merged
}

/**
 * The colour attribute a part's merged colours are copied from — `null` for a
 * part a flat merge tinted, whose one colour replaces whatever it carried, and
 * for a part with none.
 */
function colorSource(part: Part, wanted: boolean, merging: boolean): ColorReader | null {
  const source = part.mesh.geometry.attributes.color
  if (!wanted || part.tint || !source) return null
  // Under a merge the attribute is there because of the merge, not because
  // every part had a plain one, so a part it left alone is read through the
  // interface an interleaved colour has too — refusing it would turn a bake
  // that worked with the merge off into an exception with it on (#79).
  if (merging && source instanceof InterleavedBufferAttribute) return source
  return asAttribute(source, part.mesh, 'color')
}

/** What a part's own colour is read through: a plain attribute, or under a merge an interleaved one. */
type ColorReader = Pick<BufferAttribute, 'getX' | 'getY' | 'getZ'>

/** One vertex's merged colour: the tint a flat merge left, the part's own colour, or white. */
function writeColor(out: Float32Array, o3: number, part: Part, source: ColorReader | null, v: number): void {
  if (part.tint) {
    out[o3] = part.tint.r
    out[o3 + 1] = part.tint.g
    out[o3 + 2] = part.tint.b
  } else if (source) {
    out[o3] = source.getX(v)
    out[o3 + 1] = source.getY(v)
    out[o3 + 2] = source.getZ(v)
  } else {
    out[o3] = out[o3 + 1] = out[o3 + 2] = 1
  }
}

/**
 * Which optional attributes a merge carries. All-or-nothing, and the same rule
 * under either encoding: an attribute survives only if *every* part has it,
 * because a merged buffer half-filled with real values and half with zeroes
 * shades worse than the attribute's absence does.
 *
 * `tangent` asks more of a part than `uv` and `color` do, and drops rather
 * than throws when it does not get it. A vec3 under that name is not a
 * tangent, and an interleaved one is not something this merge can read — but
 * both bake today, silently tangentless, and a bug fix that turned a working
 * bake into an exception would be the worse bug. So either one fails the
 * all-or-nothing test and the crowd renders exactly as it does now.
 */
function optionalAttributes(parts: Part[]): { uv: boolean; color: boolean; tangent: boolean } {
  return {
    uv: parts.every((p) => !!p.mesh.geometry.attributes.uv),
    // A merge writes a colour for every part it touched, so the attribute is
    // there whenever one happened; a part it did not touch keeps its own, or
    // white, which leaves an untinted material's shading as it was.
    color: parts.some((p) => p.tint) || parts.every((p) => !!p.mesh.geometry.attributes.color),
    tangent: parts.every((p) => {
      const t = p.mesh.geometry.attributes.tangent
      return t instanceof BufferAttribute && t.itemSize === 4
    }),
  }
}

/**
 * Give a merged geometry its index and its material groups — the half of a
 * merge that does not care what space the vertices are in, so both encodings
 * share it.
 *
 * Always an indexed merge: a non-indexed part just contributes a sequential
 * run, which keeps every group expressible as an index range. Parts are
 * material-sorted, so a group is extended while the material matches — one
 * group, and one draw call, per material.
 */
function indexParts(merged: BufferGeometry, parts: Part[]): void {
  const indices: number[] = []
  const groups: { start: number; count: number; materialIndex: number }[] = []

  for (const part of parts) {
    const start = part.vertexStart
    const groupStart = indices.length
    const index = part.mesh.geometry.index
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(start + index.getX(i))
    } else {
      for (let v = 0; v < part.vertexCount; v++) indices.push(start + v)
    }

    const last = groups[groups.length - 1]
    if (last && last.materialIndex === part.materialIndex) {
      last.count += indices.length - groupStart
    } else {
      groups.push({
        start: groupStart,
        count: indices.length - groupStart,
        materialIndex: part.materialIndex,
      })
    }
  }

  merged.setIndex(indices)
  for (const g of groups) merged.addGroup(g.start, g.count, g.materialIndex)
}

/**
 * Rows per clip at `fps`, and their total — the texture's height, checked
 * against the ceiling because frames are rows and hit the same cap the width
 * does. Never fewer than two rows, so a clip always has a second row to blend
 * toward. Shared by both encodings, which is what makes their clip tables
 * identical for one subtree and one clip list.
 */
function frameCountsFor(
  clips: AnimationClip[],
  fps: number,
  maxTextureSize: number,
): { frameCounts: number[]; totalFrames: number } {
  const frameCounts = clips.map((c) => Math.max(2, Math.round(c.duration * fps)))
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0)
  // Easy to exceed with many clips or a high fps before any memory limit bites.
  if (totalFrames > maxTextureSize) {
    throw new Error(
      `three-vat: totalFrames ${totalFrames} exceeds maxTextureSize ${maxTextureSize}; lower fps or bake fewer clips`,
    )
  }
  return { frameCounts, totalFrames }
}

/**
 * Bake animations into a VAT by sampling the posed subtree frame by frame on
 * the CPU.
 *
 * Each entry of `animations` is an `AnimationClip`, or an `AnimationAction`
 * already configured the way three taught you:
 *
 * ```ts
 * const action = mixer.clipAction(deathClip)
 * action.loop = THREE.LoopOnce
 *
 * const vat = bakeVAT(gltf.scene, [walkAction, action, idleClip])
 * ```
 *
 * Every instance that plays `death` then inherits "once, clamped" without the
 * caller saying so again, and may still override any of it. An action costs the
 * bake nothing — it builds an `AnimationMixer` to pose the mesh either way — and
 * a plain clip carries no configuration, so the simple case still needs no
 * mixer at all and takes the library defaults ({@link VATClipDefaults}).
 *
 * `loop`, `repetitions` and `timeScale` are read. **`clampWhenFinished` is
 * not**: it is `false` on every untouched action, so a crowd reads it as the
 * silence it usually is and clamps either way — an instance names
 * `endMode: EndMode.Rewind` to get three's behaviour back.
 * **`time` and `paused` are ignored**: they say where a playhead is sitting,
 * not how the animation is meant to play, and a VAT has no playhead of its own
 * to seed — every instance's position is a function of the shared clock and its
 * own `startTime`. A non-unit `weight` and an additive `blendMode` are refused
 * outright; both describe several actions blended at once, which one baked band
 * cannot be.
 *
 * The unit of a bake is the whole subtree under `root`, merged into one vertex
 * set and recorded in root space (ADR-0008) — so it handles a single
 * `SkinnedMesh`, a morph-target mesh, a hierarchy of rigid node-animated parts
 * (three.js `RobotExpressive`), or any mix of them, without the caller having
 * to classify the asset. A VAT only records *where a vertex ended up*, never
 * how it got there.
 *
 * Positions are stored as deltas from the merged rest pose; normals absolute.
 * Positions are exact for skinning, morph targets, node animation and any mix
 * of them. A normal follows the same stages its vertex does — morph targets
 * (`morphAttributes.normal`, where the asset carries them), then the skin
 * matrix, then the part matrix. Normals reproduce what three's own skinning
 * shader renders: linear blend skinning transforms a normal by the skin matrix
 * rather than its inverse-transpose, which is exact for rigid and
 * uniformly-scaled bones and an approximation for anything else. Non-uniform bone scale is where that
 * approximation becomes visible, so the bake warns once, naming the bone.
 * Renderer-agnostic — touches no WebGL/WebGPU context — so it runs identically
 * at runtime, in a Web Worker, and in Node.
 *
 * All of that is the **vertex encoding**. `encoding: 'rig'` stores the posed
 * rig instead — one slot per bone, two texels, skinned in the vertex shader
 * from the rest-pose geometry (ADR-0018) — under the same clip table and the
 * same playback contract, at a fraction of the memory; see
 * {@link BakeOptions.encoding} for what it refuses. The default is the rig
 * where the asset allows it and the vertices where it does not (ADR-0027), so
 * a bake that names no encoding returns the {@link VAT} union: narrow on
 * `vat.encoding`, or name the encoding and get the narrow member back.
 */
export function bakeVAT(
  root: Object3D,
  animations: BakeInput[],
  options: BakeOptions & { encoding: 'delta' },
): DeltaVAT
export function bakeVAT(
  root: Object3D,
  animations: BakeInput[],
  options: BakeOptions & { encoding: 'rig' },
): RigVAT
export function bakeVAT(root: Object3D, animations: BakeInput[], options?: BakeOptions): VAT
export function bakeVAT(root: Object3D, animations: BakeInput[], options: BakeOptions = {}): VAT {
  return bakeVATWith(root, animations, options, FLAT_MERGE)
}

/**
 * {@link bakeVAT}, with the flat merge's reads handed in. Internal: a worker
 * bakes against stand-in materials, so it reads the facts the page sent and
 * builds stand-ins for the merged ones (ADR-0026, ADR-0028). One bake either
 * way — this is the body, and `bakeVAT` is this with the page's own reads.
 */
export function bakeVATWith(root: Object3D, animations: BakeInput[], options: BakeOptions, hooks: FlatMergeHooks): VAT {
  const {
    fps = 30,
    maxTextureSize = MAX_TEXTURE_SIZE,
    bakeNormals = true,
    encoding = 'auto',
    mergeFlatMaterials = false,
  } = options

  // Before anything else: a refusal is a configuration check, and baking a real
  // character is seconds of work to then throw away.
  const resolved = animations.map(resolveAnimation)
  const clips = resolved.map((a) => a.clip)

  // Rest pose first: the delta reference must be captured before any action
  // plays, or every delta is measured against an already-animated pose.
  root.updateMatrixWorld(true)
  const parts = collectParts(root, mergeFlatMaterials ? hooks : null)

  // The two encodings part here, once the subtree is collected and before
  // either has sized a texture: what a row holds is the whole difference, and
  // it decides which axis is checked against the ceiling.
  if (encoding === 'rig') return bakeRig(root, parts, resolved, { fps, maxTextureSize })
  if (encoding === 'auto') {
    // The default (ADR-0027): the rig where the asset allows it, because it is
    // two orders of magnitude smaller and the faster decode where memory is
    // the bottleneck; the vertices where it does not. What falls back is only
    // what the rig encoding refuses — the rest pose is restored before the
    // vertex bake below reads it.
    try {
      return bakeRig(root, parts, resolved, { fps, maxTextureSize })
    } catch (error) {
      if (!(error instanceof RigRefusal)) throw error
    }
  }

  const vertexCount = parts.reduce((n, p) => n + p.vertexCount, 0)
  if (vertexCount > maxTextureSize) {
    throw new Error(
      `three-vat: vertexCount ${vertexCount} exceeds maxTextureSize ${maxTextureSize}; row wrapping is not implemented`,
    )
  }
  // Frames are texture *rows*, so they hit the same cap as vertices.
  const { frameCounts, totalFrames } = frameCountsFor(clips, fps, maxTextureSize)

  // Every part's transform is taken relative to root, so the baked VAT is
  // independent of where the subtree happens to sit in the world.
  const rootInverse = root.matrixWorld.clone().invert()
  const restMatrices = parts.map((p) =>
    new Matrix4().multiplyMatrices(rootInverse, p.mesh.matrixWorld),
  )
  const geometry = mergeGeometry(parts, restMatrices, vertexCount)
  const mergedBase = geometry.attributes.position as BufferAttribute

  // Eight bytes a texel, half-float (#73): a delta's error under it is 0.061%
  // of the delta itself and zero at the rest pose, which is what storing
  // deltas rather than positions buys. What it costs is range — see
  // {@link HALF_FLOAT_MAX} and the check in the vertex loop below.
  const posData = new Uint16Array(vertexCount * totalFrames * 4)
  // Two bytes a texel, octahedral (`src/octahedral.ts`, #29) — an eighth of
  // what an RGBA float normal cost, a quarter of what the position layer beside
  // it now costs, and allocated only when something will read it.
  const nrmData = bakeNormals ? new Uint8Array(vertexCount * totalFrames * 2) : null
  // Hoisted out of the per-vertex loop below, where it gates the normal's own
  // three stages. Skipping the write alone would still pay for the morph
  // accumulation and the two `transformDirection` calls per vertex per frame,
  // which is most of what the option is meant to stop doing.
  const bakeNormal = nrmData !== null

  const mixer = new AnimationMixer(root)
  const bounds = new Box3()
  const clipTable: VATClip[] = []

  const _si = new Vector4()
  const _sw = new Vector4()
  const _acc = new Matrix4()
  const _skin = new Matrix4()
  const _partMatrix = new Matrix4()
  const _p = new Vector3()
  const _bp = new Vector3()
  const _n = new Vector3()
  const _mt = new Vector3()
  const _mb = new Vector3()
  const _mbn = new Vector3()

  // One posed skeleton per *distinct* rig in the subtree. Both the vertex loop
  // and the scale warning below read their bones from these, and nowhere else.
  const poses = attachPoseBuffers(parts)

  // Normals are the only casualty of non-uniform bone scale, and the bake is
  // still usable — so warn, once per bake, rather than throwing or repeating.
  // Silent under `bakeNormals: false`, and correctly so: positions are exact
  // under any rig, and the material either ignores normals or derives them from
  // those exact deformed positions — so nothing approximate survives to warn
  // about.
  const influencers = bakeNormals
    ? parts.filter((p) => p.pose).map(influencedBones)
    : []
  let warnedNonUniformScale = false

  let rowOffset = 0
  // Whatever leaves this loop — the last row, or a refusal a row reaches —
  // leaves the subtree at rest: stopping the actions hands every binding its
  // original value back, so a bake that throws does not strand the pose it
  // was sampling, and a second bake of the same subtree starts from rest.
  try {
    clips.forEach((clip, ci) => {
      const frames = frameCounts[ci] as number
      const action = mixer.clipAction(clip)
      action.play()
      let maxDeltaSq = 0

      for (let f = 0; f < frames; f++) {
        mixer.setTime((f / frames) * clip.duration)
        root.updateMatrixWorld(true)
        const row = rowOffset + f

        // The frame's skinning, resolved once: one matrix multiply per bone, for
        // every bone in the rig. The per-vertex loop below then only *reads* it.
        // On Soldier that is 49 multiplies a frame where it used to be one per
        // vertex per non-zero weight — about 30 000 — for the same 49 answers.
        // Costs nothing on a rigid or morph-only subtree, which has no skeleton
        // to pose and so no entry here.
        poseSkeletons(poses)

        // Bone scale is animated, so this has to be re-checked every frame — but
        // it reads one matrix per *bone*, against thousands per vertex below.
        if (!warnedNonUniformScale) {
          warnedNonUniformScale = warnOnNonUniformBoneScale(influencers)
        }

        for (const part of parts) {
          // The part's posed placement in root space. For a rigid node-animated
          // part this matrix *is* the whole animation.
          _partMatrix.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
          const influences = part.mesh.morphTargetInfluences
          const { morphPos, morphNrm, morphRelative, isSkinned, skinIndex, skinWeight } = part
          // The frame's skin matrices for this part's rig — the whole of what the
          // skinning branch below reads. Undefined for a rigid or morph-only part.
          const boneMatrices = part.pose?.matrices
          const morphCount = morphCountOf(part)

          for (let v = 0; v < part.vertexCount; v++) {
            const vi = part.vertexStart + v
            _p.fromBufferAttribute(part.basePos, v)
            if (bakeNormal) _n.fromBufferAttribute(part.baseNrm, v)

            // Morph targets: accumulate weighted deltas onto the position and,
            // where the asset carries normal targets, onto the normal too —
            // three's `morphnormal_vertex` does exactly this under
            // USE_MORPHNORMALS. Applied first, so skinning transforms the
            // already-morphed vertex and normal, as in three.
            if (influences && morphCount > 0) {
              // An absolute target contributes `w * (target - base)`, and `base`
              // is the *unmorphed* vertex for every target — `_p` and `_n` are
              // already accumulating, so they cannot stand in for it.
              if (!morphRelative) {
                _mb.fromBufferAttribute(part.basePos, v)
                if (bakeNormal) _mbn.fromBufferAttribute(part.baseNrm, v)
              }
              for (let t = 0; t < morphCount; t++) {
                const w = influences[t]!
                if (w === 0) continue
                const targetPos = morphPos?.[t]
                if (targetPos) {
                  _mt.fromBufferAttribute(targetPos, v)
                  if (!morphRelative) _mt.sub(_mb)
                  _p.addScaledVector(_mt, w)
                }
                const targetNrm = bakeNormal ? morphNrm?.[t] : undefined
                if (targetNrm) {
                  _mt.fromBufferAttribute(targetNrm, v)
                  if (!morphRelative) _mt.sub(_mbn)
                  _n.addScaledVector(_mt, w)
                }
              }
            }

            // Blended skin matrix, same math as SkinnedMesh.applyBoneTransform:
            // sum(w_i * boneWorld_i * boneInverse_i), wrapped in bind space.
            // Normals use the skin matrix directly — three's `skinnormal_vertex`
            // does the same (blended rigid transforms, no inverse-transpose).
            if (isSkinned && boneMatrices) {
              const skinned = part.mesh as SkinnedMesh
              _si.fromBufferAttribute(skinIndex!, v)
              _sw.fromBufferAttribute(skinWeight!, v)
              const ae = _acc.elements
              ae.fill(0)
              for (let i = 0; i < 4; i++) {
                const w = _sw.getComponent(i)
                if (w === 0) continue
                const b = _si.getComponent(i) * BONE_STRIDE
                for (let e = 0; e < 16; e++) ae[e]! += boneMatrices[b + e]! * w
              }
              _skin.multiplyMatrices(_acc, skinned.bindMatrix).premultiply(skinned.bindMatrixInverse)
              _p.applyMatrix4(_skin)
              if (bakeNormal) _n.transformDirection(_skin)
            }

            // Finally into root space. Skinning yields a position in the mesh's
            // own local space (three applies modelMatrix afterwards), so this
            // composes correctly for skinned, morphed and rigid parts alike.
            //
            // This is also where every baked normal becomes unit length, and the
            // only place it is guaranteed to: `transformDirection` normalises,
            // morph accumulation does not, and every part reaches this line —
            // so a morphed normal of any length leaves here normalised.
            _p.applyMatrix4(_partMatrix)
            if (bakeNormal) _n.transformDirection(_partMatrix)

            bounds.expandByPoint(_p)

            // The reference is the merged rest pose, so `position + delta` in the
            // shader reconstructs the posed vertex unchanged.
            _bp.fromBufferAttribute(mergedBase, vi)
            const o = (row * vertexCount + vi) * 4
            const dx = _p.x - _bp.x
            const dy = _p.y - _bp.y
            const dz = _p.z - _bp.z
            maxDeltaSq = Math.max(maxDeltaSq, dx * dx + dy * dy + dz * dz)
            // Half-float's ceiling, checked before the write and not after it:
            // `toHalfFloat` clamps anything past 65 504 and warns to the
            // console, so an unchecked bake would ship a crowd with a limb at
            // the horizon behind a log line. Precision needs no check of its own
            // — the error is relative, so it is 0.061% of whatever this holds.
            const largest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))
            if (largest > HALF_FLOAT_MAX) {
              throw new Error(
                `three-vat: position delta component ${largest} (clip "${clip.name}", frame ${f}, vertex ${vi}) exceeds the half-float limit of ${HALF_FLOAT_MAX} the position texture stores; a unit smaller than the metre is the usual cause`,
              )
            }
            posData[o] = toHalfFloat(dx)
            posData[o + 1] = toHalfFloat(dy)
            posData[o + 2] = toHalfFloat(dz)
            posData[o + 3] = HALF_ONE
            // Octahedral, into the two bytes this (vertex, frame) owns. The
            // normal reaching here is unit length — every part matrix pass
            // normalises — and the encode divides its length out regardless.
            if (bakeNormal) encodeOctahedral(_n.x, _n.y, _n.z, nrmData, (row * vertexCount + vi) * 2)
          }
        }
      }
      action.stop()
      // maxDelta: sanity signal — near-zero means the clip baked as a frozen pose.
      clipTable.push({
        name: clip.name,
        startFrame: rowOffset,
        frames,
        fps: frames / clip.duration,
        duration: clip.duration,
        maxDelta: Math.sqrt(maxDeltaSq),
        // Declared once, here, rather than repeated at every instance that plays
        // this band. An instance overrides any of them, field by field.
        ...resolved[ci]!.defaults,
      })
      rowOffset += frames
    })  } finally {
    mixer.stopAllAction()
    mixer.setTime(0)
    root.updateMatrixWorld(true)
  }

  // Union of every baked frame — the caller would otherwise have to compute it
  // to avoid instances culling mid-animation.
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  const materials: Material[] = []
  for (const part of parts) materials[part.materialIndex] = part.material

  return {
    positionTexture: makeVATTexture(posData, vertexCount, totalFrames, HalfFloatType),
    normalTexture: nrmData ? makeVATNormalTexture(nrmData, vertexCount, totalFrames) : null,
    clips: clipTable,
    bounds,
    vertexCount,
    totalFrames,
    encoding: 'delta',
    geometry,
    materials,
  }
}

/**
 * Three's own float-to-half conversion, named once so the vertex loop below
 * reads as arithmetic rather than as a static call. Three's rather than a
 * second copy of it, so what the baker writes is bit-for-bit what a caller
 * reading `DataUtils.fromHalfFloat` back gets — and so the tolerance the tests
 * state is the format's error and not the sum of two conversions.
 */
const toHalfFloat = DataUtils.toHalfFloat

/** The position texel's alpha, converted once: it is 1 at every vertex-frame. */
const HALF_ONE = /* @__PURE__ */ toHalfFloat(1)

/** Floats per bone in a {@link PosedSkeleton}, i.e. one `Matrix4`. */
const BONE_STRIDE = 16

/** Stands in for a hole in `Skeleton.bones`, exactly as three's own does. */
const IDENTITY = /* @__PURE__ */ new Matrix4()

/**
 * A rig's skin matrices — `boneWorld × boneInverse` per bone — for the frame
 * currently posed: {@link BONE_STRIDE} floats per bone, flat, indexed by
 * `boneIndex * BONE_STRIDE`.
 *
 * The same shape three keeps in `Skeleton.boneMatrices`, for the same reason:
 * the hot loop wants an offset, not an object. It is the baker's own array
 * rather than three's because `boneMatrices` is a `Float32Array`, and every
 * number upstream of a texel here is a double — rounding each bone on the way
 * into a blend that is rounded again at the texel would move texels the
 * per-vertex multiply did not.
 */
interface PosedSkeleton {
  skeleton: Skeleton
  matrices: Float64Array
}

/**
 * Give every skinned part the buffer its rig will be posed into, and hand back
 * one entry per *distinct* `Skeleton` — distinct because the meshes of one
 * character routinely share one, and posing it once per mesh would give back
 * half of what the buffer saves. (A glTF loader hands each skin its own
 * `Skeleton` over shared `Bone` nodes — Soldier's visor, RobotExpressive's
 * hands — so those pose twice; the rig encoding's slot table is what dedupes
 * them, by bone, in {@link layoutSlots}.)
 *
 * Empty for a rigid or morph-only subtree, which is how the whole mechanism
 * stays free for the parts that never had a skeleton to read.
 */
function attachPoseBuffers(parts: Part[]): PosedSkeleton[] {
  const byRig = new Map<Skeleton, PosedSkeleton>()
  for (const part of parts) {
    if (!part.isSkinned || !part.skeleton) continue
    let pose = byRig.get(part.skeleton)
    if (!pose) {
      const matrices = new Float64Array(part.skeleton.bones.length * BONE_STRIDE)
      pose = { skeleton: part.skeleton, matrices }
      byRig.set(part.skeleton, pose)
    }
    part.pose = pose
  }
  return [...byRig.values()]
}

/**
 * Recompute every skin matrix from the pose `updateMatrixWorld` just wrote —
 * the frame's whole skinning, resolved before a single vertex is looked at.
 *
 * This is `Skeleton.update()` done in double precision: one multiply per bone,
 * where the per-vertex loop used to do one per non-zero weight per vertex. The
 * identity stands in for a hole in `bones` and is still taken through that
 * bone's inverse, because that is what three does with the same hole.
 */
function poseSkeletons(poses: PosedSkeleton[]): void {
  const scratch = new Matrix4()
  for (const { skeleton, matrices } of poses) {
    const { bones, boneInverses } = skeleton
    for (let b = 0; b < bones.length; b++) {
      scratch.multiplyMatrices(bones[b]?.matrixWorld ?? IDENTITY, boneInverses[b]!)
      matrices.set(scratch.elements, b * BONE_STRIDE)
    }
  }
}

/** A posed skeleton paired with the bones some vertex is actually weighted to. */
interface Influencers {
  pose: PosedSkeleton
  /** Indices into `skeleton.bones`, deduplicated, zero-weight entries dropped. */
  bones: number[]
}

/**
 * Which of a part's bones actually move a vertex. A rig routinely carries
 * bones nothing is weighted to, and warning about those would be noise about
 * normals they cannot affect.
 */
function influencedBones(part: Part): Influencers {
  const used = new Set<number>()
  const index = part.skinIndex!
  const weight = part.skinWeight!
  for (let v = 0; v < part.vertexCount; v++) {
    for (let i = 0; i < 4; i++) {
      if (weight.getComponent(v, i) !== 0) used.add(index.getComponent(v, i))
    }
  }
  return { pose: part.pose!, bones: [...used] }
}

/**
 * Relative tolerance on squared basis lengths when judging a skin matrix
 * uniform. Loose enough to ignore float drift in an authored rig, tight enough
 * that a real squash trips it.
 */
const SCALE_UNIFORMITY_EPSILON = 1e-4

/** The upper 3×3 of a column-major `Matrix4`'s elements — its basis, without the translation. */
const MATRIX_BASIS = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const

/**
 * Does bone `b`'s skin matrix scale its three axes by different amounts?
 *
 * Reads the posed rig in place — the same sixteen floats the vertex loop
 * blends, so the warning can never be about a matrix the bake did not use.
 * Compares squared basis lengths to keep the check to multiplies.
 */
function hasNonUniformScale(matrices: Float64Array, b: number): boolean {
  const o = b * BONE_STRIDE
  return unevenSquares(
    matrices[o]! ** 2 + matrices[o + 1]! ** 2 + matrices[o + 2]! ** 2,
    matrices[o + 4]! ** 2 + matrices[o + 5]! ** 2 + matrices[o + 6]! ** 2,
    matrices[o + 8]! ** 2 + matrices[o + 9]! ** 2 + matrices[o + 10]! ** 2,
  )
}

/**
 * Does slot `b`'s matrix shear — axes of one length that are not square to each
 * other? A parent's uneven scale under a rotated child does that, and only an
 * exact tie in lengths gets past {@link hasNonUniformScale} with it; but one
 * rotation and one scale cannot store it either (#79). The cosine between two
 * axes is held to about the relative tolerance their lengths are, so its
 * square to that tolerance squared.
 */
function hasShear(matrices: Float64Array, b: number): boolean {
  const m = (i: number) => matrices[b * BONE_STRIDE + i]!
  const lengthSq = (a: number) => m(a) ** 2 + m(a + 1) ** 2 + m(a + 2) ** 2
  const dot = (a: number, c: number) => m(a) * m(c) + m(a + 1) * m(c + 1) + m(a + 2) * m(c + 2)
  const square = (a: number, c: number) => dot(a, c) ** 2 <= SCALE_UNIFORMITY_EPSILON ** 2 * lengthSq(a) * lengthSq(c)
  return !(square(0, 4) && square(0, 8) && square(4, 8))
}

/** Whether three squared axis lengths differ beyond {@link SCALE_UNIFORMITY_EPSILON}. */
function unevenSquares(x: number, y: number, z: number): boolean {
  const max = Math.max(x, y, z)
  return max - Math.min(x, y, z) > SCALE_UNIFORMITY_EPSILON * max
}

/**
 * Warn — once, and only for a bone that actually drives a vertex — that this
 * frame's pose squashes a bone unevenly. Returns whether it warned, so the
 * caller can stop checking.
 */
function warnOnNonUniformBoneScale(influencers: Influencers[]): boolean {
  for (const { pose, bones } of influencers) {
    for (const b of bones) {
      if (!hasNonUniformScale(pose.matrices, b)) continue
      console.warn(
        `three-vat: bone "${pose.skeleton.bones[b]!.name || '(unnamed)'}" animates with non-uniform scale; ` +
          'baked normals under it are approximate, because linear-blend skinning transforms a normal by ' +
          "the skin matrix rather than its inverse-transpose — the same shortcut three's own skinning " +
          'shader takes. Positions are exact.',
      )
      return true
    }
  }
  return false
}

// ------------------------------------------------------------ the rig encoding

/** What the rig bake reads out of {@link BakeOptions}: the rest means nothing under it. */
interface RigBakeOptions {
  fps: number
  maxTextureSize: number
}

/** The fix every rig refusal names. */
const USE_VERTEX_ENCODING = "bake this subtree with the vertex encoding (`encoding: 'delta'`) instead"

/**
 * What the rig encoding refuses and the vertex encoding does not: a morph a
 * clip animates, a non-uniform scale, parts that share slots moving apart, a
 * rig too wide for the texture. Its own class so the default encoding can fall
 * back on exactly these (ADR-0027) and on nothing else — a refusal both
 * encodings share, a clip too long, an action that blends, still throws.
 */
class RigRefusal extends Error {}
/**
 * One slot of the rig texture, and the parts that read it: a bone, seen
 * through one bone inverse and one bind matrix from one placement — or a
 * single rigid part, which is one slot of weight one (Houdini's *rigid VAT*,
 * and why the word is *slot* and not *bone*).
 *
 * Slots are keyed this way rather than per part (ADR-0018) because a slot is
 * the whole chain `partMatrix × bindMatrixInverse × boneWorld × boneInverse ×
 * bindMatrix`, and two parts whose chains agree term for term read one slot:
 * Soldier's body and visor, RobotExpressive's two hands, or a second geometry
 * on the same rig later. The key is the *bone*, not the `Skeleton` object
 * (amended at #54): a glTF loader builds one `Skeleton` per skin, so a visor
 * that lists two of the body's joints comes back on its own two-bone skeleton
 * over the body's own `Bone` nodes — the same `boneWorld`, the same
 * `boneInverse`, a different object. Keying on the object would give such a
 * character a slot per part per bone, which is what sharing was meant to
 * avoid. The bone inverse is in the key because it is in the chain: the same
 * bone bound from a different pose is a different slot. The placement —
 * `partMatrix × bindMatrixInverse`, where the part puts bind space in root
 * space — is in the key because a slot *carries* it: two parts placed apart
 * cannot read one slot, however alike their rig. Under three's default
 * attached bind mode that term is the identity for every part
 * (`SkinnedMesh.updateMatrixWorld` rewrites `bindMatrixInverse` from
 * `matrixWorld` each frame, which is why a skinned mesh's own node never moves
 * its vertices), so under glTF the bone, its inverse and the bind matrix are
 * the whole key; a detached-mode part carries its placement, and keys on it.
 */
interface Slot {
  /**
   * The posed skeleton the slot is composed from and the bone's index in it;
   * `undefined` for a rigid part. Where two skeletons list the bone, the first
   * part's is the one read — their skin matrices agree, that is the key.
   */
  rig: { pose: PosedSkeleton; bone: number; bindMatrix: Matrix4 } | undefined
  /** The parts reading this slot, in part order; the first one's placement composes it. */
  parts: Part[]
  /** The slot's placement at rest — what every part reading it must keep sharing. */
  restPlacement: Matrix4
}

/**
 * Where `part` puts bind space in root space this frame: `rootInverse ×
 * mesh.matrixWorld × bindMatrixInverse` for a skinned part, read live because
 * three rewrites `bindMatrixInverse` per frame in attached mode; the part
 * matrix alone for a rigid one, which has no bind space.
 */
function placementOf(part: Part, rootInverse: Matrix4, out: Matrix4): Matrix4 {
  out.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
  if (part.pose) out.multiply((part.mesh as SkinnedMesh).bindMatrixInverse)
  return out
}

/**
 * One part's place in the rig bake: the group whose slots it reads, and its
 * rest geometry in its own local space with any static morph folded in.
 */
interface RigPart {
  part: Part
  /** Bone index → slot index for a skinned part; the one slot, at `[0]`, for a rigid one. */
  slotOf: number[]
  /** Part-local rest positions, `vertexCount × 3`, morph folded. */
  position: Float32Array
  /** Part-local unit rest normals, `vertexCount × 3`, morph folded. */
  normal: Float32Array
}

/** Element-wise closeness of two matrices — the test for "one placement", "one bind matrix". */
const MATRIX_EPSILON = 1e-6

function matricesClose(a: Matrix4, b: Matrix4): boolean {
  const ae = a.elements
  const be = b.elements
  for (let e = 0; e < 16; e++) if (Math.abs(ae[e]! - be[e]!) > MATRIX_EPSILON) return false
  return true
}

/** How a refusal names a slot: the bone and the parts reading it, or the rigid part itself. */
function slotLabel(slot: Slot): string {
  const parts = slot.parts.map(partName).join(', ')
  if (!slot.rig) return `rigid part ${parts}`
  const { pose, bone } = slot.rig
  return `bone "${pose.skeleton.bones[bone]?.name || `bone ${bone}`}" of ${parts}`
}

/** The name a part goes by in a refusal. */
function partName(part: Part): string {
  return `"${part.mesh.name || '(unnamed)'}"`
}

/**
 * Does `slot` already hold this bone, read through this inverse, this bind
 * matrix and this placement — the four terms of the chain a slot stores?
 */
function slotReads(slot: Slot, bone: Bone, boneInverse: Matrix4, bindMatrix: Matrix4, placement: Matrix4): boolean {
  const { rig } = slot
  return (
    rig !== undefined &&
    rig.pose.skeleton.bones[rig.bone] === bone &&
    matricesClose(rig.pose.skeleton.boneInverses[rig.bone]!, boneInverse) &&
    matricesClose(rig.bindMatrix, bindMatrix) &&
    matricesClose(slot.restPlacement, placement)
  )
}

/**
 * Lay the slot table out, in part order and bone order: a part's bone takes
 * the slot an earlier part already reads it through ({@link slotReads}) or a
 * new one at the end; a rigid part takes a new one. So a single-part rig's
 * bone indices are its slot indices, as before, and a second part on the same
 * bones adds none. A hole in `Skeleton.bones` is never shared — there is no
 * bone to agree on.
 */
function layoutSlots(parts: Part[], rootInverse: Matrix4): { slots: Slot[]; slotMaps: Map<Part, number[]> } {
  const slots: Slot[] = []
  const slotMaps = new Map<Part, number[]>()
  for (const part of parts) {
    const restPlacement = placementOf(part, rootInverse, new Matrix4())
    if (part.pose) {
      const { pose } = part
      const { bones, boneInverses } = pose.skeleton
      const bindMatrix = (part.mesh as SkinnedMesh).bindMatrix.clone()
      const map: number[] = []
      for (let b = 0; b < bones.length; b++) {
        const bone = bones[b]
        const shared = bone ? slots.findIndex((s) => slotReads(s, bone, boneInverses[b]!, bindMatrix, restPlacement)) : -1
        if (shared >= 0) {
          const slot = slots[shared]!
          if (!slot.parts.includes(part)) slot.parts.push(part)
          map.push(shared)
        } else {
          map.push(slots.length)
          slots.push({ rig: { pose, bone: b, bindMatrix }, parts: [part], restPlacement })
        }
      }
      slotMaps.set(part, map)
    } else {
      slotMaps.set(part, [slots.length])
      slots.push({ rig: undefined, parts: [part], restPlacement })
    }
  }
  return { slots, slotMaps }
}
/** The morph targets whose influence some track of `clip` drives on `mesh`, with the values it drives them to. */
function morphTracksOn(mesh: Mesh, clip: AnimationClip, root: Object3D): Map<number, number[]> {
  const driven = new Map<number, number[]>()
  for (const track of clip.tracks) {
    const parsed = PropertyBinding.parseTrackName(track.name)
    if (parsed.propertyName !== 'morphTargetInfluences') continue
    if (PropertyBinding.findNode(root, parsed.nodeName) !== mesh) continue

    const size = track.getValueSize()
    const keys = track.times.length
    const values = track.values
    const add = (t: number, read: (k: number) => number) => {
      const list = driven.get(t) ?? []
      for (let k = 0; k < keys; k++) list.push(read(k))
      driven.set(t, list)
    }
    if (parsed.propertyIndex === undefined) {
      // The whole array in one track — the shape glTF emits.
      for (let t = 0; t < size; t++) add(t, (k) => values[k * size + t]!)
    } else {
      // By index, or by name through the dictionary, exactly as three binds it.
      const byIndex = Number(parsed.propertyIndex)
      const t = Number.isInteger(byIndex) ? byIndex : mesh.morphTargetDictionary?.[parsed.propertyIndex]
      if (t !== undefined) add(t, (k) => values[k]!)
    }
  }
  return driven
}

/** A morph target some baked clip animates: what a slot cannot store, and where. */
interface AnimatedMorph {
  part: Part
  /** The target's name from the mesh's dictionary, or its index where it has none. */
  target: string
  /** Every clip whose track drives the target, quoted, in clip order. */
  clips: string[]
}

/**
 * The influence every morph target of `part` holds at every baked frame — and
 * the targets for which that is not one number.
 *
 * A target's influence at a frame is what the mixer leaves there: the track's
 * value where a clip carries one, the mesh's own value where it does not. If
 * every frame of every clip agrees, the morph is a pose, not animation, and
 * the caller gets the value to fold into the rest geometry. If they disagree —
 * a track that ramps, or a track in one clip and none in another — no single
 * rest pose can stand in for it, and the target comes back as animated, with
 * every clip whose track drives it, for the bake to refuse by name
 * ({@link refuseAnimatedMorphs}). A track held flat at the mesh's own value is
 * a pose written down, not animation: RobotExpressive's fourteen clips all
 * carry one on each head part, at zero, and fold.
 */
function morphInfluences(
  part: Part,
  clips: AnimationClip[],
  root: Object3D,
): { statics: number[]; animated: AnimatedMorph[] } {
  const { mesh } = part
  const influences = mesh.morphTargetInfluences
  const count = morphCountOf(part)
  if (!influences || count === 0) return { statics: [], animated: [] }

  const driven = clips.map((clip) => morphTracksOn(mesh, clip, root))
  const statics: number[] = []
  const animated: AnimatedMorph[] = []
  for (let t = 0; t < count; t++) {
    const seen = new Set<number>()
    const offending: string[] = []
    driven.forEach((tracks, ci) => {
      const values = tracks.get(t)
      if (!values) {
        seen.add(influences[t]!)
        return
      }
      offending.push(`"${clips[ci]!.name}"`)
      for (const value of values) seen.add(value)
    })
    if (seen.size > 1) {
      const name = Object.entries(mesh.morphTargetDictionary ?? {}).find(([, i]) => i === t)?.[0]
      animated.push({ part, target: name ? `"${name}"` : String(t), clips: offending })
    }
    statics.push(seen.values().next().value as number)
  }
  return { statics, animated }
}

/**
 * One refusal for every animated morph in the subtree, not the first one met:
 * a face is routinely several meshes, and a caller who fixes the part named
 * should not meet the next on the next bake. Parts whose targets the same
 * clips drive are named together, so a fourteen-clip list is written once.
 */
function refuseAnimatedMorphs(animated: AnimatedMorph[]): Error {
  const byDriver = new Map<string, { target: string; clips: string[]; parts: Part[] }>()
  for (const { part, target, clips } of animated) {
    const key = `${target}\n${clips.join('\n')}`
    const entry = byDriver.get(key) ?? { target, clips, parts: [] }
    if (!entry.parts.includes(part)) entry.parts.push(part)
    byDriver.set(key, entry)
  }
  const offences = [...byDriver.values()].map(({ target, clips, parts }) => {
    const one = clips.length === 1
    const its = parts.length === 1 ? 'its' : 'their'
    return `clip${one ? '' : 's'} ${clips.join(', ')} animate${one ? 's' : ''} morph target ${target} of part${
      parts.length === 1 ? '' : 's'
    } ${parts.map(partName).join(', ')}, ${its} vertices moving where no bone does`
  })
  return new RigRefusal(
    `three-vat: the rig encoding cannot bake this subtree: ${offences.join('; ')}. A slot stores a rotation, ` +
      `a translation and one scale, not a per-vertex delta — ${USE_VERTEX_ENCODING}`,
  )
}

/**
 * The part's rest geometry with its static morphs applied once — the same
 * accumulation the vertex bake does per frame (`w × (target − base)` for an
 * absolute target, `w × target` for a relative one), in the part's own space,
 * because that is the space the rig geometry keeps. A part with nothing to
 * fold copies its attributes across.
 */
function foldMorphs(part: Part, statics: number[]): { position: Float32Array; normal: Float32Array } {
  const { vertexCount, basePos, baseNrm, morphPos, morphNrm, morphRelative } = part
  const position = new Float32Array(vertexCount * 3)
  const normal = new Float32Array(vertexCount * 3)
  const active = statics.some((w) => w !== 0)
  const _p = new Vector3()
  const _n = new Vector3()
  const _mt = new Vector3()
  const _mb = new Vector3()

  for (let v = 0; v < vertexCount; v++) {
    _p.fromBufferAttribute(basePos, v)
    _n.fromBufferAttribute(baseNrm, v)
    if (active) {
      for (let t = 0; t < statics.length; t++) {
        const w = statics[t]!
        if (w === 0) continue
        const targetPos = morphPos?.[t]
        if (targetPos) {
          _mt.fromBufferAttribute(targetPos, v)
          if (!morphRelative) _mt.sub(_mb.fromBufferAttribute(basePos, v))
          _p.addScaledVector(_mt, w)
        }
        const targetNrm = morphNrm?.[t]
        if (targetNrm) {
          _mt.fromBufferAttribute(targetNrm, v)
          if (!morphRelative) _mt.sub(_mb.fromBufferAttribute(baseNrm, v))
          _n.addScaledVector(_mt, w)
        }
      }
      // Morph accumulation does not keep a normal unit; the vertex bake's
      // `transformDirection` does that on the way out, and the shader expects
      // a unit rest normal here.
      _n.normalize()
    }
    _p.toArray(position, v * 3)
    _n.toArray(normal, v * 3)
  }
  return { position, normal }
}

/**
 * Every node whose scale reaches a slot some vertex reads, and the slot it
 * reaches: an influenced bone and its ancestors within the skeleton, a rigid
 * part's mesh and its ancestors below the root. A scale on any of them lands in
 * the slot's matrix; a scale on a node no vertex reads through does not.
 */
function scaleSensitiveNodes(slots: Slot[], root: Object3D, influenced: Uint8Array): Map<Object3D, Slot> {
  const sensitive = new Map<Object3D, Slot>()
  slots.forEach((slot, i) => {
    if (!influenced[i]) return
    if (slot.rig) {
      const { bones } = slot.rig.pose.skeleton
      for (let node: Object3D | null = bones[slot.rig.bone] ?? null; node && bones.includes(node as Bone); node = node.parent) {
        sensitive.set(node, slot)
      }
    } else {
      for (let node: Object3D | null = slot.parts[0]!.mesh; node && node !== root; node = node.parent) {
        sensitive.set(node, slot)
      }
    }
  })
  return sensitive
}

/**
 * Refuse, before a frame is sampled, a `scale` track on a node some slot a
 * vertex reads is composed through, whose keys are not uniform. Keys, not
 * frames: the mixer interpolates between them, and a blend of uniform scales is
 * uniform. What a track cannot show — a rest-pose scale, a scaled node above
 * the skeleton — the posed slot matrix catches at its first row.
 */
function refuseAnimatedNonUniformScale(
  slots: Slot[],
  clips: AnimationClip[],
  root: Object3D,
  influenced: Uint8Array,
): void {
  const sensitive = scaleSensitiveNodes(slots, root, influenced)
  for (const clip of clips) {
    for (const track of clip.tracks) {
      const parsed = PropertyBinding.parseTrackName(track.name)
      if (parsed.propertyName !== 'scale' || track.getValueSize() !== 3) continue
      const node = PropertyBinding.findNode(root, parsed.nodeName) as Object3D | null
      const reached = node && sensitive.get(node)
      if (!reached) continue

      const values = track.values
      for (let k = 0; k < track.times.length; k++) {
        const o = k * 3
        if (unevenSquares(values[o]! ** 2, values[o + 1]! ** 2, values[o + 2]! ** 2)) {
          throw nonUniformScale(slotLabel(reached), clip)
        }
      }
    }
  }
}

function nonUniformScale(label: string, clip: AnimationClip): Error {
  return new RigRefusal(
    `three-vat: ${label} animates with non-uniform scale in clip "${clip.name}", which the rig encoding ` +
      `cannot store — a slot is a rotation, a translation and one scale. ${USE_VERTEX_ENCODING}, or author ` +
      'it with a uniform scale.',
  )
}

/**
 * Bake the posed rig rather than the posed vertices (ADR-0018).
 *
 * A row holds one **slot** per bone: the whole chain the vertex bake composes
 * per vertex — `partMatrix × bindMatrixInverse × boneWorld × boneInverse ×
 * bindMatrix`, in root space — hoisted out of the vertex loop, because it never
 * depended on the vertex. Linearity is what makes the hoist legal: for weights
 * `w_i` and a constant `A` and `C`, `Σ w_i (A B_i C) p = A (Σ w_i B_i) C p`, so
 * the shader's weighted sum of slot matrices is the same skinning the vertex
 * bake did on the CPU. Each slot is stored as a rotation, a translation and a
 * uniform scale — two texels ({@link RIG_TEXELS}) — with consecutive rows kept
 * on one quaternion hemisphere. (The decode still checks the sign once per
 * slot, because a looping clip blends a band's last row into its first, and
 * those two are not neighbours.)
 *
 * Slots are keyed by bone, bone inverse, bind matrix and placement, not by
 * part or by `Skeleton` object ({@link Slot}), so the meshes of one character
 * on one rig share its slots. A rigid, node-animated part is one slot of weight one — its chain is
 * the part matrix alone. The merged geometry stays in each part's own local
 * space and keeps `skinIndex` and `skinWeight`, remapped to slots: the slot
 * carries the placement, so the vertex must not also carry it.
 *
 * What a rig cannot express is refused by name, before a frame is sampled: a
 * morph target whose influence a baked clip animates, naming the part, the
 * target and every clip that drives it ({@link morphInfluences}); a bone some
 * vertex reads, or a rigid part, that a clip scales unevenly
 * ({@link refuseAnimatedNonUniformScale}). A morph influence no clip animates
 * is a pose, and is folded into the rest geometry once ({@link foldMorphs}).
 * Two checks survive into the frame loop as backstops for what a track cannot
 * show: a slot matrix that turns out non-uniform anyway (a rest-pose scale, a
 * scaled node above the skeleton), and two parts sharing a group that a clip
 * moves apart — a detached-bind-mode case only, since under the attached mode
 * a part's placement is the identity ({@link placementOf}).
 *
 * Two things still touch every vertex, once per frame, on the CPU. The bounds
 * are the union of every baked frame, as under the vertex encoding — a
 * conservative hull off the slot boxes would be cheaper, but it would not be
 * *the bake's bounds*, and a caller switching encodings should not find their
 * crowd culling differently. And `maxDelta` is measured on those same posed
 * vertices, against the unmorphed rest pose, so the frozen-clip diagnostic
 * means one thing under either encoding. (ADR-0018 records it as the
 * displacement of a slot's *origin*; a bone turning about its own origin moves
 * no origin and would read as frozen, so the vertex measure is kept — it is
 * already paid for.)
 */
function bakeRig(
  root: Object3D,
  parts: Part[],
  resolved: ResolvedAnimation[],
  { fps, maxTextureSize }: RigBakeOptions,
): RigVAT {
  const clips = resolved.map((a) => a.clip)

  // Every part's transform is taken relative to root, so the baked VAT is
  // independent of where the subtree happens to sit in the world.
  const rootInverse = root.matrixWorld.clone().invert()

  // One posed skeleton per distinct rig, as under the vertex encoding; then
  // the slot table over them.
  const poses = attachPoseBuffers(parts)
  const { slots, slotMaps } = layoutSlots(parts, rootInverse)
  const slotCount = slots.length

  // Refused before a frame is sampled: a refusal is a configuration check, and
  // baking a real character to then throw it away is the wrong order. The
  // morph check doubles as the fold — a static influence comes back as the
  // value to bake into the rest geometry — and every part is checked before
  // any is refused, so the refusal names them all.
  const morphs = parts.map((part) => morphInfluences(part, clips, root))
  const animated = morphs.flatMap((m) => m.animated)
  if (animated.length > 0) throw refuseAnimatedMorphs(animated)
  const rigParts: RigPart[] = parts.map((part, i) => ({
    part,
    slotOf: slotMaps.get(part)!,
    ...foldMorphs(part, morphs[i]!.statics),
  }))

  const width = slotCount * RIG_TEXELS_PER_SLOT
  if (width > maxTextureSize) {
    throw new RigRefusal(
      `three-vat: rig texture width ${width} (${slotCount} slots × ${RIG_TEXELS_PER_SLOT} texels) exceeds ` +
        `maxTextureSize ${maxTextureSize}`,
    )
  }
  const { frameCounts, totalFrames } = frameCountsFor(clips, fps, maxTextureSize)

  const vertexCount = parts.reduce((n, p) => n + p.vertexCount, 0)
  const geometry = mergeRigGeometry(rigParts, vertexCount)
  // The merged arrays themselves, for the per-vertex loop below: it runs once
  // per vertex per frame, and the attribute accessors cost more than the
  // arithmetic they would wrap.
  const localPosition = (geometry.attributes.position as BufferAttribute).array as Float32Array
  const skinIndex = (geometry.attributes.skinIndex as BufferAttribute).array as Uint16Array
  const skinWeight = (geometry.attributes.skinWeight as BufferAttribute).array as Float32Array

  // Which slots some vertex actually reads. A rig routinely carries bones
  // nothing is weighted to, and refusing one of those for a scale no vertex
  // can see would refuse a rig for nothing.
  const influenced = new Uint8Array(slotCount)
  for (let i = 0; i < skinWeight.length; i++) {
    if (skinWeight[i] !== 0) influenced[skinIndex[i]!] = 1
  }
  refuseAnimatedNonUniformScale(slots, clips, root, influenced)

  const _p = new Vector3()
  const _slot = new Matrix4()
  const _partMatrix = new Matrix4()
  // Every part's placement this frame, read once per frame rather than once
  // per slot it reads.
  const placements = new Map<Part, Matrix4>(parts.map((part) => [part, new Matrix4()]))
  const _q = new Quaternion()
  const _t = new Vector3()
  const _s = new Vector3()

  // The unmorphed rest pose in root space, captured before any action plays:
  // the reference `maxDelta` is measured against, exactly as the vertex bake's
  // merged base is.
  const restRoot = new Float64Array(vertexCount * 3)
  for (const part of parts) {
    _partMatrix.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
    for (let v = 0; v < part.vertexCount; v++) {
      _p.fromBufferAttribute(part.basePos, v).applyMatrix4(_partMatrix)
      _p.toArray(restRoot, (part.vertexStart + v) * 3)
    }
  }

  const data = new Float32Array(width * totalFrames * 4)
  // This frame's slot matrices, in root space — what the vertex loop below
  // blends for the bounds, in the precision the texels are rounded from.
  const slotMatrices = new Float64Array(slotCount * BONE_STRIDE)
  // The last row's quaternion per slot, for hemisphere continuity across the
  // whole bake: rows are only ever blended with their neighbours, and a
  // neighbour on the far hemisphere would send the blend through zero.
  const previous = new Float64Array(slotCount * 4)

  const mixer = new AnimationMixer(root)
  const bounds = new Box3()
  const clipTable: VATClip[] = []
  // The bounds, as six numbers the vertex loop can update without a call.
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  let rowOffset = 0
  // Whatever leaves this loop — the last row, or a refusal a row reaches —
  // leaves the subtree at rest: stopping the actions hands every binding its
  // original value back, so a bake that throws does not strand the pose it
  // was sampling, and a second bake of the same subtree starts from rest.
  try {
    clips.forEach((clip, ci) => {
      const frames = frameCounts[ci] as number
      const action = mixer.clipAction(clip)
      action.play()
      let maxDeltaSq = 0

      for (let f = 0; f < frames; f++) {
        mixer.setTime((f / frames) * clip.duration)
        root.updateMatrixWorld(true)
        const row = rowOffset + f
        poseSkeletons(poses)

        for (const [part, placement] of placements) placementOf(part, rootInverse, placement)

        // The row: every slot's matrix, composed once and written as two texels.
        for (let slot = 0; slot < slotCount; slot++) {
          const { rig, parts: readers } = slots[slot]!
          const lead = readers[0]!
          const placement = placements.get(lead)!
          // Parts sharing a slot were placed alike at rest; a clip that moves
          // them apart is asking one slot for two placements. Never under the
          // attached bind mode, where every placement is the identity.
          for (let pi = 1; pi < readers.length; pi++) {
            const other = readers[pi]!
            if (!matricesClose(placement, placements.get(other)!)) {
              throw new RigRefusal(
                `three-vat: parts ${partName(lead)} and ${partName(other)} read the same slots but move apart in ` +
                  `clip "${clip.name}"; the rig encoding gives them one set of slots, which cannot place them ` +
                  `differently — ${USE_VERTEX_ENCODING}`,
              )
            }
          }

          if (rig) {
            _slot.fromArray(rig.pose.matrices, rig.bone * BONE_STRIDE).multiply(rig.bindMatrix).premultiply(placement)
          } else {
            // A rigid part: the placement is the whole animation.
            _slot.copy(placement)
          }
          slotMatrices.set(_slot.elements, slot * BONE_STRIDE)

          // The backstop to the pre-sampling check: a scale no track shows.
          if (influenced[slot] && (hasNonUniformScale(slotMatrices, slot) || hasShear(slotMatrices, slot))) {
            throw nonUniformScale(slotLabel(slots[slot]!), clip)
          }

          const p4 = slot * 4
          // One scale carries the slot's size, and it must carry a mirror and a
          // collapse as well (#79). A mirror's determinant is negative, and
          // `decompose` negates one axis for it, which one scale cannot say;
          // negating the whole 3×3 first leaves a proper rotation, and the
          // mirror rides in the scale's sign. A zero matrix has no rotation at
          // all, and `decompose` would call it the identity at scale one — the
          // hidden part at full size — so it keeps the last rotation, at zero.
          const det = _slot.determinant()
          let scale: number
          if (det === 0) {
            _t.setFromMatrixPosition(_slot)
            _q.fromArray(previous, p4)
            if (_q.lengthSq() === 0) _q.identity()
            scale = 0
          } else {
            if (det < 0) for (const e of MATRIX_BASIS) _slot.elements[e] = -_slot.elements[e]!
            _slot.decompose(_t, _q, _s)
            scale = det < 0 ? -_s.x : _s.x
          }
          if (previous[p4]! * _q.x + previous[p4 + 1]! * _q.y + previous[p4 + 2]! * _q.z + previous[p4 + 3]! * _q.w < 0) {
            _q.set(-_q.x, -_q.y, -_q.z, -_q.w)
          }
          previous[p4] = _q.x
          previous[p4 + 1] = _q.y
          previous[p4 + 2] = _q.z
          previous[p4 + 3] = _q.w

          const o = (row * width + slot * RIG_TEXELS_PER_SLOT) * 4
          const rotation = o + RIG_TEXELS.rotation * 4
          data[rotation] = _q.x
          data[rotation + 1] = _q.y
          data[rotation + 2] = _q.z
          data[rotation + 3] = _q.w
          const placementTexel = o + RIG_TEXELS.placement * 4
          data[placementTexel] = _t.x
          data[placementTexel + 1] = _t.y
          data[placementTexel + 2] = _t.z
          // One scale, in the translation texel's spare component. Uniform for
          // every slot a vertex reads (checked above), so any axis is the scale,
          // signed for a mirror.
          data[placementTexel + 3] = scale
        }

        // The frame's vertices, skinned from those slots exactly as the shader
        // will skin them: for the bounds, and for the frozen-clip diagnostic.
        // `Σ w_i (S_i p)` rather than `(Σ w_i S_i) p` — the same point, at a
        // quarter of the multiplies — and no divide by `w'`, because a product of
        // affine matrices keeps its last row at exactly (0, 0, 0, 1).
        for (let v = 0; v < vertexCount; v++) {
          const o3 = v * 3
          const o4 = v * 4
          const x = localPosition[o3]!
          const y = localPosition[o3 + 1]!
          const z = localPosition[o3 + 2]!
          let px = 0
          let py = 0
          let pz = 0
          for (let i = 0; i < 4; i++) {
            const w = skinWeight[o4 + i]!
            if (w === 0) continue
            const m = skinIndex[o4 + i]! * BONE_STRIDE
            px += w * (slotMatrices[m]! * x + slotMatrices[m + 4]! * y + slotMatrices[m + 8]! * z + slotMatrices[m + 12]!)
            py += w * (slotMatrices[m + 1]! * x + slotMatrices[m + 5]! * y + slotMatrices[m + 9]! * z + slotMatrices[m + 13]!)
            pz += w * (slotMatrices[m + 2]! * x + slotMatrices[m + 6]! * y + slotMatrices[m + 10]! * z + slotMatrices[m + 14]!)
          }
          if (px < minX) minX = px
          if (px > maxX) maxX = px
          if (py < minY) minY = py
          if (py > maxY) maxY = py
          if (pz < minZ) minZ = pz
          if (pz > maxZ) maxZ = pz

          const dx = px - restRoot[o3]!
          const dy = py - restRoot[o3 + 1]!
          const dz = pz - restRoot[o3 + 2]!
          const deltaSq = dx * dx + dy * dy + dz * dz
          if (deltaSq > maxDeltaSq) maxDeltaSq = deltaSq
        }
      }
      action.stop()
      clipTable.push({
        name: clip.name,
        startFrame: rowOffset,
        frames,
        fps: frames / clip.duration,
        duration: clip.duration,
        maxDelta: Math.sqrt(maxDeltaSq),
        ...resolved[ci]!.defaults,
      })
      rowOffset += frames
    })  } finally {
    mixer.stopAllAction()
    mixer.setTime(0)
    root.updateMatrixWorld(true)
  }

  bounds.min.set(minX, minY, minZ)
  bounds.max.set(maxX, maxY, maxZ)
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  const materials: Material[] = []
  for (const part of parts) materials[part.materialIndex] = part.material

  return {
    encoding: 'rig',
    rigTexture: makeVATTexture(data, width, totalFrames),
    slotCount,
    clips: clipTable,
    bounds,
    vertexCount,
    totalFrames,
    geometry,
    materials,
  }
}

/**
 * The rig encoding's merge: every part's rest geometry in its *own* local
 * space, static morphs already folded ({@link RigPart}) — the slot matrix
 * carries the placement — with `skinIndex` remapped from bone indices to slot
 * indices through the part's slot map and `skinWeight` carried across. A rigid
 * part reads its one slot at weight one. The optional attributes follow the
 * vertex encoding's all-or-nothing rule ({@link optionalAttributes}), and a
 * tangent stays local like the normal.
 */
function mergeRigGeometry(rigParts: RigPart[], total: number): BufferGeometry {
  const parts = rigParts.map((r) => r.part)
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  // Slots are texture columns, and the width is capped well inside sixteen bits.
  const slotIndex = new Uint16Array(total * 4)
  const slotWeight = new Float32Array(total * 4)

  const want = optionalAttributes(parts)
  const uv = want.uv ? new Float32Array(total * 2) : null
  const color = want.color ? new Float32Array(total * 3) : null
  const merging = parts.some((p) => p.tint)
  const tangent = want.tangent ? new Float32Array(total * 4) : null

  for (const { part, slotOf, position: restPos, normal: restNrm } of rigParts) {
    const geometry = part.mesh.geometry
    const start = part.vertexStart
    // Read through `getComponent`, not as plain arrays: a glTF routinely
    // interleaves its skinning attributes (Soldier does), and the vertex bake
    // reads them through the same interface. A rigid part has none to read.
    const srcIndex = part.pose ? part.skinIndex! : null
    const srcWeight = part.pose ? part.skinWeight! : null
    const srcUV = uv ? asAttribute(geometry.attributes.uv, part.mesh, 'uv') : null
    const srcColor = colorSource(part, !!color, merging)
    const srcTangent = tangent ? (geometry.attributes.tangent as BufferAttribute) : null

    position.set(restPos, start * 3)
    normal.set(restNrm, start * 3)

    for (let v = 0; v < part.vertexCount; v++) {
      const vi = start + v
      const o3 = vi * 3
      const o4 = vi * 4
      if (srcIndex && srcWeight) {
        for (let i = 0; i < 4; i++) {
          slotIndex[o4 + i] = slotOf[srcIndex.getComponent(v, i)]!
          slotWeight[o4 + i] = srcWeight.getComponent(v, i)
        }
      } else {
        slotIndex[o4] = slotOf[0]!
        slotWeight[o4] = 1
      }

      if (uv && srcUV) {
        uv[vi * 2] = srcUV.getX(v)
        uv[vi * 2 + 1] = srcUV.getY(v)
      }
      if (color) writeColor(color, o3, part, srcColor, v)
      if (tangent && srcTangent) {
        tangent[o4] = srcTangent.getX(v)
        tangent[o4 + 1] = srcTangent.getY(v)
        tangent[o4 + 2] = srcTangent.getZ(v)
        tangent[o4 + 3] = srcTangent.getW(v)
      }
    }
  }

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(position, 3))
  merged.setAttribute('normal', new BufferAttribute(normal, 3))
  merged.setAttribute('skinIndex', new BufferAttribute(slotIndex, 4))
  merged.setAttribute('skinWeight', new BufferAttribute(slotWeight, 4))
  if (uv) merged.setAttribute('uv', new BufferAttribute(uv, 2))
  if (color) merged.setAttribute('color', new BufferAttribute(color, 3))
  if (tangent) merged.setAttribute('tangent', new BufferAttribute(tangent, 4))
  indexParts(merged, parts)
  return merged
}
