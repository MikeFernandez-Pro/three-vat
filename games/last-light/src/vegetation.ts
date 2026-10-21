// A first try of modelled vegetation in the woods: a pine and a bush made in
// Blender, `public/models/testVegetation.glb`, drawn by the scenery in place
// of the grey box's forest trees and bush domes. The pines are the file's
// `Pine`, `Pine.001` and on, each tree one of them at random; the bush its
// leaf cards, `Bush`, round the rounded cube at their heart.
// `?greybox` draws the plain shapes again. Both are shaded with the floor's
// and the rats' own toon shell (shell.ts), each with a folder of its own.
import { Box3, type BufferGeometry, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { PaintLook, ShellLook } from './shell'
import type { ToonLook } from './toon'

/** What a vegetation folder edits: how big, over the size each stands at; its shell; its painted normals; its toon steps. */
export interface PropLook {
  scale: number
  shell: ShellLook
  paint: PaintLook
  toon: ToonLook
}

/**
 * The pines' folder, which colours the pine's trunk and its foliage, and the
 * bushes', which colours the bush: a tint over its leaf cards' texture, and
 * its core's colour. Each colour is named for the part it colours.
 */
export interface VegetationLook {
  pines: PropLook & { trunk: number; foliage: number }
  bushes: PropLook & { leaves: number; core: number }
}

/** What a part of a model is: a pine's trunk or foliage, a bush's leaves or core. */
export type Role = 'trunk' | 'foliage' | 'leaves' | 'core'

/** A model as the scenery instances it: each of its meshes, set where the model has it, and what it is; and the box round them all. */
export interface Prop {
  parts: { geometry: BufferGeometry; material: Material; role: Role }[]
  box: Box3
}

export interface Vegetation {
  /** The pine's variants, in the file's order. */
  pines: Prop[]
  bush: Prop
}

export async function loadVegetation(url = './models/testVegetation.glb'): Promise<Vegetation> {
  const { scene } = await new GLTFLoader().loadAsync(url)
  scene.updateMatrixWorld(true)
  // The loader drops the dots from the names: `Roundcube.002` is `Roundcube002`.
  const named = (name: string) => {
    const found = scene.getObjectByName(name)
    if (!found) throw new Error(`${url} has no ${name}`)
    return found
  }
  // Each pine's narrowest part is its trunk.
  const width = (part: Prop['parts'][number]) => part.geometry.boundingBox!.max.x - part.geometry.boundingBox!.min.x
  const pines = scene.children
    .filter((o) => /^Pine\d*$/.test(o.name))
    .map((root) => {
      const pine = prop([root], () => 'foliage')
      pine.parts.reduce((narrowest, part) => (width(part) < width(narrowest) ? part : narrowest)).role = 'trunk'
      return pine
    })
  if (pines.length === 0) throw new Error(`${url} has no Pine`)
  // The bush's textured part is its leaf cards.
  const bush = prop([named('Bush'), named('Roundcube002')], (material) => ((material as MeshStandardMaterial).map ? 'leaves' : 'core'))
  return { pines, bush }
}

/** `roots`' meshes, each geometry carried to where the file sets it, each what `role` says of its material. */
function prop(roots: Object3D[], role: (material: Material) => Role): Prop {
  const parts: Prop['parts'] = []
  const box = new Box3()
  for (const root of roots) {
    root.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      geometry.computeBoundingBox()
      box.union(geometry.boundingBox!)
      const material = mesh.material as Material
      parts.push({ geometry, material, role: role(material) })
    })
  }
  return { parts, box }
}
