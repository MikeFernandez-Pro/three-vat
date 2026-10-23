// The modelled pieces taking the grey boxes' places in the loaded sewers
// (sewers3d.replace.ts): what the play relies on is that a piece answers to
// the box's name under the box's parent and stands where the designer put it.
import { describe, expect, it } from 'vitest'
import { Group, Mesh, type Object3D, PropertyBinding, Vector3 } from 'three'
import { meshesOf, replaceWithNew } from './sewers3d.replace'

/** A node named as GLTFLoader would bind `name`. */
const node = (name: string, at: [number, number, number], mesh = true, scale = 1): Object3D => {
  const o = mesh ? new Mesh() : new Group()
  o.name = PropertyBinding.sanitizeNodeName(name)
  o.position.set(...at)
  o.scale.setScalar(scale)
  return o
}
const named = (level: Object3D, name: string) => level.getObjectByName(PropertyBinding.sanitizeNodeName(name))
const worldOf = (o: Object3D) => o.getWorldPosition(new Vector3()).toArray().map((v) => +v.toFixed(6))

/** The file as Blender exports it: the boxes in their groups, the new pieces loose at the root. */
function level(): Object3D {
  const root = new Group()
  const doors = node('Doors', [0, 0, 0], false)
  const door = node('huge door', [0, 1.75, -19.4])
  const rod = node('huge door.rod.gas', [0, -0.85, -0.3])
  door.add(rod)
  doors.add(door)
  const lever = node('lever.gas', [-33.25, 0, -11.2], false)
  lever.rotation.y = Math.PI / 2
  const post = node('lever.gas.post', [0, 0.5, 0])
  const handle = node('lever.gas.handle', [0, 1.3, 0])
  lever.add(post, handle)
  const lamp = node('light.00 waking lantern', [1.6, 0, 20.4], false)
  lamp.add(node('waking lantern.body', [0, 0.2, 0]), node('waking lantern.reach', [0, 0, 0]))
  root.add(doors, lever, lamp, node('Stone', [0, 0, 0], false))

  const newDoor = node('huge door.new', [0, 0, -18.49], true, 5.64)
  newDoor.add(node('doors', [0, 0.3, 0]))
  const newPost = node('lever.gas.post.new', [-33.25, 0, -11.2])
  newPost.rotation.y = Math.PI / 2
  newPost.add(node('lever.gas.handle.new', [0, 0.43, -0.08]))
  root.add(newDoor, newPost, node('chest.top.new', [5, 0, -7]), node('renew', [1, 1, 1]))
  root.updateWorldMatrix(true, true)
  return root
}

describe('the modelled pieces in the boxes’ places', () => {
  it('puts each piece under the box’s parent, under the box’s name, at its own world position, and drops the box', () => {
    const root = level()
    const before = worldOf(named(root, 'huge door.new')!)
    expect(replaceWithNew(root).sort()).toEqual(['huge_door', 'levergashandle', 'levergaspost'])
    const door = named(root, 'huge door')!
    expect(door.parent).toBe(named(root, 'Doors'))
    expect((door as Group).isGroup).toBe(true)
    expect(worldOf(door)).toEqual(before)
    expect(worldOf(named(root, 'huge door.new')!)).toEqual(before)
    expect(named(root, 'huge door.new')!.parent).toBe(door)
    const sameName: Object3D[] = []
    root.traverse((o) => o.name === 'huge_door' && sameName.push(o))
    expect(sameName).toEqual([door])
  })

  it('keeps the piece’s own scale and turn inside the pivot, which is turned and scaled as the box was', () => {
    const root = level()
    replaceWithNew(root)
    const door = named(root, 'huge door')!
    expect(door.scale.toArray()).toEqual([1, 1, 1])
    expect(named(root, 'huge door.new')!.scale.x).toBeCloseTo(5.64, 9)
    const handle = named(root, 'lever.gas.handle')!
    expect(handle.parent).toBe(named(root, 'lever.gas'))
    expect(handle.rotation.y).toBeCloseTo(0, 9)
    expect(worldOf(handle)).toEqual(worldOf(named(root, 'lever.gas.handle.new')!))
    expect(worldOf(handle)).toEqual([-33.25 - 0.08, 0.43, -11.2].map((v) => +v.toFixed(6)))
  })

  it('carries the box’s children over to the pivot where they stood, so the rods still sink with the door', () => {
    const root = level()
    replaceWithNew(root)
    const rod = named(root, 'huge door.rod.gas')!
    expect(rod.parent).toBe(named(root, 'huge door'))
    expect(worldOf(rod)).toEqual([0, 0.9, -19.7])
    named(root, 'huge door')!.position.y -= 3.6
    root.updateWorldMatrix(true, true)
    expect(worldOf(rod)[1]).toBeCloseTo(0.9 - 3.6, 9)
    expect(worldOf(named(root, 'huge door.new')!)[1]).toBeCloseTo(-3.6, 9)
  })

  it('puts a nested piece in its own box’s place too, and leaves a piece with no box, or a name that only ends so, alone', () => {
    const root = level()
    replaceWithNew(root)
    expect(named(root, 'lever.gas.post')!.parent).toBe(named(root, 'lever.gas'))
    expect(named(root, 'lever.gas.post.new')!.children).toHaveLength(0)
    expect(named(root, 'chest.top.new')!.parent).toBe(root)
    expect(named(root, 'renew')!.parent).toBe(root)
    expect(named(root, 'waking lantern.body')!.parent).toBe(named(root, 'light.00 waking lantern'))
  })

  it('lists the meshes of a pivot, the piece and its parts', () => {
    const root = level()
    replaceWithNew(root)
    expect(meshesOf(named(root, 'huge door')!).map((m) => m.name).sort()).toEqual(['doors', 'huge_doornew', 'huge_doorrodgas'])
  })
})
