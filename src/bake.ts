import {
  AdditiveAnimationBlendMode,
  AnimationMixer,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  LoopOnce,
  LoopPingPong,
  LoopRepeat,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Sphere,
  Vector3,
  Vector4,
} from 'three'
import type {
  AnimationAction,
  AnimationClip,
  Material,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
  TextureDataType,
  TypedArray,
} from 'three'
import {
  INFINITE_REPETITIONS,
  LIBRARY_PLAYBACK_DEFAULTS,
  LoopMode,
} from './instance-playback.js'
import type { VAT, VATClip, VATClipDefaults } from './types.js'

/**
 * Conservative fallback texture-dimension cap, used when the caller does not
 * pass `maxTextureSize`. This is the WebGL2 *spec floor for high-end desktop*,
 * not a guarantee — plenty of mobile GPUs report 4096 or 8192. The baker is
 * renderer-agnostic by design (it runs in Node, and in a Web Worker), so it cannot
 * query the real limit itself: pass `getMaxTextureSize(renderer)` from
 * `three-vat/webgl` or `three-vat/tsl` whenever a renderer exists.
 */
export const MAX_TEXTURE_SIZE = 16384

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
   * Turning it off halves the VAT — `verts x frames x 16 B x 2` becomes `x 1` —
   * and is correct for exactly two material setups:
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
   */
  bakeNormals?: boolean
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
 * Collect every `Mesh` under `root`, ordered so that parts sharing a material
 * are contiguous — that ordering is what lets the merged geometry express each
 * material as a single group, and therefore a single draw call.
 */
