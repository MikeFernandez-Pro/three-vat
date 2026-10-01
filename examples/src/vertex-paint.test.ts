// Switch one clip's colour pickers repaint a merged robot's parts in its
// vertex colours, since the merge left one material and no part to recolour.
// Held against a real merged bake of a stand-in robot: three boxes in three
// flat colours, as RobotExpressive's three materials differ.
import { AnimationClip, BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, type BufferAttribute } from 'three'
import { bakeVAT } from 'three-vat'
import { describe, expect, it } from 'vitest'
import { paintPart, partsByColour } from './vertex-paint.js'

const PARTS = [['Main', 0xe4572e, -2], ['Grey', 0x808080, 0], ['Black', 0x101010, 2]] as const

function robot(): Group {
  const root = new Group()
  for (const [name, hex, x] of PARTS) {
    const part = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name, color: hex }))
    part.position.x = x
    root.add(part)
  }
  root.updateMatrixWorld(true)
  return root
}

function mergedColours(): BufferAttribute {
  const vat = bakeVAT(robot(), [new AnimationClip('Still', 1, [])], { encoding: 'delta', mergeFlatMaterials: true })
  return vat.geometry.getAttribute('color') as BufferAttribute
}

describe('partsByColour', () => {
  it('finds the three parts a merge made, in their colours', () => {
    const { colours } = partsByColour(mergedColours())

    expect(colours.map(({ r, g, b }) => new Color(r, g, b).getHex())).toEqual(PARTS.map(([, hex]) => hex))
  })

  it('gives every vertex the part whose colour it carries', () => {
    const color = mergedColours()
    const { colours, partOf } = partsByColour(color)

    expect(partOf.length).toBe(color.count)
    for (let v = 0; v < color.count; v++) {
      const part = colours[partOf[v]!]!
      expect([color.getX(v), color.getY(v), color.getZ(v)]).toEqual([part.r, part.g, part.b])
    }
  })
})

describe('paintPart', () => {
  it('repaints one part and leaves the others as they were', () => {
    const color = mergedColours()
    const { partOf } = partsByColour(color)
    const teal = new Color(0x2f6f73)

    paintPart(color, partOf, 1, teal)

    const after = partsByColour(color).colours.map(({ r, g, b }) => new Color(r, g, b).getHex())
    expect(after).toEqual([0xe4572e, 0x2f6f73, 0x101010])
  })
})
