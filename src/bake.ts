import {
  AnimationMixer,
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Sphere,
  Vector3,
  Vector4,
} from 'three'
import type {
  AnimationClip,
  Material,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
  TextureDataType,
  TypedArray,
} from 'three'
import type { BakedVAT, VATClip } from './types.js'

/**
 * Conservative fallback texture-dimension cap, used when the caller does not
 * pass `maxTextureSize`. This is the WebGL2 *spec floor for high-end desktop*,
 * not a guarantee — plenty of mobile GPUs report 4096 or 8192. The baker is
 * renderer-agnostic by design (it runs in Node, and in a Web Worker), so it cannot
 * query the real limit itself: pass `getMaxTextureSize(renderer)` from
 * `three-vat/webgl` or `three-vat/tsl` whenever a renderer exists.
 */
export const MAX_TEXTURE_SIZE = 16384

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
  skinIndex: BufferAttribute | undefined
  skinWeight: BufferAttribute | undefined
  morphPos: BufferAttribute[] | undefined
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
    // A VAT always carries a normal texture, so normals are required. Some
    // assets ship without them — derive them so lighting works.
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
      skinIndex: geometry.attributes.skinIndex as BufferAttribute | undefined,
      skinWeight: geometry.attributes.skinWeight as BufferAttribute | undefined,
      morphPos: geometry.morphAttributes.position as BufferAttribute[] | undefined,
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
 */
