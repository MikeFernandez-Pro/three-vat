import { BufferAttribute, InstancedMesh, MeshStandardMaterial } from 'three'
import type { Material } from 'three'
import type { Node } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { createVATPlaybackTexture, PACK_TEXELS } from './instance-playback.js'
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import {
  isComponent,
  makeBatchedCarrier,
  makeFixtureCrowd,
  makeRigVATFixture,
  makeVATFixture,
  nodesIn,
  packRowsIn,
  unwrap,
} from './test-utils.js'
import type { InspectedNode } from './test-utils.js'
import { createVATMesh, vatDecode, vatNodes } from './tsl.js'
import type { RigVAT } from './types.js'

// The rig decode on the TSL path (ADR-0018). Everything above the sampling —
// the pack, the row arithmetic, the fade — is the vertex decode's, the very
// same nodes; what these pin is that a rig crowd reads the rig texture and
// nothing else, skins from it, and rides both carriers under the unchanged
// instance playback contract. There is no GPU here, so the graph is read as a
// graph: which textures, at which rows, through which arithmetic.

const crowdPlayback = () => createVATPlaybackTexture(makeFixtureCrowd())

/** A decode of the rig fixture, on the default carrier. */
function decodeRigFixture(vat: RigVAT = makeRigVATFixture()) {
  const playback = crowdPlayback()
  const decoded = vatDecode(vat, { playback, carrier: new InstancedMesh(vat.geometry, vat.materials[0], 2) })
  if (decoded.encoding !== 'rig') throw new Error('the rig fixture decoded as the vertex encoding')
  return { vat, playback, ...decoded }
}

const texturesIn = (node: Node) => [...new Set(nodesIn(node).flatMap((n) => (n.type === 'TextureNode' ? [n.value] : [])))]

/** The fetches of one texture: each `textureLoad`, once. */
const fetchesOf = (node: Node, texture: unknown) =>
  nodesIn(node).filter((n) => n.type === 'TextureNode' && n.value === texture)

/** `ivec2( column, row )`, as the fetch carries it. */
const columnOf = (fetch: InspectedNode) => fetch.uvNode?.node?.nodes?.[0]
const rowOf = (fetch: InspectedNode) => fetch.uvNode?.node?.nodes?.[1]

const attributesIn = (node: Node) =>
  [...new Set(nodesIn(node).flatMap((n) => (n.type === 'AttributeNode' ? [n.getAttributeName!()] : [])))].sort()

/** `skinIndex.<component>` anywhere under a node. */
const readsSkinIndex = (node: InspectedNode | undefined, component: string) =>
  nodesIn(node).some(
    (n) =>
      n.type === 'SplitNode' &&
      n.components === component &&
      n.node?.type === 'AttributeNode' &&
      n.node.getAttributeName!() === 'skinIndex',
  )

const methodsIn = (node: unknown) => nodesIn(node).map((n) => n.method)

