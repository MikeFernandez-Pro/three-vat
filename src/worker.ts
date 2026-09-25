// Baking off the main thread: `bakeVATInWorker` on the page, `serveVATBakes`
// in the worker (ADR-0026).
//
// The bake is pure CPU and never touches a renderer, so it can run in a Web
// Worker as it is. What cannot cross is the scene: an `Object3D` is not
// cloneable. So the page sends a *copy of what the bake reads* — the posed
// subtree's transforms, geometry, skins and morphs, and the clips — and the
// worker rebuilds that subtree and calls the very same `bakeVAT` on it. No
// second baker, and no second opinion about what a frame is (ADR-0008's one
// entry point, kept).
//
// Materials never travel. A material holds textures and GPU state, and the bake
// only needs to tell one from another, so the worker bakes against numbered
// stand-ins and the page puts its own materials back by number. The VAT that
// comes back holds the caller's real materials, in `materialIndex` order,
// exactly as `bakeVAT` would have returned them.
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BooleanKeyframeTrack,
  BufferAttribute,
  BufferGeometry,
  ColorKeyframeTrack,
  Float16BufferAttribute,
  FloatType,
  HalfFloatType,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Interpolant,
  Material,
  Matrix4,
  Mesh,
  NumberKeyframeTrack,
  Object3D,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Sphere,
  StringKeyframeTrack,
  VectorKeyframeTrack,
  Box3,
  Vector3,
} from 'three'
import type {
  AnimationAction,
  AnimationBlendMode,
  AnimationActionLoopStyles,
  EulerOrder,
  InterpolationModes,
  KeyframeTrack,
  TypedArray,
} from 'three'
import { bakeVATWith } from './bake.js'
import type { BakeInput, BakeOptions } from './bake.js'
import { flatFacts, mergedFlatMaterial } from './flat-materials.js'
import type { FlatFacts, FlatMergeHooks } from './flat-materials.js'
import type { DeltaVAT, RigVAT, VAT, VATClip } from './types.js'
import { makeVATNormalTexture, makeVATTexture } from './vat-texture.js'

/**
 * What `bakeVATInWorker` talks to: a `Worker`, or anything else that posts and
 * receives messages the same way (a `MessagePort`, say). The worker on the
 * other end must call {@link serveVATBakes}.
 */
export interface VATBakeWorker {
  postMessage(message: unknown, transfer: Transferable[]): void
  addEventListener(type: 'message' | 'error', listener: (event: MessageEvent | ErrorEvent) => void): void
  removeEventListener(type: 'message' | 'error', listener: (event: MessageEvent | ErrorEvent) => void): void
}

/**
 * Where `serveVATBakes` listens: the worker's own global scope by default, or
 * any other end of a message channel.
 */
