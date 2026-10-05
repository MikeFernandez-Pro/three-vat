// The meat at the centre: the bone of meat the swarm is starving for,
// standing at the light where every rat wants to be. A skinned model played
// by three's own mixer, not baked: one of it needs no VAT. Its four flat
// colours, four meshes on one rig, are merged into one skinned mesh on the
// shell material the rats and the floor wear, each colour a part of its own,
// so it is one draw and one shading. Its idle plays on the clock the page
// gives, the run's, so the stop motion holds it on the beat with the rats.
import { AnimationMixer, BufferAttribute, Group, SkinnedMesh, type BufferGeometry } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import type { ToonLook } from './toon'

/** The clip it plays. */
const IDLE = 'Meat_Idle_Scared'

/** What the meat folder edits. */
export interface MeatLook {
  enabled: boolean
  /** How tall it stands, m, and how far off the ground. */
  height: number
  lift: number
  /** Its parts' colours, as modelled to start: the meat, the bone, the bone's knob, the cheeks. */
  colors: [number, number, number, number]
}

/** Half a metre of meat on the ground, in its own colours. */
export const defaultMeat = (): MeatLook => ({
  enabled: true,
  height: 0.5,
  lift: 0,
  colors: [0xe0794a, 0xe7e171, 0xe7e4c3, 0xe79295],
})

export interface Meat {
  /** What the scene adds; move it to the light. */
  readonly object: Group
  readonly material: ShellToonMaterial
  /** Take the meat folder's values, and the shading it shares with the rats. */
  set(look: MeatLook, shell: ShellLook, paint: PaintLook, toon: ToonLook): void
  /** Pose it at `time` seconds of its idle. */
  pose(time: number): void
}

export async function createMeat(): Promise<Meat> {
  const gltf = await new GLTFLoader().loadAsync('./models/meatBone.glb')
  const root = gltf.scene
  const parts: SkinnedMesh[] = []
  root.traverse((o) => {
    if ((o as SkinnedMesh).isSkinnedMesh) parts.push(o as SkinnedMesh)
  })

  // One geometry, each mesh's vertices naming their part, on the one rig they share.
  const geometries = parts.map((mesh, i) => {
    const geometry = mesh.geometry.clone() as BufferGeometry
    geometry.setAttribute('part', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(i), 1))
    return geometry
  })
  const geometry = mergeGeometries(geometries)!
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const modelHeight = box.max.y - box.min.y

  const material = new ShellToonMaterial({ parts: parts.length, painted: { strokes: createStrokes(), extent: modelHeight } })
  const merged = new SkinnedMesh(geometry, material)
  merged.bind(parts[0].skeleton, parts[0].bindMatrix)
  merged.castShadow = merged.receiveShadow = true
  merged.frustumCulled = false
  const holder = parts[0].parent!
  for (const mesh of parts) holder.remove(mesh)
  holder.add(merged)

  const mixer = new AnimationMixer(root)
  const clip = gltf.animations.find((c) => c.name === IDLE) ?? gltf.animations[0]
  if (clip !== undefined) mixer.clipAction(clip).play()

  // The model's own size is three centimetres: it is scaled to the folder's height.
  const object = new Group()
  object.add(root)

  return {
    object,
    material,
    set(look, shell, paint, toon) {
      object.visible = look.enabled
      root.scale.setScalar(look.height / modelHeight)
      root.position.y = look.lift
      look.colors.forEach((color, i) => material.parts[i]?.value.set(color))
      material.set(shell)
      material.setPaint(paint)
      material.setToon(toon)
    },
    pose(time) {
      if (clip !== undefined) mixer.setTime(time % clip.duration)
    },
  }
}
