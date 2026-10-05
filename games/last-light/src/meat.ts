// The meat at the centre: the bone of meat the swarm is starving for,
// standing at the light where every rat wants to be. A skinned model played
// by three's own mixer, not baked: one of it needs no VAT. Its four flat
// colours, four meshes on one rig, are merged into one skinned mesh on the
// shell material the rats and the floor wear, each colour a part of its own,
// so it is one draw and one shading. Its idle plays on the clock the page
// gives, the run's, so the stop motion holds it on the beat with the rats;
// and as the light walks it runs, blending from the one clip to the other by
// how fast it goes, and turns to face its way. The blend and the turn move on
// that clock too, so they step on the beat like the pose.
import { AnimationMixer, BufferAttribute, Group, SkinnedMesh, type AnimationAction, type BufferGeometry } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import type { ToonLook } from './toon'

/** The clips it plays: standing, and carried along. */
const IDLE = 'Meat_Idle_Scared'
const RUN = 'Meat_Run'
/** The light's pace, m/s, at which the meat is all run; and the seconds its blend and its turn take to follow. */
const RUN_FULL = 1
const EASE = 0.2
/** Which way the model faces at no turn, as a yaw: +z, as the rat does. */
const FACING = 0

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
  /** Pose it at `time` seconds of its clips, the light walking at (vx, vz) m/s. */
  pose(time: number, vx: number, vz: number): void
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
  const play = (name: string): AnimationAction | undefined => {
    const clip = gltf.animations.find((c) => c.name === name)
    if (clip === undefined) return undefined
    const action = mixer.clipAction(clip)
    action.play()
    return action
  }
  const idle = play(IDLE)
  const run = play(RUN)
  /** How much of the run shows, 0 to 1, the time it was last posed at, and the way it faces. */
  let running = 0
  let posedAt = 0
  let yaw = 0

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
    pose(time, vx, vz) {
      // Eased by the time the pose moved on, so a held pose holds its blend and its turn too.
      const step = time - posedAt
      posedAt = time
      const k = step > 0 && step < 1 ? 1 - Math.exp(-step / EASE) : 0
      const speed = Math.hypot(vx, vz)
      running += (Math.min(1, speed / RUN_FULL) - running) * k
      if (speed > 0.05) {
        let turn = Math.atan2(vx, vz) + FACING - yaw
        turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2))
        yaw += turn * k
        root.rotation.y = yaw
      }
      idle?.setEffectiveWeight(1 - running)
      run?.setEffectiveWeight(running)
      mixer.setTime(time)
    },
  }
}
