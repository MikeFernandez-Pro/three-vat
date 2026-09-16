import {
  BufferAttribute,
  BufferGeometry,
  Material,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  RGBADepthPacking,
} from 'three'
import type { IUniform, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { makeBakedVATFixture, makeFixtureCrowd } from './test-utils.js'
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
    const vat = makeBakedVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.count).toBe(2)
    expect(mesh.geometry.getAttribute('aClipStart').array).toEqual(new Float32Array([0, 10]))
    expect(mesh.geometry.getAttribute('aClipFrames').array).toEqual(new Float32Array([10, 8]))
    expect(mesh.geometry.getAttribute('aClipFps').array).toEqual(new Float32Array([30, 24]))
    expect(mesh.geometry.getAttribute('aTimeOffset').array).toEqual(new Float32Array([1.5, 0.25]))
    expect(mesh.geometry.getAttribute('aSpeed').array).toEqual(new Float32Array([2, 0.5]))
  })

  it('clones the baked geometry, so a second crowd off the same VAT is untouched', () => {
    const vat = makeBakedVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.geometry).not.toBe(vat.geometry)
    expect(vat.geometry.getAttribute('aClipStart')).toBeUndefined()
    // The clone must carry the all-frames bounds with it, or a deformed crowd
    // culls mid-animation.
    expect(mesh.geometry.boundingBox).toEqual(vat.geometry.boundingBox)
  })

  it('prepares one patched material per geometry group, cloned from the source', () => {
    const vat = makeBakedVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

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
    const vat = makeBakedVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const depth = mesh.customDepthMaterial as MeshDepthMaterial
    expect(depth).toBeInstanceOf(MeshDepthMaterial)
    expect(depth.depthPacking).toBe(RGBADepthPacking)
    expect(compile(depth).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('attaches the distance material point-light shadows need', () => {
    // Which shadow material a scene uses is a property of its lights, so a
    // crowd that deforms under a directional light and snaps to the bind pose
    // under a point light is exactly the surprise this call removes.
    const vat = makeBakedVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const distance = mesh.customDistanceMaterial as MeshDistanceMaterial
    expect(distance).toBeInstanceOf(MeshDistanceMaterial)
    expect(compile(distance).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('drives every material and the depth pass from one exposed clock', () => {
    const vat = makeBakedVATFixture()

    const { mesh, time } = createVATMesh(vat, makeFixtureCrowd())
    time.value = 3

    const patched = [...(mesh.material as Material[]), mesh.customDepthMaterial!, mesh.customDistanceMaterial!]
    for (const material of patched) {
      expect(compile(material).uniforms['uVatTime']).toBe(time)
    }
  })

  it('shares a caller-owned clock, so two crowds animate off one time value', () => {
    const time = createVATUniforms().uVatTime

    const a = createVATMesh(makeBakedVATFixture(), makeFixtureCrowd(), { time })
    const b = createVATMesh(makeBakedVATFixture(), makeFixtureCrowd(), { time })

    expect(a.time).toBe(time)
    expect(compile((a.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
    expect(compile((b.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
  })
})
