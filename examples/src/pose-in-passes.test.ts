// A WebGL pass that draws the scene under a material of its own draws a VAT
// crowd in its rest pose, so the fix hands each crowd a VAT-patched copy of
// that material for as long as the pass draws, and takes it back after. Held
// here off a real bake of a stand-in and three's own materials, calling the
// scene's render hooks the way WebGLRenderer does around each render; that the
// copy then draws the running pose is the pages' to show.
import { AnimationClip, BoxGeometry, Camera, Group, Mesh, MeshDepthMaterial, MeshStandardMaterial, Scene, ShaderMaterial, WebGLRenderer, type Material } from 'three'
import { bakeVAT, type VATInstance } from 'three-vat'
import { createVATMesh } from 'three-vat/webgl'
import { describe, expect, it } from 'vitest'
import { followThePose } from './pose-in-passes.js'

function stage() {
  const root = new Group()
  root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: 'Body' })))
  root.updateMatrixWorld(true)
  const vat = bakeVAT(root, [new AnimationClip('Still', 1, [])], { encoding: 'delta' })
  const instances: VATInstance[] = [{ clip: vat.clips[0]!, startTime: 0 }]
  const crowds = [createVATMesh(vat, instances), createVATMesh(vat, instances)]
  const scene = new Scene()
  for (const crowd of crowds) scene.add(crowd.mesh)
  // Something else in the scene, which the pass's own material must go on drawing.
  const floor = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
  scene.add(floor)
  const fix = followThePose(scene, vat, crowds)
  return { vat, crowds, scene, floor, fix }
}

/** One `renderer.render(scene, camera)`, as far as the scene can tell. */
function render(scene: Scene, during: () => void = () => {}) {
  const renderer = {} as WebGLRenderer
  const camera = new Camera()
  // Called with the arguments WebGLRenderer passes a scene, not an object's.
  ;(scene.onBeforeRender as (...args: unknown[]) => void)(renderer, scene, camera, null)
  during()
  ;(scene.onAfterRender as (...args: unknown[]) => void)(renderer, scene, camera)
}

/** What `patchVATMaterial` leaves on a material, read the way three reads it. */
const patched = (material: Material) => material.onBeforeCompile !== MeshDepthMaterial.prototype.onBeforeCompile

describe('a pass that draws the scene under a material of its own', () => {
  it("gives each crowd a VAT-patched copy of the pass's material while the pass draws", () => {
    const { crowds, scene } = stage()
    const depth = new MeshDepthMaterial()
    scene.overrideMaterial = depth

    render(scene, () => {
      for (const { mesh } of crowds) {
        const copy = mesh.material as Material
        expect(copy).toBeInstanceOf(MeshDepthMaterial)
        expect(copy).not.toBe(depth)
        expect(patched(copy)).toBe(true)
        // So three draws the copy rather than the pass's own material over it.
        expect(copy.allowOverride).toBe(false)
      }
      // One copy per crowd: each decodes its own playback.
      expect(crowds[0]!.mesh.material).not.toBe(crowds[1]!.mesh.material)
    })
  })

  it("never patches the pass's own material, which everything else in the scene draws with", () => {
    const { scene } = stage()
    const depth = new MeshDepthMaterial()
    scene.overrideMaterial = depth

    render(scene)

    expect(patched(depth)).toBe(false)
    expect(depth.allowOverride).toBe(true)
  })

  it("follows whichever material the pass draws with, render by render, as OutlinePass's two do", () => {
    const { crowds, scene } = stage()
    const depth = new MeshDepthMaterial()
    const mask = new ShaderMaterial({ uniforms: { depthTexture: { value: null } } })

    scene.overrideMaterial = depth
    render(scene, () => expect(crowds[0]!.mesh.material).toBeInstanceOf(MeshDepthMaterial))
    scene.overrideMaterial = mask
    render(scene, () => expect(crowds[0]!.mesh.material).toBeInstanceOf(ShaderMaterial))
  })

  it('makes each copy once, not every frame', () => {
    const { crowds, scene } = stage()
    scene.overrideMaterial = new MeshDepthMaterial()

    let first: unknown
    render(scene, () => (first = crowds[0]!.mesh.material))
    render(scene, () => expect(crowds[0]!.mesh.material).toBe(first))
  })

  it('gives each crowd its own materials back after the render', () => {
    const { crowds, scene } = stage()
    const own = crowds.map(({ mesh }) => mesh.material)
    scene.overrideMaterial = new MeshDepthMaterial()

    render(scene)

    expect(crowds.map(({ mesh }) => mesh.material)).toEqual(own)
  })

  it('leaves a render with no material of its own alone, as the scene render is', () => {
    const { crowds, scene } = stage()
    const own = crowds.map(({ mesh }) => mesh.material)

    render(scene, () => expect(crowds.map(({ mesh }) => mesh.material)).toEqual(own))
  })

  it('swaps nothing with the fix off, so the pass draws the rest pose again', () => {
    const { crowds, scene, fix } = stage()
    const own = crowds.map(({ mesh }) => mesh.material)
    scene.overrideMaterial = new MeshDepthMaterial()
    fix.enabled = false

    render(scene, () => expect(crowds.map(({ mesh }) => mesh.material)).toEqual(own))
  })

  it('leaves everything that is not a crowd to the pass', () => {
    const { floor, scene } = stage()
    const own = floor.material
    scene.overrideMaterial = new MeshDepthMaterial()

    render(scene, () => expect(floor.material).toBe(own))
  })

  it("chains the scene's own render hooks rather than replacing them", () => {
    const scene = new Scene()
    const calls: string[] = []
    scene.onBeforeRender = () => void calls.push('before')
    scene.onAfterRender = () => void calls.push('after')
    const { vat } = stage()
    followThePose(scene, vat, [])

    render(scene)

    expect(calls).toEqual(['before', 'after'])
  })
})

