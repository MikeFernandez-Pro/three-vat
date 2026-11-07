// A culled crowd (#199): culled against the view on the GPU where the renderer
// can, drawn by a `BatchedMesh` where it cannot, from the same code. Driven
// here through its four public functions, on a stand-in for an initialised
// renderer.
import { BatchedMesh, Group, Matrix4, Mesh, PerspectiveCamera } from 'three'
import type { Material, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import {
  builtCompute,
  builtFor,
  makeFixtureCrowd,
  makeRigVATFixture,
  makeVATFixture,
  storageBuffersOf,
  unassignedReads,
} from './test-utils.js'
import type { VATCulledCrowd, VATCulledCrowdOptions } from './culled-crowd.js'
import { createVATCulledCrowd, setVATMatrixAt, setVATVisibleAt, updateVATCulledCrowd } from './culled-crowd.js'
import type { VAT } from './types.js'

/** What an initialised WebGPURenderer says about itself, on WebGPU or on its WebGL 2 fallback. */
function standIn({ backend = 'webgpu', vertexStorage = 8 as number | undefined } = {}) {
  const computed: unknown[] = []
  const limits: Record<string, number> = { maxTextureDimension2D: 8192, maxStorageBuffersPerShaderStage: 8 }
  if (vertexStorage !== undefined) limits['maxStorageBuffersInVertexStage'] = vertexStorage
  const renderer = {
    backend:
      backend === 'webgpu'
        ? { isWebGPUBackend: true, device: { limits } }
        : { isWebGLBackend: true, gl: { MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => 4096 } },
    compute(nodes: unknown) {
      computed.push(...(Array.isArray(nodes) ? nodes : [nodes]))
    },
  }
  return { renderer, computed }
}

describe('createVATCulledCrowd', () => {
  it.each([
    ['WebGPU with storage in the vertex stage', standIn(), 'gpu'],
    ['WebGPU on a browser reporting only the per-stage limit', standIn({ vertexStorage: undefined }), 'gpu'],
    ['a WebGPU device with no storage in the vertex stage', standIn({ vertexStorage: 0 }), 'batch'],
    ['the WebGL 2 fallback', standIn({ backend: 'webgl' }), 'batch'],
  ] as const)('takes the %s route', (_, { renderer }, route) => {
    expect(createVATCulledCrowd(renderer, makeRigVATFixture(), makeFixtureCrowd()).route).toBe(route)
  })

  it('refuses a renderer that has not been initialised', () => {
    const renderer = { backend: { isWebGPUBackend: true, device: null }, compute() {} }

    expect(() => createVATCulledCrowd(renderer, makeVATFixture(), makeFixtureCrowd())).toThrow(/init/)
  })
})

const at = (x: number) => new Matrix4().makeTranslation(x, 0, 0)
const batchesOf = (object: Object3D) => object.children as BatchedMesh[]
const materialOf = (mesh: Object3D) => (mesh as unknown as { material: Material & { positionNode?: unknown } }).material

describe('the batch route', () => {
  const crowdOn = (capacity?: number) =>
    createVATCulledCrowd(standIn({ backend: 'webgl' }).renderer, makeVATFixture(), makeFixtureCrowd(), { capacity })

  it('is a group of BatchedMeshes, one a geometry group, that neither sorts nor culls as a whole', () => {
    const vat = makeVATFixture()
    const { object } = createVATCulledCrowd(standIn({ backend: 'webgl' }).renderer, vat, makeFixtureCrowd())

    expect(object).toBeInstanceOf(Group)
    expect(batchesOf(object)).toHaveLength(2)
    for (const [k, batch] of batchesOf(object).entries()) {
      expect(batch).toBeInstanceOf(BatchedMesh)
      expect([batch.sortObjects, batch.perObjectFrustumCulled, batch.frustumCulled]).toEqual([false, true, false])
      // A clone of the VAT's material, decoding the VAT.
      expect(materialOf(batch)).not.toBe(vat.materials[k])
      expect(materialOf(batch).name).toBe(vat.materials[k]!.name)
      expect(materialOf(batch).positionNode).toBeDefined()
    }
  })

  it('holds its capacity, the instances it was given shown and the rows past them hidden', () => {
    const { object, playback } = crowdOn(4)

    for (const batch of batchesOf(object)) {
      expect(batch.instanceCount).toBe(4)
      expect([0, 1, 2, 3].map((i) => batch.getVisibleAt(i))).toEqual([true, true, false, false])
    }
    expect(playback.count).toBe(4)
  })

  it('moves, hides and shows an instance in every batch', () => {
    const crowd = crowdOn(3)

    setVATMatrixAt(crowd, 1, at(5))
    setVATVisibleAt(crowd, 0, false)
    setVATVisibleAt(crowd, 2, true)

    for (const batch of batchesOf(crowd.object)) {
      expect(batch.getMatrixAt(1, new Matrix4()).elements[12]).toBe(5)
      expect([0, 1, 2].map((i) => batch.getVisibleAt(i))).toEqual([false, true, true])
    }
  })

  it('frees its batches, their materials and its playback texture once disposed', () => {
    const crowd = crowdOn()
    const things = [...batchesOf(crowd.object), ...batchesOf(crowd.object).map(materialOf), crowd.playback.texture]
    const freed = watchDisposal(things)

    crowd.dispose()

    expect(new Set(freed)).toEqual(new Set(things))
  })
})

/** Whatever of `things` sends `dispose`, in the order it does. */
function watchDisposal(things: readonly object[]): unknown[] {
  const freed: unknown[] = []
  for (const thing of things) {
    ;(thing as { addEventListener(type: 'dispose', listener: () => void): void }).addEventListener('dispose', () => freed.push(thing))
  }
  return freed
}

describe('the GPU route', () => {
  const meshesOf = (object: Object3D) => object.children as Mesh[]
  /** A crowd on the GPU route, and the compute passes it has dispatched so far. */
  const crowdOn = (vat: VAT = makeRigVATFixture(), options: VATCulledCrowdOptions = {}) => {
    const { renderer, computed } = standIn()
    return { crowd: createVATCulledCrowd(renderer, vat, makeFixtureCrowd(), options), computed }
  }
  /** The vertex stage's build for the crowd's first mesh. */
  const drawn = (crowd: VATCulledCrowd) => {
    const mesh = meshesOf(crowd.object)[0]!
    return builtFor(mesh, materialOf(mesh))
  }
  /** The passes one call to updateVATCulledCrowd dispatches, built. */
  const culled = (crowd: VATCulledCrowd, computed: unknown[]) => {
    computed.length = 0
    updateVATCulledCrowd(crowd, new PerspectiveCamera())
    return computed.map(builtCompute)
  }
  /** The buffer the vertex stage reads the matrices from: its one of floats, sixteen an instance. */
  const matricesOf = (crowd: VATCulledCrowd) => storageBuffersOf(drawn(crowd)).find((b) => b.array instanceof Float32Array)!
  /** The survivor list the vertex stage reads: its one of u32s. */
  const survivorsOf = (crowd: VATCulledCrowd) => storageBuffersOf(drawn(crowd)).find((b) => b.array instanceof Uint32Array)!
  /** The visibility flags: the cull's buffer of u32s that is neither the survivor list nor the indirect arguments. */
  const visibilityOf = (crowd: VATCulledCrowd, computed: unknown[]) => {
    const list = survivorsOf(crowd)
    return culled(crowd, computed)
      .flatMap(storageBuffersOf)
      .find((b) => b.array instanceof Uint32Array && b !== list && !(b as { isIndirectStorageBufferAttribute?: boolean }).isIndirectStorageBufferAttribute)!
  }

  it('is a group of meshes, one a geometry group, drawn indirectly and never culled by three', () => {
    const vat = makeVATFixture()
    const { crowd } = crowdOn(vat)

    expect(crowd.object).toBeInstanceOf(Group)
    expect(meshesOf(crowd.object)).toHaveLength(2)
    meshesOf(crowd.object).forEach((mesh, k) => {
      expect(mesh).toBeInstanceOf(Mesh)
      expect(mesh.frustumCulled).toBe(false)
      expect(mesh.geometry.indirect).not.toBeNull()
      expect(materialOf(mesh)).not.toBe(vat.materials[k])
      expect(materialOf(mesh).name).toBe(vat.materials[k]!.name)
    })
  })

  it('compiles its draw and its cull reading no variable a branch skipped assigning', () => {
    for (const vat of [makeVATFixture(), makeRigVATFixture()]) {
      const { crowd, computed } = crowdOn(vat)

      expect(unassignedReads(drawn(crowd).vertexShader)).toEqual([])
      const passes = culled(crowd, computed)
      expect(passes.length).toBeGreaterThan(1)
      for (const pass of passes) expect(unassignedReads(pass.computeShader)).toEqual([])
    }
  })

  it('reads each drawn instance out of the survivor list the cull writes, and places it by that instance', () => {
    const { crowd, computed } = crowdOn()
    const { vertexShader } = drawn(crowd)

    // The drawn slot indexes the list; what the list holds indexes the matrices.
    const read = /let (nodeConst\d+) = i32\( (nodeUniform\d+)\.value\[ instanceIndex \] \);/.exec(vertexShader)
    expect(read).not.toBeNull()
    expect(vertexShader).toMatch(new RegExp(`struct ${read![2]}Struct \\{\\s*value : array< u32 >`))
    expect(vertexShader).toMatch(new RegExp(`\\.value\\[ ${read![1]} \\]`))
    // The list the vertex stage reads is the one a pass of the cull writes.
    const list = survivorsOf(crowd)
    expect(culled(crowd, computed).some((pass) => storageBuffersOf(pass).includes(list))).toBe(true)
  })

  it('culls a sphere of the VAT’s all-frames bounds, at the instance’s largest scale, grown by the margin', () => {
    // The fixture's bounds run from (-2, 0, -2) to (2, 3, 2): centred at (0, 1.5, 0), √10.25 from each corner.
    const { crowd, computed } = crowdOn(makeRigVATFixture(), { margin: 0.75 })

    const cull = culled(crowd, computed).map((pass) => pass.computeShader).find((wgsl) => wgsl.includes('atomicAdd'))!
    expect(cull).toContain('vec3<f32>( 0.0, 1.5, 0.0 )')
    expect(cull).toContain(`( ${Math.sqrt(10.25)} * max( length(`)
    expect(cull).toContain('+ 0.75')
  })

  it('writes a matrix into the buffer the vertex stage reads, flagging the span written since the last upload', () => {
    const { crowd } = crowdOn()
    const matrices = matricesOf(crowd)
    const version = matrices.version

    setVATMatrixAt(crowd, 1, at(5))
    expect(matrices.array[16 + 12]).toBe(5)
    expect(matrices.updateRanges).toEqual([{ start: 16, count: 16 }])
    expect(matrices.version).toBeGreaterThan(version)

    setVATMatrixAt(crowd, 0, at(7))
    expect(matrices.array[12]).toBe(7)
    expect(matrices.updateRanges).toEqual([{ start: 0, count: 32 }])

    // Uploaded, as the renderer does: it clears the ranges, and the next write flags its own.
    matrices.clearUpdateRanges()
    setVATMatrixAt(crowd, 1, at(9))
    expect(matrices.updateRanges).toEqual([{ start: 16, count: 16 }])
  })

  it('places every instance at the origin, the instances it was given shown and the rows past them hidden', () => {
    const { crowd, computed } = crowdOn(makeRigVATFixture(), { capacity: 3 })

    expect(Array.from(matricesOf(crowd).array.slice(32, 48))).toEqual(new Matrix4().elements)
    expect(Array.from(visibilityOf(crowd, computed).array)).toEqual([1, 1, 0])
  })

  it('hides and shows an instance in the buffer the cull reads, flagging the span written', () => {
    const { crowd, computed } = crowdOn(makeRigVATFixture(), { capacity: 4 })
    const flags = visibilityOf(crowd, computed)

    setVATVisibleAt(crowd, 0, false)
    setVATVisibleAt(crowd, 3, true)

    expect(Array.from(flags.array)).toEqual([0, 1, 0, 1])
    expect(flags.updateRanges).toEqual([{ start: 0, count: 4 }])
  })

  it('casts and receives shadows from the group, as a mesh does', () => {
    const { crowd } = crowdOn()

    crowd.object.castShadow = true
    crowd.object.receiveShadow = true

    for (const mesh of meshesOf(crowd.object)) expect([mesh.castShadow, mesh.receiveShadow]).toEqual([true, true])
  })

  it('frees its materials, buffers, compute passes and playback texture once disposed', () => {
    // Two parts, so the pass that shares the count between them runs too.
    const { crowd, computed } = crowdOn(makeVATFixture())
    const materials = meshesOf(crowd.object).map(materialOf)
    const buffers = [...new Set([...storageBuffersOf(drawn(crowd)), ...culled(crowd, computed).flatMap(storageBuffersOf)])]
    const things = [...materials, ...buffers, ...(computed as object[]), crowd.playback.texture]
    expect(computed).toHaveLength(3)
    const freed = watchDisposal(things)

    crowd.dispose()

    expect(new Set(freed)).toEqual(new Set(things))
  })
})

describe('either route', () => {
  it.each([
    ['gpu', standIn()],
    ['batch', standIn({ backend: 'webgl' })],
  ] as const)('refuses an instance past the capacity on the %s route', (_, { renderer }) => {
    const crowd = createVATCulledCrowd(renderer, makeVATFixture(), makeFixtureCrowd(), { capacity: 3 })

    expect(() => setVATMatrixAt(crowd, 3, at(0))).toThrow(/capacity of 3/)
    expect(() => setVATVisibleAt(crowd, -1, true)).toThrow(/capacity of 3/)
    expect(() => setVATMatrixAt(crowd, 2, at(0))).not.toThrow()
  })
})
