// A **culled crowd** (#199): a crowd the library culls against the view on the
// GPU each frame, once for every pass, where the renderer can — and draws
// through a `BatchedMesh` carrier where it cannot, from the same code. Not a
// carrier itself: it owns the meshes that draw it, and on the GPU route spells
// each instance's logical index for them (ADR-0051).
//
// Four functions, as changing an instance is a function and not a subclass
// (ADR-0014): one makes the crowd, one culls it once a frame, and two write an
// instance. What each route keeps is held against the crowd it returned.
import { BatchedMesh, BufferAttribute, BufferGeometry, EventDispatcher, Frustum, Group, Matrix4, Mesh, Sphere, Vector4 } from 'three'
import type { Camera, Material } from 'three'
import {
  Fn,
  If,
  atomicAdd,
  atomicLoad,
  atomicStore,
  attributeArray,
  float,
  instanceIndex,
  int,
  max,
  normalLocal,
  positionPrevious,
  storage,
  transformNormal,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, NodeBuilder } from 'three/webgpu'
import { assertBakedNormal } from './baked-normals.js'
import { boundedBy, indexOf } from './batch-geometry.js'
import { createVATPlaybackTexture } from './instance-playback.js'
import type { VATInstance, VATPlaybackTexture } from './instance-playback.js'
import { getMaxTextureSize, vatNodes, vatNodesFadingOn } from './tsl.js'
import type { VATTimeUniform } from './tsl.js'
import type { VAT } from './types.js'

/** Which way a culled crowd is drawn: culled on the GPU, or by three through a `BatchedMesh`. */
export type VATCullRoute = 'gpu' | 'batch'

/** Options for {@link createVATCulledCrowd}. */
export interface VATCulledCrowdOptions {
  /**
   * How many instances the crowd holds, fixed for its life (ADR-0022): the
   * instances given are shown, the rows past them hidden until shown. A write
   * past it is refused. Defaults to the instances given.
   */
  capacity?: number
  /** The playback clock, as `createVATMesh` takes it. Defaults to a fresh `uniform(0)`. */
  time?: VATTimeUniform
  /**
   * Units added round each instance's cull sphere on the GPU route, in the
   * crowd's own space (world units unless `object` is scaled), so
   * an instance just out of view still casts its shadow into it: one cull, by
   * the view, serves the shadow maps too. 0 by default. The batch route culls
   * each pass by its own camera, and needs none.
   */
  margin?: number
}

/** What {@link createVATCulledCrowd} returns. */
export interface VATCulledCrowd {
  /** What goes in the scene: a group of the meshes that draw the crowd, one a geometry group of the VAT, whichever the route. */
  object: Group
  /** The crowd's playback texture, which `setVATInstance` writes, one row an instance up to the capacity. */
  playback: VATPlaybackTexture
  /** The shared playback clock: set `.value` once a frame. */
  time: VATTimeUniform
  /** The route the crowd took, chosen from the renderer at creation. */
  route: VATCullRoute
  /** Free the crowd's materials, buffers, batches and playback texture. The bake's geometry, which it shares, stays the caller's. */
  dispose(): void
}

/** The fields of an initialised WebGPURenderer the crowd reads. */
interface CullRenderer {
  backend: {
    isWebGPUBackend?: boolean
    device?: { limits: { maxStorageBuffersPerShaderStage: number; maxStorageBuffersInVertexStage?: number } } | null
  }
  compute(nodes: unknown): unknown
}

/** What a route does with the crowd's four functions. */
interface Route {
  setMatrixAt(index: number, matrix: Matrix4): void
  setVisibleAt(index: number, visible: boolean): void
  update(camera: Camera): void
}

const routes = new WeakMap<VATCulledCrowd, Route & { capacity: number }>()

type Clone = Material & { positionNode: unknown }

/**
 * The most storage buffers the GPU route's vertex stage reads: the matrices and
 * the survivor list, a rig's crossfade pass's poses, and where the build draws
 * velocity the previous frame's matrices, and poses.
 */
function vertexStorageBuffersOf(vat: VAT): number {
  const poses = vat.encoding === 'rig' ? 1 : 0
  return 2 + poses + (1 + poses)
}

