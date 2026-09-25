import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BufferAttribute,
  DataTexture,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshNormalMaterial,
  MeshStandardMaterial,
  ShadowMaterial,
} from 'three'
import type { Material } from 'three'
import { texture } from 'three/tsl'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import { flatFacts } from './flat-materials.js'
import { assetMissing, makeMultiMaterialFixture, makeRigidSubtreeFixture } from './test-utils.js'
import type { VAT } from './types.js'

/** The rigid fixture with its two parts painted apart: flat, alike in all but colour. */
function makePaintedFixture() {
  const fixture = makeRigidSubtreeFixture()
  ;(fixture.arm.material as MeshBasicMaterial).color.setRGB(1, 0, 0)
  ;(fixture.body.material as MeshBasicMaterial).color.setRGB(0, 0, 1)
  return fixture
}

/** The merged `color` attribute at one merged vertex. */
function colorAt(vat: VAT, v: number): number[] {
  const color = vat.geometry.attributes.color as BufferAttribute
  return [color.getX(v), color.getY(v), color.getZ(v)]
}

/** Which merged vertex a source part's first vertex landed on: parts are laid out in group order. */
function vertexOf(vat: VAT, materialIndex: number): number {
  const group = vat.geometry.groups.find((g) => g.materialIndex === materialIndex)!
  return vat.geometry.index!.getX(group.start)
}

describe('what counts as a flat material', () => {
  it('is a coloured material with no texture and no vertex colours', () => {
    expect(flatFacts(new MeshStandardMaterial({ color: 0xff0000 }))).not.toBeNull()
    expect(flatFacts(new MeshStandardMaterial({ map: new DataTexture() }))).toBeNull()
    expect(flatFacts(new MeshStandardMaterial({ normalMap: new DataTexture() }))).toBeNull()
    expect(flatFacts(new MeshStandardMaterial({ vertexColors: true }))).toBeNull()
    // No colour to move into the vertices at all.
    expect(flatFacts(new MeshNormalMaterial())).toBeNull()
  })

  it('is not a material whose shader a caller hooked, which a key cannot see and a clone drops', () => {
    // `toJSON` serializes neither hook and `copy` carries neither over, so two
    // materials apart only in their hook would share a key, and the merged
    // clone would draw both parts without it (#79).
    const hooked = new MeshStandardMaterial({ color: 0xff0000 })
    hooked.onBeforeCompile = () => {}
    const keyed = new MeshStandardMaterial({ color: 0xff0000 })
    keyed.customProgramCacheKey = () => 'keyed'

    expect(flatFacts(hooked)).toBeNull()
    expect(flatFacts(keyed)).toBeNull()
  })

  it('is not a ShadowMaterial, whose shader never reads a vertex colour', () => {
    expect(flatFacts(new ShadowMaterial({ color: 0xff0000 }))).toBeNull()
  })

  it('is not a node material with a node input, where `color` may not be what it draws', () => {
    // A `colorNode` replaces `color` outright, and may hold a texture no own
    // property shows; merged, the vertex colour would multiply into it.
    const plain = new MeshStandardNodeMaterial({ color: 0xff0000 })
    const noded = new MeshStandardNodeMaterial({ color: 0xff0000 })
    noded.colorNode = texture(new DataTexture())
    const output = new MeshStandardNodeMaterial({ color: 0xff0000 })
    output.outputNode = texture(new DataTexture())

    expect(flatFacts(plain as unknown as Material)).not.toBeNull()
    expect(flatFacts(noded as unknown as Material)).toBeNull()
    expect(flatFacts(output as unknown as Material)).toBeNull()
  })

  it('keys on everything but the colour and the name', () => {
    const key = (m: Material) => flatFacts(m)!.key
    const red = new MeshStandardMaterial({ color: 0xff0000, name: 'red', roughness: 0.5 })
    const blue = new MeshStandardMaterial({ color: 0x0000ff, name: 'blue', roughness: 0.5 })
    const rough = new MeshStandardMaterial({ color: 0x0000ff, roughness: 0.9 })
    const basic = new MeshBasicMaterial({ color: 0xff0000 })

    expect(key(red)).toBe(key(blue))
    expect(key(red)).not.toBe(key(rough))
    expect(key(red)).not.toBe(key(basic))
  })
})

