// PROTOTYPE — throwaway. See ./README.md and issue #47.
//
// The second encoding, baked: per frame, one skin matrix per *slot* instead of
// a position per vertex. A slot is a bone of a skinned part, or the part itself
// for a rigid one (Houdini's rigid VAT, and what RobotExpressive's 14
// node-animated parts are).
//
// The matrix a slot holds is the whole chain, so the shader's job is one
// weighted sum and one multiply:
//
//     M_slot = partMatrix x bindMatrixInverse x boneWorld x boneInverse x bindMatrix
//
// which is exactly what src/bake.ts already computes per vertex — the same
// `_skin` composed with the same `_partMatrix`, hoisted out of the vertex loop
// because it never depended on the vertex. Linearity is what makes the hoist
// legal: sum_i w_i (A B_i C) p == A (sum_i w_i B_i) C p, for A and C constant
// across the four influences.
//
// Deliberately NOT deduplicated across parts that share a rig: Soldier's body
// and visor share one 49-bone skeleton but carry their own bindMatrix, so this
// gives them 98 slots where a shipped implementation would key the slot table
// on (skeleton, bindMatrix) and give them 49. It costs texture width and
// nothing else — the per-vertex fetch count is identical — so the memory
// numbers this reports are the pessimistic ones. `idealSlotCount` reports what
// the dedupe would have cost, so the write-up can state both.
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Matrix4,
  Quaternion,
  Vector3,
  AnimationMixer,
} from 'three'
import type {
  AnimationClip,
  DataTexture,
  Material,
  Mesh,
  Object3D,
  Skeleton,
  SkinnedMesh,
} from 'three'
import { makeVATTexture } from 'three-vat'
import { EndMode, INFINITE_REPETITIONS, LoopMode } from 'three-vat'
import type { VATClip } from 'three-vat'

/** How a slot's matrix is stored. The whole point of the prototype. */
export type BoneFormat = 'mat4' | 'qt'

/** Texels one slot occupies per frame. `qt` is the compression being measured. */
export const TEXELS_PER_SLOT: Record<BoneFormat, number> = { mat4: 4, qt: 2 }

export interface BoneBakeOptions {
  fps?: number
  format?: BoneFormat
  maxTextureSize?: number
  /**
   * What to do about a part whose morph targets are animated.
   *
   * `'refuse'` is the real behaviour and the default — a shipped encoding must
   * refuse, loudly, naming the part (issue #47).
   *
   * `'drop'` exists because of what the refusal turned out to catch:
   * *every* clip this prototype benches on RobotExpressive animates its head's
   * morphs, so refusing correctly also refuses the measurement. Dropping the
   * offending parts renders a slightly smaller mesh — reported in
   * `droppedParts`, and printed on the page, because timing a different mesh
   * and not saying so would be the dishonest way to get a number.
   */
  onMorphAnimation?: 'refuse' | 'drop'
}

export interface BoneBake {
  /** `x = slot * TEXELS_PER_SLOT + texel`, `y = frame`. Clips stacked in bands. */
  texture: DataTexture
  /**
   * Merged geometry in each part's own **local** space — unlike the VAT's,
   * which is pre-transformed into root space. The slot matrix carries the
   * placement, so it must not also be baked into the vertex.
   */
  geometry: BufferGeometry
  materials: Material[]
  /** Same shape, same bands, same `startFrame` arithmetic as a VAT's. */
  clips: VATClip[]
  bounds: Box3
  format: BoneFormat
  slotCount: number
  /** What a (skeleton, bindMatrix)-keyed slot table would have cost instead. */
  idealSlotCount: number
  totalFrames: number
  bytes: number
  bakeMs: number
  /** Bones whose pose scales unevenly — `qt` cannot store these. */
  nonUniformBones: string[]
  /**
   * Parts left out because their morphs are animated, under
   * `onMorphAnimation: 'drop'`. Non-empty means the mesh being timed is not
   * the mesh the VAT control is timing — say so wherever the number is used.
   */
  droppedParts: string[]
}

