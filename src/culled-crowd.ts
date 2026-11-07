// A **culled crowd** (#199): a crowd the library culls against the view on the
// GPU each frame, once for every pass, where the renderer can — and draws
// through a `BatchedMesh` carrier where it cannot, from the same code. Not a
// carrier itself: it owns the meshes that draw it, and on the GPU route spells
// each instance's logical index for them (ADR-0051).
//
// Four functions, as changing an instance is a function and not a subclass
// (ADR-0014): one makes the crowd, one culls it once a frame, and two write an
// instance. What each route keeps is held against the crowd it returned.
import { BatchedMesh, BufferAttribute, EventDispatcher, Frustum, Group, Matrix4, Mesh, Sphere, Vector3, Vector4 } from 'three'
import type { Box3, BufferGeometry, Camera, Material } from 'three'
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
  mat3,
  max,
  normalLocal,
  positionPrevious,
  select,
  storage,
  tangentLocal,
  transformNormal,
  uint,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import type { Node, NodeBuilder } from 'three/webgpu'
import { assertBakedNormal } from './baked-normals.js'
import { boundedBy, charactersOf, indexOf } from './batch-geometry.js'
import { createVATPlaybackTexture } from './instance-playback.js'
import type { VATInstance, VATPlaybackTexture } from './instance-playback.js'
import { assertLevelChoice, createVATLODs, updateVATLevels, withIndex } from './lod.js'
import { getMaxTextureSize, vatNodesFadingOn } from './tsl.js'
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
  /**
   * The levels of detail, as `createVATLODs` hands them back, the full detail
   * first: hand the crowd the VAT it returned with them. Each instance draws the
   * level its distance from the camera asks for, chosen at
   * `updateVATCulledCrowd` by `bands` and `slack` as `updateVATLevels` chooses
   * one (ADR-0065), on either route. A level draws with one material, so a
   * bake of more than one is refused with levels.
   */
  levels?: readonly (readonly BufferGeometry[])[]
  /** Where each level gives way to the next, in world units and increasing, as `updateVATLevels` takes them. Required with `levels`. */
  bands?: readonly number[]
  /** How far past a band an instance has to be before it leaves its level, a fraction of that band: 0.1 by default, as `updateVATLevels`'s. */
  slack?: number
  /**
   * On an atlas, which character each instance is, in the atlas's order, one
   * an instance up to the capacity; an instance not given is character 0. Fixed
   * for the crowd's life, as the capacity is: an instance keeps its character
   * at every level. An atlas draws with its first material, as a batch of it does.
   */
  characters?: readonly number[]
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
/** Crowds already disposed: refused by name, and freed once. */
const disposed = new WeakSet<VATCulledCrowd>()

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
 * The most storage buffers the cull binds: the matrices, the visibility, the
 * survivor list and the indirect arguments, and the level each instance kept
 * and its character where the crowd has them.
 */
function computeStorageBuffersOf({ choice, characterCount }: Layout): number {
  return 4 + (choice ? 1 : 0) + (characterCount > 1 ? 1 : 0)
}

/**
 * The GPU route where the renderer has compute, indirect draws and storage in
 * the vertex stage: a WebGPU device with storage buffers enough for that stage
 * and for the cull's. The WebGL 2 fallback has none of them, and a
 * compatibility-level device may report no vertex-stage storage, or too little
 * for a cull with levels and an atlas (see `readsVertexStorage` in tsl.ts).
 */
function routeOf(renderer: CullRenderer, vat: VAT, layout: Layout): VATCullRoute {
  const { backend } = renderer
  if (backend.isWebGPUBackend !== true || !backend.device) return 'batch'
  const { limits } = backend.device
  const vertex = limits.maxStorageBuffersInVertexStage ?? limits.maxStorageBuffersPerShaderStage
  return vertex >= vertexStorageBuffersOf(vat) && limits.maxStorageBuffersPerShaderStage >= computeStorageBuffersOf(layout) ? 'gpu' : 'batch'
}

