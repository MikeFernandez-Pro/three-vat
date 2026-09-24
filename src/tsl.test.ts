import { BatchedMesh, Box3, BufferGeometry, DataTexture, InstancedMesh, MeshStandardMaterial } from 'three'
import type { Material } from 'three'
import { float, int, uniform } from 'three/tsl'
import type { Node } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import {
  createVATPlaybackTexture,
  EndMode,
  INFINITE_REPETITIONS,
  LIBRARY_PLAYBACK_DEFAULTS,
  LoopMode,
  PACK_TEXELS,
} from './instance-playback.js'
import type { VATPlaybackTexture } from './instance-playback.js'
import {
  isComponent,
  isPackTexel,
  makeBatchedCarrier,
  makeVATFixture,
  makeFixtureCrowd,
  nodesIn,
  packRowsIn,
} from './test-utils.js'
import type { InspectedNode } from './test-utils.js'
import { createVATMesh, resolveBand, vatDecode, vatNodes } from './tsl.js'
import type { DeltaVAT, VATClip } from './types.js'

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

function makeVAT(clips: VATClip[] = [walk, run]): DeltaVAT {
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

/** The five texels `createVATPlaybackTexture` writes — the shared contract. */
const CONTRACT = Object.values(PACK_TEXELS)

/**
 * All five are read by the decode: the live pair, the crossfade duration, and
 * the outgoing pair the duration weighs in.
 */
const READ = CONTRACT

/** A crowd whose instances differ in clip, phase and rate — the point of the ticket. */
function crowdPlayback(): VATPlaybackTexture {
  return createVATPlaybackTexture([
    { clip: walk, startTime: 0, speed: 1 },
    { clip: run, startTime: -2.5, speed: 1.7 },
  ])
}

/** Which texels of the playback texture this graph fetches. */
function texelsIn(node: Node): number[] {
  return CONTRACT.filter((texel) => nodesIn(node).some((n) => isPackTexel(n, texel)))
}

function texturesIn(node: Node): unknown[] {
  return [...new Set(nodesIn(node).flatMap((n) => (n.type === 'TextureNode' ? [n.value] : [])))]
}

/**
 * Exactly these textures, by identity and in any order. Identity rather than
 * `toEqual`, because two `DataTexture`s of the same shape are structurally
 * equal and the question here is *which* one the graph fetches.
 */
const samplesExactly = (node: Node, expected: unknown[]) => {
  const found = texturesIn(node)
  return found.length === expected.length && expected.every((texture) => found.includes(texture))
}

const operatorsIn = (node: Node) => nodesIn(node).filter((n) => n.type === 'OperatorNode')

/**
 * `a <op> <constant>` anywhere in the graph — how the decode's branch
 * conditions read once TSL has built them. The constant matters as much as the
 * component: a branch comparing the playback texel's `y` against the wrong
 * number is a mode that silently never fires.
 */
const comparesComponent = (node: Node, op: string, texel: number, component: string, value: number) =>
  operatorsIn(node).some(
    (n) =>
      n.op === op &&
      isComponent(n.aNode, texel, component) &&
      n.bNode?.type === 'ConstNode' &&
      n.bNode.value === value,
  )

/**
 * `time - playback.x`, wherever it appears — seconds of clock since this
 * animation began. Matched rather than identified, because the decode measures
 * from the start time twice: playback scales it by the clip's speed, the
 * crossfade's weight does not, and each spells the subtraction for itself
 * exactly as the GLSL decode does in `vatBand` and in `vatRows`.
 */
const elapsedSince = (time: Node) => (n: InspectedNode) =>
  n.type === 'OperatorNode' && n.op === '-' && n.aNode === time && isComponent(n.bNode, PACK_TEXELS.playback, 'x')

const conditionalsIn = (node: Node) => nodesIn(node).filter((n) => n.type === 'ConditionalNode')

const readsInstanceIndex = (node: Node) => nodesIn(node).some((n) => n.type === 'IndexNode' && n.scope === 'instance')

describe('vatNodes — instance playback', () => {
  it('reads clip, start time and rate per instance from the playback texture', () => {
    const { position, normal } = vatDecode(makeVAT(), { playback: crowdPlayback() })

    expect(texelsIn(position)).toEqual(READ)
    expect(texelsIn(normal!)).toEqual(READ)
  })

  it('keys the pack by the instance index, not by the drawn slot', () => {
    // The whole of ADR-0016 on this path: row `instanceIndex` of the playback
    // texture rather than element `gl_InstanceID` of an instanced attribute.
    // The hashed fallback also reads `instanceIndex`, so this is asserted
    // together with the fetches that use it.
    const { position } = vatDecode(makeVAT(), { playback: crowdPlayback() })

    expect(readsInstanceIndex(position)).toBe(true)
    expect(nodesIn(position).some((n) => n.type === 'AttributeNode')).toBe(false)
  })

  it('weighs the outgoing band by wall clock, not by clip time', () => {
    // The crossfade's own arithmetic, asserted by component: it divides by the
    // crossfade texel's `x` and is guarded on that same duration being
    // positive, and the elapsed time it divides is *not* scaled by the clip
    // texel's `w` - a transition is seconds of clock, so a half-speed clip does
    // not get one twice as long.
    const time = uniform(0)
    const { position } = vatDecode(makeVAT(), { time, playback: crowdPlayback() })

    expect(comparesComponent(position, '>', PACK_TEXELS.crossfade, 'x', 0)).toBe(true)
    const weighted = operatorsIn(position).find(
      (n) =>
        n.op === '/' &&
        isComponent(n.bNode, PACK_TEXELS.crossfade, 'x') &&
        nodesIn(n.aNode!).some(elapsedSince(time)),
    )
    expect(weighted, '( time - playback.x ) / crossfade.x').toBeDefined()
  })

  it('resolves the outgoing band from its own pair of texels, through the same resolver', () => {
    const time = uniform(0)
    const { position } = vatDecode(makeVAT(), { time, playback: crowdPlayback() })

    // The outgoing band's local time is measured from the *outgoing* start time
    // and scaled by the *outgoing* speed: reading the incoming pair here would
    // blend out of a band moving at the wrong rate from the wrong moment.
    const local = operatorsIn(position).find(
      (n) =>
        n.op === '*' &&
        isComponent(n.bNode, PACK_TEXELS.outgoingClip, 'w') &&
        nodesIn(n.aNode!).some(
          (m) =>
            m.type === 'OperatorNode' &&
            m.op === '-' &&
            m.aNode === time &&
            isComponent(m.bNode, PACK_TEXELS.outgoingPlayback, 'x'),
        ),
    )
    expect(local, '( time - outgoingPlayback.x ) * outgoingClip.w').toBeDefined()
    // And its policy is its own too, branch for branch with the live band's.
    expect(
      comparesComponent(position, '==', PACK_TEXELS.outgoingPlayback, 'y', LoopMode.PingPong),
      'outgoingPlayback.y == LoopMode.PingPong',
    ).toBe(true)
    expect(
      comparesComponent(position, '!=', PACK_TEXELS.outgoingPlayback, 'z', INFINITE_REPETITIONS),
      'outgoingPlayback.z != INFINITE_REPETITIONS',
    ).toBe(true)
    expect(
      comparesComponent(position, '==', PACK_TEXELS.outgoingPlayback, 'w', EndMode.Clamp),
      'outgoingPlayback.w == EndMode.Clamp',
    ).toBe(true)
  })

  it('takes local time from the start time, then scales it by the rate component', () => {
    // Names in the graph are not enough: the pack makes every term a swizzle,
    // so reading the clip texel's `z` where the decode means its `w` would
    // leave every other test here green. This asserts the GLSL decode's own
    // expression — `( uVatTime - vatPlayback.x ) * vatClip.w`.
    const time = uniform(0)
    const { position: positionNode } = vatDecode(makeVAT(), { time, playback: crowdPlayback() })

    expect(operatorsIn(positionNode).some(elapsedSince(time)), 'time - playback.x').toBe(true)

    const scaled = operatorsIn(positionNode).find(
      (n) =>
        n.op === '*' &&
        isComponent(n.bNode, PACK_TEXELS.clip, 'w') &&
        nodesIn(n.aNode!).some(elapsedSince(time)),
    )
    expect(scaled, '( time - playback.x ) * clip.w').toBeDefined()
  })

  it('takes each instance’s clip duration from its own frame count and fps', () => {
    const { position: positionNode } = vatDecode(makeVAT(), { playback: crowdPlayback() })

    const duration = operatorsIn(positionNode).find(
      (n) =>
        n.op === '/' &&
        isComponent(n.aNode, PACK_TEXELS.clip, 'y') &&
        isComponent(n.bNode, PACK_TEXELS.clip, 'z'),
    )
    expect(duration, 'clip.y / clip.z').toBeDefined()
  })

  it('branches on the loop mode, the repeat count and the end mode', () => {
    // `resolveVATFrame` (src/instance-playback.ts) is the one definition of
    // these semantics; this asserts the graph transcribes it against the right
    // components *and* the right constants — a `select` on `playback.y == 1`
    // would be a ping-pong that never bounces, and every other test here would
    // stay green.
    const { position } = vatDecode(makeVAT(), { playback: crowdPlayback() })

    expect(
      comparesComponent(position, '==', PACK_TEXELS.playback, 'y', LoopMode.PingPong),
      'playback.y == LoopMode.PingPong',
    ).toBe(true)
    expect(
      comparesComponent(position, '!=', PACK_TEXELS.playback, 'z', INFINITE_REPETITIONS),
      'playback.z != INFINITE_REPETITIONS',
    ).toBe(true)
    expect(
      comparesComponent(position, '==', PACK_TEXELS.playback, 'w', EndMode.Clamp),
      'playback.w == EndMode.Clamp',
    ).toBe(true)
    expect(conditionalsIn(position).length, 'the branches themselves').toBeGreaterThan(0)
  })

  it('keeps a finished or bouncing clip inside its own band of rows', () => {
    // Only a wrapping clip may cross its last row back into its first; every
    // other mode clamps to the last one. Without the clamp a ping-pong at
    // phase 1 addresses the row after the band — the next clip's first frame.
    const { position } = vatDecode(makeVAT(), { playback: crowdPlayback() })

    const methods = nodesIn(position).map((n) => (n as { method?: string }).method)
    expect(methods, 'min, clamping both rows to the band').toContain('min')
    expect(methods, 'floor, the row the phase lands on').toContain('floor')
  })

  it('leaves the hashed phase behind once the playback texture carries it', () => {
    // `desync` is ignored, not blended in: an instance's start time is in its
    // row, and a hashed phase on top of it would be a second answer.
    const { position: positionNode } = vatDecode(makeVAT(), { playback: crowdPlayback(), desync: 10 })

    const hashed = nodesIn(positionNode).some((n) => n.type === 'FunctionCallNode' || n.method === 'hash')
    expect(hashed).toBe(false)
  })

  it('desyncs from the instance index when no playback texture is given', () => {
    const { position: positionNode } = vatDecode(makeVAT(), { desync: 10 })

    expect(readsInstanceIndex(positionNode)).toBe(true)
    expect(texelsIn(positionNode)).toEqual([])
  })

  it('throws a clear error for an out-of-range clip index', () => {
    expect(() => vatNodes(makeVAT(), { clipIndex: 7 })).toThrow(/clipIndex 7 out of range \(2 clips\)/)
  })
})

describe('resolveBand', () => {
  // The row resolution as a function of a (clip texel, playback texel) pair,
  // which is what makes a second band a second *call*: the crossfade (#67)
  // resolves its outgoing band through this same arithmetic rather than
  // through a second transcription of it.
  const clipTexel = (startFrame: number, frames: number) => ({
    startFrame: int(startFrame),
    frames: float(frames),
    duration: float(frames / 30),
    speed: float(1),
  })
  const playbackTexel = (startTime: number) => ({
    startTime: float(startTime),
    loopMode: float(LoopMode.Repeat),
    repetitions: float(INFINITE_REPETITIONS),
    endMode: float(EndMode.Clamp),
  })

  it('resolves two rows, a blend, and the two facts the rows cannot say', () => {
    // Whether the sampling wraps and whether playback finished are not
    // re-derivable from a pair of rows, so the band carries them — the same
    // five fields the GLSL decode's `VatBand` struct declares.
    const clip = clipTexel(0, 10)
    const band = resolveBand(clip, playbackTexel(0), uniform(0))

    for (const row of [band.row0, band.row1]) {
      expect(nodesIn(row)).toContain(clip.startFrame)
    }
    expect(nodesIn(band.blend)).toContain(clip.frames)
    // A ping-pong and a finished one-shot must not wrap, so `wraps` is the
    // resolver's branch cascade and not a constant.
    expect((band.wraps as InspectedNode).type).toBe('ConditionalNode')
    expect(
      operatorsIn(band.finished).some(
        (n) => n.op === '!=' && n.bNode?.type === 'ConstNode' && n.bNode.value === INFINITE_REPETITIONS,
      ),
      'finished tests the infinite-repetitions sentinel',
    ).toBe(true)
  })

  it('wraps and bounces without a mod, which divides and can land a row off', () => {
    // TSL's `mod` is `%`, and on a float both backends divide: a quotient a
    // hair under 1 at the last frame leaves the next row one past the band
    // (#79). The wrap is a compare, and the bounce halves rather than divides.
    const band = resolveBand(clipTexel(0, 10), playbackTexel(0), uniform(0))

    for (const node of [band.row0, band.row1, band.blend]) {
      expect(operatorsIn(node).filter((n) => n.op === '%')).toEqual([])
    }
    expect(
      operatorsIn(band.row1).some(
        (n) => n.op === '>=' && nodesIn(n.bNode).some((m) => m.type === 'ConstNode' && m.value === 10),
      ),
      'the wrap compares the next row against the clip’s frame count',
    ).toBe(true)
  })

  it('addresses each band from its own pair, so a second pair is a second call', () => {
    const walkClip = clipTexel(0, 10)
    const runClip = clipTexel(10, 8)
    const time = uniform(0)

    const live = resolveBand(walkClip, playbackTexel(0), time)
    const outgoing = resolveBand(runClip, playbackTexel(-2.5), time)

    // Each band's rows are addressed from its own clip texel's start row, and
    // from no other — which is the whole of what "a function of the pair" buys.
    expect(nodesIn(live.row0)).toContain(walkClip.startFrame)
    expect(nodesIn(live.row0)).not.toContain(runClip.startFrame)
    expect(nodesIn(outgoing.row0)).toContain(runClip.startFrame)
    expect(nodesIn(outgoing.row0)).not.toContain(walkClip.startFrame)
  })
})

describe('vatNodes — the node graph', () => {
  it('samples the position texture for position and the normal texture for normals', () => {
    const vat = makeVAT()
    const playback = crowdPlayback()
    const { position, normal } = vatDecode(vat, { playback })

    // The playback texture is read by both, being where the pack lives; the
    // VAT layer each one samples is what must differ.
    expect(samplesExactly(position, [playback.texture, vat.positionTexture])).toBe(true)
    expect(samplesExactly(normal!, [playback.texture, vat.normalTexture])).toBe(true)
  })

  it('fetches position and normal at the same row nodes, built once', () => {
    // Not an economy. `f1` is a `select`, which TSL hoists into a variable
    // assigned in an if/else, and a second `int()` node built over that same
    // variable comes out of the WGSL builder without its cast (three r185): the
    // position fetch read `i32( nodeVar )`, the normal fetch the bare `f32`,
    // and the vertex shader did not compile — on WebGPU, a crowd that silently
    // draws nothing. The parity gate caught it; this pins the shape that avoids
    // it, which is one row node per fetch shared by every texture.
    const vat = makeVAT()
    const { position, normal } = vatDecode(vat, { playback: crowdPlayback() })

    const rowsRead = (node: Node) =>
      nodesIn(node)
        // The VAT layers only: the pack's own fetches are keyed by instance,
        // not by frame row.
        .filter((n) => n.type === 'TextureNode' && n.value !== undefined && n.value !== null)
        .filter((n) => n.value === vat.positionTexture || n.value === vat.normalTexture)
        // `ivec2(column, row)` arrives as a var-intent wrapper around the join.
        .map((n) => n.uvNode?.node?.nodes?.[1])

    const positionRows = rowsRead(position)
    const normalRows = rowsRead(normal!)
    // Four: the two rows of the live band, and the two of the outgoing one.
    expect(positionRows).toHaveLength(4)
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
    const nodes = vatNodes(makeVAT(), { playback: crowdPlayback() })

    expect('normalNode' in nodes).toBe(false)
  })

  it('carries the caller’s time uniform, so one clock drives every material', () => {
    const time = uniform(0)
    const nodes = vatNodes(makeVAT(), { time, playback: crowdPlayback() })

    expect(nodes.time).toBe(time)
    expect(nodesIn(vatDecode(makeVAT(), { time, playback: crowdPlayback() }).position)).toContain(time)
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

    const { mesh, playback } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.count).toBe(2)
    expect(playback.count).toBe(2)
    // One row per instance: clip texel, playback texel, and a crossfade texel
    // and outgoing pair of zeroes.
    // An endless looper and a rewinding one-shot, whose defaults were filled
    // in once, in core — byte for byte what the WebGL path writes.
    expect(playback.texture.image.data).toEqual(
      new Float32Array([
        0, 10, 30, 2, -1.5, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        10, 8, 24, 0.5, -0.25, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    )
  })

  it('refuses a crowd past the maxTextureSize it is given, as the playback texture does', () => {
    // The crowd is built beside the renderer, so this is where the GPU's real
    // limit is to hand (ADR-0022). Two instances against a limit of one.
    expect(() => createVATMesh(makeVATFixture(), makeFixtureCrowd(), { maxTextureSize: 1 })).toThrow(
      /2 rows .* past the 1-row ceiling of the maxTextureSize option/,
    )
    expect(() => createVATMesh(makeVATFixture(), makeFixtureCrowd(), { maxTextureSize: 2 })).not.toThrow()
  })

  it('renders the bake’s own geometry, bounds and all', () => {
    const vat = makeVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    expect(mesh.geometry).toBe(vat.geometry)
    expect(mesh.geometry.boundingBox).toBe(vat.geometry.boundingBox)
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
    const playback = crowdPlayback()

    const { position, normal } = vatDecode(vat, { playback })

    expect(samplesExactly(position, [playback.texture, vat.positionTexture])).toBe(true)
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

// ------------------------------------------------------- the BatchedMesh carrier

describe('a crowd on a BatchedMesh', () => {
  // The second carrier, on the path that had to wait for it: `batchIndirectIndex`
  // is three's own public accessor for the logical index, exported from
  // `three/tsl` in r186, and reading it is what keeps this decode off the
  // private `_indirectTexture` ADR-0016's stop condition forbids.
  const batchedDecode = () => {
    const vat = makeVATFixture()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())
    return vatDecode(vat, { playback, carrier: makeBatchedCarrier(vat) })
  }

  const isBatchIndirectIndex = (n: InspectedNode) => n.type === 'PropertyNode' && n.name === 'vBatchIndirectId'

  it('reads the pack row at batchIndirectIndex, never at the drawn slot', () => {
    const rows = packRowsIn(batchedDecode().position)

    expect(rows).toHaveLength(5) // clip, playback, crossfade, outgoing clip, outgoing playback
    for (const row of rows) {
      expect(row.some(isBatchIndirectIndex)).toBe(true)
      expect(row.some((n) => n.type === 'IndexNode' && n.scope === 'instance')).toBe(false)
    }
  })

  it('keys the normal decode by the same index as the position decode', () => {
    // One graph, two layers: a normal read at a different row than its position
    // is the shape of bug the pack's single index exists to rule out.
    const { normal } = batchedDecode()

    for (const row of packRowsIn(normal!)) expect(row.some(isBatchIndirectIndex)).toBe(true)
  })

  it('leaves the InstancedMesh carrier reading instanceIndex', () => {
    // The two spellings must not converge: `batchIndirectIndex` is a varying
    // three only assigns on a batched draw, and an instanced crowd reading it
    // would read zero for every instance.
    const vat = makeVATFixture()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())

    const rows = packRowsIn(vatDecode(vat, { playback, carrier: new InstancedMesh(vat.geometry, vat.materials[0], 2) }).position)

    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row.some((n) => n.type === 'IndexNode' && n.scope === 'instance')).toBe(true)
      expect(row.some(isBatchIndirectIndex)).toBe(false)
    }
  })

  it('desyncs the zero-config default from the batch index too', () => {
    // No playback texture, so the phase is hashed from the instance — and on
    // this carrier "the instance" is the same logical index the pack would
    // have been read at, not the slot the frame happened to draw it in.
    const vat = makeVATFixture()

    const { position } = vatDecode(vat, { desync: 10, carrier: makeBatchedCarrier(vat) })

    expect(nodesIn(position).some(isBatchIndirectIndex)).toBe(true)
  })

  it('refuses a batch the VAT cannot be decoded on, as the WebGL path does', () => {
    const vat = makeVATFixture()
    const empty = new BatchedMesh(2, vat.vertexCount, vat.vertexCount * 2, vat.materials[0])

    expect(() => vatNodes(vat, { carrier: empty })).toThrow(/holds no geometry/)
  })
})