/**
 * The GPU route where the renderer has compute, indirect draws and storage in
 * the vertex stage: a WebGPU device with storage buffers enough for that stage.
 * The WebGL 2 fallback has none of them, and a compatibility-level device may
 * report no vertex-stage storage (see `readsVertexStorage` in tsl.ts).
 */
function routeOf(renderer: CullRenderer, vat: VAT): VATCullRoute {
  const { backend } = renderer
  if (backend.isWebGPUBackend !== true || !backend.device) return 'batch'
  const { limits } = backend.device
  return (limits.maxStorageBuffersInVertexStage ?? limits.maxStorageBuffersPerShaderStage) >= vertexStorageBuffersOf(vat) ? 'gpu' : 'batch'
}

/** One draw of the VAT's geometry: a group's range, or the whole of it where it has none, and its material. */
interface Part {
  material: number
  start: number
  count: number
}

/**
 * A part's geometry, over the bake's own attributes and bounded by its
 * all-frames bounds, and its own clone of the part's material, as
 * `createVATMesh` clones them: what each route draws a part with.
 */
function partOf(vat: VAT, { material }: Part) {
  const geometry = new BufferGeometry()
  for (const [name, attribute] of Object.entries(vat.geometry.attributes)) geometry.setAttribute(name, attribute)
  boundedBy(geometry, vat.bounds)
  return { geometry, material: vat.materials[material]!.clone() as Clone }
}

function partsOf(geometry: BufferGeometry): Part[] {
  if (geometry.groups.length > 0) return geometry.groups.map(({ start, count, materialIndex = 0 }) => ({ material: materialIndex, start, count }))
  return [{ material: 0, start: 0, count: geometry.getIndex()?.count ?? geometry.getAttribute('position').count }]
}

/**
 * A group whose `castShadow` and `receiveShadow` set every mesh it holds, so
 * a crowd's shadows are switched on as a mesh's are, whichever the route.
 */
function crowdGroup(meshes: readonly Mesh[] | readonly BatchedMesh[]): Group {
  const group = new Group()
  for (const mesh of meshes) group.add(mesh)
  for (const flag of ['castShadow', 'receiveShadow'] as const) {
    Object.defineProperty(group, flag, {
      get: () => meshes[0]![flag],
      set: (value: boolean) => {
        for (const mesh of meshes) mesh[flag] = value
      },
    })
  }
  return group
}

/**
 * Make a culled crowd of `instances`, on the route `renderer` can draw it by:
 * culled on the GPU, or through a `BatchedMesh`. Call it after `await
 * renderer.init()`, which is when a WebGPURenderer knows which backend it has.
 */
export function createVATCulledCrowd(
  renderer: object,
  vat: VAT,
  instances: VATInstance[],
  options: VATCulledCrowdOptions = {},
): VATCulledCrowd {
  const maxTextureSize = getMaxTextureSize(renderer)
  if (vat.characters) {
    throw new Error('three-vat: a culled crowd draws a bake, not an atlas — draw an atlas on a BatchedMesh')
  }
  const capacity = options.capacity ?? instances.length
  const time: VATTimeUniform = options.time ?? uniform(0)
  const playback = createVATPlaybackTexture(instances, { capacity, maxTextureSize })
  for (const source of vat.materials) assertBakedNormal(vat, source)
  const route = routeOf(renderer as CullRenderer, vat)

  const built =
    route === 'gpu'
      ? gpuRoute(renderer as CullRenderer, vat, instances.length, capacity, playback, time, options.margin ?? 0)
      : batchRoute(vat, instances.length, capacity, playback, time)
  const crowd: VATCulledCrowd = {
    object: built.object,
    playback,
    time,
    route,
    dispose() {
      built.dispose()
      playback.texture.dispose()
    },
  }
  routes.set(crowd, { ...built, capacity })
  return crowd
}

/**
 * The batch route: one `BatchedMesh` a part of the VAT's geometry, each over
 * that part's triangles and every vertex — the vertex encoding reads a vertex's
 * column at its batch vertex index — and each holding the whole capacity. three
 * culls it per instance and per pass, each pass by its own camera, so a shadow
 * cast from out of view is kept without a margin. It does not sort, so it draws
 * in the order the GPU route does.
 */
