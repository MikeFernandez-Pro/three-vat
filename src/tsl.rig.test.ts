import { BufferAttribute, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Material, Mesh, RenderTarget } from 'three'
import type { Node } from 'three/webgpu'
import { describe, expect, it } from 'vitest'
import { createVATPlaybackTexture, PACK_TEXELS, pauseVATInstance, setVATInstance } from './instance-playback.js'
import { RIG_TEXELS, RIG_TEXELS_PER_SLOT } from './rig-texture.js'
import {
  builtFor,
  computeWGSL,
  coordsOf,
  isComponent,
  makeBatchedCarrier,
  makeFixtureCrowd,
  makeRigVATFixture,
  makeVATFixture,
  nodesIn,
  packRowsIn,
  unassignedReads,
  unwrap,
  vertexWGSL,
} from './test-utils.js'
import type { BuiltShader, InspectedNode } from './test-utils.js'
import { createVATMesh, fadePassesOf, vatDecode, vatNodes } from './tsl.js'
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
const columnOf = (fetch: InspectedNode) => coordsOf(fetch)[0]
const rowOf = (fetch: InspectedNode) => coordsOf(fetch)[1]

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

  it('fetches four slots’ two texels at the live band’s two rows', () => {
    const { vat, position } = decodeRigFixture()

    const fetches = fetchesOf(position, vat.rigTexture)
    // 4 slots x 2 texels x 2 rows: the two the instance sits between. The band
    // it is crossfading out of is read behind the one branch on this path, in
    // the walk up each slot's chain (ADR-0039), which does not traverse.
    expect(fetches).toHaveLength(4 * RIG_TEXELS_PER_SLOT * 2)

    for (const component of ['x', 'y', 'z', 'w']) {
      const ofSlot = fetches.filter((f) => readsSkinIndex(columnOf(f), component))
      expect(ofSlot, `fetches for skinIndex.${component}`).toHaveLength(RIG_TEXELS_PER_SLOT * 2)
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
    expect(layouts.filter((l) => l.texel === RIG_TEXELS.rotation)).toHaveLength(8)
    expect(layouts.filter((l) => l.texel === RIG_TEXELS.placement)).toHaveLength(8)
  })

  it('builds the rows once, shared by every fetch', () => {
    // Not an economy: a second `int()` over the hoisted `select` that `f1`
    // becomes comes out of the WGSL builder without its cast (three r185) —
    // see the vertex decode's test of the same shape. Sixteen fetches here
    // make it sixteen chances.
    const { vat, position, normal } = decodeRigFixture()

    const rows = new Set([...fetchesOf(position, vat.rigTexture), ...fetchesOf(normal!, vat.rigTexture)].map(rowOf))
    expect(rows.size).toBe(2)
    expect([...rows].every((row) => row !== undefined)).toBe(true)
  })

  it('flips the second row onto the first’s hemisphere, then blends rotation as a normalised lerp', () => {
    const { position } = decodeRigFixture()

    // `dot( q0, q1 ) < 0.0 ? -q1 : q1`, once per slot for the live band's
    // pair. The bake keeps neighbouring rows on one hemisphere, but a looping
    // clip's wrap is no neighbour of this row. (The crossfade's own checks are
    // behind its branch.)
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
    expect(flips).toHaveLength(4)

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
    // Each one a composed mat4 — `Matrix4.compose` as a join of four columns —
    // plus the crossfade's correction to it, which is zero unless the instance
    // is crossfading (ADR-0039).
    for (const n of weighted) {
      const sum = unwrap(n.aNode)
      expect(sum?.type === 'OperatorNode' && sum.op === '+', 'the live matrix, corrected').toBe(true)
      const matrix = unwrap(unwrap(sum!.aNode)?.node ?? undefined)
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

  it('shares the pack, the rows and the crossfade with the vertex decode: the same components, read the same way', () => {
    // One transcription of `resolveVATFrame`, and the rig decode reads it
    // through the same nodes the vertex decode does - asserted by component,
    // because the pack makes every term a swizzle and a wrong one is silent.
    const { position } = decodeRigFixture()
    const nodes = nodesIn(position)

    for (const texel of [
      PACK_TEXELS.clip,
      PACK_TEXELS.playback,
      PACK_TEXELS.outgoingClip,
      PACK_TEXELS.outgoingPlayback,
    ]) {
      for (const component of ['x', 'y', 'z', 'w']) {
        expect(nodes.some((n) => isComponent(n, texel, component)), `texel ${texel}.${component}`).toBe(true)
      }
    }
    // The crossfade texel carries three values, the duration, the blend start
    // (ADR-0036) and the pause (ADR-0041); its last component is written as
    // zero and read by nothing.
    expect(nodes.some((n) => isComponent(n, PACK_TEXELS.crossfade, 'x')), 'the crossfade duration').toBe(true)
    expect(nodes.some((n) => isComponent(n, PACK_TEXELS.crossfade, 'y')), 'the blend start').toBe(true)
    expect(nodes.some((n) => isComponent(n, PACK_TEXELS.crossfade, 'z')), 'the pause').toBe(true)
    expect(nodes.some((n) => isComponent(n, PACK_TEXELS.crossfade, 'w')), 'crossfade.w').toBe(false)
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
      expect(rows).toHaveLength(5)
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

  it('computes each band’s phase once in the WGSL it ships, as the vertex crowd does (#162)', () => {
    // Two bands, the live one and the outgoing one, each wrapping its loops
    // once: the rig resolves them through the same resolver, and the four
    // influences it unrolls read the rows it settles, never a band of their own.
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    const wgsl = vertexWGSL(mesh, materialsOf(mesh)[0]!)

    expect(wgsl.split('fract(').length - 1).toBe(2)
  })

  it('reads no variable on a path that skipped the branch assigning it (#162)', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    expect(unassignedReads(vertexWGSL(mesh, materialsOf(mesh)[0]!))).toEqual([])
  })

  it('accepts a smooth-shaded lit material — the normal comes out of the skin matrix', () => {
    const vat = makeRigVATFixture()
    expect((vat.materials[0] as MeshStandardMaterial).flatShading).toBe(false)

    expect(() => createVATMesh(vat, makeFixtureCrowd())).not.toThrow()
  })
})

describe('a rig crossfade blended once an instance (ADR-0059)', () => {
  // The chain walk is the same for every vertex of an instance: walked once a
  // slot in a compute pass, the vertices read what it wrote. A Loop is the walk.
  const walksInTheVertexShader = (wgsl: string) => /for \( var/.test(wgsl)
  const firstMaterial = (mesh: InstancedMesh) => (mesh.material as Material[])[0]!

  it('leaves the walk out of the vertex shader where the vertex stage reads storage', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    expect(walksInTheVertexShader(vertexWGSL(mesh, firstMaterial(mesh)))).toBe(false)
  })

  const textureBindingsOf = (wgsl: string) => (wgsl.match(/: texture_2d<f32>/g) ?? []).length
  /** A build whose vertex stage reads no storage: the WebGL 2 fallback's, or a device's with none for that stage. */
  const noVertexStorage = [
    (builder: BuiltShader) => { builder.isAvailable = (name) => name !== 'storageBuffer' },
    (builder: BuiltShader) => { builder.renderer.backend.device.limits.maxStorageBuffersInVertexStage = 0 },
  ]
  /** The WebGL 2 fallback, with or without float targets to draw into. */
  const onTheFallback = (floats: boolean) => (builder: BuiltShader) => {
    builder.isAvailable = (name) => name !== 'storageBuffer'
    Object.assign(builder.renderer.backend, {
      isWebGLBackend: true,
      extensions: { has: (name: string) => floats && name === 'EXT_color_buffer_float' },
    })
  }

  it('reads the drawn pass’s targets where the vertex stage cannot read storage (ADR-0061)', () => {
    for (const before of [...noVertexStorage, onTheFallback(true)]) {
      const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
      const { vertexShader } = builtFor(mesh, firstMaterial(mesh), before)
      const [pass] = fadePassesOf(mesh)

      expect(walksInTheVertexShader(vertexShader)).toBe(false)
      expect(pass?.route).toBe('draw')
      const target = pass!.written as RenderTarget
      expect(target.textures).toHaveLength(2)
      // Its two targets, bound in the vertex stage beside what the walk reads.
      const walked = createVATMesh(makeRigVATFixture(), makeFixtureCrowd()).mesh
      expect(textureBindingsOf(vertexShader)).toBe(textureBindingsOf(builtFor(walked, firstMaterial(walked), onTheFallback(false)).vertexShader) + 2)
    }
  })

  it('walks in the vertex shader, as before, where it can neither read storage nor draw float targets', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())

    expect(walksInTheVertexShader(builtFor(mesh, firstMaterial(mesh), onTheFallback(false)).vertexShader)).toBe(true)
    expect(fadePassesOf(mesh)).toHaveLength(0)
  })

  /** A renderer as the pass meets it, keeping what it was asked to compute. */
  const computing = () => {
    const calls: Node[] = []
    return { calls, renderer: { compute: (node: Node) => calls.push(node) } }
  }
  /**
   * One draw of the carrier, as three makes it once the shader is built: each
   * node the build asked to run ahead of a draw, with the renderer (ADR-0062).
   */
  const draw = (built: BuiltShader, renderer: object) => {
    for (const node of built.updateBeforeNodes) node.updateBefore({ renderer })
  }
  /** Draws until the pass has run once, nothing fading: by the second (ADR-0062). */
  const drawTwice = (built: BuiltShader, renderer: object) => {
    draw(built, renderer)
    draw(built, renderer)
  }
  /** A crowd whose shader has been built, which is what makes its pass, and the build. */
  const builtCrowd = () => {
    const vat = makeRigVATFixture()
    const crowd = createVATMesh(vat, makeFixtureCrowd())
    const built = builtFor(crowd.mesh, firstMaterial(crowd.mesh))
    return { vat, built, ...crowd }
  }

  it('runs the pass by the second draw, then only while a fade can be running, once a moment', () => {
    const { vat, built, time, playback } = builtCrowd()
    const { calls, renderer } = computing()

    draw(built, renderer)
    expect(calls).toHaveLength(0) // nothing fading at the first draw
    draw(built, renderer)
    expect(calls).toHaveLength(1) // compiled ahead of any fade
    draw(built, renderer)
    expect(calls).toHaveLength(1) // nothing fading

    time.value = 1
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 1, fadeDuration: 0.5 })
    draw(built, renderer)
    draw(built, renderer) // the same moment, in a second pass: a shadow map, say
    expect(calls).toHaveLength(2)
    time.value = 1.2
    draw(built, renderer)
    expect(calls).toHaveLength(3)
    time.value = 1.5 // the blend's end: weight zero from here
    draw(built, renderer)
    expect(calls).toHaveLength(3)
  })

  it('runs the pass at the first draw where something is fading at it', () => {
    const { vat, built, time, playback } = builtCrowd()
    const { calls, renderer } = computing()
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 0, fadeDuration: 0.5 })
    time.value = 0.2

    draw(built, renderer)

    expect(calls).toHaveLength(1)
  })

  it('keeps running while an instance is paused short of its blend’s end', () => {
    const { vat, built, time, playback } = builtCrowd()
    const { calls, renderer } = computing()
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 1, fadeDuration: 0.5 })
    pauseVATInstance(playback, 0, 1.2)

    for (const at of [2, 3, 10]) {
      time.value = at
      draw(built, renderer)
    }

    expect(calls).toHaveLength(3)
  })

  it('runs no pass where the vertex shader walks the chain itself', () => {
    const vat = makeRigVATFixture()
    const { mesh, playback, time } = createVATMesh(vat, makeFixtureCrowd())
    const built = builtFor(mesh, firstMaterial(mesh), onTheFallback(false))
    const { calls, renderer } = computing()
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 0, fadeDuration: 0.5 })

    time.value = 0.2
    draw(built, renderer)

    expect(calls).toHaveLength(0)
  })

  it('leaves the carrier’s onBeforeRender alone, and runs nothing from it', () => {
    const vat = makeRigVATFixture()
    const carrier = new InstancedMesh(vat.geometry, vat.materials[0], 2)
    const material = new MeshStandardNodeMaterial()
    material.positionNode = vatNodes(vat, { carrier, playback: crowdPlayback() }).positionNode
    builtFor(carrier, material)
    const { calls, renderer } = computing()

    carrier.onBeforeRender(renderer as never, null as never, null as never, null as never, null as never, null as never)

    expect(carrier.onBeforeRender).toBe(Object3D.prototype.onBeforeRender)
    expect(calls).toHaveLength(0)
  })

  it('runs the pass from every build that reads it, the shadow map’s too, once a moment', () => {
    const { mesh, built } = builtCrowd()
    const shadow = builtFor(mesh, firstMaterial(mesh))
    const { calls, renderer } = computing()

    for (let frame = 0; frame < 2; frame++) {
      draw(shadow, renderer)
      draw(built, renderer)
    }

    expect(fadePassesOf(mesh)).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('frees its storage with the carrier', () => {
    const { mesh } = builtCrowd()
    let freed = 0
    fadePassesOf(mesh)[0]!.written.addEventListener('dispose', () => { freed++ })

    mesh.dispose()

    expect(freed).toBe(1)
  })

  it('builds a pass that reads no variable a branch skipped assigning', () => {
    const { built } = builtCrowd()
    const { calls, renderer } = computing()
    drawTwice(built, renderer)

    expect(unassignedReads(computeWGSL(calls[0]))).toEqual([])
  })

  /** A renderer as the drawn pass meets it, keeping what it drew, where, and what it put back. */
  const drawing = () => {
    const draws: { object: Mesh; target: unknown; mrt: unknown; drawsObjects: unknown }[] = []
    const sets: unknown[][] = []
    let target: unknown = 'the frame'
    let mrt: unknown = 'the frame’s outputs'
    let drawsObjects: unknown = 'a shadow map’s depth'
    const renderer = {
      compute: () => { throw new Error('the drawn pass dispatched a compute') },
      getRenderTarget: () => target,
      getActiveCubeFace: () => 3,
      getActiveMipmapLevel: () => 1,
      getMRT: () => mrt,
      setMRT: (to: unknown) => { mrt = to },
      setRenderTarget(to: unknown, face = 0, level = 0) {
        target = to
        sets.push([to, face, level])
      },
      getRenderObjectFunction: () => drawsObjects,
      setRenderObjectFunction: (to: unknown) => { drawsObjects = to },
      render: (object: Mesh) => { draws.push({ object, target, mrt, drawsObjects }) },
    }
    return { draws, sets, renderer, now: () => ({ target, mrt, drawsObjects }) }
  }
  /** A crowd built for a vertex stage that reads no storage, which makes its pass a drawn one, and the build. */
  const drawnCrowd = () => {
    const vat = makeRigVATFixture()
    const crowd = createVATMesh(vat, makeFixtureCrowd())
    const built = builtFor(crowd.mesh, firstMaterial(crowd.mesh), onTheFallback(true))
    return { vat, built, ...crowd }
  }

  it('draws the drawn pass by the second draw, then only while a fade can be running, once a moment', () => {
    const { vat, built, time, playback } = drawnCrowd()
    const { draws, renderer } = drawing()

    draw(built, renderer)
    expect(draws).toHaveLength(0)
    draw(built, renderer)
    expect(draws).toHaveLength(1) // compiled ahead of any fade
    draw(built, renderer)
    expect(draws).toHaveLength(1)

    time.value = 1
    setVATInstance(playback, 0, { clip: vat.clips[1]!, startTime: 1, fadeDuration: 0.5 })
    draw(built, renderer)
    draw(built, renderer)
    expect(draws).toHaveLength(2)
    time.value = 1.5
    draw(built, renderer)
    expect(draws).toHaveLength(2)
  })

  it('draws into its own targets, as plainly as an object is drawn, and puts back what it interrupted', () => {
    const { mesh, built } = drawnCrowd()
    const { draws, sets, renderer, now } = drawing()

    drawTwice(built, renderer)

    expect(draws[0]!.target).toBe(fadePassesOf(mesh)[0]!.written)
    expect(draws[0]!.mrt).toBeNull()
    expect(draws[0]!.drawsObjects).toBeNull()
    expect(sets[sets.length - 1]).toEqual(['the frame', 3, 1])
    expect(now()).toEqual({ target: 'the frame', mrt: 'the frame’s outputs', drawsObjects: 'a shadow map’s depth' })
  })

  it('draws a pass that walks the compute pass’s walk into both targets, and reads no variable a branch skipped assigning', () => {
    const { mesh, built } = drawnCrowd()
    const { draws, renderer } = drawing()
    drawTwice(built, renderer)
    const quad = draws[0]!.object
    const target = fadePassesOf(mesh)[0]!.written as RenderTarget
    const { fragmentShader } = builtFor(quad, quad.material as Material, (builder) => {
      Object.assign(builder.renderer, { getRenderTarget: () => target })
    })

    expect(walksInTheVertexShader(fragmentShader)).toBe(true) // the walk's loop, here in the fragment
    expect(fragmentShader).toContain('discard')
    expect(fragmentShader.match(/@location\( [01] \)/g)).toHaveLength(2)
    expect(unassignedReads(fragmentShader)).toEqual([])
  })

  it('sets its targets up as the shader that reads them builds, ahead of the pass’s first draw', () => {
    const { mesh } = createVATMesh(makeRigVATFixture(), makeFixtureCrowd())
    const set: unknown[] = []
    builtFor(mesh, firstMaterial(mesh), (builder) => {
      onTheFallback(true)(builder)
      Object.assign(builder.renderer, { initRenderTarget: (target: unknown) => set.push(target) })
    })

    expect(set).toEqual([fadePassesOf(mesh)[0]!.written])
  })

  it('frees its targets and its triangle with the carrier', () => {
    const { mesh, built } = drawnCrowd()
    const { draws, renderer } = drawing()
    drawTwice(built, renderer)
    let freed = 0
    fadePassesOf(mesh)[0]!.written.addEventListener('dispose', () => { freed++ })
    ;(draws[0]!.object.material as Material).addEventListener('dispose', () => { freed++ })

    mesh.dispose()

    expect(freed).toBe(2)
  })

  it('starts no pass for the vertex encoding', () => {
    const { mesh } = createVATMesh(makeVATFixture(), makeFixtureCrowd())
    vertexWGSL(mesh, firstMaterial(mesh))

    expect(fadePassesOf(mesh)).toHaveLength(0)
  })
})