describe('mergeFlatMaterials', () => {
  it.each(['delta', 'rig'] as const)('collapses two flat materials into one, colours moved into the vertices (%s)', (encoding) => {
    const { root, clip, arm, body } = makePaintedFixture()
    const sources = [arm.material, body.material] as MeshBasicMaterial[]

    const vat = bakeVAT(root, [clip], { fps: 10, encoding, mergeFlatMaterials: true })

    expect(vat.materials).toHaveLength(1)
    expect(vat.geometry.groups).toHaveLength(1)
    const merged = vat.materials[0] as MeshBasicMaterial
    expect(sources).not.toContain(merged)
    expect(merged.vertexColors).toBe(true)
    expect(merged.color.toArray()).toEqual([1, 1, 1])
    expect(merged).toBeInstanceOf(MeshBasicMaterial)

    // Each vertex carries its own part's colour. The fixture's parts are one
    // vertex each, arm first in traversal order.
    const colours = [colorAt(vat, 0), colorAt(vat, 1)].sort()
    expect(colours).toEqual([
      [0, 0, 1],
      [1, 0, 0],
    ])
    // The caller's materials are only read.
    expect(sources.map((m) => m.color.toArray())).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ])
    expect(sources.every((m) => !m.vertexColors)).toBe(true)
  })

  it.each(['delta', 'rig'] as const)('collapses the groups of a mesh with a material array, as it does two meshes (%s)', (encoding) => {
    // The fixture's groups are red and blue, flat and alike in all but colour
    // (#92). Each triangle keeps its group's colour, the shared edge included.
    const { root, clip, materials } = makeMultiMaterialFixture()

    const vat = bakeVAT(root, [clip], { fps: 10, encoding, mergeFlatMaterials: true })

    expect(vat.materials).toHaveLength(1)
    expect(materials).not.toContain(vat.materials[0])
    expect(vat.geometry.groups).toHaveLength(1)
    const index = vat.geometry.index!
    for (let i = 0; i < index.count; i++) {
      expect(colorAt(vat, index.getX(i))).toEqual(i < 3 ? [1, 0, 0] : [0, 0, 1])
    }
  })

  it('changes nothing when it is not asked for', () => {
    const { root, clip } = makePaintedFixture()
    const vat = bakeVAT(root, [clip], { fps: 10, encoding: 'delta' })
    expect(vat.materials).toHaveLength(2)
    expect(vat.geometry.attributes.color).toBeUndefined()
  })

  it('leaves a flat material alone when nothing shares its kind, and never swaps it for a clone', () => {
    const { root, clip, arm, body } = makePaintedFixture()
    ;(body.material as MeshBasicMaterial).dispose()
    body.material = new MeshStandardMaterial({ color: 0x00ff00 })

    const vat = bakeVAT(root, [clip], { fps: 10, encoding: 'delta', mergeFlatMaterials: true })

    expect(vat.materials).toEqual(expect.arrayContaining([arm.material, body.material]))
    expect(vat.materials).toHaveLength(2)
    expect(vat.geometry.attributes.color).toBeUndefined()
  })

  it('merges what it can, and paints the parts it did not touch white', () => {
    const { root, clip, arm, body } = makePaintedFixture()
    const textured = new Mesh(arm.geometry.clone(), new MeshBasicMaterial({ map: new DataTexture() }))
    textured.name = 'textured'
    root.add(textured)

    const vat = bakeVAT(root, [clip], { fps: 10, encoding: 'delta', mergeFlatMaterials: true })

    expect(vat.materials).toHaveLength(2)
    expect(vat.materials).toContain(textured.material)
    expect(vat.materials).not.toContain(arm.material)
    expect(vat.materials).not.toContain(body.material)
    const texturedIndex = vat.materials.indexOf(textured.material as Material)
    expect(colorAt(vat, vertexOf(vat, texturedIndex))).toEqual([1, 1, 1])
  })

  for (const encoding of ['delta', 'rig'] as const) {
    it(`reads an untouched part's interleaved colour rather than refusing it, under the ${encoding} encoding`, () => {
      // With the merge off, a colour only one part has is dropped and the bake
      // works; with it on, the attribute is there for the merge, and a glTF's
      // interleaved colour on a part it left alone must not throw (#79).
      const { root, clip, arm } = makePaintedFixture()
      const geometry = arm.geometry.clone()
      const colour = new InterleavedBuffer(new Float32Array([0.25, 0.5, 0.75, 1]), 4)
      geometry.setAttribute('color', new InterleavedBufferAttribute(colour, 3, 0))
      const coloured = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }))
      coloured.name = 'coloured'
      root.add(coloured)

      expect(() => bakeVAT(root, [clip], { fps: 10, encoding })).not.toThrow()
      const vat = bakeVAT(root, [clip], { fps: 10, encoding, mergeFlatMaterials: true })

      const index = vat.materials.indexOf(coloured.material as Material)
      expect(colorAt(vat, vertexOf(vat, index))).toEqual([0.25, 0.5, 0.75])
    })
  }

  it('leaves the texels as they were: only materials, groups and colours move', () => {
    const plain = makePaintedFixture()
    const merged = makePaintedFixture()
    const a = bakeVAT(plain.root, [plain.clip], { fps: 10, encoding: 'delta' })
    const b = bakeVAT(merged.root, [merged.clip], { fps: 10, encoding: 'delta', mergeFlatMaterials: true })
    expect(b.bounds).toEqual(a.bounds)
    expect(b.clips).toEqual(a.clips)
    expect(b.vertexCount).toBe(a.vertexCount)
  })
})

const ROBOT = 'examples/public/RobotExpressive.glb'

describe.skipIf(assetMissing(ROBOT))('RobotExpressive under mergeFlatMaterials', () => {
  it('draws in one call where it drew in three (ADR-0008)', async () => {
    ;(globalThis as { self?: unknown }).self = globalThis
    const buf = readFileSync(ROBOT)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const gltf = await new Promise<{ scene: Mesh; animations: never[] }>((res, rej) =>
      new GLTFLoader().parse(ab, '', res as never, rej),
    )
    const clips = gltf.animations.filter((c: { name: string }) => ['Idle', 'Walking'].includes(c.name))

    for (const encoding of ['delta', 'rig'] as const) {
      const plain = bakeVAT(gltf.scene, clips, { fps: 10, encoding })
      const merged = bakeVAT(gltf.scene, clips, { fps: 10, encoding, mergeFlatMaterials: true })
      expect(plain.geometry.groups).toHaveLength(3)
      expect(merged.geometry.groups).toHaveLength(1)
      expect(merged.materials).toHaveLength(1)
      // Three colours in the vertices, one per source material.
      const color = merged.geometry.attributes.color as BufferAttribute
      const seen = new Set<string>()
      for (let v = 0; v < color.count; v++) seen.add([color.getX(v), color.getY(v), color.getZ(v)].join())
      expect(seen.size).toBe(3)
    }
  })
})