function mergeGeometry(parts: Part[], restMatrices: Matrix4[], total: number): BufferGeometry {
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)

  // Optional attributes survive the merge only if every part has them —
  // otherwise the merged buffer would carry undefined holes.
  const wantUV = parts.every((p) => !!p.mesh.geometry.attributes.uv)
  const wantColor = parts.every((p) => !!p.mesh.geometry.attributes.color)
  const uv = wantUV ? new Float32Array(total * 2) : null
  const color = wantColor ? new Float32Array(total * 3) : null

  const indices: number[] = []
  const groups: { start: number; count: number; materialIndex: number }[] = []

  const _v = new Vector3()
  const _n = new Vector3()

  parts.forEach((part, pi) => {
    const m = restMatrices[pi]!
    const geometry = part.mesh.geometry
    const start = part.vertexStart
    const srcUV = uv ? asAttribute(geometry.attributes.uv, part.mesh, 'uv') : null
    const srcColor = color ? asAttribute(geometry.attributes.color, part.mesh, 'color') : null

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
  merged.setIndex(indices)
  for (const g of groups) merged.addGroup(g.start, g.count, g.materialIndex)
  return merged
}

/**
 * Bake `AnimationClip`s into a VAT by sampling the posed subtree frame by frame
 * on the CPU.
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
 * of them. Normals reproduce what three's own skinning shader renders: linear
 * blend skinning transforms a normal by the skin matrix rather than its
 * inverse-transpose, which is exact for rigid and uniformly-scaled bones and an
 * approximation for anything else. Non-uniform bone scale is where that
 * approximation becomes visible, so the bake warns once, naming the bone.
 * Renderer-agnostic — touches no WebGL/WebGPU context — so it runs identically
 * at runtime, in a Web Worker, and in Node.
 */
export function bakeVAT(
  root: Object3D,
  clips: AnimationClip[],
  { fps = 30, maxTextureSize = MAX_TEXTURE_SIZE }: BakeOptions = {},
): BakedVAT {
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
  const nrmData = new Float32Array(vertexCount * totalFrames * 4)

  const mixer = new AnimationMixer(root)
  const bounds = new Box3()
  const clipTable: VATClip[] = []

  const _si = new Vector4()
  const _sw = new Vector4()
  const _bone = new Matrix4()
  const _acc = new Matrix4()
  const _skin = new Matrix4()
  const _partMatrix = new Matrix4()
  const _p = new Vector3()
  const _bp = new Vector3()
  const _n = new Vector3()
  const _mt = new Vector3()
  const _mb = new Vector3()

  // Normals are the only casualty of non-uniform bone scale, and the bake is
  // still usable — so warn, once per bake, rather than throwing or repeating.
  const influencers = parts.filter((p) => p.isSkinned && p.skeleton).map(influencedBones)
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

      // Bone scale is animated, so this has to be re-checked every frame — but
      // it costs one matrix per *bone*, against thousands per vertex below.
      if (!warnedNonUniformScale) {
        warnedNonUniformScale = warnOnNonUniformBoneScale(influencers, _bone)
      }

      for (const part of parts) {
        // The part's posed placement in root space. For a rigid node-animated
        // part this matrix *is* the whole animation.
        _partMatrix.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
        const influences = part.mesh.morphTargetInfluences
        const { morphPos, morphRelative, isSkinned, skeleton, skinIndex, skinWeight } = part

        for (let v = 0; v < part.vertexCount; v++) {
          const vi = part.vertexStart + v
          _p.fromBufferAttribute(part.basePos, v)
          _n.fromBufferAttribute(part.baseNrm, v)

          // Morph targets: accumulate weighted position deltas. Applied first,
          // so skinning transforms the already-morphed vertex, as in three.
          if (morphPos && influences) {
            // An absolute target contributes `w * (target - base)`, and `base`
            // is the *unmorphed* vertex for every target — `_p` is already
            // accumulating, so it cannot stand in for it.
            if (!morphRelative) _mb.fromBufferAttribute(part.basePos, v)
            for (let t = 0; t < morphPos.length; t++) {
              const w = influences[t]!
              if (w === 0) continue
              _mt.fromBufferAttribute(morphPos[t]!, v)
              if (!morphRelative) _mt.sub(_mb)
              _p.addScaledVector(_mt, w)
            }
          }

          // Blended skin matrix, same math as SkinnedMesh.applyBoneTransform:
          // sum(w_i * boneWorld_i * boneInverse_i), wrapped in bind space.
          // Normals use the skin matrix directly — three's `skinnormal_vertex`
          // does the same (blended rigid transforms, no inverse-transpose).
          if (isSkinned && skeleton) {
            const skinned = part.mesh as SkinnedMesh
            _si.fromBufferAttribute(skinIndex!, v)
            _sw.fromBufferAttribute(skinWeight!, v)
            _acc.elements.fill(0)
            for (let i = 0; i < 4; i++) {
              const w = _sw.getComponent(i)
              if (w === 0) continue
              const bi = _si.getComponent(i)
              _bone.multiplyMatrices(skeleton.bones[bi]!.matrixWorld, skeleton.boneInverses[bi]!)
              const ae = _acc.elements
              const be = _bone.elements
              for (let e = 0; e < 16; e++) ae[e]! += be[e]! * w
            }
            _skin.multiplyMatrices(_acc, skinned.bindMatrix).premultiply(skinned.bindMatrixInverse)
            _p.applyMatrix4(_skin)
            _n.transformDirection(_skin)
          }

          // Finally into root space. Skinning yields a position in the mesh's
          // own local space (three applies modelMatrix afterwards), so this
          // composes correctly for skinned, morphed and rigid parts alike.
          _p.applyMatrix4(_partMatrix)
          _n.transformDirection(_partMatrix)

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
          nrmData[o] = _n.x
          nrmData[o + 1] = _n.y
          nrmData[o + 2] = _n.z
          nrmData[o + 3] = 1
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
    normalTexture: makeVATTexture(nrmData, vertexCount, totalFrames),
    clips: clipTable,
    bounds,
    vertexCount,
    totalFrames,
    encoding: 'delta',
    geometry,
    materials,
  }
}

/** A skeleton paired with the bones some vertex is actually weighted to. */
interface Influencers {
  skeleton: Skeleton
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
  return { skeleton: part.skeleton!, bones: [...used] }
}

/**
 * Relative tolerance on squared basis lengths when judging a skin matrix
 * uniform. Loose enough to ignore float drift in an authored rig, tight enough
 * that a real squash trips it.
 */
const SCALE_UNIFORMITY_EPSILON = 1e-4

/**
 * Does this matrix scale its three axes by different amounts?
 *
 * Compares squared basis lengths to keep the check to multiplies — it runs per
 * bone per frame, alongside work that is per *vertex* per frame.
 */
function hasNonUniformScale(m: Matrix4): boolean {
  const e = m.elements
  const x = e[0]! * e[0]! + e[1]! * e[1]! + e[2]! * e[2]!
  const y = e[4]! * e[4]! + e[5]! * e[5]! + e[6]! * e[6]!
  const z = e[8]! * e[8]! + e[9]! * e[9]! + e[10]! * e[10]!
  const max = Math.max(x, y, z)
  return max - Math.min(x, y, z) > SCALE_UNIFORMITY_EPSILON * max
}

/**
 * Warn — once, and only for a bone that actually drives a vertex — that this
 * frame's pose squashes a bone unevenly. Returns whether it warned, so the
 * caller can stop checking.
 */
function warnOnNonUniformBoneScale(influencers: Influencers[], scratch: Matrix4): boolean {
  for (const { skeleton, bones } of influencers) {
    for (const b of bones) {
      scratch.multiplyMatrices(skeleton.bones[b]!.matrixWorld, skeleton.boneInverses[b]!)
      if (!hasNonUniformScale(scratch)) continue
      console.warn(
        `three-vat: bone "${skeleton.bones[b]!.name || '(unnamed)'}" animates with non-uniform scale; ` +
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