/** What the bone encoding cannot express, named so the page can print it. */
export class BoneEncodingRefusal extends Error {
  constructor(
    readonly part: string,
    readonly clips: string[],
    message: string,
  ) {
    super(message)
    this.name = 'BoneEncodingRefusal'
  }
}

interface Part {
  mesh: Mesh
  material: Material
  materialIndex: number
  vertexStart: number
  vertexCount: number
  skinned: SkinnedMesh | null
  /** First slot this part owns. Rigid parts own exactly one. */
  slotStart: number
  slotCount: number
}

const IDENTITY = new Matrix4()
const SCALE_EPSILON = 1e-4

/**
 * Refuse a subtree whose animation the encoding cannot store, naming the mesh
 * and the clips — the failure mode the issue asks to see, and the reason this
 * is a second encoding rather than a replacement.
 *
 * The test is the *animation*, not the attribute: a mesh that ships morph
 * targets nothing animates bakes fine, and refusing it would refuse
 * RobotExpressive's head on a walk cycle that never touches it.
 */
function refuseMorphAnimation(
  parts: Part[],
  clips: AnimationClip[],
  policy: 'refuse' | 'drop',
): { kept: Part[]; dropped: string[] } {
  const kept: Part[] = []
  const dropped: string[] = []
  for (const part of parts) {
    const targets = part.mesh.morphTargetInfluences
    const name = part.mesh.name || '(unnamed)'
    const animating =
      targets && targets.length > 0
        ? clips
            .filter((clip) =>
              clip.tracks.some(
                (t) => t.name.includes('morphTargetInfluences') && t.name.startsWith(`${name}.`),
              ),
            )
            .map((c) => c.name)
        : []
    if (animating.length === 0) {
      kept.push(part)
      continue
    }
    if (policy === 'refuse') {
      throw new BoneEncodingRefusal(
        name,
        animating,
        `three-vat: the bone encoding cannot bake "${name}" — ${animating.length === 1 ? 'clip' : 'clips'} ` +
          `${animating.map((c) => `"${c}"`).join(', ')} animate its morph targets, and a morph is not a bone. ` +
          'Bake this subtree with the vertex encoding (the default), or exclude the clips that morph it.',
      )
    }
    dropped.push(name)
  }
  if (kept.length === 0) {
    throw new BoneEncodingRefusal(
      dropped.join(', '),
      clips.map((c) => c.name),
      `three-vat: every part of this subtree morphs (${dropped.join(', ')}); there is nothing left to bake.`,
    )
  }
  return { kept, dropped }
}

/** Every mesh under `root`, grouped by material so each is one draw call. */
function collectParts(root: Object3D): Part[] {
  const found: Mesh[] = []
  root.traverse((o) => {
    const mesh = o as Mesh
    if (mesh.isMesh && mesh.geometry) found.push(mesh)
  })
  if (found.length === 0) throw new Error('prototype: no Mesh under root')

  const materials: Material[] = []
  const parts: Part[] = []
  for (const mesh of found) {
    if (Array.isArray(mesh.material)) throw new Error(`prototype: "${mesh.name}" uses a material array`)
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals()
    const material = mesh.material as Material
    let materialIndex = materials.indexOf(material)
    if (materialIndex === -1) materialIndex = materials.push(material) - 1
    const skinned = mesh as SkinnedMesh
    const isSkinned = !!mesh.geometry.attributes.skinWeight && !!skinned.skeleton
    parts.push({
      mesh,
      material,
      materialIndex,
      vertexStart: 0,
      vertexCount: mesh.geometry.attributes.position!.count,
      skinned: isSkinned ? skinned : null,
      slotStart: 0,
      slotCount: isSkinned ? skinned.skeleton.bones.length : 1,
    })
  }

  parts.sort((a, b) => a.materialIndex - b.materialIndex)
  let vertex = 0
  let slot = 0
  for (const part of parts) {
    part.vertexStart = vertex
    vertex += part.vertexCount
    part.slotStart = slot
    slot += part.slotCount
  }
  return parts
}