describe('vatDecode on a rig-encoded VAT', () => {
  it('samples the rig texture and the playback texture, and no position or normal texture', () => {
    const { vat, playback, position, normal } = decodeRigFixture()

    for (const node of [position, normal!]) {
      const textures = texturesIn(node)
      expect(textures).toHaveLength(2)
      expect(textures).toContain(vat.rigTexture)
      expect(textures).toContain(playback.texture)
    }
  })

  it('reads skinIndex and skinWeight off the geometry the bake kept them on, and no instanced attribute', () => {
    // The whole of ADR-0016 still holds: the pack comes from the playback
    // texture by the logical index. The attributes here are the vertex's own —
    // which slots it is weighted to — and the rest pose it skins from.
    const { position, normal } = decodeRigFixture()

    expect(attributesIn(position)).toEqual(['position', 'skinIndex', 'skinWeight'])
    expect(attributesIn(normal!)).toEqual(['normal', 'skinIndex', 'skinWeight'])
    expect(nodesIn(position).some((n) => n.type === 'IndexNode' && n.scope === 'instance')).toBe(true)
  })

  it('fetches four slots’ two texels at both resolved rows and at the frozen row', () => {
    const { vat, position } = decodeRigFixture()

    const fetches = fetchesOf(position, vat.rigTexture)
    // 4 slots × 2 texels × 3 rows: the two the instance sits between, and the
    // pose-freeze fade's frozen row — which a node graph pays for whether or
    // not the instance is fading, as the vertex decode does.
    expect(fetches).toHaveLength(4 * RIG_TEXELS_PER_SLOT * 3)

    for (const component of ['x', 'y', 'z', 'w']) {
      const ofSlot = fetches.filter((f) => readsSkinIndex(columnOf(f), component))
      expect(ofSlot, `fetches for skinIndex.${component}`).toHaveLength(RIG_TEXELS_PER_SLOT * 3)
    }
  })

  it('addresses each texel as the bake laid it out: slot × RIG_TEXELS_PER_SLOT + texel', () => {
    const { vat, position } = decodeRigFixture()

    // `slot * 2 + texel`, from the one layout module — so a repack there
    // cannot leave this decode reading the old columns.
    const layoutOf = (column: InspectedNode | undefined) => {
      const add = nodesIn(column).find((n) => n.type === 'OperatorNode' && n.op === '+')
      const mul = unwrap(add?.aNode)
      return {
        stride: mul?.type === 'OperatorNode' && mul.op === '*' && mul.bNode?.type === 'ConstNode' ? mul.bNode.value : null,
        texel: add?.bNode?.type === 'ConstNode' ? add.bNode.value : null,
      }
    }

    const layouts = fetchesOf(position, vat.rigTexture).map((f) => layoutOf(columnOf(f)))
    for (const layout of layouts) expect(layout.stride).toBe(RIG_TEXELS_PER_SLOT)
    expect(layouts.filter((l) => l.texel === RIG_TEXELS.rotation)).toHaveLength(12)
    expect(layouts.filter((l) => l.texel === RIG_TEXELS.placement)).toHaveLength(12)
  })

  it('builds the rows once, shared by every fetch', () => {
    // Not an economy: a second `int()` over the hoisted `select` that `f1`
    // becomes comes out of the WGSL builder without its cast (three r185) —
    // see the vertex decode's test of the same shape. Twenty-four fetches here
    // make it twenty-four chances.
    const { vat, position, normal } = decodeRigFixture()

    const rows = new Set([...fetchesOf(position, vat.rigTexture), ...fetchesOf(normal!, vat.rigTexture)].map(rowOf))
    expect(rows.size).toBe(3)
    expect([...rows].every((row) => row !== undefined)).toBe(true)
  })

  it('flips the second row onto the first’s hemisphere, then blends rotation as a normalised lerp', () => {
    const { position } = decodeRigFixture()

    // `dot( q0, q1 ) < 0.0 ? -q1 : q1`, once per slot for the live pair and
    // once for the frozen row: the bake keeps neighbouring rows on one
    // hemisphere, but a looping clip's wrap and a fade's frozen row are not
    // neighbours.
    const flips = nodesIn(position).filter((n) => {
      if (n.type !== 'ConditionalNode') return false
      const condition = unwrap(n.condNode)
      return (
        condition?.type === 'OperatorNode' &&
        condition.op === '<' &&
        unwrap(condition.aNode)?.method === 'dot' &&
        condition.bNode?.type === 'ConstNode' &&
        condition.bNode.value === 0 &&
        unwrap(n.ifNode)?.method === 'negate'
      )
    })
    expect(flips).toHaveLength(4 * 2)

    const methods = methodsIn(position)
    expect(methods).toContain('mix')
    expect(methods).toContain('normalize')
  })

  it('weighs each slot by the vertex’s own skinWeight component', () => {
    const { position } = decodeRigFixture()

    const weighted = nodesIn(position).filter(
      (n) =>
        n.type === 'OperatorNode' &&
        n.op === '*' &&
        n.bNode?.type === 'SplitNode' &&
        n.bNode.node?.type === 'AttributeNode' &&
        n.bNode.node.getAttributeName!() === 'skinWeight',
    )
    expect(weighted.map((n) => n.bNode!.components).sort()).toEqual(['w', 'x', 'y', 'z'])
    // Each one a composed mat4 — `Matrix4.compose` as a join of four columns.
    for (const n of weighted) {
      const matrix = unwrap(n.aNode)
      expect(matrix?.type === 'JoinNode' && matrix.nodeType === 'mat4', 'a composed mat4').toBe(true)
    }
  })

  it('transforms the rest position by the skin matrix, and the rest normal by its upper 3×3', () => {
    const { position, normal } = decodeRigFixture()

    // Position: `( skin * vec4( position, 1 ) ).xyz`.
    const skinned = nodesIn(position).find((n) => {
      const operand = unwrap(n.bNode)
      return (
        n.type === 'OperatorNode' &&
        n.op === '*' &&
        operand?.type === 'JoinNode' &&
        nodesIn(operand).some((m) => m.type === 'AttributeNode' && m.getAttributeName!() === 'position')
      )
    })
    expect(skinned, 'skin * vec4( position, 1 )').toBeDefined()

    // Normal: `mat3( skin ) * normal`, normalised — the matrix itself, as
    // three's skinning takes it, exact for the rigid and uniformly scaled
    // slots this encoding stores.
    const rotated = nodesIn(normal!).find((n) => {
      const matrix = unwrap(n.aNode)
      return (
        n.type === 'OperatorNode' &&
        n.op === '*' &&
        matrix?.type === 'ConvertNode' &&
        matrix.convertTo === 'mat3' &&
        n.bNode?.type === 'AttributeNode' &&
        n.bNode.getAttributeName!() === 'normal'
      )
    })
    expect(rotated, 'mat3( skin ) * normal').toBeDefined()
    expect(methodsIn(normal!)).toContain('normalize')
  })

  it('carries a tangent through the same matrix when the geometry has one, and none otherwise', () => {
    const plain = decodeRigFixture()
    expect(plain.tangent).toBeNull()

    const vat = makeRigVATFixture()
    vat.geometry.setAttribute('tangent', new BufferAttribute(new Float32Array(24), 4))
    const { tangent } = decodeRigFixture(vat)

    expect(tangent).not.toBeNull()
    expect(attributesIn(tangent!)).toEqual(['skinIndex', 'skinWeight', 'tangent'])
    expect(texturesIn(tangent!)).toContain(vat.rigTexture)
  })

  it('shares the pack, the rows and the fade with the vertex decode: the same components, read the same way', () => {
    // One transcription of `resolveVATFrame`, and the rig decode reads it
    // through the same nodes the vertex decode does — asserted by component,
    // because the pack makes every term a swizzle and a wrong one is silent.
    const { position } = decodeRigFixture()
    const nodes = nodesIn(position)

    for (const texel of Object.values(PACK_TEXELS)) {
      for (const component of ['x', 'y', 'z', 'w']) {
        expect(nodes.some((n) => isComponent(n, texel, component)), `texel ${texel}.${component}`).toBe(true)
      }
    }
  })

  it('desyncs from the instance index when no playback texture is given, like the vertex decode', () => {
    const vat = makeRigVATFixture()

    const { position } = vatDecode(vat, { desync: 10 })

    expect(nodesIn(position).some((n) => n.type === 'IndexNode' && n.scope === 'instance')).toBe(true)
    expect(texturesIn(position)).toEqual([vat.rigTexture])
  })
})

