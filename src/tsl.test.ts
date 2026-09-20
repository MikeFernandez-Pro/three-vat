import { Box3, BufferGeometry, DataTexture, MeshStandardMaterial } from 'three'
import type { Material } from 'three'
import { uniform } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import {
  addVATInstanceAttributes,
  EndMode,
  INFINITE_REPETITIONS,
  LIBRARY_PLAYBACK_DEFAULTS,
  LoopMode,
  PLAYBACK_ATTRIBUTES,
} from './instance-playback.js'
import { isComponent, makeVATFixture, makeFixtureCrowd, nodesIn } from './test-utils.js'
import type { InspectedNode } from './test-utils.js'
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
  ...LIBRARY_PLAYBACK_DEFAULTS,
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

/** The three vec4s `addVATInstanceAttributes` writes — the shared contract. */
const CONTRACT = Object.values(PLAYBACK_ATTRIBUTES)

/** All three are read by the decode: clip band, policy, and the pose-freeze fade. */
const READ = CONTRACT

/** A crowd whose instances differ in clip, phase and rate — the point of the ticket. */
function crowdGeometry(): BufferGeometry {
  const geometry = new BufferGeometry()
  addVATInstanceAttributes(geometry, [
    { clip: walk, startTime: 0, speed: 1 },
    { clip: run, startTime: -2.5, speed: 1.7 },
  ])
  return geometry
}

function attributesIn(node: Node): string[] {
  return [...new Set(nodesIn(node).flatMap((n) => (n.type === 'AttributeNode' ? [n.getAttributeName!()] : [])))]
}

function texturesIn(node: Node): unknown[] {
  return [...new Set(nodesIn(node).flatMap((n) => (n.type === 'TextureNode' ? [n.value] : [])))]
}

const operatorsIn = (node: Node) => nodesIn(node).filter((n) => n.type === 'OperatorNode')

/**
 * `a <op> <constant>` anywhere in the graph — how the decode's branch
 * conditions read once TSL has built them. The constant matters as much as the
 * component: a branch comparing `aVatPlayback.y` against the wrong number is a
 * mode that silently never fires.
 */
const comparesComponent = (node: Node, op: string, name: string, component: string, value: number) =>
  operatorsIn(node).some(
    (n) =>
      n.op === op &&
      isComponent(n.aNode, name, component) &&
      n.bNode?.type === 'ConstNode' &&
      n.bNode.value === value,
  )

const conditionalsIn = (node: Node) => nodesIn(node).filter((n) => n.type === 'ConditionalNode')

const readsInstanceIndex = (node: Node) => nodesIn(node).some((n) => n.type === 'IndexNode' && n.scope === 'instance')

