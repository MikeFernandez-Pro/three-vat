import { Box3, BufferGeometry, DataTexture, MeshStandardMaterial } from 'three'
import type { Material } from 'three'
import { uniform } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { addVATInstanceAttributes, PLAYBACK_ATTRIBUTES } from './instance-playback.js'
import { makeVATFixture, makeFixtureCrowd } from './test-utils.js'
import { createVATMesh, vatDecode, vatNodes } from './tsl.js'
import type { VAT, VATClip } from './types.js'

// The TSL path has no headless GPU, so these are structural: they assert the
// node graph reads what it must read. A `three` release renaming a TSL
// primitive, or the decode quietly dropping back to the hashed default, fails
// here. Proving the two paths decode *identically* is the pixel-diff release
// gate, not CI (ADR-0009).

const makeClip = (name: string, startFrame: number, frames: number): VATClip => ({
  name,
  startFrame,
  frames,
  fps: 30,
  duration: frames / 30,
  maxDelta: 0.5,
})

const walk = makeClip('walk', 0, 10)
const run = makeClip('run', 10, 8)

function makeVAT(clips: VATClip[] = [walk, run]): VAT {
  const texture = () => new DataTexture(new Float32Array(4), 1, 1)
  return {
    positionTexture: texture(),
    normalTexture: texture(),
    clips,
    bounds: new Box3(),
    vertexCount: 1,
    totalFrames: 18,
    encoding: 'delta',
    geometry: new BufferGeometry(),
    materials: [],
  }
}

/** The five names `addVATInstanceAttributes` writes — the shared contract. */
const CONTRACT = Object.values(PLAYBACK_ATTRIBUTES)

/** A crowd whose instances differ in clip, phase and rate — the point of the ticket. */
function crowdGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  addVATInstanceAttributes(geometry, [
    { clip: walk, timeOffset: 0, speed: 1 },
    { clip: run, timeOffset: 2.5, speed: 1.7 },
  ])
  return geometry
}

type InspectedNode = Node & {
  type?: string
  scope?: string
  value?: unknown
  op?: string
  aNode?: InspectedNode
  bNode?: InspectedNode
  node?: Node
  getAttributeName?: () => string
}

function nodesIn(node: Node): InspectedNode[] {
  const seen: InspectedNode[] = []
  node.traverse((n) => seen.push(n as InspectedNode))
  return seen
}

function attributesIn(node: Node): string[] {
  return [...new Set(nodesIn(node).flatMap((n) => (n.type === 'AttributeNode' ? [n.getAttributeName!()] : [])))]
}

function texturesIn(node: Node): unknown[] {
  return [...new Set(nodesIn(node).flatMap((n) => (n.type === 'TextureNode' ? [n.value] : [])))]
}

const operatorsIn = (node: Node) => nodesIn(node).filter((n) => n.type === 'OperatorNode')

const isAttribute = (node: InspectedNode | undefined, name: string) =>
  node?.type === 'AttributeNode' && node.getAttributeName!() === name

const readsInstanceIndex = (node: Node) => nodesIn(node).some((n) => n.type === 'IndexNode' && n.scope === 'instance')