/**
 * Merge into local-space geometry carrying the two attributes the encoding
 * needs: which slots move a vertex, and by how much. A rigid part's vertices
 * all name its one slot at full weight, which is how one decode covers both
 * kinds of part with no branch.
 */
function mergeGeometry(parts: Part[], total: number): BufferGeometry {
  const position = new Float32Array(total * 3)
  const normal = new Float32Array(total * 3)
  const slotIndex = new Float32Array(total * 4)
  const slotWeight = new Float32Array(total * 4)
  const wantUV = parts.every((p) => !!p.mesh.geometry.attributes.uv)
  const uv = wantUV ? new Float32Array(total * 2) : null

  for (const part of parts) {
    const geometry = part.mesh.geometry
    const src = geometry.attributes.position as BufferAttribute
    const srcN = geometry.attributes.normal as BufferAttribute
    const srcUV = geometry.attributes.uv as BufferAttribute | undefined
    const si = geometry.attributes.skinIndex as BufferAttribute | undefined
    const sw = geometry.attributes.skinWeight as BufferAttribute | undefined

    for (let v = 0; v < part.vertexCount; v++) {
      const vi = part.vertexStart + v
      position[vi * 3] = src.getX(v)
      position[vi * 3 + 1] = src.getY(v)
      position[vi * 3 + 2] = src.getZ(v)
      normal[vi * 3] = srcN.getX(v)
      normal[vi * 3 + 1] = srcN.getY(v)
      normal[vi * 3 + 2] = srcN.getZ(v)
      if (uv && srcUV) {
        uv[vi * 2] = srcUV.getX(v)
        uv[vi * 2 + 1] = srcUV.getY(v)
      }
      if (part.skinned && si && sw) {
        for (let i = 0; i < 4; i++) {
          slotIndex[vi * 4 + i] = part.slotStart + si.getComponent(v, i)
          slotWeight[vi * 4 + i] = sw.getComponent(v, i)
        }
      } else {
        slotIndex[vi * 4] = part.slotStart
        slotWeight[vi * 4] = 1
      }
    }
  }

  // Always indexed, exactly as `mergeGeometry` in src/bake.ts is, and for the
  // same reason: a group is a range of *indices*, so a non-indexed part has to
  // contribute a sequential run rather than be left to the draw order.
  // Forgetting this is not subtle — the crowd renders in the right places, at
  // the right scale, as confetti.
  const indices: number[] = []
  const groups: { start: number; count: number; materialIndex: number }[] = []
  for (const part of parts) {
    const groupStart = indices.length
    const index = part.mesh.geometry.index
    if (index) {
      for (let i = 0; i < index.count; i++) indices.push(part.vertexStart + index.getX(i))
    } else {
      for (let v = 0; v < part.vertexCount; v++) indices.push(part.vertexStart + v)
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

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('vatSlotIndex', new BufferAttribute(slotIndex, 4))
  geometry.setAttribute('vatSlotWeight', new BufferAttribute(slotWeight, 4))
  if (uv) geometry.setAttribute('uv', new BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  for (const g of groups) geometry.addGroup(g.start, g.count, g.materialIndex)
  return geometry
}

/** Does this matrix scale its three axes by different amounts? */
function nonUniform(m: Matrix4): boolean {
  const e = m.elements
  const x = e[0]! ** 2 + e[1]! ** 2 + e[2]! ** 2
  const y = e[4]! ** 2 + e[5]! ** 2 + e[6]! ** 2
  const z = e[8]! ** 2 + e[9]! ** 2 + e[10]! ** 2
  const max = Math.max(x, y, z)
  return max - Math.min(x, y, z) > SCALE_EPSILON * max
}

/**
 * Bake the rig rather than the vertices.
 *
 * Same clip bands, same `startFrame`/`frames` table and same playback defaults
 * as `bakeVAT`, so the playback texture and `resolveVATFrame` above this are
 * untouched — which is the 2.0 architecture claim the whole idea leans on.
 */
export function bakeBones(
  root: Object3D,
  clips: AnimationClip[],
  {
    fps = 30,
    format = 'mat4',
    maxTextureSize = 16384,
    onMorphAnimation = 'refuse',
  }: BoneBakeOptions = {},
): BoneBake {
  const started = performance.now()
  root.updateMatrixWorld(true)
  const { kept: parts, dropped: droppedParts } = refuseMorphAnimation(
    collectParts(root),
    clips,
    onMorphAnimation,
  )
  // Offsets are assigned after the drop, not before: a hole in the vertex or
  // slot numbering would index the texture past its own rows. Material indices
  // are compacted for the same reason — dropping the only part that used
  // material 3 would otherwise leave `materials[3]` undefined, and a geometry
  // group pointing at it.
  let vertexOffset = 0
  let slotOffset = 0
  const remap = new Map<number, number>()
  for (const part of parts) {
    part.vertexStart = vertexOffset
    vertexOffset += part.vertexCount
    part.slotStart = slotOffset
    slotOffset += part.slotCount
    let index = remap.get(part.materialIndex)
    if (index === undefined) {
      index = remap.size
      remap.set(part.materialIndex, index)
    }
    part.materialIndex = index
  }

  const vertexCount = parts.reduce((n, p) => n + p.vertexCount, 0)
  const slotCount = parts.reduce((n, p) => n + p.slotCount, 0)
  const rigs = new Set<Skeleton>()
  for (const p of parts) if (p.skinned) rigs.add(p.skinned.skeleton)
  const idealSlotCount =
    [...rigs].reduce((n, r) => n + r.bones.length, 0) + parts.filter((p) => !p.skinned).length

  const stride = TEXELS_PER_SLOT[format]
  const width = slotCount * stride
  if (width > maxTextureSize) {
    throw new Error(`prototype: ${slotCount} slots x ${stride} texels = ${width} > ${maxTextureSize}`)
  }

  const frameCounts = clips.map((c) => Math.max(2, Math.round(c.duration * fps)))
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0)
  if (totalFrames > maxTextureSize) throw new Error(`prototype: ${totalFrames} frames > ${maxTextureSize}`)

  const geometry = mergeGeometry(parts, vertexCount)
  const data = new Float32Array(width * totalFrames * 4)

  const rootInverse = root.matrixWorld.clone().invert()
  const partMatrix = new Matrix4()
  const slotMatrix = new Matrix4()
  const translation = new Vector3()
  const rotation = new Quaternion()
  const scale = new Vector3()
  // Previous frame's quaternion per slot, so `qt` rows stay on one hemisphere
  // and the shader's row blend needs no sign test. Rotations are only ever
  // interpolated *between rows*; blending across bones happens on matrices.
  const previous = format === 'qt' ? new Float32Array(slotCount * 4) : null

  const mixer = new AnimationMixer(root)
  const clipTable: VATClip[] = []
  const bounds = new Box3()
  const restPoint = new Vector3()
  const nonUniformBones = new Set<string>()

  // Each part's rest box in its own local space, computed once. A skinned
  // part's box is its bind pose, which is what the slot matrices transform.
  const partBounds = new Map<Part, Box3>()
  for (const part of parts) {
    if (!part.mesh.geometry.boundingBox) part.mesh.geometry.computeBoundingBox()
    partBounds.set(part, part.mesh.geometry.boundingBox!)
  }

  let rowOffset = 0
  clips.forEach((clip, ci) => {
    const frames = frameCounts[ci]!
    const action = mixer.clipAction(clip)
    action.play()

    for (let f = 0; f < frames; f++) {
      mixer.setTime((f / frames) * clip.duration)
      root.updateMatrixWorld(true)
      const row = rowOffset + f

      for (const part of parts) {
        partMatrix.multiplyMatrices(rootInverse, part.mesh.matrixWorld)
        const skinned = part.skinned

        for (let b = 0; b < part.slotCount; b++) {
          if (skinned) {
            const bone = skinned.skeleton.bones[b]
            slotMatrix
              .multiplyMatrices(bone?.matrixWorld ?? IDENTITY, skinned.skeleton.boneInverses[b]!)
              .premultiply(skinned.bindMatrixInverse)
              .multiply(skinned.bindMatrix)
              .premultiply(partMatrix)
          } else {
            slotMatrix.copy(partMatrix)
          }

          if (nonUniform(slotMatrix)) {
            nonUniformBones.add(skinned ? skinned.skeleton.bones[b]?.name || `bone ${b}` : part.mesh.name)
          }

          // Bounds, from the convex-hull property of linear blend skinning:
          // the weights are non-negative and sum to one, so every skinned
          // vertex is a convex combination of the points `M_i p` and lies
          // inside the union of the slot boxes. Eight corners per slot per
          // frame bounds the animated crowd without touching a vertex.
          const box = partBounds.get(part)!
          for (let c = 0; c < 8; c++) {
            restPoint.set(
              c & 1 ? box.max.x : box.min.x,
              c & 2 ? box.max.y : box.min.y,
              c & 4 ? box.max.z : box.min.z,
            )
            bounds.expandByPoint(restPoint.applyMatrix4(slotMatrix))
          }

          const slot = part.slotStart + b
          const o = (row * width + slot * stride) * 4
          if (format === 'mat4') {
            // Column-major, one texel per column — the order `mat4(c0,c1,c2,c3)`
            // reads them back in GLSL.
            data.set(slotMatrix.elements, o)
          } else {
            slotMatrix.decompose(translation, rotation, scale)
            // Hemisphere continuity, per slot, across the whole bake.
            if (previous) {
              const p = slot * 4
              const dot =
                previous[p]! * rotation.x +
                previous[p + 1]! * rotation.y +
                previous[p + 2]! * rotation.z +
                previous[p + 3]! * rotation.w
              if (dot < 0) {
                rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w)
              }
              previous[p] = rotation.x
              previous[p + 1] = rotation.y
              previous[p + 2] = rotation.z
              previous[p + 3] = rotation.w
            }
            data[o] = rotation.x
            data[o + 1] = rotation.y
            data[o + 2] = rotation.z
            data[o + 3] = rotation.w
            data[o + 4] = translation.x
            data[o + 5] = translation.y
            data[o + 6] = translation.z
            // Uniform scale rides in the translation texel's spare component.
            // Non-uniform scale is reported above and lost here — the honest
            // limit of two texels, and why `mat4` stays in the comparison.
            data[o + 7] = (scale.x + scale.y + scale.z) / 3
          }
        }

      }
    }

    action.stop()
    clipTable.push({
      name: clip.name,
      startFrame: rowOffset,
      frames,
      fps: frames / clip.duration,
      duration: clip.duration,
      maxDelta: 0, // a bone bake stores no deltas; the VAT's number is the one to read
      loopMode: LoopMode.Repeat,
      repetitions: INFINITE_REPETITIONS,
      endMode: EndMode.Clamp,
      speed: 1,
    })
    rowOffset += frames
  })

  mixer.stopAllAction()
  mixer.setTime(0)
  root.updateMatrixWorld(true)

  const materials: Material[] = []
  for (const part of parts) materials[part.materialIndex] = part.material

  return {
    texture: makeVATTexture(data, width, totalFrames),
    geometry,
    materials,
    clips: clipTable,
    bounds,
    format,
    slotCount,
    idealSlotCount,
    totalFrames,
    bytes: data.byteLength,
    bakeMs: performance.now() - started,
    nonUniformBones: [...nonUniformBones],
    droppedParts,
  }
}
