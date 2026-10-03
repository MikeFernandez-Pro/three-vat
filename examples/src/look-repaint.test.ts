// A change of look repaints the characters in a running scene: a part's own
// material by name, a merged part's vertices by the colour the look it left
// painted them. Checked against real merged bakes, a Soldier's two parts and
// a robot's three, starting from the dark look, which paints Soldier's body
// and the robot's alike.
import { AnimationClip, BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, Scene } from 'three'
import { bakeVAT } from 'three-vat'
import { describe, expect, it } from 'vitest'
import { repaintCharacters } from './look-repaint.js'
import { partColour, partsOf } from './palette.js'
import { verticesOf } from './repaint.js'

/** A stand-in with one box per part, each in the dark look's colour for it, merged into one white material. */
function merged(names: string[]): Mesh {
  const root = new Group()
  names.forEach((name, i) => {
    const box = new Mesh(new BoxGeometry(), new MeshStandardMaterial({ name, color: partsOf('dark')[name]! }))
    box.position.x = i * 2
    root.add(box)
  })
  const vat = bakeVAT(root, [new AnimationClip('still', 1, [])], { mergeFlatMaterials: true, encoding: 'delta' })
  return new Mesh(vat.geometry, vat.materials)
}

const linear = (hex: number) => new Color(hex)
const coloursOf = (mesh: Mesh) => mesh.geometry.getAttribute('color').array

describe('a change of look', () => {
  it("repaints each merged part its own new colour, though the look it left painted two parts alike", () => {
    const soldier = merged(['VanguardBodyMat', 'Vanguard_VisorMat'])
    const robot = merged(['Main', 'Grey', 'Black'])
    const before = (mesh: Mesh, name: string) => verticesOf(coloursOf(mesh), linear(partsOf('dark')[name]!))
    const soldierBody = before(soldier, 'VanguardBodyMat')
    const robotBody = before(robot, 'Main')
    const scene = new Scene().add(soldier, robot)

    // The palette is in the light look under Node: this is the switch from dark to light.
    repaintCharacters(scene, 'dark', linear)

    expect(verticesOf(coloursOf(soldier), linear(partColour('VanguardBodyMat')))).toEqual(soldierBody)
    expect(verticesOf(coloursOf(robot), linear(partColour('Main')))).toEqual(robotBody)
    expect(verticesOf(coloursOf(robot), linear(partColour('VanguardBodyMat')))).toEqual([])
  })

  it("repaints a material named for a part, and leaves any other alone", () => {
    const part = new MeshStandardMaterial({ name: 'Grey', color: partsOf('dark').Grey })
    const other = new MeshStandardMaterial({ name: 'Floor', color: 0x123456 })
    const scene = new Scene().add(new Mesh(new BoxGeometry(), part), new Mesh(new BoxGeometry(), other))

    repaintCharacters(scene, 'dark', linear)

    expect(part.color.getHex()).toBe(partColour('Grey'))
    expect(other.color.getHex()).toBe(0x123456)
  })
})
