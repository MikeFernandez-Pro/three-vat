// A culled crowd (#199): culled against the view on the GPU where the renderer
// can, drawn by a `BatchedMesh` where it cannot, from the same code. Driven
// here through its four public functions, on a stand-in for an initialised
// renderer.
import { BatchedMesh, Group, Matrix4, Mesh, PerspectiveCamera } from 'three'
import type { Material, Object3D } from 'three'
import { describe, expect, it } from 'vitest'
import type { BuiltShader } from './test-utils.js'
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
    // A rig's draw reads its matrices, the survivor list and its crossfade pass's poses, and where it draws velocity both again for the previous frame.
    ['a WebGPU device with storage for five buffers in the vertex stage', standIn({ vertexStorage: 5 }), 'gpu'],
    ['a WebGPU device with storage for four buffers in the vertex stage', standIn({ vertexStorage: 4 }), 'batch'],
    ['the WebGL 2 fallback', standIn({ backend: 'webgl' }), 'batch'],
  ] as const)('takes the %s route', (_, { renderer }, route) => {
    expect(createVATCulledCrowd(renderer, makeRigVATFixture(), makeFixtureCrowd()).route).toBe(route)
  })

  it('takes the GPU route for the vertex encoding where the vertex stage has storage for three buffers, having no crossfade pass', () => {
    expect(createVATCulledCrowd(standIn({ vertexStorage: 3 }).renderer, makeVATFixture(), makeFixtureCrowd()).route).toBe('gpu')
    expect(createVATCulledCrowd(standIn({ vertexStorage: 2 }).renderer, makeVATFixture(), makeFixtureCrowd()).route).toBe('batch')
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
  /** The buffer the vertex stage reads the matrices from: of floats, sixteen an instance, beside a rig's crossfade pass's eight a slot. */
  const matricesOf = (crowd: VATCulledCrowd) =>
    storageBuffersOf(drawn(crowd)).find((b) => b.array instanceof Float32Array && b.array.length === crowd.playback.count * 16)!
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

  it('writes a matrix into the buffer the vertex stage reads, flagging the span written since the last cull at the next', () => {
    const { crowd, computed } = crowdOn()
    const matrices = matricesOf(crowd)
    const version = matrices.version

    setVATMatrixAt(crowd, 1, at(5))
    setVATMatrixAt(crowd, 0, at(7))
    expect([matrices.array[16 + 12], matrices.array[12]]).toEqual([5, 7])
    // Not flagged until the cull: the GPU keeps the frame drawn last till then.
    expect([matrices.updateRanges, matrices.version]).toEqual([[], version])

    culled(crowd, computed)
    expect(matrices.updateRanges).toEqual([{ start: 0, count: 32 }])
    expect(matrices.version).toBeGreaterThan(version)

    // Uploaded, as the renderer does: it clears the ranges, and the next cull flags only what was written since.
    matrices.clearUpdateRanges()
    setVATMatrixAt(crowd, 1, at(9))
    culled(crowd, computed)
    expect(matrices.updateRanges).toEqual([{ start: 16, count: 16 }])
  })

  it('places every instance at the origin, the instances it was given shown and the rows past them hidden', () => {
    const { crowd, computed } = crowdOn(makeRigVATFixture(), { capacity: 3 })

    expect(Array.from(matricesOf(crowd).array.slice(32, 48))).toEqual(new Matrix4().elements)
    expect(Array.from(visibilityOf(crowd, computed).array)).toEqual([1, 1, 0])
  })

  it('hides and shows an instance in the buffer the cull reads, flagging the span written at the next cull', () => {
    const { crowd, computed } = crowdOn(makeRigVATFixture(), { capacity: 4 })
    const flags = visibilityOf(crowd, computed)

    setVATVisibleAt(crowd, 0, false)
    setVATVisibleAt(crowd, 3, true)
    culled(crowd, computed)

    expect(Array.from(flags.array)).toEqual([0, 1, 0, 1])
    expect(flags.updateRanges).toEqual([{ start: 0, count: 4 }])
  })

  /** One draw of a build, as three makes it: each node the build asked to run ahead of a draw (ADR-0062). */
  const drawOnce = (built: BuiltShader, renderer: object, renderId = 0) => {
    for (const node of built.updateBeforeNodes) node.updateBefore({ renderer, renderId })
  }

  it('walks a crossfade once an instance, in a pass of its own the vertex stage reads at the instance it draws', () => {
    const { crowd } = crowdOn()
    const built = drawn(crowd)
    const ran: unknown[] = []
    const renderer = { compute: (node: unknown) => ran.push(node) }

    // No chain walked a vertex: a Loop is the walk.
    expect(built.vertexShader).not.toMatch(/for \( var/)
    // Run ahead of the draws, by the second with nothing fading, as a carrier's pass is.
    drawOnce(built, renderer)
    drawOnce(built, renderer)
    expect(ran).toHaveLength(1)
    const [poses] = storageBuffersOf(builtCompute(ran[0]))
    expect(storageBuffersOf(built)).toContain(poses)
    // Read at the instance out of the survivor list: two texels a slot, of the fixture's three, an instance.
    const logical = logicalIn(built.vertexShader)
    expect(built.vertexShader).toMatch(new RegExp(`= \\( \\( \\( ${logical} \\* 3 \\) \\+ nodeConst\\d+ \\) \\* 2 \\);`))
  })

  /** A build that draws velocity, as a scene pass with a velocity output asks for. */
  const drawsVelocity = (builder: BuiltShader) => {
    builder.needsPreviousData = () => true
  }
  /** The instance the vertex stage reads out of the survivor list, as the WGSL names it. */
  const logicalIn = (wgsl: string) => /let (nodeConst\d+) = i32\( nodeUniform\d+\.value\[ instanceIndex \] \);/.exec(wgsl)![1]!

  it('places the previous frame’s pose by the previous frame’s matrices, at the instance it draws, where the build draws velocity', () => {
    const { crowd } = crowdOn()
    const mesh = meshesOf(crowd.object)[0]!
    const plain = builtFor(mesh, materialOf(mesh))
    const velocity = builtFor(mesh, materialOf(mesh), drawsVelocity)
    const matricesRead = ({ vertexShader }: BuiltShader) => vertexShader.split(`.value[ ${logicalIn(vertexShader)} ]`).length - 1

    expect(plain.vertexShader).not.toContain('positionPrevious')
    expect(velocity.vertexShader).toContain('positionPrevious')
    // This frame's matrix, and only where velocity is drawn the previous frame's, both at the instance drawn.
    expect([matricesRead(plain), matricesRead(velocity)]).toEqual([1, 2])
    // Beside them, the previous frame's crossfade pass's poses.
    expect(storageBuffersOf(velocity)).toHaveLength(storageBuffersOf(plain).length + 2)
  })

  it('copies its matrices to the previous frame’s on the GPU at each cull after a move, ahead of uploading the frame’s writes', () => {
    const { renderer, computed } = standIn()
    const crowd = createVATCulledCrowd(renderer, makeRigVATFixture(), makeFixtureCrowd())
    const matrices = matricesOf(crowd)
    // Each pass dispatched, with the matrices' version as it was dispatched.
    const dispatched: { pass: ReturnType<typeof builtCompute>; version: number }[] = []
    renderer.compute = (nodes: unknown) => {
      for (const node of Array.isArray(nodes) ? nodes : [nodes]) dispatched.push({ pass: builtCompute(node), version: matrices.version })
    }
    const frame = (write?: number) => {
      if (write !== undefined) setVATMatrixAt(crowd, 1, at(write))
      dispatched.length = 0
      updateVATCulledCrowd(crowd, new PerspectiveCamera())
      return dispatched
    }

    frame(5)
    expect(computed).toHaveLength(0)
    // Its first velocity build, at the first render: the previous frame's matrices start as these.
    const mesh = meshesOf(crowd.object)[0]!
    const previous = storageBuffersOf(builtFor(mesh, materialOf(mesh), drawsVelocity)).find(
      (b) => b !== matrices && b.array instanceof Float32Array && b.array.length === matrices.array.length,
    )!
    expect(Array.from(previous.array)).toEqual(Array.from(matrices.array))
    const copies = (passes: typeof dispatched) => passes.filter(({ pass }) => storageBuffersOf(pass).includes(previous))

    // A move: the copy reads the matrices before the move is uploaded, the cull after.
    const version = matrices.version
    const moved = frame(9)
    expect(copies(moved)).toHaveLength(1)
    expect(storageBuffersOf(copies(moved)[0]!.pass)).toContain(matrices)
    expect(copies(moved)[0]!.version).toBe(version)
    expect(moved[moved.length - 1]!.version).toBeGreaterThan(version)
    // The frame after a move copies it; a frame after a still one copies nothing.
    expect(copies(frame())).toHaveLength(1)
    expect(copies(frame())).toHaveLength(0)
  })

  it('copies its matrices at the first cull after its first velocity build, so they start as the GPU holds them', () => {
    const { renderer, computed } = standIn()
    const crowd = createVATCulledCrowd(renderer, makeRigVATFixture(), makeFixtureCrowd())
    const mesh = meshesOf(crowd.object)[0]!
    // Built before the crowd is placed, as a compile ahead of the first frame builds it.
    const previous = storageBuffersOf(builtFor(mesh, materialOf(mesh), drawsVelocity)).find(
      (b) => b.array instanceof Float32Array && b.array.length === crowd.playback.count * 16 && b !== matricesOf(crowd),
    )!
    const copies = () => computed.filter((node) => storageBuffersOf(builtCompute(node)).includes(previous)).length
    const frame = () => {
      computed.length = 0
      updateVATCulledCrowd(crowd, new PerspectiveCamera())
      return copies()
    }

    setVATMatrixAt(crowd, 1, at(5))
    expect(frame()).toBe(1)
    expect(frame()).toBe(1) // the move just uploaded
    expect(frame()).toBe(0)
  })

  it('builds no crossfade pass, and no previous matrices before a velocity build, for the vertex encoding', () => {
    const { crowd, computed } = crowdOn(makeVATFixture())

    // This frame's matrices and the survivor list.
    expect(storageBuffersOf(drawn(crowd))).toHaveLength(2)
    // Its cull's three passes, no copy among them.
    culled(crowd, computed)
    expect(computed).toHaveLength(3)
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

  it('frees its crossfade passes’ storage, its previous matrices and their copy once disposed', () => {
    const { renderer, computed } = standIn()
    const crowd = createVATCulledCrowd(renderer, makeRigVATFixture(), makeFixtureCrowd())
    const mesh = meshesOf(crowd.object)[0]!
    const velocity = builtFor(mesh, materialOf(mesh), drawsVelocity)
    // A move, and the cull after it copies.
    setVATMatrixAt(crowd, 1, at(5))
    updateVATCulledCrowd(crowd, new PerspectiveCamera())
    computed.length = 0
    updateVATCulledCrowd(crowd, new PerspectiveCamera())
    const copy = computed[0] as object
    const things = [...storageBuffersOf(velocity), copy]
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
