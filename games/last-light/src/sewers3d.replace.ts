// The Blender file's modelled pieces take the grey boxes' places (2026-10-20):
// a mesh named like a box with `.new` on the end, `huge door.new`, `lever.gas
// .handle.new`, sits loose at the file's root where the box stands, modelled
// at the scale and the hinge it wants. The play drives the boxes by name and
// by parent, the door sinks, a handle turns, a ring falls, a light's group
// slides to the map, so the new piece has to stand where the box stood in the
// tree, not only in the world. Here each takes the box's name and parent, in
// a pivot at its own origin turned and scaled as the box was, the box's
// children follow it, and the box goes. Names are as GLTFLoader binds them,
// dots and spaces gone (PropertyBinding.sanitizeNodeName), so `.new` is a
// bare `new` on the end and the box's name is what stands before it.
import { Group, Matrix4, type Mesh, type Object3D, Quaternion, Vector3 } from 'three'

const SUFFIX = 'new'
const position = new Vector3()
const quaternion = new Quaternion()
const scale = new Vector3()
const unused = new Vector3()
const world = new Matrix4()

/** The piece's pivot: a group standing in for `old` at the same place in the tree, at `piece`'s origin, turned and scaled as `old`. */
function pivotFor(piece: Object3D, old: Object3D): Group {
  const pivot = new Group()
  pivot.name = old.name
  piece.matrixWorld.decompose(position, quaternion, scale)
  old.matrixWorld.decompose(unused, quaternion, scale)
  world.compose(position, quaternion, scale)
  const parent = old.parent!
  pivot.matrix.copy(parent.matrixWorld).invert().multiply(world)
  pivot.matrix.decompose(pivot.position, pivot.quaternion, pivot.scale)
  parent.add(pivot)
  pivot.updateWorldMatrix(true, false)
  return pivot
}

/**
 * Puts every `<name>.new` piece of `level` in `<name>`'s place and drops `<name>`: same parent, same name, the box's
 * children carried over, every world transform kept. A `.new` with no box of its name is left where it is. Returns the
 * names replaced, as the loader has them.
 */
export function replaceWithNew(level: Object3D): string[] {
  level.updateWorldMatrix(true, true)
  const pieces: Object3D[] = []
  level.traverse((o) => o.name.endsWith(SUFFIX) && o.name.length > SUFFIX.length && pieces.push(o))
  const replaced: string[] = []
  for (const piece of pieces) {
    const name = piece.name.slice(0, -SUFFIX.length)
    const old = level.getObjectByName(name)
    if (old === undefined || old.parent === null) continue
    const pivot = pivotFor(piece, old)
    pivot.attach(piece)
    for (const child of [...old.children]) pivot.attach(child)
    old.removeFromParent()
    replaced.push(name)
  }
  level.updateWorldMatrix(true, true)
  return replaced
}

/** Every mesh of `o`, itself counted. */
export function meshesOf(o: Object3D): Mesh[] {
  const out: Mesh[] = []
  o.traverse((c) => (c as Mesh).isMesh && out.push(c as Mesh))
  return out
}
