// A merged character's part is the vertices that carry its colour, so the
// colour controls find them by the colour the bake wrote. Checked against a
// real merged bake of a stand-in, so a bake that stored the colour any other
// way (another space, another precision) would find nothing here first.
import { AnimationClip, BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three'
import { bakeVAT } from 'three-vat'
import { describe, expect, it } from 'vitest'
import { paint, piecesOf, verticesOf } from './repaint.js'

/** Two flat boxes, a body and a visor, as Soldier's two materials differ. */
function soldier(): Group {
  const root = new Group()
  for (const [name, hex, x] of [['Body', 0xfdf5e3, -1], ['Visor', 0xe4572e, 1]] as const) {
    const part = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name, color: hex }))
    part.position.x = x
    root.add(part)
  }
  root.updateMatrixWorld(true)
  return root
}

const still = new AnimationClip('Still', 1, [])
const merged = () => bakeVAT(soldier(), [still], { encoding: 'delta', mergeFlatMaterials: true })

describe('a merged part, found and painted by its colour', () => {
  it('finds every vertex of the part and none of the other', () => {
    const colours = merged().geometry.getAttribute('color').array
    const body = verticesOf(colours, new Color(0xfdf5e3))
    const visor = verticesOf(colours, new Color(0xe4572e))

    expect(body.length).toBe(24) // a box's vertices
    expect(visor.length).toBe(24)
    expect(body.some((v) => visor.includes(v))).toBe(false)
  })

  it('paints the part and leaves the other as it was', () => {
    const colours = merged().geometry.getAttribute('color').array as Float32Array
    const body = verticesOf(colours, new Color(0xfdf5e3))
    const visor = verticesOf(colours, new Color(0xe4572e))

    const picked = new Color(0x5cffc9)
    paint(colours, body, picked)

    expect(verticesOf(colours, picked)).toEqual(body)
    expect(verticesOf(colours, new Color(0xe4572e))).toEqual(visor)
  })
})

describe('a part, split into its pieces', () => {
  it('tells two balls from two boxes in the one colour, as the robot eyes are told from its brows', () => {
    const root = new Group()
    const red = 0xe4572e
    for (const [geometry, x] of [[new SphereGeometry(0.5, 12, 8), -1], [new SphereGeometry(0.5, 12, 8), 1], [new BoxGeometry(0.4, 0.1, 0.1), -1], [new BoxGeometry(0.4, 0.1, 0.1), 1]] as const) {
      const part = new Mesh(geometry, new MeshStandardMaterial({ name: 'Black', color: red }))
      part.position.set(x, 0, geometry instanceof BoxGeometry ? 1 : 0)
      root.add(part)
    }
    root.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name: 'Main', color: 0xfdf5e3 })))
    root.updateMatrixWorld(true)
    const { geometry } = bakeVAT(root, [still], { encoding: 'delta', mergeFlatMaterials: true })
    const red3 = verticesOf(geometry.getAttribute('color').array, new Color(red))

    const pieces = piecesOf(geometry.index!.array, geometry.getAttribute('position').array, red3)

    const ball = new SphereGeometry(0.5, 12, 8).getAttribute('position').count
    expect(pieces.map((piece) => piece.length)).toEqual([ball, ball, 24, 24])
  })
})
