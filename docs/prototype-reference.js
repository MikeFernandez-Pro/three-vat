// PROTOTYPE — throwaway code validating the VAT bake recipe from
// Portfolio2024/docs/vat-project-report.md. Not the library.
import * as THREE from 'three'

// Bakes skinned AnimationClips into two float DataTextures.
// Layout: x = vertexIndex, y = frame, clips stacked vertically.
// Position texture stores DELTAS from the bind pose (shader does position + delta).
// Normal texture stores absolute skinned normals.
export function bakeVAT(root, skinnedMesh, clips, { fps = 30 } = {}) {
  const t0 = performance.now()
  const geometry = skinnedMesh.geometry
  const vertexCount = geometry.attributes.position.count
  const maxSize = 16384
  if (vertexCount > maxSize) throw new Error(`vertexCount ${vertexCount} > ${maxSize}; row wrapping not implemented`)

  const frameCounts = clips.map((c) => Math.max(2, Math.round(c.duration * fps)))
  const totalFrames = frameCounts.reduce((a, b) => a + b, 0)

  const posData = new Float32Array(vertexCount * totalFrames * 4)
  const nrmData = new Float32Array(vertexCount * totalFrames * 4)

  const basePos = geometry.attributes.position
  const baseNrm = geometry.attributes.normal
  const skinIndex = geometry.attributes.skinIndex
  const skinWeight = geometry.attributes.skinWeight
  const skeleton = skinnedMesh.skeleton
  const mixer = new THREE.AnimationMixer(root)

  const bounds = new THREE.Box3()
  const clipTable = []

  const _si = new THREE.Vector4()
  const _sw = new THREE.Vector4()
  const _bone = new THREE.Matrix4()
  const _acc = new THREE.Matrix4()
  const _skin = new THREE.Matrix4()
  const _p = new THREE.Vector3()
  const _bp = new THREE.Vector3()
  const _n = new THREE.Vector3()

  let rowOffset = 0
  clips.forEach((clip, ci) => {
    const frames = frameCounts[ci]
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
          _bone.multiplyMatrices(skeleton.bones[bi].matrixWorld, skeleton.boneInverses[bi])
          const ae = _acc.elements
          const be = _bone.elements
          for (let e = 0; e < 16; e++) ae[e] += be[e] * w
        }
        _skin.multiplyMatrices(_acc, skinnedMesh.bindMatrix).premultiply(skinnedMesh.bindMatrixInverse)

        _bp.fromBufferAttribute(basePos, v)
        _p.copy(_bp).applyMatrix4(_skin)
        bounds.expandByPoint(_p)

        // Normals via the skin matrix directly (three's skinnormal_vertex does the
        // same — blended rigid transforms, no inverse-transpose needed).
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
    posTexture: makeDataTexture(posData, vertexCount, totalFrames),
    nrmTexture: makeDataTexture(nrmData, vertexCount, totalFrames),
    clips: clipTable,
    bounds,
    vertexCount,
    totalFrames,
    bakeMs: performance.now() - t0,
    bytes: posData.byteLength + nrmData.byteLength,
  }
}

function makeDataTexture(data, width, height) {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

// Per-instance attributes consumed by the patched shaders.
export function addInstancedVATAttributes(geometry, instances) {
  const n = instances.length
  const clipStart = new Float32Array(n)
  const clipFrames = new Float32Array(n)
  const clipFps = new Float32Array(n)
  const timeOffset = new Float32Array(n)
  const speed = new Float32Array(n)
  instances.forEach((inst, i) => {
    clipStart[i] = inst.clip.startFrame
    clipFrames[i] = inst.clip.frames
    clipFps[i] = inst.clip.fps
    timeOffset[i] = inst.timeOffset
    speed[i] = inst.speed
  })
  geometry.setAttribute('aClipStart', new THREE.InstancedBufferAttribute(clipStart, 1))
  geometry.setAttribute('aClipFrames', new THREE.InstancedBufferAttribute(clipFrames, 1))
  geometry.setAttribute('aClipFps', new THREE.InstancedBufferAttribute(clipFps, 1))
  geometry.setAttribute('aTimeOffset', new THREE.InstancedBufferAttribute(timeOffset, 1))
  geometry.setAttribute('aSpeed', new THREE.InstancedBufferAttribute(speed, 1))
}

// Self-contained decode: each injection point calls vatSample() independently.
// This MUST NOT be split into shared local variables across injection points —
// MeshDepthMaterial contains '#include <beginnormal_vertex>' inside
// '#ifdef USE_DISPLACEMENTMAP' (dead code), so anything injected there can
// silently vanish and break a later injection that depended on it.
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

// Patches any built-in material (including MeshDepthMaterial for shadows) so the
// vertex stage samples the VAT textures instead of using skinning.
export function patchVATMaterial(material, vat, sharedUniforms) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVatPosTex = { value: vat.posTexture }
    shader.uniforms.uVatNrmTex = { value: vat.nrmTexture }
    shader.uniforms.uVatTime = sharedUniforms.uVatTime

    shader.vertexShader = DECODE_PRELUDE + shader.vertexShader
      .replace('#include <begin_vertex>', DECODE_POSITION)
      .replace('#include <beginnormal_vertex>', DECODE_NORMAL)
  }
  // Distinct cache key so patched materials never share a program with unpatched ones.
  material.customProgramCacheKey = () => 'vat-prototype'
}