function batchRoute(vat: VAT, shown: number, capacity: number, playback: VATPlaybackTexture, time: VATTimeUniform) {
  const index = indexOf(vat.geometry)
  const batches = partsOf(vat.geometry).map((part) => {
    const { start, count } = part
    const { geometry, material: clone } = partOf(vat, part)
    geometry.setIndex(new BufferAttribute(Uint32Array.from(Array.prototype.slice.call(index, start, start + count) as number[]), 1))
    const batch = new BatchedMesh(capacity, vat.vertexCount, count, clone)
    const id = batch.addGeometry(geometry)
    for (let i = 0; i < capacity; i++) batch.setVisibleAt(batch.addInstance(id), i < shown)
    batch.sortObjects = false
    // Its instances move: three culls them one by one, never the batch as a whole by bounds that lag them.
    batch.frustumCulled = false
    clone.positionNode = vatNodes(vat, { time, playback, carrier: batch }).positionNode
    return batch
  })
  return {
    object: crowdGroup(batches),
    setMatrixAt(i: number, matrix: Matrix4) {
      for (const batch of batches) batch.setMatrixAt(i, matrix)
    },
    setVisibleAt(i: number, visible: boolean) {
      for (const batch of batches) batch.setVisibleAt(i, visible)
    },
    update() {},
    dispose() {
      for (const batch of batches) {
        batch.dispose()
        ;(batch.material as Material).dispose()
      }
    },
  }
}

/**
 * A storage buffer the crowd writes and the renderer uploads, by the span written
 * since the last cull. Flagged for upload at the cull and not at the write, so
 * the GPU still holds the previous frame's matrices until then, to copy them.
 */
function writtenBuffer(attribute: BufferAttribute, itemSize: number) {
  let first = 0
  let last = -1
  return {
    attribute,
    /** Note the item at `index` as written. */
    written(index: number) {
      first = last < 0 ? index : Math.min(first, index)
      last = Math.max(last, index)
    },
    /** Flag the span written since the last flush for the next upload: whether anything was written. */
    flush(): boolean {
      if (last < 0) return false
      attribute.clearUpdateRanges()
      attribute.addUpdateRange(first * itemSize, (last - first + 1) * itemSize)
      attribute.needsUpdate = true
      last = -1
      return true
    },
  }
}

/** Uints in a record of indirect arguments: an indexed draw's five, a plain draw's four and one unread. */
const ARGS = 5

const _viewProjection = /* @__PURE__ */ new Matrix4()
const _frustum = /* @__PURE__ */ new Frustum()

/**
 * The GPU route: the instances' matrices and visibility in storage buffers the
 * crowd owns and the caller writes; a compute pass that tests each instance's
 * sphere against the view's planes and compacts the survivors into a list; and
 * one mesh a part of the geometry, drawing that list indirectly, whose vertex
 * stage reads which instance it draws out of it: its logical index, at which
 * the decode reads the playback row and the placement reads the matrix. The
 * shadow maps draw the same list: one cull a frame serves every pass (ADR-0052).
 */