describe('vatNodes — instance playback', () => {
  it('reads clip, phase and rate per instance from the contract attributes', () => {
    const { position, normal } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    expect(attributesIn(position)).toEqual(expect.arrayContaining(CONTRACT))
    expect(attributesIn(normal!)).toEqual(expect.arrayContaining(CONTRACT))
  })

  it('scales the clock by the rate attribute and phases it by the offset attribute', () => {
    // Names in the graph are not enough: swapping `aSpeed` for `aTimeOffset` in
    // the decode would leave every other test here green. This asserts the
    // GLSL decode's own expression — `uVatTime * aSpeed + aTimeOffset`.
    const time = uniform(0)
    const { position: positionNode } = vatDecode(makeVAT(), { time, geometry: crowdGeometry() })

    const scaled = operatorsIn(positionNode).find(
      (n) => n.op === '*' && n.aNode === time && isAttribute(n.bNode, PLAYBACK_ATTRIBUTES.speed),
    )
    expect(scaled, 'time * aSpeed').toBeDefined()

    const phased = operatorsIn(positionNode).find(
      (n) =>
        n.op === '+' && isAttribute(n.bNode, PLAYBACK_ATTRIBUTES.timeOffset) && nodesIn(n.aNode!).includes(scaled!),
    )
    expect(phased, 'time * aSpeed + aTimeOffset').toBeDefined()
  })

  it('takes each instance\u2019s clip duration from its own frame count and fps', () => {
    const { position: positionNode } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    const duration = operatorsIn(positionNode).find(
      (n) =>
        n.op === '/' &&
        isAttribute(n.aNode, PLAYBACK_ATTRIBUTES.clipFrames) &&
        isAttribute(n.bNode, PLAYBACK_ATTRIBUTES.clipFps),
    )
    expect(duration, 'aClipFrames / aClipFps').toBeDefined()
  })

  it('leaves the hashed phase behind once the attributes carry it', () => {
    const { position: positionNode } = vatDecode(makeVAT(), { geometry: crowdGeometry(), desync: 10 })

    expect(readsInstanceIndex(positionNode)).toBe(false)
  })

  it('desyncs from the instance index when no geometry is given', () => {
    const { position: positionNode } = vatDecode(makeVAT(), { desync: 10 })

    expect(readsInstanceIndex(positionNode)).toBe(true)
    for (const name of CONTRACT) expect(attributesIn(positionNode), name).not.toContain(name)
  })

  it('desyncs from the instance index when the geometry carries no playback attributes', () => {
    const { position: positionNode } = vatDecode(makeVAT(), { geometry: new BufferGeometry(), desync: 10 })

    expect(readsInstanceIndex(positionNode)).toBe(true)
  })

  it('refuses a half-wired geometry rather than silently dropping to the default', () => {
    const geometry = crowdGeometry()
    geometry.deleteAttribute('aSpeed')

    expect(() => vatNodes(makeVAT(), { geometry })).toThrow(/aSpeed/)
  })

  it('throws a clear error for an out-of-range clip index', () => {
    expect(() => vatNodes(makeVAT(), { clipIndex: 7 })).toThrow(/clipIndex 7 out of range \(2 clips\)/)
  })
})

describe('vatNodes — the node graph', () => {
  it('samples the position texture for position and the normal texture for normals', () => {
    const vat = makeVAT()
    const { position, normal } = vatDecode(vat, { geometry: crowdGeometry() })

    expect(texturesIn(position)).toEqual([vat.positionTexture])
    expect(texturesIn(normal!)).toEqual([vat.normalTexture])
  })

  it('offers no normalNode, because a VAT normal cannot be one', () => {
    // A material's `normalNode` is built in the *fragment* stage — three reaches
    // it from `normalView` through `builder.context.setupNormal()` — and is
    // expected in **view** space. A VAT's normals are per-vertex and in the
    // geometry's own space, so handing one over as a `normalNode` skipped both
    // the instance matrix and the normal matrix, and took `vertexIndex` into the
    // fragment stage with it — where `IndexNode` does not return the vertex
    // index at all, but turns itself into a varying, so every fragment read a
    // linearly *interpolated* index addressing neither of the vertices it lies
    // between.
    //
    // The normal is written to `normalLocal` inside the vertex-stage decode
    // instead, which is what the GLSL path does when it sets `objectNormal` in
    // `beginnormal_vertex` and lets three transform and interpolate the result.
    const nodes = vatNodes(makeVAT(), { geometry: crowdGeometry() })

    expect('normalNode' in nodes).toBe(false)
  })

  it('carries the caller’s time uniform, so one clock drives every material', () => {
    const time = uniform(0)
    const nodes = vatNodes(makeVAT(), { time, geometry: crowdGeometry() })

    expect(nodes.time).toBe(time)
    expect(nodesIn(vatDecode(makeVAT(), { time, geometry: crowdGeometry() }).position)).toContain(time)
  })

  it('exposes a fresh time uniform when the caller supplies none', () => {
    const nodes = vatNodes(makeVAT())

    expect((nodes.time as InspectedNode).type).toBe('UniformNode')
    expect(nodesIn(vatDecode(makeVAT(), { time: nodes.time }).position)).toContain(nodes.time)
  })
})

// ---------------------------------------------------------------- createVATMesh