export interface VATBakeScope {
  postMessage(message: unknown, transfer: Transferable[]): void
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

// Tagged, so a worker that does other work besides can share its channel.
const REQUEST = 'three-vat:bake'
const RESPONSE = 'three-vat:baked'

// ------------------------------------------------------------------ records
// The wire format. Internal: both ends ship in the same package version, so
// nothing here is a contract anyone else reads.

type Mat4 = number[]

interface PlainAttributeRecord {
  kind: 'plain'
  array: TypedArray
  itemSize: number
  normalized: boolean
  name: string
  /** A `Float16BufferAttribute`: its array holds half-float bits, which only that class reads as values. */
  half?: true
}

interface InterleavedAttributeRecord {
  kind: 'interleaved'
  /** Index into {@link SceneRecord.interleaved}. */
  buffer: number
  itemSize: number
  offset: number
  normalized: boolean
  name: string
}

type AttributeRecord = PlainAttributeRecord | InterleavedAttributeRecord

interface GeometryRecord {
  attributes: Record<string, AttributeRecord>
  morphAttributes: Record<string, AttributeRecord[]>
  morphTargetsRelative: boolean
  index: PlainAttributeRecord | null
  groups: { start: number; count: number; materialIndex?: number }[]
  drawRange: { start: number; count: number }
}

interface NodeRecord {
  kind: 'object' | 'bone' | 'mesh' | 'skinned'
  /** Index of the parent in {@link SceneRecord.nodes}; `-1` for the root. */
  parent: number
  name: string
  uuid: string
  position: number[]
  quaternion: number[]
  scale: number[]
  rotationOrder: EulerOrder
  matrixAutoUpdate: boolean
  matrixWorldAutoUpdate: boolean
  matrix: Mat4
  matrixWorld: Mat4
  /** The node's pivot, which `updateMatrix` folds into its matrix; absent for none. */
  pivot?: number[]
  geometry?: number
  /** Index, or indices, into the page's material list. */
  material?: number | number[]
  morphTargetInfluences?: number[]
  morphTargetDictionary?: Record<string, number>
  skeleton?: number
  bindMode?: SkinnedMesh['bindMode']
  bindMatrix?: Mat4
  bindMatrixInverse?: Mat4
}

interface SkeletonRecord {
  /** Node index per bone; `-1` where three's own array holds none. */
  bones: number[]
  boneInverses: Mat4[]
}

interface TrackRecord {
  name: string
  type: string
  times: TypedArray
  values: TypedArray | unknown[]
  /** A three interpolation mode, or glTF's cubic spline, which three reaches only through GLTFLoader. */
  interpolation: InterpolationModes | 'gltf-cubic'
  settings?: { inTangents: unknown; outTangents: unknown }
}

interface ClipRecord {
  name: string
  duration: number
  blendMode: AnimationBlendMode
  tracks: TrackRecord[]
}

interface InputRecord {
  clip: number
  /** Present when the caller handed an `AnimationAction`: the fields the bake reads off one. */
  action?: {
    weight: number
    blendMode: AnimationBlendMode
    timeScale: number
    loop: AnimationActionLoopStyles
    repetitions: number
    clampWhenFinished: boolean
  }
}

interface SceneRecord {
  /** The root's parent's world matrix, so root space is computed from the same bits on both threads. */
  parentWorld: Mat4 | null
  nodes: NodeRecord[]
  geometries: GeometryRecord[]
  interleaved: { array: TypedArray; stride: number }[]
  skeletons: SkeletonRecord[]
  clips: ClipRecord[]
  inputs: InputRecord[]
  materialCount: number
  /**
   * Per material, what a flat merge reads off it (ADR-0028) — read here, on the
   * page, because a stand-in has no colour to read. `null` when the bake was
   * not asked to merge.
   */
  flat: (FlatFacts | null)[] | null
}

interface BakeRequest {
  type: typeof REQUEST
  id: number
  scene: SceneRecord
  options: BakeOptions
}

interface VATRecord {
  encoding: 'delta' | 'rig'
  /** The position texture's texels under the vertex encoding, the rig texture's under the rig one. */
  texels: Float32Array | Uint16Array
  /**
   * That texture's dimensions, as the bake made it — carried rather than
   * worked out again here, so the layout is said once, by the bake.
   */
  width: number
  height: number
  normals: Uint8Array | null
  slotCount: number
  /** `vat.fallback` under the vertex encoding (ADR-0029); `null` under the rig one, which has none. */
  fallback: string | null
  /**
   * `vat.rowsPerFrame` under the vertex encoding (ADR-0030); `1` under the rig
   * one, whose frame is always one row.
   */
  rowsPerFrame: number
  geometry: GeometryRecord
  /**
   * Per entry of `vat.materials`, its index in the page's material list — or,
   * for a material a flat merge made, the indices of the materials it merged,
   * so the page can build the real one from its own.
   */
  materials: (number | number[])[]
  clips: VATClip[]
  bounds: { min: number[]; max: number[] }
  vertexCount: number
  totalFrames: number
}

type BakeResponse =
  | { type: typeof RESPONSE; id: number; vat: VATRecord }
  | { type: typeof RESPONSE; id: number; error: string }

// ------------------------------------------------------------------ buffers

/**
 * A typed array this message can transfer. The page does not own a glTF's
 * arrays — they are views into the file's one buffer, which a transfer would
 * detach under the caller, and which a plain clone would copy whole, images
 * and all — so the page always copies the view. The worker owns what it
 * baked, and hands over a whole-buffer array as it is.
 */
function transferable<T extends TypedArray>(array: T, owned: boolean, transfer: Set<ArrayBuffer>): T {
  const whole = array.byteOffset === 0 && array.byteLength === array.buffer.byteLength
  const out = owned && whole ? array : (array.slice() as T)
  transfer.add(out.buffer as ArrayBuffer)
  return out
}

function recordGeometry(
  geometry: BufferGeometry,
  owned: boolean,
  transfer: Set<ArrayBuffer>,
  interleaved: Map<InterleavedBuffer, number>,
  interleavedRecords: SceneRecord['interleaved'],
): GeometryRecord {
  const attribute = (a: unknown, what: string): AttributeRecord => {
    if (a instanceof InterleavedBufferAttribute) {
      let buffer = interleaved.get(a.data)
      if (buffer === undefined) {
        buffer = interleavedRecords.push({ array: transferable(a.data.array, owned, transfer), stride: a.data.stride }) - 1
        interleaved.set(a.data, buffer)
      }
      return { kind: 'interleaved', buffer, itemSize: a.itemSize, offset: a.offset, normalized: a.normalized, name: a.name }
    }
    if (a instanceof BufferAttribute) {
      return {
        kind: 'plain',
        array: transferable(a.array, owned, transfer),
        itemSize: a.itemSize,
        normalized: a.normalized,
        name: a.name,
        ...(a instanceof Float16BufferAttribute ? { half: true as const } : {}),
      }
    }
    throw new Error(`three-vat: the "${what}" attribute is neither a BufferAttribute nor an interleaved one; a worker cannot carry it`)
  }

  const index = geometry.getIndex()
  return {
    attributes: Object.fromEntries(Object.entries(geometry.attributes).map(([name, a]) => [name, attribute(a, name)])),
    morphAttributes: Object.fromEntries(
      Object.entries(geometry.morphAttributes).map(([name, list]) => [name, list.map((a) => attribute(a, `morph ${name}`))]),
    ),
    morphTargetsRelative: geometry.morphTargetsRelative,
    index: index ? (attribute(index, 'index') as PlainAttributeRecord) : null,
    groups: geometry.groups.map((g) => ({ ...g })),
    drawRange: { ...geometry.drawRange },
  }
}

function rebuildGeometry(record: GeometryRecord, interleaved: InterleavedBuffer[]): BufferGeometry {
  const attribute = (a: AttributeRecord): BufferAttribute | InterleavedBufferAttribute => {
    const built =
      a.kind === 'plain'
        ? a.half
          ? new Float16BufferAttribute(a.array as Uint16Array, a.itemSize, a.normalized)
          : new BufferAttribute(a.array, a.itemSize, a.normalized)
        : new InterleavedBufferAttribute(interleaved[a.buffer]!, a.itemSize, a.offset, a.normalized)
    built.name = a.name
    return built
  }

  const geometry = new BufferGeometry()
  for (const [name, a] of Object.entries(record.attributes)) geometry.setAttribute(name, attribute(a))
  for (const [name, list] of Object.entries(record.morphAttributes)) {
    ;(geometry.morphAttributes as Record<string, (BufferAttribute | InterleavedBufferAttribute)[]>)[name] = list.map(attribute)
  }
  geometry.morphTargetsRelative = record.morphTargetsRelative
  if (record.index) geometry.setIndex(attribute(record.index) as BufferAttribute)
  for (const g of record.groups) geometry.addGroup(g.start, g.count, g.materialIndex)
  geometry.setDrawRange(record.drawRange.start, record.drawRange.count)
  return geometry
}

// ------------------------------------------------------------------ tracks

/** A keyframe track's constructor, loosened so one table can hold every value type. */
type TrackConstructor = new (name: string, times: unknown, values: unknown) => KeyframeTrack

/** Every track type three ships, by the `ValueTypeName` each one carries. */
const TRACK_TYPES = {
  bool: BooleanKeyframeTrack,
  color: ColorKeyframeTrack,
  number: NumberKeyframeTrack,
  quaternion: QuaternionKeyframeTrack,
  string: StringKeyframeTrack,
  vector: VectorKeyframeTrack,
} as unknown as Record<string, TrackConstructor>

/** A track's interpolant factory, which three's typings leave off the class. */
interface WithFactory {
  createInterpolant: unknown
}

/** GLTFLoader marks its cubic-spline factory this way, because `getInterpolation` cannot name a custom one. */
interface GLTFCubicFactory {
  isInterpolantFactoryMethodGLTFCubicSpline?: boolean
}

/**
 * The properties a bake reads off the nodes a track animates: a node's
 * transform, and a baked mesh's morphs. Kept in step with bake.ts, whose own
 * track readers (`morphTracksOn`, `refuseAnimatedNonUniformScale`) read no
 * others.
 */
const READ_PROPERTIES = new Set(['position', 'quaternion', 'rotation', 'scale', 'morphTargetInfluences'])

/**
 * Whether the bake reads what `track` animates. What it does not read stays on
 * the page (#89): the worker's nodes and materials are bare stand-ins, so a
 * track on a material's colour or a light's intensity, which binds on the page,
 * would find nothing there, and three says so on the console. Dropping it
 * changes no frame. A bone is reached through its mesh's skeleton, which the
 * worker rebuilds; any other object a track names — a material, a map — it
 * does not. Morphs cross only on the meshes the bake bakes, so a morph track on
 * a Points, a Line or a mesh with no geometry stays behind too.
 */
function bakeReadsTrack(track: KeyframeTrack, root: Object3D, baked: Set<Object3D>): boolean {
  const { nodeName, objectName, propertyName } = PropertyBinding.parseTrackName(track.name)
  if (objectName && objectName !== 'bones') return false
  if (!READ_PROPERTIES.has(propertyName)) return false
  if (propertyName !== 'morphTargetInfluences' || objectName) return true
  return baked.has(PropertyBinding.findNode(root, nodeName) as Object3D)
}

function recordTrack(track: KeyframeTrack, clip: AnimationClip, transfer: Set<ArrayBuffer>): TrackRecord {
  const factory = (track as unknown as WithFactory).createInterpolant as GLTFCubicFactory
  const interpolation = factory.isInterpolantFactoryMethodGLTFCubicSpline ? 'gltf-cubic' : track.getInterpolation()
  if (interpolation === undefined) {
    throw new Error(
      `three-vat: track "${track.name}" of clip "${clip.name || '(unnamed)'}" uses a custom interpolant, which ` +
        'a worker cannot carry; bake this clip with bakeVAT on the main thread',
    )
  }
  if (!(track.ValueTypeName in TRACK_TYPES)) {
    throw new Error(`three-vat: track "${track.name}" is a "${track.ValueTypeName}" track, which a worker cannot rebuild`)
  }
  const values = ArrayBuffer.isView(track.values)
    ? transferable(track.values as TypedArray, false, transfer)
    : Array.from(track.values as ArrayLike<unknown>)
  const settings = (track as KeyframeTrack & { settings?: { inTangents?: unknown; outTangents?: unknown } }).settings
  return {
    name: track.name,
    type: track.ValueTypeName,
    times: transferable(track.times as TypedArray, false, transfer),
    values,
    interpolation,
    ...(settings?.inTangents && settings.outTangents
      ? { settings: { inTangents: settings.inTangents, outTangents: settings.outTangents } }
      : {}),
  }
}

// glTF's cubic spline, as GLTFLoader interpolates it (three's
// `GLTFCubicSplineInterpolant`, which that module does not export). A keyframe
// holds three values — in-tangent, vertex, out-tangent — so the sample size is
// a third of the track's value size.
class CubicSplineInterpolant extends Interpolant {
  override copySampleValue_(index: number): TypedArray {
    const result = this.resultBuffer as TypedArray
    const values = this.sampleValues as TypedArray
    const size = this.valueSize
    const offset = index * size * 3 + size
    for (let i = 0; i !== size; i++) result[i] = values[offset + i]!
    return result
  }

