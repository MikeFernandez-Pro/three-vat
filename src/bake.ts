import {
  AnimationMixer,
  Box3,
  DataTexture,
  FloatType,
  Matrix4,
  NearestFilter,
  RGBAFormat,
  Vector3,
  Vector4,
} from 'three'
import type { AnimationClip, BufferAttribute, Object3D, SkinnedMesh, TextureDataType, TypedArray } from 'three'
import type { VAT, VATClip } from './types.js'

/** Maximum texture dimension we support; `vertexCount` must not exceed it. */
export const MAX_TEXTURE_SIZE = 16384

export interface BakeOptions {
  /** Sample rate in frames per second. Default `30`. */
  fps?: number
}

/**
 * Bake skinned `AnimationClip`s into a VAT by sampling the posed mesh frame by
 * frame on the CPU. Positions are stored as deltas from the bind pose; normals
 * are stored absolute. Renderer-agnostic — touches no WebGL/WebGPU context — so
 * it runs identically at runtime and offline in Node.
 */
export function bakeVAT(
  root: Object3D,
  skinnedMesh: SkinnedMesh,
  clips: AnimationClip[],
  { fps = 30 }: BakeOptions = {},
): VAT {
  const geometry = skinnedMesh.geometry
  const vertexCount = geometry.attributes.position.count
  if (vertexCount > MAX_TEXTURE_SIZE) {
    throw new Error(
      `three-vat: vertexCount ${vertexCount} exceeds MAX_TEXTURE_SIZE ${MAX_TEXTURE_SIZE}; row wrapping is not implemented`,
    )
  }

  const frameCounts = clips.map((c) => Math.max(2, Math.round(c.duration * fps)))
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0)

  const posData = new Float32Array(vertexCount * totalFrames * 4)
  const nrmData = new Float32Array(vertexCount * totalFrames * 4)

  // VAT bakes a plain (non-interleaved) skinned mesh; narrow to BufferAttribute.
  const basePos = geometry.attributes.position as BufferAttribute
  const baseNrm = geometry.attributes.normal as BufferAttribute
  const skinIndex = geometry.attributes.skinIndex as BufferAttribute
  const skinWeight = geometry.attributes.skinWeight as BufferAttribute
  const skeleton = skinnedMesh.skeleton
  const mixer = new AnimationMixer(root)

  const bounds = new Box3()
  const clipTable: VATClip[] = []

  const _si = new Vector4()
  const _sw = new Vector4()
  const _bone = new Matrix4()
  const _acc = new Matrix4()
  const _skin = new Matrix4()
  const _p = new Vector3()
  const _bp = new Vector3()
  const _n = new Vector3()

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

      for (let v = 0; v < vertexCount; v++) {
        // Blended skin matrix, same math as SkinnedMesh.applyBoneTransform:
        // sum(w_i * boneWorld_i * boneInverse_i), wrapped in bind space.
        _si.fromBufferAttribute(skinIndex, v)
        _sw.fromBufferAttribute(skinWeight, v)
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
        _skin.multiplyMatrices(_acc, skinnedMesh.bindMatrix).premultiply(skinnedMesh.bindMatrixInverse)

        _bp.fromBufferAttribute(basePos, v)
        _p.copy(_bp).applyMatrix4(_skin)
        bounds.expandByPoint(_p)

        // Normals via the skin matrix directly — three's `skinnormal_vertex`
        // does the same (blended rigid transforms, no inverse-transpose).
        _n.fromBufferAttribute(baseNrm, v).transformDirection(_skin)

        const o = (row * vertexCount + v) * 4
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

  return {
    positionTexture: makeVATTexture(posData, vertexCount, totalFrames),
    normalTexture: makeVATTexture(nrmData, vertexCount, totalFrames),
    clips: clipTable,
    bounds,
    vertexCount,
    totalFrames,
    encoding: 'delta',
  }
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
