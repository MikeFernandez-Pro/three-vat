import {
  Material,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
} from 'three'
import type { IUniform, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { makeVATFixture, makeFixtureCrowd } from './test-utils.js'
import { createVATMesh, createVATUniforms } from './webgl.js'

// `addVATInstanceAttributes` itself is covered in instance-playback.test.ts —
// it is core, not WebGL. What belongs here is the other half of the contract:
// that the GLSL decode reads the pack those tests describe.

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
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.count).toBe(2)
    // x = clip start row, y = frames, z = fps, w = speed — for both instances.
    expect(mesh.geometry.getAttribute('aVatClip').array).toEqual(
      new Float32Array([0, 10, 30, 2, 10, 8, 24, 0.5]),
    )
    // x = start time; y/z/w are today's one policy — repeat, forever, clamp.
    expect(mesh.geometry.getAttribute('aVatPlayback').array).toEqual(
      new Float32Array([-1.5, 0, -1, 0, -0.25, 0, -1, 0]),
    )
  })

  it('clones the baked geometry, so a second crowd off the same VAT is untouched', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.geometry).not.toBe(vat.geometry)
    expect(vat.geometry.getAttribute('aVatClip')).toBeUndefined()
    // The clone must carry the all-frames bounds with it, or a deformed crowd
    // culls mid-animation.
    expect(mesh.geometry.boundingBox).toEqual(vat.geometry.boundingBox)
  })

  it('prepares one patched material per geometry group, cloned from the source', () => {
    const vat = makeVATFixture()

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
    const vat = makeVATFixture()

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
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const distance = mesh.customDistanceMaterial as MeshDistanceMaterial
    expect(distance).toBeInstanceOf(MeshDistanceMaterial)
    expect(compile(distance).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('drives every material and the depth pass from one exposed clock', () => {
    const vat = makeVATFixture()

    const { mesh, time } = createVATMesh(vat, makeFixtureCrowd())
    time.value = 3

    const patched = [...(mesh.material as Material[]), mesh.customDepthMaterial!, mesh.customDistanceMaterial!]
    for (const material of patched) {
      expect(compile(material).uniforms['uVatTime']).toBe(time)
    }
  })

  it('shares a caller-owned clock, so two crowds animate off one time value', () => {
    const time = createVATUniforms().uVatTime

    const a = createVATMesh(makeVATFixture(), makeFixtureCrowd(), { time })
    const b = createVATMesh(makeVATFixture(), makeFixtureCrowd(), { time })

    expect(a.time).toBe(time)
    expect(compile((a.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
    expect(compile((b.mesh.material as Material[])[0]!).uniforms['uVatTime']).toBe(time)
  })
})

describe('the GLSL decode reads the instance-playback pack', () => {
  it('declares the two vec4s it reads, and samples through them', () => {
    // The decode's own arithmetic, asserted as source: this is the only place
    // in CI where the GLSL the shader actually compiles can be inspected, and
    // the pack's component order is the thing a repack gets wrong silently.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    const { vertexShader } = compile((mesh.material as Material[])[0]!)
    expect(vertexShader).toContain('attribute vec4 aVatClip;')
    expect(vertexShader).toContain('attribute vec4 aVatPlayback;')
    // frames / fps, the clip's duration.
    expect(vertexShader).toContain('float frames = aVatClip.y;')
    expect(vertexShader).toContain('float duration = frames / aVatClip.z;')
    // ( now - startTime ) * speed, the local time this instance is at.
    expect(vertexShader).toContain('( uVatTime - aVatPlayback.x ) * aVatClip.w')
    // The band is addressed from the clip's own start row.
    expect(vertexShader).toContain('int( aVatClip.x )')
  })

  it('leaves the fade slot undeclared, because nothing reads it yet', () => {
    // Written by the contract, read by no decode until crossfade lands. A
    // declared-but-unused attribute is dead source, and the GLSL compiler would
    // strip its binding anyway.
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    expect(compile((mesh.material as Material[])[0]!).vertexShader).not.toContain('aVatFade')
  })
})

describe('createVATMesh on a VAT baked without normals', () => {
  it('samples the position texture and nothing else', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    for (const material of mesh.material as Material[]) {
      const shader = compile(material)
      expect(shader.uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
      // No dead uniform left bound, and no sampler declared for it.
      expect(shader.uniforms['uVatNrmTex']).toBeUndefined()
      expect(shader.vertexShader).not.toContain('uVatNrmTex')
    }
  })

  it('leaves three’s own normal stage alone, so flatShading can do its work', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const shader = compile((mesh.material as Material[])[0]!)
    expect(shader.vertexShader).toContain('#include <beginnormal_vertex>')
    expect(shader.vertexShader).not.toContain('objectNormal')
    // The position decode is untouched by any of this.
    expect(shader.vertexShader).toContain('vec3 transformed = position + vatSample( uVatPosTex );')
  })

  it('still patches the shadow materials, which shade from nothing', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(compile(mesh.customDepthMaterial!).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
    expect(compile(mesh.customDistanceMaterial!).uniforms['uVatPosTex']?.value).toBe(vat.positionTexture)
  })

  it('refuses a smooth-shaded lit material rather than lighting the rest pose', () => {
    // The one pairing `bakeNormals: false` must not render: the crowd would be
    // lit by bind-pose normals, which is the failure bakeVAT exists to prevent
    // (ADR-0002). It is silent if allowed through — the geometry still carries
    // a rest normal for three to shade with.
    const vat = makeVATFixture({ bakeNormals: false })
    ;(vat.materials[0] as MeshStandardMaterial).flatShading = false

    expect(() => createVATMesh(vat, makeFixtureCrowd())).toThrow(/bakeNormals: false/)
  })
})

describe('program cache keys', () => {
  it('separates the two patches, so the shadow materials cannot share a program', () => {
    // A normal-less VAT injects a different vertex shader off the same material
    // parameters. On the render material `flatShading` happens to differ too,
    // but `createVATDepthMaterial` builds the identical MeshDepthMaterial for
    // either kind of VAT — so without distinct keys the second crowd's shadow
    // pass would be handed the first's compiled program (ADR-0006).
    const withNormals = createVATMesh(makeVATFixture(), makeFixtureCrowd())
    const without = createVATMesh(makeVATFixture({ bakeNormals: false }), makeFixtureCrowd())

    const key = (material: Material) => material.customProgramCacheKey()
    expect(key(without.mesh.customDepthMaterial!)).not.toBe(key(withNormals.mesh.customDepthMaterial!))
    expect(key(without.mesh.customDistanceMaterial!)).not.toBe(key(withNormals.mesh.customDistanceMaterial!))
    expect(key((without.mesh.material as Material[])[0]!)).not.toBe(
      key((withNormals.mesh.material as Material[])[0]!),
    )
  })

  it('still separates a patched material from an unpatched one', () => {
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    expect((mesh.material as Material[])[0]!.customProgramCacheKey()).toBe('three-vat')
    expect(new MeshStandardMaterial().customProgramCacheKey()).not.toBe('three-vat')
  })
})
