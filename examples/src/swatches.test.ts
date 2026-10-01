// The merged-materials page's swatch diagram is read off the bake, never
// written down: three materials and three draws with the merge off, one
// material carrying the colours in its vertices and one draw with it on. So
// the facts are checked against real bakes of a stand-in robot, both ways —
// a diagram that drew from a list of its own would agree with any bake.
import { AnimationClip, BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { bakeVAT } from 'three-vat'
import { describe, expect, it } from 'vitest'
import { swatchFacts } from './swatches.js'

/** Three boxes in three flat colours, as RobotExpressive's three materials differ. */
function robot(): Group {
  const root = new Group()
  for (const [name, hex, x] of [['Main', 0xe4572e, -2], ['Grey', 0x808080, 0], ['Black', 0x101010, 2]] as const) {
    const part = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name, color: hex, roughness: 0.8 }))
    part.position.x = x
    root.add(part)
  }
  root.updateMatrixWorld(true)
  return root
}

// A clip of no tracks: the swatches read the materials and the geometry, and
// neither depends on what the bake animates.
const still = new AnimationClip('Still', 1, [])

describe('the swatch facts, read off a bake', () => {
  it('has three materials and three draws with the merge off', () => {
    const facts = swatchFacts(bakeVAT(robot(), [still], { encoding: 'delta' }))

    expect(facts.draws).toBe(3)
    expect(facts.materials.map((m) => m.name)).toEqual(['Main', 'Grey', 'Black'])
    expect(facts.materials.map((m) => m.color)).toEqual(['#e4572e', '#808080', '#101010'])
    // Each draws in its own colour, and none reads a vertex.
    for (const material of facts.materials) expect(material.vertexColors).toEqual([])
  })

  it('has one white material carrying the three colours in its vertices, and one draw, with it on', () => {
    const facts = swatchFacts(bakeVAT(robot(), [still], { encoding: 'delta', mergeFlatMaterials: true }))

    expect(facts.draws).toBe(1)
    expect(facts.materials).toHaveLength(1)
    const [merged] = facts.materials
    expect(merged!.name).toBe('Main + Grey + Black')
    expect(merged!.color).toBe('#ffffff')
    expect(merged!.vertexColors).toEqual(['#e4572e', '#808080', '#101010'])
  })

  it('reads the same off a rig bake', () => {
    // RobotExpressive bakes under the rig encoding by default, and the merge
    // runs before either encoding sizes a texture.
    const plain = swatchFacts(bakeVAT(robot(), [still], { encoding: 'rig' }))
    const merged = swatchFacts(bakeVAT(robot(), [still], { encoding: 'rig', mergeFlatMaterials: true }))

    expect([plain.draws, merged.draws]).toEqual([3, 1])
    expect(merged.materials[0]!.vertexColors).toHaveLength(3)
  })
})