function gpuRoute(
  renderer: CullRenderer,
  vat: VAT,
  shown: number,
  capacity: number,
  playback: VATPlaybackTexture,
  time: VATTimeUniform,
  margin: number,
) {
  const matrices = writtenBuffer(attributeArray(capacity * 16).value as BufferAttribute, 16)
  const visible = writtenBuffer(attributeArray(capacity, 'uint').value as BufferAttribute, 1)
  const survivors = attributeArray(capacity, 'uint').value as BufferAttribute
  const identity = new Matrix4().elements
  for (let i = 0; i < capacity; i++) {
    ;(matrices.attribute.array as Float32Array).set(identity, i * 16)
    visible.attribute.array[i] = i < shown ? 1 : 0
  }

  // One record of indirect arguments a part, the instance count the cull's: an
  // indexed draw's indexCount, instanceCount, firstIndex, baseVertex and
  // firstInstance, and a plain draw's first four in the same places.
  const parts = partsOf(vat.geometry)
  const args = attributeArray(parts.length * ARGS, 'uint').value as BufferAttribute & { isIndirectStorageBufferAttribute?: boolean }
  // What three's IndirectStorageBufferAttribute is, flagged here rather than
  // imported: three/webgpu stays a type-only import of this entry (ADR-0005).
  args.isIndirectStorageBufferAttribute = true
  parts.forEach(({ start, count }, k) => (args.array as Uint32Array).set([count, 0, start, 0, 0], k * ARGS))

  // Each pass's nodes of its own over the buffers: toReadOnly() and toAtomic() change the node they are called on.
  const counts = storage(args, 'uint', args.count).toAtomic()
  const instanceCountAt = (k: number) => counts.element(int(k * ARGS + 1))
  const reset = Fn(() => {
    parts.forEach((_, k) => atomicStore(instanceCountAt(k), uint(0)))
  })().compute(1)

  // An instance's sphere: the VAT's all-frames bounds, moved and sized by its
  // matrix, at its largest scale, and grown by the margin.
  const bounds = vat.bounds.getBoundingSphere(new Sphere())
  const planes = Array.from({ length: 6 }, () => uniform(new Vector4()))
  const cullMatrices = storage(matrices.attribute, 'mat4', capacity).toReadOnly()
  const cullVisible = storage(visible.attribute, 'uint', capacity).toReadOnly()
  const kept = storage(survivors, 'uint', capacity)
  const cull = Fn(() => {
    const m = cullMatrices.element(instanceIndex).toVar()
    const center = m.mul(vec4(vec3(bounds.center.x, bounds.center.y, bounds.center.z), 1)).xyz.toVar()
    const axis = (x: number, y: number, z: number) => m.mul(vec4(x, y, z, 0)).xyz.length()
    const scale = max(axis(1, 0, 0), max(axis(0, 1, 0), axis(0, 0, 1)))
    const reach = float(bounds.radius).mul(scale).add(margin).negate().toVar()
    let inside = cullVisible.element(instanceIndex).notEqual(uint(0)) as Node<'bool'>
    for (const plane of planes) inside = inside.and(plane.xyz.dot(center).add(plane.w).greaterThanEqual(reach)) as Node<'bool'>
    If(inside, () => {
      kept.element(atomicAdd(instanceCountAt(0), uint(1))).assign(uint(instanceIndex))
    })
  })().compute(capacity)
  // Every part draws the survivors the first one counted.
  const share = Fn(() => {
    const survived = atomicLoad(instanceCountAt(0)).toVar()
    parts.slice(1).forEach((_, k) => atomicStore(instanceCountAt(k + 1), survived))
  })().compute(1)
  const passes = parts.length > 1 ? [reset, cull, share] : [reset, cull]

  // The drawn slot is a place in the survivor list; what it holds is the instance.
  const logicalIndex = int(storage(survivors, 'uint', capacity).toReadOnly().element(instanceIndex))
  // The crowd holds its crossfade pass as a carrier would, so a crossfade is walked
  // once an instance, written at its row and read at its logical index (#203).
  const fading = new EventDispatcher<{ dispose: object }>()
  const posed = vatNodesFadingOn(vat, { time, playback, logicalIndex }, fading).positionNode
  const drawnMatrices = storage(matrices.attribute, 'mat4', capacity).toReadOnly()

  // Motion vectors (ADR-0064): the previous frame's matrices, made by the first
  // build that draws velocity, and copied from the matrices on the GPU at the
  // first cull after, and at each cull after a move, ahead of its upload (#203).
  let previous: { attribute: BufferAttribute; copy: Node & { dispose(): void } } | null = null
  const previousMatrices = () => {
    if (!previous) {
      const attribute = attributeArray(new Float32Array(matrices.attribute.array as Float32Array), 'float').value as BufferAttribute
      const from = storage(matrices.attribute, 'mat4', capacity).toReadOnly()
      const to = storage(attribute, 'mat4', capacity)
      const copy = Fn(() => {
        to.element(instanceIndex).assign(from.element(instanceIndex))
      })().compute(capacity) as unknown as Node & { dispose(): void }
      previous = { attribute, copy }
      // Copied at the next cull, from what the GPU holds rather than the array,
      // which may hold writes not yet uploaded; and compiled then, not at the first move.
      behind = true
    }
    return previous.attribute
  }
  // Whether the previous frame's matrices are behind what the GPU holds: new, or a move uploaded since.
  let behind = false

  // The decode poses in the geometry's own space; the crowd's matrix places it,
  // and turns the normal with it, and where the build draws velocity the
  // previous frame's matrix places the previous frame's pose.
  const positionNode = Fn((builder: NodeBuilder) => {
    const local = posed.toVar()
    const m = drawnMatrices.element(logicalIndex).toVar()
    normalLocal.assign(transformNormal(normalLocal, m))
    // Whether this build draws velocity, which @types/three does not declare.
    if ((builder as NodeBuilder & { needsPreviousData(): boolean }).needsPreviousData()) {
      const before = storage(previousMatrices(), 'mat4', capacity).toReadOnly().element(logicalIndex)
      positionPrevious.assign(before.mul(vec4(positionPrevious, 1)).xyz)
    }
    return m.mul(vec4(local, 1)).xyz
  })()

  const materials: Clone[] = []
  const meshes = parts.map((part, k) => {
    const { geometry, material: clone } = partOf(vat, part)
    // The bake's index too, shared: a part's range is in its arguments.
    geometry.setIndex(vat.geometry.getIndex())
    geometry.setIndirect(args as never, k * ARGS * Uint32Array.BYTES_PER_ELEMENT)
    clone.positionNode = positionNode
    materials.push(clone)
    const mesh = new Mesh(geometry, clone)
    // Placed by the cull, never culled by three.
    mesh.frustumCulled = false
    return mesh
  })
  const object = crowdGroup(meshes)

  return {
    object,
    setMatrixAt(i: number, matrix: Matrix4) {
      matrix.toArray(matrices.attribute.array as Float32Array, i * 16)
      matrices.written(i)
    },
    setVisibleAt(i: number, shows: boolean) {
      visible.attribute.array[i] = shows ? 1 : 0
      visible.written(i)
    },
    update(camera: Camera) {
      // As a render would bring them up to date, and the planes in the crowd's own space, where its matrices are.
      camera.updateWorldMatrix(true, false)
      object.updateWorldMatrix(true, false)
      _viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld)
      _frustum.setFromProjectionMatrix(_viewProjection, camera.coordinateSystem, (camera as { reversedDepth?: boolean }).reversedDepth)
      _frustum.planes.forEach(({ normal, constant }, k) => planes[k]!.value.set(normal.x, normal.y, normal.z, constant))
      // What the GPU holds is the frame drawn last, until the writes since are
      // flagged: copied first, where it is ahead of the previous frame's.
      if (previous && behind) renderer.compute(previous.copy)
      behind = matrices.flush()
      visible.flush()
      renderer.compute(passes)
    },
    dispose() {
      for (const material of materials) material.dispose()
      for (const attribute of [matrices.attribute, visible.attribute, survivors, args]) attribute.dispose()
      for (const pass of [reset, cull, share]) pass.dispose()
      previous?.attribute.dispose()
      previous?.copy.dispose()
      fading.dispatchEvent({ type: 'dispose' })
    },
  }
}