/** One draw of the VAT's geometry: a group's range, or the whole of it where it has none, and its material. */
interface Part {
  material: number
  start: number
  count: number
}

/** A geometry over `source`'s own attributes under `index`, bounded by `bounds`, its all-frames bounds: what each route draws a part with. */
const geometryOver = (source: BufferGeometry, index: BufferAttribute | null, bounds: Box3) => boundedBy(withIndex(source, index), bounds)

/** A clone of a part's material, as `createVATMesh` clones them. */
const materialOf = (vat: VAT, { material }: Part) => vat.materials[material]!.clone() as Clone

/**
 * One list the cull keeps instances in, and the geometry they are drawn with: a
 * level of a character, or a bake's whole geometry where it has no levels.
 */
interface List {
  /** The geometry a batch adds for it: every vertex of its character, numbered from 0. */
  geometry: BufferGeometry
  /** Its character's first vertex in the VAT's own geometry, where the GPU route draws it. */
  vertexStart: number
  /** Its character's own all-frames bounds, which a batch culls it by. */
  bounds: Box3
  /** Its draws: a bake's parts where it has no levels; any other list is one, in the VAT's first material. */
  parts: Part[]
}

/** The crowd's lists, level by level and character by character within a level: list `l × characters + k`. */
function listsOf(vat: VAT, levels: readonly (readonly BufferGeometry[])[] | undefined): List[] {
  if (!levels && !vat.characters) return [{ geometry: vat.geometry, vertexStart: 0, bounds: vat.bounds, parts: partsOf(vat.geometry) }]
  const characters = charactersOf(vat)
  // An atlas without levels is its characters' full detail, as a batch adds them.
  return (levels ?? createVATLODs(vat, []).levels).flatMap((level) =>
    level.map((geometry, k) => ({
      geometry,
      vertexStart: characters[k]!.vertexStart,
      bounds: characters[k]!.bounds,
      parts: [{ material: 0, start: 0, count: indexOf(geometry).length }],
    })),
  )
}

/** How the crowd chooses its instances' levels, as `updateVATLevels` does. */
interface LevelChoice {
  bands: readonly number[]
  slack: number
}

/** What both routes draw a crowd by: its lists, each instance's character, and how its levels are chosen. */
interface Layout {
  lists: List[]
  characterCount: number
  /** Each instance's character, up to the capacity. */
  characterOf: Uint32Array
  /** How the levels are chosen, or `null` where every instance stays at the full detail. */
  choice: LevelChoice | null
}

/**
 * The crowd's layout, or a refusal of what does not fit the VAT: levels that
 * are not the ones `createVATLODs` returned the VAT with, levels of a bake of
 * several materials, levels without bands, a character the VAT does not have.
 */