describe('vatNodes — instance playback', () => {
  it('reads clip, start time and rate per instance from the contract attributes', () => {
    const { position, normal } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    expect(attributesIn(position)).toEqual(expect.arrayContaining(READ))
    expect(attributesIn(normal!)).toEqual(expect.arrayContaining(READ))
  })

  it('weighs the frozen outgoing pose by wall clock, not by clip time', () => {
    // The fade's own arithmetic, asserted by component: it divides by
    // `aVatFade.w` and is guarded on that same duration being positive, and the
    // elapsed time it divides is *not* scaled by `aVatClip.w` — a fade is
    // seconds of clock, so a half-speed clip does not get a fade twice as long.
    const time = uniform(0)
    const { position } = vatDecode(makeVAT(), { time, geometry: crowdGeometry() })

    expect(comparesComponent(position, '>', PLAYBACK_ATTRIBUTES.fade, 'w', 0)).toBe(true)
    const elapsed = operatorsIn(position).find(
      (n) => n.op === '-' && n.aNode === time && isComponent(n.bNode, PLAYBACK_ATTRIBUTES.playback, 'x'),
    )
    const weighted = operatorsIn(position).find(
      (n) =>
        n.op === '/' &&
        isComponent(n.bNode, PLAYBACK_ATTRIBUTES.fade, 'w') &&
        nodesIn(n.aNode!).includes(elapsed!),
    )
    expect(weighted, '( time - aVatPlayback.x ) / aVatFade.w').toBeDefined()
  })

  it('reads the frozen row from the outgoing band the write recorded', () => {
    const { position } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    // phase * frames, off the fade's own components — reading the incoming
    // clip's band here would freeze a row of the wrong animation.
    const frozen = operatorsIn(position).find(
      (n) =>
        n.op === '*' &&
        isComponent(n.aNode, PLAYBACK_ATTRIBUTES.fade, 'z') &&
        isComponent(n.bNode, PLAYBACK_ATTRIBUTES.fade, 'y'),
    )
    expect(frozen, 'aVatFade.z * aVatFade.y').toBeDefined()
  })

  it('takes local time from the start time, then scales it by the rate component', () => {
    // Names in the graph are not enough: the pack makes every term a swizzle,
    // so reading `aVatClip.z` where the decode means `aVatClip.w` would leave
    // every other test here green. This asserts the GLSL decode's own
    // expression — `( uVatTime - aVatPlayback.x ) * aVatClip.w`.
    const time = uniform(0)
    const { position: positionNode } = vatDecode(makeVAT(), { time, geometry: crowdGeometry() })

    const local = operatorsIn(positionNode).find(
      (n) => n.op === '-' && n.aNode === time && isComponent(n.bNode, PLAYBACK_ATTRIBUTES.playback, 'x'),
    )
    expect(local, 'time - aVatPlayback.x').toBeDefined()

    const scaled = operatorsIn(positionNode).find(
      (n) =>
        n.op === '*' && isComponent(n.bNode, PLAYBACK_ATTRIBUTES.clip, 'w') && nodesIn(n.aNode!).includes(local!),
    )
    expect(scaled, '( time - aVatPlayback.x ) * aVatClip.w').toBeDefined()
  })

  it('takes each instance’s clip duration from its own frame count and fps', () => {
    const { position: positionNode } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    const duration = operatorsIn(positionNode).find(
      (n) =>
        n.op === '/' &&
        isComponent(n.aNode, PLAYBACK_ATTRIBUTES.clip, 'y') &&
        isComponent(n.bNode, PLAYBACK_ATTRIBUTES.clip, 'z'),
    )
    expect(duration, 'aVatClip.y / aVatClip.z').toBeDefined()
  })

  it('branches on the loop mode, the repeat count and the end mode', () => {
    // `resolveVATFrame` (src/instance-playback.ts) is the one definition of
    // these semantics; this asserts the graph transcribes it against the right
    // components *and* the right constants — a `select` on `aVatPlayback.y == 1`
    // would be a ping-pong that never bounces, and every other test here would
    // stay green.
    const { position } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    expect(
      comparesComponent(position, '==', PLAYBACK_ATTRIBUTES.playback, 'y', LoopMode.PingPong),
      'aVatPlayback.y == LoopMode.PingPong',
    ).toBe(true)
    expect(
      comparesComponent(position, '!=', PLAYBACK_ATTRIBUTES.playback, 'z', INFINITE_REPETITIONS),
      'aVatPlayback.z != INFINITE_REPETITIONS',
    ).toBe(true)
    expect(
      comparesComponent(position, '==', PLAYBACK_ATTRIBUTES.playback, 'w', EndMode.Clamp),
      'aVatPlayback.w == EndMode.Clamp',
    ).toBe(true)
    expect(conditionalsIn(position).length, 'the branches themselves').toBeGreaterThan(0)
  })

  it('keeps a finished or bouncing clip inside its own band of rows', () => {
    // Only a wrapping clip may cross its last row back into its first; every
    // other mode clamps to the last one. Without the clamp a ping-pong at
    // phase 1 addresses the row after the band — the next clip's first frame.
    const { position } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    const methods = nodesIn(position).map((n) => (n as { method?: string }).method)
    expect(methods, 'min, clamping both rows to the band').toContain('min')
    expect(methods, 'floor, the row the phase lands on').toContain('floor')
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
    geometry.deleteAttribute(PLAYBACK_ATTRIBUTES.playback)

    expect(() => vatNodes(makeVAT(), { geometry })).toThrow(/aVatPlayback/)
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

  it('fetches position and normal at the same row nodes, built once', () => {
    // Not an economy. `f1` is a `select`, which TSL hoists into a variable
    // assigned in an if/else, and a second `int()` node built over that same
    // variable comes out of the WGSL builder without its cast (three r185): the
    // position fetch read `i32( nodeVar )`, the normal fetch the bare `f32`,
    // and the vertex shader did not compile — on WebGPU, a crowd that silently
    // draws nothing. The parity gate caught it; this pins the shape that avoids
    // it, which is one row node per fetch shared by every texture.
    const { position, normal } = vatDecode(makeVAT(), { geometry: crowdGeometry() })

    const rowsRead = (node: Node) =>
      nodesIn(node)
        .filter((n) => n.type === 'TextureNode')
        // `ivec2(column, row)` arrives as a var-intent wrapper around the join.
        .map((n) => (n as { uvNode?: { node?: { nodes?: unknown[] } } }).uvNode?.node?.nodes?.[1])

    const positionRows = rowsRead(position)
    const normalRows = rowsRead(normal!)
    expect(positionRows).toHaveLength(3)
    expect(positionRows.every((row) => row !== undefined)).toBe(true)
    // Identity, not shape: the same node objects, so the builder converts each row once.
    expect(normalRows).toEqual(positionRows)
    positionRows.forEach((row, i) => expect(normalRows[i]).toBe(row))
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
    expect(mesh.geometry.getAttribute('aVatClip').array).toEqual(
      new Float32Array([0, 10, 30, 2, 10, 8, 24, 0.5]),
    )
    // x = start time, y = loop mode, z = repetitions, w = end mode: an endless
    // looper and a rewinding one-shot, whose defaults were filled in once, in
    // core.
    expect(mesh.geometry.getAttribute('aVatPlayback').array).toEqual(
      new Float32Array([-1.5, 0, -1, 0, -0.25, 1, 1, 1]),
    )
  })

  it('clones the baked geometry, bounds and all, leaving the VAT untouched', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.geometry).not.toBe(vat.geometry)
    expect(vat.geometry.getAttribute('aVatClip')).toBeUndefined()
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