function collectParts(root: Object3D): Part[] {
  const found: Mesh[] = []
  root.traverse((o) => {
    const mesh = o as Mesh
    if (mesh.isMesh && mesh.geometry) found.push(mesh)
  })
  if (found.length === 0) {
    throw new Error('three-vat: no Mesh found under root; nothing to bake')
  }

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
    // The merged rest geometry carries normals whatever the bake decides about
    // the normal *texture*, and some assets ship without them — derive them, so
    // the merge has something to transform and a flat-shaded crowd still has a
    // well-formed attribute behind it.
    if (!geometry.attributes.normal) geometry.computeVertexNormals()

    const material = mesh.material as Material
    let materialIndex = materials.indexOf(material)
    if (materialIndex === -1) materialIndex = materials.push(material) - 1

    const skinned = mesh as SkinnedMesh
    parts.push({
      mesh,
      material,
      materialIndex,
      vertexStart: 0, // assigned below, after material sorting
      vertexCount: geometry.attributes.position!.count,
      basePos: asAttribute(geometry.attributes.position, mesh, 'position'),
      baseNrm: asAttribute(geometry.attributes.normal, mesh, 'normal'),
      isSkinned: !!geometry.attributes.skinWeight && !!skinned.skeleton,
      skeleton: skinned.skeleton,
      pose: undefined, // assigned below, once the distinct rigs are known
      skinIndex: geometry.attributes.skinIndex as BufferAttribute | undefined,
      skinWeight: geometry.attributes.skinWeight as BufferAttribute | undefined,
      morphPos: geometry.morphAttributes.position as BufferAttribute[] | undefined,
      morphNrm: geometry.morphAttributes.normal as BufferAttribute[] | undefined,
      morphRelative: geometry.morphTargetsRelative,
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

  // Optional attributes survive the merge only if every part has them —
  // otherwise the merged buffer would carry undefined holes.
  const wantUV = parts.every((p) => !!p.mesh.geometry.attributes.uv)
  const wantColor = parts.every((p) => !!p.mesh.geometry.attributes.color)
  // `tangent` asks more of a part than `uv` and `color` do, and drops rather
  // than throws when it does not get it. A vec3 under that name is not a
  // tangent, and an interleaved one is not something this merge can read — but
  // both bake today, silently tangentless, and a bug fix that turned a working
  // bake into an exception would be the worse bug. So either one fails the
  // all-or-nothing test and the crowd renders exactly as it does now.
  const wantTangent = parts.every((p) => {
    const t = p.mesh.geometry.attributes.tangent
    return t instanceof BufferAttribute && t.itemSize === 4
  })
  const uv = wantUV ? new Float32Array(total * 2) : null
  const color = wantColor ? new Float32Array(total * 3) : null
  const tangent = wantTangent ? new Float32Array(total * 4) : null

  const indices: number[] = []
  const groups: { start: number; count: number; materialIndex: number }[] = []

  const _v = new Vector3()
  const _n = new Vector3()
  const _t = new Vector3()

  parts.forEach((part, pi) => {
    const m = restMatrices[pi]!
    const geometry = part.mesh.geometry
    const start = part.vertexStart
    const srcUV = uv ? asAttribute(geometry.attributes.uv, part.mesh, 'uv') : null
    const srcColor = color ? asAttribute(geometry.attributes.color, part.mesh, 'color') : null
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
      if (color && srcColor) {
        color[o3] = srcColor.getX(v)
        color[o3 + 1] = srcColor.getY(v)
        color[o3 + 2] = srcColor.getZ(v)
      }
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

    // Always emit an indexed merge: a non-indexed part just contributes a
    // sequential run, which keeps every group expressible as an index range.
    const groupStart = indices.length
    const index = geometry.index
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(start + index.getX(i))
    } else {
      for (let v = 0; v < part.vertexCount; v++) indices.push(start + v)
    }

    // Parts are material-sorted, so extend the open group when it matches.
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
  })

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(position, 3))
  merged.setAttribute('normal', new BufferAttribute(normal, 3))
  if (uv) merged.setAttribute('uv', new BufferAttribute(uv, 2))
  if (color) merged.setAttribute('color', new BufferAttribute(color, 3))
  if (tangent) merged.setAttribute('tangent', new BufferAttribute(tangent, 4))
  merged.setIndex(indices)
  for (const g of groups) merged.addGroup(g.start, g.count, g.materialIndex)
  return merged
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
 */
export function bakeVAT(
  root: Object3D,
  animations: BakeInput[],
  { fps = 30, maxTextureSize = MAX_TEXTURE_SIZE, bakeNormals = true }: BakeOptions = {},
): VAT {
  // Before anything else: a refusal is a configuration check, and baking a real
  // character is seconds of work to then throw away.
  const resolved = animations.map(resolveAnimation)
  const clips = resolved.map((a) => a.clip)

  // Rest pose first: the delta reference must be captured before any action
  // plays, or every delta is measured against an already-animated pose.
  root.updateMatrixWorld(true)
  const parts = collectParts(root)
  const vertexCount = parts.reduce((n, p) => n + p.vertexCount, 0)

  if (vertexCount > maxTextureSize) {
    throw new Error(
      `three-vat: vertexCount ${vertexCount} exceeds maxTextureSize ${maxTextureSize}; row wrapping is not implemented`,
    )
  }

  const frameCounts = clips.map((c) => Math.max(2, Math.round(c.duration * fps)))
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0)
  // Frames are texture *rows*, so they hit the same cap as vertices. Easy to
  // exceed with many clips or a high fps before any memory limit bites.
  if (totalFrames > maxTextureSize) {
    throw new Error(
      `three-vat: totalFrames ${totalFrames} exceeds maxTextureSize ${maxTextureSize}; lower fps or bake fewer clips`,
    )
  }

  // Every part's transform is taken relative to root, so the baked VAT is
  // independent of where the subtree happens to sit in the world.
  const rootInverse = root.matrixWorld.clone().invert()
  const restMatrices = parts.map((p) =>
    new Matrix4().multiplyMatrices(rootInverse, p.mesh.matrixWorld),
  )
  const geometry = mergeGeometry(parts, restMatrices, vertexCount)
  const mergedBase = geometry.attributes.position as BufferAttribute

  const posData = new Float32Array(vertexCount * totalFrames * 4)
  // Half the bytes of the whole VAT, allocated only when something will read it.
  const nrmData = bakeNormals ? new Float32Array(vertexCount * totalFrames * 4) : null
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
        // three drives both attributes off one influence list, and sizes that
        // list from whichever morph attribute the geometry happens to declare
        // first (`Mesh.updateMorphTargets`) — so the influences, not either
        // target array, bound the loop. A target may morph the position, the
        // normal, or both.
        const morphCount = influences
          ? Math.min(influences.length, Math.max(morphPos?.length ?? 0, morphNrm?.length ?? 0))
          : 0

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
          posData[o] = dx
          posData[o + 1] = dy
          posData[o + 2] = dz
          posData[o + 3] = 1
          if (bakeNormal) {
            nrmData[o] = _n.x
            nrmData[o + 1] = _n.y
            nrmData[o + 2] = _n.z
            nrmData[o + 3] = 1
          }
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
  })
  mixer.stopAllAction()
  mixer.setTime(0)
  root.updateMatrixWorld(true)

  // Union of every baked frame — the caller would otherwise have to compute it
  // to avoid instances culling mid-animation.
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  const materials: Material[] = []
  for (const part of parts) materials[part.materialIndex] = part.material

  return {
    positionTexture: makeVATTexture(posData, vertexCount, totalFrames),
    normalTexture: nrmData ? makeVATTexture(nrmData, vertexCount, totalFrames) : null,
    clips: clipTable,
    bounds,
    vertexCount,
    totalFrames,
    encoding: 'delta',
    geometry,
    materials,
  }
}

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
 * one entry per *distinct* rig — distinct because the meshes of one character
 * routinely share a skeleton (Soldier's body and visor do), and posing it once
 * per mesh would give back half of what the buffer saves.
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

/**
 * Does bone `b`'s skin matrix scale its three axes by different amounts?
 *
 * Reads the posed rig in place — the same sixteen floats the vertex loop
 * blends, so the warning can never be about a matrix the bake did not use.
 * Compares squared basis lengths to keep the check to multiplies.
 */
function hasNonUniformScale(matrices: Float64Array, b: number): boolean {
  const o = b * BONE_STRIDE
  const x = matrices[o]! ** 2 + matrices[o + 1]! ** 2 + matrices[o + 2]! ** 2
  const y = matrices[o + 4]! ** 2 + matrices[o + 5]! ** 2 + matrices[o + 6]! ** 2
  const z = matrices[o + 8]! ** 2 + matrices[o + 9]! ** 2 + matrices[o + 10]! ** 2
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

/**
 * Build a VAT `DataTexture` with the fixed sampling flags every path relies on:
 * RGBA, nearest filtering, no mipmaps. Frame interpolation is done manually in
 * the shader, so linear filtering must stay off.
 */
export function makeVATTexture(
  data: TypedArray,
  width: number,
  height: number,
  type: TextureDataType = FloatType,
): DataTexture {
  const tex = new DataTexture(data, width, height, RGBAFormat, type)
  tex.minFilter = NearestFilter
  tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}