function layoutOf(vat: VAT, capacity: number, options: VATCulledCrowdOptions): Layout {
  const { levels, bands, slack = 0.1 } = options
  const characters = charactersOf(vat)
  if (levels?.length !== vat.lods) {
    throw new Error(
      levels
        ? `three-vat: ${levels.length} levels were given with a VAT that ${vat.lods ? `has ${vat.lods}` : 'has none'} — hand the crowd the VAT createVATLODs returned with them`
        : `three-vat: this VAT has ${vat.lods} levels — give the crowd them too, as createVATLODs returned them`,
    )
  }
  if (levels) {
    levels.forEach((level, l) => {
      if (level.length !== characters.length) {
        throw new Error(
          `three-vat: level ${l} gives ${level.length} geometries, and the VAT has ${characters.length} ${characters.length === 1 ? 'character' : 'characters'}`,
        )
      }
    })
    if (!vat.characters && vat.materials.length > 1) {
      throw new Error(
        `three-vat: a level draws with one material, and this bake has ${vat.materials.length} — draw a bake of several materials on a culled crowd without levels`,
      )
    }
    if (!bands) throw new Error('three-vat: a culled crowd chooses its levels by bands — give the bands with the levels')
  }
  assertLevelChoice(levels?.length ?? 1, bands ?? [], slack)

  const given = options.characters ?? []
  if (given.length > capacity) throw new Error(`three-vat: ${given.length} characters were given for a crowd of capacity ${capacity}`)
  given.forEach((k, i) => {
    if (!Number.isInteger(k) || k < 0 || k >= characters.length) {
      throw new Error(`three-vat: instance ${i} is given character ${k}, and the VAT has ${characters.length}, numbered from 0`)
    }
  })
  const characterOf = new Uint32Array(capacity)
  characterOf.set(given)

  const choice = bands && bands.length > 0 ? { bands, slack } : null
  return { lists: listsOf(vat, levels), characterCount: characters.length, characterOf, choice }
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
  const capacity = options.capacity ?? instances.length
  const layout = layoutOf(vat, capacity, options)
  const time: VATTimeUniform = options.time ?? uniform(0)
  for (const source of vat.materials) assertBakedNormal(vat, source)
  const route = routeOf(renderer as CullRenderer, vat, layout)

  // Made once every check has passed, and freed if a route fails to build.
  const playback = createVATPlaybackTexture(instances, { capacity, maxTextureSize })
  let built: ReturnType<typeof batchRoute>
  try {
    built =
      route === 'gpu'
        ? gpuRoute(renderer as CullRenderer, vat, layout, instances.length, capacity, playback, time, options.margin ?? 0)
        : batchRoute(vat, layout, instances.length, capacity, playback, time)
  } catch (error) {
    playback.texture.dispose()
    throw error
  }
  const crowd: VATCulledCrowd = {
    object: built.object,
    playback,
    time,
    route,
    dispose() {
      if (disposed.has(crowd)) return
      disposed.add(crowd)
      routes.delete(crowd)
      built.dispose()
      playback.texture.dispose()
    },
  }
  routes.set(crowd, { ...built, capacity })
  return crowd
}

/**
 * The batch route: one `BatchedMesh` a part of the VAT's geometry — a bake of
 * several materials without levels has several, anything else one — each
 * holding that part of every list, level by level and character by character,
 * over every vertex of its character, since the vertex encoding reads a
 * vertex's column at its batch vertex index; and each holding the whole
 * capacity, every row at the full detail of its character. three culls it per
 * instance and per pass, each pass by its own camera, so a shadow cast from out
 * of view is kept without a margin. It does not sort, so it draws in the order
 * the GPU route does. Its levels are chosen by `updateVATLevels`.
 */
