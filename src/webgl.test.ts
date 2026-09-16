import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Material,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  Sphere,
  Vector3,
} from 'three'
import type { IUniform, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import type { BakedVAT } from './types.js'
import { addInstancedVATAttributes, createVATMesh, createVATUniforms } from './webgl.js'

const instance = { clip: { startFrame: 0, frames: 10, fps: 30 }, timeOffset: 1, speed: 2 }

describe('addInstancedVATAttributes', () => {
  it('attaches the per-instance attributes the shader reads', () => {
    const geometry = new BufferGeometry()
    addInstancedVATAttributes(geometry, [instance, instance])

    for (const name of ['aClipStart', 'aClipFrames', 'aClipFps', 'aTimeOffset', 'aSpeed']) {
      expect(geometry.getAttribute(name).count).toBe(2)
    }
  })

  it('strips morph targets, which the VAT supersedes', () => {
    // A morph-baked source geometry still carries its targets after cloning;
    // leaving them on an InstancedMesh crashes three's morph path.
    const geometry = new BufferGeometry()
    geometry.morphAttributes.position = [new BufferAttribute(new Float32Array([1, 0, 0]), 3)]
    geometry.morphTargetsRelative = true

    addInstancedVATAttributes(geometry, [instance])

    expect(geometry.morphAttributes.position).toBeUndefined()
    expect(geometry.morphTargetsRelative).toBe(false)
  })
})

// ---------------------------------------------------------------- createVATMesh

/**
 * A baked VAT with two material groups — the shape the one-call path has to get
 * right, since a merged subtree is the normal case (ADR-0008) and one material
 * per group is what keeps a crowd at one draw call per material.
 */
function makeBakedVAT(): BakedVAT {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(18), 3))
  geometry.addGroup(0, 3, 0)
  geometry.addGroup(3, 3, 1)

  // The union of every baked frame's extent — set on the geometry by the baker
  // so instances never cull mid-animation.
  const bounds = new Box3(new Vector3(-2, 0, -2), new Vector3(2, 3, 2))
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  const texture = () => new DataTexture(new Float32Array(4), 1, 1)
  return {
    positionTexture: texture(),
    normalTexture: texture(),
    clips: [{ name: 'walk', startFrame: 0, frames: 10, fps: 30, duration: 10 / 30, maxDelta: 0.5 }],
    bounds,
    vertexCount: 6,
    totalFrames: 10,
    encoding: 'delta',
    geometry,
    materials: [new MeshStandardMaterial({ name: 'body' }), new MeshStandardMaterial({ name: 'visor' })],
  }
}

const crowd = [
  { clip: { startFrame: 0, frames: 10, fps: 30 }, timeOffset: 1.5, speed: 2 },
  { clip: { startFrame: 10, frames: 8, fps: 24 }, timeOffset: 0.25, speed: 0.5 },
]

/**
 * Run a patched material's `onBeforeCompile` against a stand-in for three's
 * shader object, so the uniforms and injections a real compile would see can be
 * asserted headlessly.
 */
function compile(material: Material) {
  const shader = {
    uniforms: {} as Record<string, IUniform>,
    vertexShader: 'void main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}',
    fragmentShader: '',
  }
  expect(material.onBeforeCompile, `${material.type} is not VAT-patched`).not.toBe(Material.prototype.onBeforeCompile)
  material.onBeforeCompile(shader as unknown as WebGLProgramParametersWithUniforms, null as unknown as WebGLRenderer)
  return shader
}

describe('createVATMesh', () => {
  it('returns a renderable InstancedMesh carrying the crowd', () => {
    const vat = makeBakedVAT()

    const { mesh } = createVATMesh(vat, crowd)

    expect(mesh.count).toBe(2)
    expect(mesh.geometry.getAttribute('aClipStart').array).toEqual(new Float32Array([0, 10]))
    expect(mesh.geometry.getAttribute('aClipFrames').array).toEqual(new Float32Array([10, 8]))
    expect(mesh.geometry.getAttribute('aClipFps').array).toEqual(new Float32Array([30, 24]))
    expect(mesh.geometry.getAttribute('aTimeOffset').array).toEqual(new Float32Array([1.5, 0.25]))
    expect(mesh.geometry.getAttribute('aSpeed').array).toEqual(new Float32Array([2, 0.5]))
  })

  it('clones the baked geometry, so a second crowd off the same VAT is untouched', () => {
    const vat = makeBakedVAT()

    const { mesh } = createVATMesh(vat, crowd)

    expect(mesh.geometry).not.toBe(vat.geometry)
    expect(vat.geometry.getAttribute('aClipStart')).toBeUndefined()
    // The clone must carry the all-frames bounds with it, or a deformed crowd
    // culls mid-animation.
    expect(mesh.geometry.boundingBox).toEqual(vat.geometry.boundingBox)
  })

  it('prepares one patched material per geometry group, cloned from the source', () => {
    const vat = makeBakedVAT()

    const { mesh } = createVATMesh(vat, crowd)

    const materials = mesh.material as Material[]
    expect(materials.map((m) => m.name)).toEqual(['body', 'visor'])
    // Every group must resolve to a material: `materialIndex` indexes this
    // array, and a group pointing past its end draws nothing at all.
    for (const group of mesh.geometry.groups) expect(materials[group.materialIndex!]).toBeDefined()
    for (const [i, material] of materials.entries()) {
      expect(material, 'the source material must not be mutated').not.toBe(vat.materials[i])
      expect(compile(material).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
    }
  })

  it('attaches the depth material instanced shadows need', () => {
    const vat = makeBakedVAT()

    const { mesh } = createVATMesh(vat, crowd)

    const depth = mesh.customDepthMaterial as MeshDepthMaterial
    expect(depth).toBeInstanceOf(MeshDepthMaterial)
    expect(depth.depthPacking).toBe(RGBADepthPacking)
    expect(compile(depth).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('attaches the distance material point-light shadows need', () => {
    // Which shadow material a scene uses is a property of its lights, so a
    // crowd that deforms under a directional light and snaps to the bind pose
    // under a point light is exactly the surprise this call removes.
    const vat = makeBakedVAT()

    const { mesh } = createVATMesh(vat, crowd)

    const distance = mesh.customDistanceMaterial as MeshDistanceMaterial
    expect(distance).toBeInstanceOf(MeshDistanceMaterial)
    expect(compile(distance).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('drives every material and the depth pass from one exposed clock', () => {
    const vat = makeBakedVAT()

    const { mesh, time } = createVATMesh(vat, crowd)
    time.value = 3

    const patched = [...(mesh.material as Material[]), mesh.customDepthMaterial!, mesh.customDistanceMaterial!]
    for (const material of patched) {
      expect(compile(material).uniforms['uVatTime']).toBe(time)
    }
  })

  it('shares a caller-owned clock, so two crowds animate off one time value', () => {
    const time = createVATUniforms().uVatTime

    const a = createVATMesh(makeBakedVAT(), crowd, { time })
    const b = createVATMesh(makeBakedVAT(), crowd, { time })

    expect(a.time).toBe(time)
    expect(compile((a.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
    expect(compile((b.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
  })
})