/** The nodes a VAT-ready material carries, whatever material class it is. */
type NodeMaterial = Material & { positionNode?: Node; normalNode?: Node }

describe('createVATMesh', () => {
  it('returns a renderable InstancedMesh carrying the crowd', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.count).toBe(2)
    expect(mesh.geometry.getAttribute('aClipStart').array).toEqual(new Float32Array([0, 10]))
    expect(mesh.geometry.getAttribute('aTimeOffset').array).toEqual(new Float32Array([1.5, 0.25]))
    expect(mesh.geometry.getAttribute('aSpeed').array).toEqual(new Float32Array([2, 0.5]))
  })

  it('clones the baked geometry, bounds and all, leaving the VAT untouched', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.geometry).not.toBe(vat.geometry)
    expect(vat.geometry.getAttribute('aClipStart')).toBeUndefined()
    expect(mesh.geometry.boundingBox).toEqual(vat.geometry.boundingBox)
  })

  it('gives every geometry group a material that decodes the VAT per instance', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const materials = mesh.material as NodeMaterial[]
    expect(materials.map((m) => m.name)).toEqual(['body', 'visor'])
    for (const group of mesh.geometry.groups) expect(materials[group.materialIndex!]).toBeDefined()
    for (const [i, material] of materials.entries()) {
      expect(material, 'the source material must not be mutated').not.toBe(vat.materials[i])
      expect(material.positionNode, 'every group decodes').toBeDefined()
      // One decode, shared: the graph is a DAG, so three materials reading one
      // decode is one decode, not three. Its contents are asserted against
      // `vatDecode` above — a `Fn` body does not traverse.
      expect(material.positionNode).toBe(materials[0]!.positionNode)
      expect(material.normalNode, 'a VAT normal is written to normalLocal, not handed over as a node').toBeUndefined()
    }
  })

  it('attaches no depth material — the position node already feeds the depth pass', () => {
    // The asymmetry this call absorbs. On the WebGL path a missing
    // `customDepthMaterial` means bind-pose shadows; here attaching one would
    // be the mistake, and the user should not have to know which is which.
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.customDepthMaterial).toBeUndefined()
    expect(mesh.customDistanceMaterial).toBeUndefined()
  })

  it('drives every material from one exposed clock', () => {
    const vat = makeVATFixture()

    const { mesh, time } = createVATMesh(vat, makeFixtureCrowd())
    time.value = 3

    const materials = mesh.material as NodeMaterial[]
    for (const material of materials) expect(material.positionNode).toBe(materials[0]!.positionNode)
    expect((time as unknown as InspectedNode).value).toBe(3)
  })

  it('shares a caller-owned clock, so two crowds animate off one time value', () => {
    const time = uniform(0)

    const a = createVATMesh(makeVATFixture(), makeFixtureCrowd(), { time })
    const b = createVATMesh(makeVATFixture(), makeFixtureCrowd(), { time })

    // Both crowds hand back the one clock they were given, and setting it once
    // is what drives them both. The decode's own reading of it is asserted
    // against `vatDecode`, where the graph is still traversable.
    expect(a.time).toBe(time)
    expect(b.time).toBe(time)

    time.value = 5
    expect((a.time as unknown as InspectedNode).value).toBe(5)
    expect((b.time as unknown as InspectedNode).value).toBe(5)
  })
})

describe('a VAT baked without normals', () => {
  it('decodes a position and no normal at all', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { position, normal } = vatDecode(vat, { geometry: crowdGeometry() })

    expect(texturesIn(position)).toEqual([vat.positionTexture])
    expect(normal).toBeNull()
  })

  it('still builds a position node for every material', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const materials = mesh.material as NodeMaterial[]
    expect(materials).toHaveLength(2)
    for (const material of materials) expect(material.positionNode).toBe(materials[0]!.positionNode)
  })

  it('refuses a smooth-shaded lit material rather than lighting the rest pose', () => {
    const vat = makeVATFixture({ bakeNormals: false })
    ;(vat.materials[0] as MeshStandardMaterial).flatShading = false

    expect(() => createVATMesh(vat, makeFixtureCrowd())).toThrow(/bakeNormals: false/)
  })
})