function batchRoute(
  vat: VAT,
  { lists, characterCount, characterOf, choice }: Layout,
  shown: number,
  capacity: number,
  playback: VATPlaybackTexture,
  time: VATTimeUniform,
) {
  // One crossfade pass for every batch: they hold the same instances at the same rows.
  const fading = new EventDispatcher<{ dispose: object }>()
  const batches = lists[0]!.parts.map((part, p) => {
    const geometries = lists.map((list) => {
      const { start, count } = list.parts[p]!
      const index = indexOf(list.geometry)
      return geometryOver(list.geometry, new BufferAttribute(Uint32Array.from(Array.prototype.slice.call(index, start, start + count) as number[]), 1), list.bounds)
    })
    const clone = materialOf(vat, part)
    const batch = new BatchedMesh(
      capacity,
      geometries.reduce((n, g) => n + g.getAttribute('position').count, 0),
      geometries.reduce((n, g) => n + g.getIndex()!.count, 0),
      clone,
    )
    const added = geometries.map((geometry) => batch.addGeometry(geometry))
    // `ids[l][k]`, as updateVATLevels reads them.
    const ids = Array.from({ length: added.length / characterCount }, (_, l) => added.slice(l * characterCount, (l + 1) * characterCount))
    for (let i = 0; i < capacity; i++) batch.setVisibleAt(batch.addInstance(ids[0]![characterOf[i]!]!), i < shown)
    batch.sortObjects = false
    // Its instances move: three culls them one by one, never the batch as a whole by bounds that lag them.
    batch.frustumCulled = false
    clone.positionNode = vatNodesFadingOn(vat, { time, playback, carrier: batch }, fading).positionNode
    return { batch, ids }
  })
  return {
    object: crowdGroup(batches.map(({ batch }) => batch)),
    setMatrixAt(i: number, matrix: Matrix4) {
      for (const { batch } of batches) batch.setMatrixAt(i, matrix)
    },
    setVisibleAt(i: number, visible: boolean) {
      for (const { batch } of batches) batch.setVisibleAt(i, visible)
    },
    update(camera: Camera) {
      if (choice) for (const { batch, ids } of batches) updateVATLevels(batch, camera, { ids, ...choice })
    },
    dispose() {
      for (const { batch } of batches) {
        batch.dispose()
        ;(batch.material as Material).dispose()
      }
      fading.dispatchEvent({ type: 'dispose' })
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
 * crowd owns and the caller writes; a compute pass that chooses each instance's
 * level, tests its sphere against the view's planes and compacts the survivors
 * into one list a level and character (ADR-0057); and one mesh a part of each
 * list's geometry, drawing that list indirectly, whose vertex stage reads which
 * instance it draws out of it: its logical index, at which the decode reads the
 * playback row and the placement reads the matrix. The shadow maps draw the
 * same lists: one cull a frame serves every pass (ADR-0052).
 */
function gpuRoute(
  renderer: CullRenderer,
  vat: VAT,
  { lists, characterCount, characterOf, choice }: Layout,
  shown: number,
  capacity: number,
  playback: VATPlaybackTexture,
  time: VATTimeUniform,
  margin: number,
) {
  const matrices = writtenBuffer(attributeArray(capacity * 16).value as BufferAttribute, 16)
  const visible = writtenBuffer(attributeArray(capacity, 'uint').value as BufferAttribute, 1)
  // One list a level and character, each `capacity` long, list `j` from `j × capacity`.
  const survivors = attributeArray(capacity * lists.length, 'uint').value as BufferAttribute
  const identity = new Matrix4().elements
  for (let i = 0; i < capacity; i++) {
    ;(matrices.attribute.array as Float32Array).set(identity, i * 16)
    visible.attribute.array[i] = i < shown ? 1 : 0
  }

  // One draw a part of each list, list by list: a bake without levels is one
  // list of as many parts as it has materials, any other crowd one part a list.
  const draws = lists.flatMap((list, j) => list.parts.map((part) => ({ list: j, part })))
  const perList = lists[0]!.parts.length
  // One record of indirect arguments a draw, the instance count the cull's: an
  // indexed draw's indexCount, instanceCount, firstIndex, baseVertex and
  // firstInstance, and a plain draw's first four in the same places.
  const args = attributeArray(draws.length * ARGS, 'uint').value as BufferAttribute & { isIndirectStorageBufferAttribute?: boolean }
  // What three's IndirectStorageBufferAttribute is, flagged here rather than
  // imported: three/webgpu stays a type-only import of this entry (ADR-0005).
  args.isIndirectStorageBufferAttribute = true
  draws.forEach(({ part: { start, count } }, d) => (args.array as Uint32Array).set([count, 0, start, 0, 0], d * ARGS))

  // Each pass's nodes of its own over the buffers: toReadOnly() and toAtomic() change the node they are called on.
  const counts = storage(args, 'uint', args.count).toAtomic()
  const instanceCountAt = (d: number) => counts.element(int(d * ARGS + 1))
  // A list counts its survivors in its first draw's arguments.
  const reset = Fn(() => {
    lists.forEach((_, j) => atomicStore(instanceCountAt(j * perList), uint(0)))
  })().compute(1)

  // Each instance's level, kept from one cull to the next for the slack, every
  // one at the full detail until the first; and each instance's character.
  const levels = choice ? (attributeArray(capacity, 'uint').value as BufferAttribute) : null
  const characters = characterCount > 1 ? (attributeArray(capacity, 'uint').value as BufferAttribute) : null
  characters?.array.set(characterOf)
  // The levels are chosen in world units, from the camera to each instance placed by the crowd's world matrix.
  const eye = uniform(new Vector3())
  const placedBy = uniform(new Matrix4())

  // An instance's sphere: its character's all-frames bounds (the VAT's, for a
  // bake), moved and sized by its matrix, at its largest scale, and grown by the margin.
  const spheres = charactersOf(vat).map(({ bounds }) => bounds.getBoundingSphere(new Sphere()))
  const planes = Array.from({ length: 6 }, () => uniform(new Vector4()))
  const cullMatrices = storage(matrices.attribute, 'mat4', capacity).toReadOnly()
  const cullVisible = storage(visible.attribute, 'uint', capacity).toReadOnly()
  const kept = storage(survivors, 'uint', survivors.count)
  const cull = Fn(() => {
    const m = cullMatrices.element(instanceIndex).toVar()
    // Its list: its level, and its character within the level.
    let list = uint(0) as Node<'uint'>
    if (choice && levels) {
      // Chosen for every instance, hidden and out of view too, as updateVATLevels
      // moves every live one: from the level it kept, out past each band it is a
      // slack beyond, then back in past each it is a slack within.
      const keptLevel = storage(levels, 'uint', capacity)
      const distance = placedBy.mul(m.mul(vec4(0, 0, 0, 1))).xyz.distance(eye).toVar()
      const level = keptLevel.element(instanceIndex).toVar()
      const { bands, slack } = choice
      bands.forEach((band, b) => {
        If(level.equal(uint(b)).and(distance.greaterThanEqual(band * (1 + slack))), () => {
          level.assign(uint(b + 1))
        })
      })
      for (let b = bands.length - 1; b >= 0; b--) {
        If(level.equal(uint(b + 1)).and(distance.lessThan(bands[b]! * (1 - slack))), () => {
          level.assign(uint(b))
        })
      }
      keptLevel.element(instanceIndex).assign(level)
      list = level
    }
    const character = characters ? storage(characters, 'uint', capacity).toReadOnly().element(instanceIndex).toVar() : null
    if (character) list = list.mul(characterCount).add(character) as Node<'uint'>
    const centreOf = ({ center }: Sphere) => vec3(center.x, center.y, center.z)
    let sphereCentre = centreOf(spheres[0]!) as Node<'vec3'>
    let sphereRadius = float(spheres[0]!.radius) as Node<'float'>
    if (character) {
      spheres.forEach((sphere, k) => {
        if (k === 0) return
        sphereCentre = select(character.equal(uint(k)), centreOf(sphere), sphereCentre) as Node<'vec3'>
        sphereRadius = select(character.equal(uint(k)), float(sphere.radius), sphereRadius) as Node<'float'>
      })
    }
    const center = m.mul(vec4(sphereCentre, 1)).xyz.toVar()
    const axis = (x: number, y: number, z: number) => m.mul(vec4(x, y, z, 0)).xyz.length()
    const scale = max(axis(1, 0, 0), max(axis(0, 1, 0), axis(0, 0, 1)))
    const reach = sphereRadius.mul(scale).add(margin).negate().toVar()
    let inside = cullVisible.element(instanceIndex).notEqual(uint(0)) as Node<'bool'>
    for (const plane of planes) inside = inside.and(plane.xyz.dot(center).add(plane.w).greaterThanEqual(reach)) as Node<'bool'>
    If(inside, () => {
      const at = list.toVar()
      const drawnSlot = atomicAdd(counts.element(at.mul(perList * ARGS).add(1)), uint(1))
      kept.element(at.mul(capacity).add(drawnSlot)).assign(uint(instanceIndex))
    })
  })().compute(capacity)
  // Every part of the one list draws the survivors the first one counted.
  const share = Fn(() => {
    const survived = atomicLoad(instanceCountAt(0)).toVar()
    for (let d = 1; d < perList; d++) atomicStore(instanceCountAt(d), survived)
  })().compute(1)
  const passes = perList > 1 ? [reset, cull, share] : [reset, cull]

  // The crowd holds its crossfade pass as a carrier would, so a crossfade is walked
  // once an instance, written at its row and read at its logical index (#203):
  // one pass, however many lists read it.
  const fading = new EventDispatcher<{ dispose: object }>()
  const drawnLists = storage(survivors, 'uint', survivors.count).toReadOnly()
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
  // One node for every list, so every mesh of a material builds one program:
  // each mesh says where its list starts in a uniform of its own (ADR-0057's
  // lists, one program).
  const listStart = uniform(0, 'uint').onObjectUpdate(({ object }) => listStarts.get(object as Mesh) ?? 0)
  const positionNode = (() => {
    // The drawn slot is a place in the mesh's list; what it holds is the instance.
    const logicalIndex = int(drawnLists.element(instanceIndex.add(listStart)))
    const posed = vatNodesFadingOn(vat, { time, playback, logicalIndex }, fading).positionNode
    return Fn((builder: NodeBuilder) => {
      const local = posed.toVar()
      const m = drawnMatrices.element(logicalIndex).toVar()
      normalLocal.assign(transformNormal(normalLocal, m))
      // Turned with the normal, where the geometry has one: the decode leaves it in the geometry's own space.
      if ((builder as NodeBuilder & { hasGeometryAttribute(name: string): boolean }).hasGeometryAttribute('tangent')) tangentLocal.assign(mat3(m).mul(tangentLocal))
      // Whether this build draws velocity, which @types/three does not declare.
      if ((builder as NodeBuilder & { needsPreviousData(): boolean }).needsPreviousData()) {
        const before = storage(previousMatrices(), 'mat4', capacity).toReadOnly().element(logicalIndex)
        positionPrevious.assign(before.mul(vec4(positionPrevious, 1)).xyz)
      }
      return m.mul(vec4(local, 1)).xyz
    })()
  })()
  const listStarts = new WeakMap<Mesh, number>()

  // Each list's index over the VAT's own vertices: its geometry's, shared, where
  // its character starts at the first, else moved to where the character does.
  const indices = lists.map(({ geometry, vertexStart }) =>
    vertexStart === 0
      ? geometry.getIndex()
      : new BufferAttribute(Uint32Array.from(indexOf(geometry), (v) => v + vertexStart), 1),
  )
  const materials: Clone[] = []
  const meshes = draws.map(({ list, part }, d) => {
    // A part's range is in its arguments.
    const geometry = geometryOver(vat.geometry, indices[list]!, vat.bounds)
    geometry.setIndirect(args as never, d * ARGS * Uint32Array.BYTES_PER_ELEMENT)
    const clone = materialOf(vat, part)
    clone.positionNode = positionNode
    materials.push(clone)
    const mesh = new Mesh(geometry, clone)
    listStarts.set(mesh, list * capacity)
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
      eye.value.setFromMatrixPosition(camera.matrixWorld)
      placedBy.value.copy(object.matrixWorld)
      // What the GPU holds is the frame drawn last, until the writes since are
      // flagged: copied first, where it is ahead of the previous frame's.
      if (previous && behind) renderer.compute(previous.copy)
      behind = matrices.flush()
      visible.flush()
      renderer.compute(passes)
    },
    dispose() {
      for (const material of materials) material.dispose()
      for (const attribute of [matrices.attribute, visible.attribute, survivors, args, levels, characters]) attribute?.dispose()
      for (const pass of [reset, cull, share]) pass.dispose()
      previous?.attribute.dispose()
      previous?.copy.dispose()
      // The geometries share the bake's attributes, which disposing one would
      // free from the GPU under every crowd of the bake: only the indices moved
      // to a later character are this crowd's own.
      for (const index of indices) if (index && index !== vat.geometry.getIndex()) index.dispose()
      fading.dispatchEvent({ type: 'dispose' })
    },
  }
}

/** The crowd's route, or a refusal of a crowd `createVATCulledCrowd` did not make. */
function routeFor(crowd: VATCulledCrowd) {
  if (disposed.has(crowd)) throw new Error('three-vat: this culled crowd was disposed — make a new one to draw it again')
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