describe("a ShaderMaterial copy, as OutlinePass's mask is", () => {
  function maskStage() {
    const { crowds, scene } = stage()
    const mask = new ShaderMaterial({
      uniforms: { depthTexture: { value: null }, cameraNearFar: { value: 0 } },
      vertexShader: 'void main() {\n#include <begin_vertex>\n}',
    })
    scene.overrideMaterial = mask
    let copies: ShaderMaterial[] = []
    render(scene, () => (copies = crowds.map(({ mesh }) => mesh.material as ShaderMaterial)))
    return { crowds, mask, copies }
  }

  /** Compile a copy as three would: its own `uniforms` object is the shader's. */
  function compile(material: ShaderMaterial) {
    const shader = { uniforms: material.uniforms, vertexShader: material.vertexShader, fragmentShader: '' }
    material.onBeforeCompile(shader as never, {} as WebGLRenderer)
  }

  it("reads what the pass writes into its material's uniforms every frame", () => {
    const { mask, copies } = maskStage()
    const depthTexture = {}

    // The pass sets a uniform's value, never the uniform: the copy shares each one.
    mask.uniforms.depthTexture!.value = depthTexture
    mask.uniforms.cameraNearFar!.value = 7

    for (const copy of copies) {
      expect(copy.uniforms.depthTexture!.value).toBe(depthTexture)
      expect(copy.uniforms.cameraNearFar!.value).toBe(7)
    }
  })

  it("binds each crowd's playback on its own copy, never on the pass's material", () => {
    const { crowds, mask, copies } = maskStage()
    for (const copy of copies) compile(copy)

    // One object shared by both copies would hold the last crowd's playback,
    // and every crowd would draw that crowd's pose.
    expect(copies[0]!.uniforms.uVatPlaybackTex!.value).toBe(crowds[0]!.playback.texture)
    expect(copies[1]!.uniforms.uVatPlaybackTex!.value).toBe(crowds[1]!.playback.texture)
    expect(mask.uniforms.uVatPlaybackTex).toBeUndefined()
  })

  it("never copies a uniform's value, as clone() would the render target's texture", () => {
    const { crowds, scene } = stage()
    const depthTexture = { isTexture: true, clone: () => expect.unreachable('a uniform value was cloned') }
    const mask = new ShaderMaterial({ uniforms: { depthTexture: { value: depthTexture } } })
    const own = mask.uniforms
    scene.overrideMaterial = mask

    render(scene, () => expect((crowds[0]!.mesh.material as ShaderMaterial).uniforms.depthTexture!.value).toBe(depthTexture))
    expect(mask.uniforms).toBe(own)
  })
})