  override interpolate_(i1: number, t0: number, t: number, t1: number): TypedArray {
    const result = this.resultBuffer as TypedArray
    const values = this.sampleValues as TypedArray
    const stride = this.valueSize
    const stride2 = stride * 2
    const stride3 = stride * 3
    const td = t1 - t0
    const p = (t - t0) / td
    const pp = p * p
    const ppp = pp * p
    const offset1 = i1 * stride3
    const offset0 = offset1 - stride3
    const s2 = -2 * ppp + 3 * pp
    const s3 = ppp - pp
    const s0 = 1 - s2
    const s1 = s3 - pp + p
    for (let i = 0; i !== stride; i++) {
      const p0 = values[offset0 + i + stride]!
      const m0 = values[offset0 + i + stride2]! * td
      const p1 = values[offset1 + i + stride]!
      const m1 = values[offset1 + i]! * td
      result[i] = s0 * p0 + s1 * m0 + s2 * p1 + s3 * m1
    }
    return result
  }
}

const _q = new Quaternion()

class CubicSplineQuaternionInterpolant extends CubicSplineInterpolant {
  override interpolate_(i1: number, t0: number, t: number, t1: number): TypedArray {
    const result = super.interpolate_(i1, t0, t, t1)
    _q.fromArray(result).normalize().toArray(result)
    return result
  }
}

function rebuildTrack(record: TrackRecord): KeyframeTrack {
  const Track = TRACK_TYPES[record.type]!
  const track = new Track(record.name, record.times as ArrayLike<number>, record.values as ArrayLike<unknown>)
  if (record.interpolation === 'gltf-cubic') {
    const quaternion = track instanceof QuaternionKeyframeTrack
    const factory = function (this: KeyframeTrack, result: TypedArray | undefined) {
      const Kind = quaternion ? CubicSplineQuaternionInterpolant : CubicSplineInterpolant
      return new Kind(this.times, this.values, this.getValueSize() / 3, result)
    }
    ;(factory as GLTFCubicFactory).isInterpolantFactoryMethodGLTFCubicSpline = true
    ;(track as unknown as WithFactory).createInterpolant = factory
  } else if (record.interpolation !== track.DefaultInterpolation) {
    track.setInterpolation(record.interpolation)
  }
  if (record.settings) Object.assign(track, { settings: record.settings })
  return track
}

// ------------------------------------------------------------------ scene

function isAction(input: BakeInput): input is AnimationAction {
  return typeof (input as AnimationAction).getClip === 'function'
}

/** Everything `bakeVAT(root, animations)` reads, as a message, and the page's materials in the order the message numbers them. */
function recordScene(
  root: Object3D,
  animations: BakeInput[],
  mergeFlat: boolean,
): { scene: SceneRecord; materials: Material[]; transfer: Transferable[] } {
  const transfer = new Set<ArrayBuffer>()
  const nodes: NodeRecord[] = []
  const nodeIndex = new Map<Object3D, number>()
  const geometries = new Map<BufferGeometry, number>()
  const geometryRecords: GeometryRecord[] = []
  const interleaved = new Map<InterleavedBuffer, number>()
  const interleavedRecords: SceneRecord['interleaved'] = []
  const materials: Material[] = []
  const skeletons = new Map<Skeleton, number>()
  const skinned: [SkinnedMesh, NodeRecord][] = []
  const baked = new Set<Object3D>()

  const materialOf = (m: Material) => {
    const i = materials.indexOf(m)
    return i === -1 ? materials.push(m) - 1 : i
  }

  root.traverse((o) => {
    const mesh = o as Mesh
    const skin = o as SkinnedMesh
    // A mesh with no geometry is one the bake skips, so it crosses as a plain
    // node: rebuilt as a mesh, it would get an empty geometry and be baked.
    const isBaked = mesh.isMesh && !!mesh.geometry
    const record: NodeRecord = {
      kind: isBaked ? (skin.isSkinnedMesh ? 'skinned' : 'mesh') : (o as Bone).isBone ? 'bone' : 'object',
      parent: o === root ? -1 : nodeIndex.get(o.parent!)!,
      name: o.name,
      uuid: o.uuid,
      position: o.position.toArray(),
      quaternion: o.quaternion.toArray(),
      scale: o.scale.toArray(),
      rotationOrder: o.rotation.order,
      matrixAutoUpdate: o.matrixAutoUpdate,
      matrixWorldAutoUpdate: o.matrixWorldAutoUpdate,
      matrix: [...o.matrix.elements],
      matrixWorld: [...o.matrixWorld.elements],
    }
    if (o.pivot) record.pivot = o.pivot.toArray()
    nodeIndex.set(o, nodes.push(record) - 1)

    if (isBaked) {
      baked.add(o)
      let g = geometries.get(mesh.geometry)
      if (g === undefined) {
        g = geometryRecords.push(recordGeometry(mesh.geometry, false, transfer, interleaved, interleavedRecords)) - 1
        geometries.set(mesh.geometry, g)
      }
      record.geometry = g
      record.material = Array.isArray(mesh.material) ? mesh.material.map(materialOf) : materialOf(mesh.material)
      if (mesh.morphTargetInfluences) record.morphTargetInfluences = [...mesh.morphTargetInfluences]
      if (mesh.morphTargetDictionary) record.morphTargetDictionary = { ...mesh.morphTargetDictionary }
      if (skin.isSkinnedMesh) {
        record.bindMode = skin.bindMode
        record.bindMatrix = [...skin.bindMatrix.elements]
        record.bindMatrixInverse = [...skin.bindMatrixInverse.elements]
        skinned.push([skin, record])
      }
    }
  })

  // Skeletons last: a bone may sit anywhere in the subtree, including after the
  // mesh it moves.
  const skeletonRecords: SkeletonRecord[] = []
  for (const [mesh, record] of skinned) {
    const skeleton = mesh.skeleton
    if (!skeleton) continue
    let s = skeletons.get(skeleton)
    if (s === undefined) {
      const bones = skeleton.bones.map((bone) => {
        if (!bone) return -1
        const i = nodeIndex.get(bone)
        if (i === undefined) {
          throw new Error(
            `three-vat: bone "${bone.name || '(unnamed)'}" of mesh "${mesh.name || '(unnamed)'}" is outside the ` +
              'subtree being baked; bake from an ancestor of the whole rig',
          )
        }
        return i
      })
      s = skeletonRecords.push({ bones, boneInverses: skeleton.boneInverses.map((m) => [...m.elements]) }) - 1
      skeletons.set(skeleton, s)
    }
    record.skeleton = s
  }

  const clips: AnimationClip[] = []
  const clipRecords: ClipRecord[] = []
  const clipOf = (clip: AnimationClip) => {
    const i = clips.indexOf(clip)
    if (i !== -1) return i
    clipRecords.push({
      name: clip.name,
      duration: clip.duration,
      blendMode: clip.blendMode,
      tracks: clip.tracks.filter((t) => bakeReadsTrack(t, root, baked)).map((t) => recordTrack(t, clip, transfer)),
    })
    return clips.push(clip) - 1
  }
  const inputs: InputRecord[] = animations.map((input) =>
    isAction(input)
      ? {
          clip: clipOf(input.getClip()),
          action: {
            weight: input.weight,
            blendMode: input.blendMode,
            timeScale: input.timeScale,
            loop: input.loop,
            repetitions: input.repetitions,
            clampWhenFinished: input.clampWhenFinished,
          },
        }
      : { clip: clipOf(input) },
  )

  return {
    scene: {
      parentWorld: root.parent ? [...root.parent.matrixWorld.elements] : null,
      nodes,
      geometries: geometryRecords,
      interleaved: interleavedRecords,
      skeletons: skeletonRecords,
      clips: clipRecords,
      inputs,
      materialCount: materials.length,
      flat: mergeFlat ? materials.map(flatFacts) : null,
    },
    materials,
    transfer: [...transfer],
  }
}

/** The subtree the page described, rebuilt, with numbered stand-ins for its materials. */
function rebuildScene(scene: SceneRecord): {
  root: Object3D
  animations: BakeInput[]
  stand: Map<Material, number | number[]>
  hooks: FlatMergeHooks
} {
  const stand = new Map<Material, number | number[]>()
  const standIns = Array.from({ length: scene.materialCount }, (_, i) => {
    const m = new Material()
    stand.set(m, i)
    return m
  })
  // A flat merge reads the facts the page sent, and makes a stand-in for the
  // merged material that remembers which materials it stands for.
  const hooks: FlatMergeHooks = {
    facts: (m) => scene.flat?.[stand.get(m) as number] ?? null,
    merge: (members) => {
      const merged = new Material()
      stand.set(merged, members.map((m) => stand.get(m) as number))
      return merged
    },
  }
  const interleaved = scene.interleaved.map(({ array, stride }) => new InterleavedBuffer(array, stride))
  const geometries = scene.geometries.map((g) => rebuildGeometry(g, interleaved))

  const nodes: Object3D[] = scene.nodes.map((n) => {
    const material = n.material === undefined ? undefined : Array.isArray(n.material) ? n.material.map((i) => standIns[i]!) : standIns[n.material]!
    const geometry = n.geometry === undefined ? undefined : geometries[n.geometry]
    const o =
      n.kind === 'skinned'
        ? new SkinnedMesh(geometry, material as Material)
        : n.kind === 'mesh'
          ? new Mesh(geometry, material)
          : n.kind === 'bone'
            ? new Bone()
            : new Object3D()
    o.name = n.name
    o.uuid = n.uuid
    o.rotation.order = n.rotationOrder
    o.position.fromArray(n.position)
    o.quaternion.fromArray(n.quaternion)
    o.scale.fromArray(n.scale)
    if (n.pivot) o.pivot = new Vector3().fromArray(n.pivot)
    o.matrixAutoUpdate = n.matrixAutoUpdate
    o.matrixWorldAutoUpdate = n.matrixWorldAutoUpdate
    o.matrix.fromArray(n.matrix)
    o.matrixWorld.fromArray(n.matrixWorld)
    const mesh = o as Mesh
    if (n.morphTargetInfluences) mesh.morphTargetInfluences = [...n.morphTargetInfluences]
    if (n.morphTargetDictionary) mesh.morphTargetDictionary = { ...n.morphTargetDictionary }
    return o
  })
  scene.nodes.forEach((n, i) => {
    if (n.parent !== -1) nodes[n.parent]!.add(nodes[i]!)
  })

  const skeletons = scene.skeletons.map(
    (s) =>
      new Skeleton(
        s.bones.map((b) => (b === -1 ? undefined : nodes[b])) as Bone[],
        s.boneInverses.map((m) => new Matrix4().fromArray(m)),
      ),
  )
  scene.nodes.forEach((n, i) => {
    if (n.kind !== 'skinned' || n.skeleton === undefined) return
    const mesh = nodes[i] as SkinnedMesh
    mesh.bindMode = n.bindMode!
    mesh.bind(skeletons[n.skeleton]!, new Matrix4().fromArray(n.bindMatrix!))
    // The page's bits, not an inverse recomputed here: in detached mode this
    // is what skins, and it need not be the bind matrix's exact inverse.
    mesh.bindMatrixInverse.fromArray(n.bindMatrixInverse!)
  })

  const root = nodes[0]!
  if (scene.parentWorld) {
    // Root space is `root.matrixWorld⁻¹ × part.matrixWorld`, and the root's
    // world matrix is its parent's times its own: a parent that holds the
    // page's bits keeps both in step without being a node the bake can reach.
    const parent = new Object3D()
    parent.matrixWorld.fromArray(scene.parentWorld)
    parent.add(root)
  }

  const clips = scene.clips.map((c) => {
    return new AnimationClip(c.name, c.duration, c.tracks.map(rebuildTrack), c.blendMode)
  })
  const animations: BakeInput[] = scene.inputs.map(({ clip, action }) => {
    if (!action) return clips[clip]!
    // A mixer of its own per action: one mixer hands back the same action for
    // the same clip, and two actions of one clip, configured apart, are two
    // inputs the bake reads apart.
    const a = new AnimationMixer(root).clipAction(clips[clip]!, undefined, action.blendMode)
    a.weight = action.weight
    a.timeScale = action.timeScale
    a.loop = action.loop
    a.repetitions = action.repetitions
    a.clampWhenFinished = action.clampWhenFinished
    return a
  })

  return { root, animations, stand, hooks }
}

// ------------------------------------------------------------------ the VAT

function recordVAT(vat: VAT, stand: Map<Material, number | number[]>): { vat: VATRecord; transfer: Transferable[] } {
  const transfer = new Set<ArrayBuffer>()
  const texture = vat.encoding === 'delta' ? vat.positionTexture : vat.rigTexture
  const normals = vat.encoding === 'delta' && vat.normalTexture ? (vat.normalTexture.image.data as Uint8Array) : null
  const record: VATRecord = {
    encoding: vat.encoding,
    texels: transferable(texture.image.data as Float32Array | Uint16Array, true, transfer),
    width: texture.image.width,
    height: texture.image.height,
    normals: normals ? transferable(normals, true, transfer) : null,
    slotCount: vat.encoding === 'rig' ? vat.slotCount : 0,
    fallback: vat.encoding === 'delta' ? vat.fallback : null,
    rowsPerFrame: vat.encoding === 'delta' ? vat.rowsPerFrame : 1,
    geometry: recordGeometry(vat.geometry, true, transfer, new Map(), []),
    materials: vat.materials.map((m) => stand.get(m)!),
    clips: vat.clips,
    bounds: { min: vat.bounds.min.toArray(), max: vat.bounds.max.toArray() },
    vertexCount: vat.vertexCount,
    totalFrames: vat.totalFrames,
  }
  return { vat: record, transfer: [...transfer] }
}

function rebuildVAT(record: VATRecord, materials: Material[]): VAT {
  const geometry = rebuildGeometry(record.geometry, [])
  const bounds = new Box3(new Vector3().fromArray(record.bounds.min), new Vector3().fromArray(record.bounds.max))
  // What the bake set, set the same way: the union of every frame, so a
  // deformed crowd is not culled mid-animation.
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

  const base = {
    geometry,
    materials: record.materials.map((i) =>
      typeof i === 'number' ? materials[i]! : mergedFlatMaterial(i.map((j) => materials[j]!)),
    ),
    clips: record.clips,
    bounds,
    vertexCount: record.vertexCount,
    totalFrames: record.totalFrames,
  }
  if (record.encoding === 'rig') {
    const vat: RigVAT = {
      encoding: 'rig',
      rigTexture: makeVATTexture(record.texels, record.width, record.height, FloatType),
      slotCount: record.slotCount,
      ...base,
    }
    return vat
  }
  const vat: DeltaVAT = {
    positionTexture: makeVATTexture(record.texels, record.width, record.height, HalfFloatType),
    normalTexture: record.normals ? makeVATNormalTexture(record.normals, record.width, record.height) : null,
    encoding: 'delta',
    fallback: record.fallback,
    rowsPerFrame: record.rowsPerFrame,
    ...base,
  }
  return vat
}

// ------------------------------------------------------------------ public

let nextId = 0

/**
 * {@link bakeVAT}, in a Web Worker: the same arguments, the same VAT, and a
 * page that keeps drawing frames while it bakes.
 *
 * ```ts
 * // bake.worker.ts — the whole file
 * import { serveVATBakes } from 'three-vat'
 * serveVATBakes()
 * ```
 *
 * ```ts
 * // the page
 * const worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' })
 * const vat = await bakeVATInWorker(worker, gltf.scene, gltf.animations, {
 *   maxTextureSize: getMaxTextureSize(renderer),
 * })
 * ```
 *
 * The subtree is copied, not moved: the caller's scene is untouched, and a
 * source geometry without normals is not given them as it would be by a bake
 * on this thread. Materials never cross — the VAT comes back holding the
 * caller's own, in `materialIndex` order. A refusal rejects the promise with
 * the message `bakeVAT` would have thrown. One worker serves any number of
 * bakes, one at a time. A track on what the bake does not read, such as a
 * material's colour, stays on the page.
 *
 * What cannot be copied is refused before anything is sent: a bone outside
 * the subtree, a keyframe track the bake reads that has a custom interpolant
 * (glTF's cubic spline is carried), an attribute that is neither a
 * `BufferAttribute` nor an interleaved one.
 */
export function bakeVATInWorker(
  worker: VATBakeWorker,
  root: Object3D,
  animations: BakeInput[],
  options: BakeOptions & { encoding: 'delta' },
): Promise<DeltaVAT>
export function bakeVATInWorker(
  worker: VATBakeWorker,
  root: Object3D,
  animations: BakeInput[],
  options: BakeOptions & { encoding: 'rig' },
): Promise<RigVAT>
export function bakeVATInWorker(
  worker: VATBakeWorker,
  root: Object3D,
  animations: BakeInput[],
  options?: BakeOptions,
): Promise<VAT>
export function bakeVATInWorker(
  worker: VATBakeWorker,
  root: Object3D,
  animations: BakeInput[],
  options: BakeOptions = {},
): Promise<VAT> {
  return new Promise<VAT>((resolve, reject) => {
    // Read now, as `bakeVAT` reads it: the pose the caller hands over is the
    // pose at the call, not whatever it has become once the worker answers.
    root.updateMatrixWorld(true)
    const { scene, materials, transfer } = recordScene(root, animations, !!options.mergeFlatMaterials)
    const id = nextId++

    const done = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    const onMessage = (event: MessageEvent | ErrorEvent) => {
      const data = (event as MessageEvent).data as BakeResponse | undefined
      if (data?.type !== RESPONSE || data.id !== id) return
      done()
      if ('error' in data) reject(new Error(data.error))
      else resolve(rebuildVAT(data.vat, materials))
    }
    const onError = (event: MessageEvent | ErrorEvent) => {
      done()
      const message = (event as ErrorEvent).message
      reject(
        new Error(
          `three-vat: the bake worker failed${message ? ` (${message})` : ''}; its module must import and call serveVATBakes()`,
        ),
      )
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)

    const request: BakeRequest = { type: REQUEST, id, scene, options }
    try {
      worker.postMessage(request, transfer)
    } catch (error) {
      done()
      reject(error)
    }
  })
}

/**
 * The worker's half of {@link bakeVATInWorker}: answer every bake the page
 * sends, by calling `bakeVAT` here. Call it once, at the top of the worker
 * module. Messages that are not bakes are left alone, so the worker may do
 * other work besides. Returns a function that stops listening.
 */
export function serveVATBakes(scope: VATBakeScope = globalThis as unknown as VATBakeScope): () => void {
  const onMessage = (event: MessageEvent) => {
    const data = event.data as BakeRequest | undefined
    if (data?.type !== REQUEST) return
    let response: BakeResponse
    let transfer: Transferable[] = []
    try {
      const { root, animations, stand, hooks } = rebuildScene(data.scene)
      const recorded = recordVAT(bakeVATWith(root, animations, data.options, hooks), stand)
      response = { type: RESPONSE, id: data.id, vat: recorded.vat }
      transfer = recorded.transfer
    } catch (error) {
      response = { type: RESPONSE, id: data.id, error: error instanceof Error ? error.message : String(error) }
    }
    scope.postMessage(response, transfer)
  }
  scope.addEventListener('message', onMessage)
  return () => scope.removeEventListener('message', onMessage)
}