describe('vatNodes on a rig-encoded VAT', () => {
  it('offers no normalNode — the skinned normal is written to normalLocal in the vertex stage', () => {
    const nodes = vatNodes(makeRigVATFixture(), { playback: crowdPlayback() })

    expect('normalNode' in nodes).toBe(false)
    expect(nodes.positionNode).toBeDefined()
  })

  it('reads the pack row at batchIndirectIndex on a BatchedMesh, never at the drawn slot', () => {
    const vat = makeRigVATFixture()
    const { position, normal } = vatDecode(vat, { playback: crowdPlayback(), carrier: makeBatchedCarrier(vat) })

    const isBatchIndirectIndex = (n: InspectedNode) => n.type === 'PropertyNode' && n.name === 'vBatchIndirectId'
    for (const node of [position, normal!]) {
      const rows = packRowsIn(node)
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.some(isBatchIndirectIndex)).toBe(true)
        expect(row.some((n) => n.type === 'IndexNode' && n.scope === 'instance')).toBe(false)
      }
    }
  })
})

describe('createVATMesh on a rig-encoded VAT', () => {
  const materialsOf = (mesh: { material: Material | Material[] }) =>
    mesh.material as (Material & { positionNode?: Node; normalNode?: Node })[]

  it('writes the same playback texture a vertex crowd writes from the same instances', () => {
    const rig = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const vertex = createVATMesh(makeVATFixture(), makeFixtureCrowd())

    expect(rig.mesh.count).toBe(vertex.mesh.count)
    expect(rig.playback.texture.image.data).toEqual(vertex.playback.texture.image.data)
  })

  it('gives every material one shared decode of the rig texture, and no normalNode', () => {
    const vat = makeRigVATFixture()

    const { mesh } = createVATMesh(vat, makeFixtureCrowd())

    const materials = materialsOf(mesh)
    expect(materials.map((m) => m.name)).toEqual(['body', 'visor'])
    for (const material of materials) {
      expect(material.positionNode).toBe(materials[0]!.positionNode)
      expect(material.normalNode).toBeUndefined()
    }
    expect(mesh.geometry).toBe(vat.geometry)
    expect(mesh.customDepthMaterial).toBeUndefined()
  })

  it('accepts a smooth-shaded lit material — the normal comes out of the skin matrix', () => {
    const vat = makeRigVATFixture()
    expect((vat.materials[0] as MeshStandardMaterial).flatShading).toBe(false)

    expect(() => createVATMesh(vat, makeFixtureCrowd())).not.toThrow()
  })
})
