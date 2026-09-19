import {
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshDistanceMaterial,
  MeshLambertMaterial,
  MeshMatcapMaterial,
  MeshNormalMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  MeshToonMaterial,
} from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, MeshToonNodeMaterial } from 'three/webgpu'
import type { Material } from 'three'
import { describe, expect, it } from 'vitest'
import { assertBakedNormal, needsBakedNormal } from './baked-normals.js'
import { makeVATFixture } from './test-utils.js'

// The rule behind `bakeNormals: false`: which materials would notice a missing
// normal texture. Asserted per material class rather than by the shape of one,
// because the classes disagree — `MeshToonMaterial` reads a normal and has no
// `flatShading` to escape through.

describe('needsBakedNormal', () => {
  it('says yes to every smooth-shaded material that reads a normal', () => {
    const shading: Material[] = [
      new MeshStandardMaterial(),
      new MeshPhysicalMaterial(),
      new MeshPhongMaterial(),
      new MeshLambertMaterial(),
      new MeshToonMaterial(),
      new MeshNormalMaterial(),
      new MeshMatcapMaterial(),
    ]

    for (const material of shading) expect(needsBakedNormal(material), material.type).toBe(true)
  })

  it('says no to an unlit material, which never reads one', () => {
    expect(needsBakedNormal(new MeshBasicMaterial())).toBe(false)
  })

  it('says no to a flat-shaded material, which derives a better one itself', () => {
    // three takes screen-space derivatives of the *deformed* position, per
    // fragment — the correct normal for the posed mesh, for free.
    for (const material of [new MeshStandardMaterial(), new MeshPhongMaterial()]) {
      material.flatShading = true
      expect(needsBakedNormal(material), material.type).toBe(false)
    }
  })

  it('still says yes to a toon material, which has no flatShading to escape through', () => {
    const toon = new MeshToonMaterial() as MeshToonMaterial & { flatShading?: boolean }
    toon.flatShading = false

    expect(needsBakedNormal(toon)).toBe(true)
  })

  it('says no to the shadow-pass materials, which shade nothing', () => {
    expect(needsBakedNormal(new MeshDepthMaterial())).toBe(false)
    expect(needsBakedNormal(new MeshDistanceMaterial())).toBe(false)
  })

  it('reads the node twins the same way, so the TSL path gets the same answer', () => {
    // A node material inherits `isMeshStandardMaterial` and friends from the
    // classic class it twins (`NodeMaterial.setDefaultValues`), which is what
    // lets one rule serve both decode paths.
    expect(needsBakedNormal(new MeshStandardNodeMaterial() as unknown as Material)).toBe(true)
    expect(needsBakedNormal(new MeshToonNodeMaterial() as unknown as Material)).toBe(true)
    expect(needsBakedNormal(new MeshBasicNodeMaterial() as unknown as Material)).toBe(false)
  })
})

describe('assertBakedNormal', () => {
  it('names the option, the material and both fixes', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    expect(() => assertBakedNormal(vat, new MeshStandardMaterial({ name: 'body' }))).toThrow(
      /material "body" \(MeshStandardMaterial\)/,
    )
    expect(() => assertBakedNormal(vat, new MeshStandardMaterial())).toThrow(/bakeNormals: false/)
    expect(() => assertBakedNormal(vat, new MeshStandardMaterial())).toThrow(/flatShading: true/)
    expect(() => assertBakedNormal(vat, new MeshStandardMaterial())).toThrow(/MeshBasicMaterial/)
  })

  it('passes anything paired with a VAT that has a normal texture', () => {
    const vat = makeVATFixture()

    expect(() => assertBakedNormal(vat, new MeshStandardMaterial())).not.toThrow()
  })

  it('passes the two setups the option is for', () => {
    const vat = makeVATFixture({ bakeNormals: false })

    expect(() => assertBakedNormal(vat, new MeshBasicMaterial())).not.toThrow()
    expect(() => assertBakedNormal(vat, new MeshStandardMaterial({ flatShading: true }))).not.toThrow()
  })
})