/** The crowd's route, or a refusal of a crowd `createVATCulledCrowd` did not make. */
function routeFor(crowd: VATCulledCrowd) {
  const route = routes.get(crowd)
  if (!route) throw new Error('three-vat: this is not a crowd createVATCulledCrowd made')
  return route
}

/** The crowd's route, or a refusal of an index past its capacity. */
function routeAt(crowd: VATCulledCrowd, index: number): Route {
  const route = routeFor(crowd)
  if (!Number.isInteger(index) || index < 0 || index >= route.capacity) {
    throw new Error(`three-vat: instance ${index} is past this crowd's capacity of ${route.capacity}, numbered from 0 — a crowd's capacity is fixed when it is made`)
  }
  return route
}

/** Place instance `index` of the crowd, on either route. */
export function setVATMatrixAt(crowd: VATCulledCrowd, index: number, matrix: Matrix4): void {
  routeAt(crowd, index).setMatrixAt(index, matrix)
}

/** Show or hide instance `index` of the crowd: a hidden instance is skipped by the cull and keeps its row. */
export function setVATVisibleAt(crowd: VATCulledCrowd, index: number, visible: boolean): void {
  routeAt(crowd, index).setVisibleAt(index, visible)
}

/**
 * Cull the crowd against `camera` for the frame about to be drawn: call it once
 * a frame, after the frame's writes and before `renderer.render`. One cull
 * serves every pass, shadow maps included: on WebGPU a shadow map can be drawn
 * before the crowd's own draw, which is why this is not left to a draw hook.
 * The batch route culls itself, per pass, inside the render.
 */
export function updateVATCulledCrowd(crowd: VATCulledCrowd, camera: Camera): void {
  routeFor(crowd).update(camera)
}
