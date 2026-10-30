// The tent on the pond's island: public/models/tent.glb (brought in on
// 2026-10-29: one mesh of three flat colours, y-up, its foot on the
// origin, about 0.93 x 0.77 x 1 m), its colours merged into one draw on a
// palette (palettemesh.ts), in the scene pieces' shell (the well's, the
// cage's: toon steps, brush strokes) under a highlight and rim of its own.
// It stands on the island's crown, off its middle as the tent folder moves it,
// its foot on the ground there (pond.ts's `groundOf`), turned and sized by the
// folder too.
import { DoubleSide, Group, type Color, type Material, type Mesh } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import { createPalette } from './palettemesh'
import { groundOf, islandMiddle, type PondLook } from './pond'
import type { ToonLook } from './toon'
import type { ShineLook } from './panel'
import type { Point } from './plain'

const MODEL = './models/tent.glb'
/** How tall the file's tent stands, m, as modelled, and how far its widest reaches from its middle across the ground. */
const MODEL_HEIGHT = 0.771
const MODEL_REACH = 0.5
/** The strokes' size over a scene piece, m, as goosescenes.ts lays them. */
const STROKE_BODY = 0.9
/** How far out of its door a bird going out of it steps, m, past its widest. */
const DOOR_OUT = 0.3

/** What the tent folder edits. */
export interface TentLook {
  show: boolean
  /** Where it stands off the island's middle, m, and how far up or down from the ground there. */
  x: number
  z: number
  y: number
  /** Which way it faces, degrees about y. */
  turn: number
  /** How tall it stands, m. */
  size: number
  /** Each of the file's materials' colour, by its name. */
  colours: Record<string, number>
  /** Its own highlight and rim, over the scene pieces' shell. */
  shine: ShineLook
}

/** The tent to start, as set from the panel on 2026-10-29: off the island's middle, 2.9 m tall and sunk into the crown, matt, a soft warm rim. */
export function defaultTentLook(): TentLook {
  return {
    show: true,
    x: -0.62,
    z: -1.49,
    y: -0.195,
    turn: 18,
    size: 2.9,
    colours: {},
    shine: { specular: 0, shininess: 30, softness: 0.17, specularColor: 0xffe2c0, rim: true, rimStrength: 0.45, rimWidth: 0.35, rimSoftness: 0.1, rimColor: 0xffc890 },
  }
}

export interface Tent {
  readonly object: Group
  readonly look: TentLook
  /** Stand it again on the island of `pond`, as the folder has it. */
  set(pond: PondLook): void
  /** How far it reaches from where it stands across the ground at its widest, m, as big as it now is. */
  reach(): number
  /** Just outside its door, on the ground's level of where it stands: the way out of it. */
  door(): Point
  /** Its colours again, as the folder has them. */
  recolour(): void
  /** The scene pieces' shell, as the look folder sets it, under its own highlight and rim. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /** Its own highlight and rim again, as the folder has them. */
  shineChanged(): void
}

/** The tent, in `look`; the colours the folder starts from are the file's own, where `look` has none. */
export async function createTent(look: TentLook = defaultTentLook()): Promise<Tent> {
  const file = (await new GLTFLoader().loadAsync(MODEL)).scene
  const meshes: Mesh[] = []
  file.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh)
  })
  const names = [...new Set(meshes.map((mesh) => (mesh.material as { name: string }).name))]
  for (const mesh of meshes) {
    const { name, color } = mesh.material as Material & { color: Color }
    look.colours[name] ??= color.getHex()
  }
  // Both sides drawn, so its faces show from behind too.
  const material = new ShellToonMaterial({ side: DoubleSide, painted: { strokes: createStrokes(), extent: (STROKE_BODY * MODEL_HEIGHT) / look.size } })
  const palette = createPalette(names, material)
  palette.merge(file, meshes)
  const object = new Group().add(file)
  const recolour = () => {
    for (const [name, colour] of Object.entries(look.colours)) palette.set(name, colour)
  }
  recolour()
  /** The shell it shares, last handed over: its sheen, strokes and toon steps kept under its own highlight and rim. */
  let shared: (ShellLook & { paint: PaintLook; toon: ToonLook }) | undefined
  const shineChanged = () => {
    if (shared) material.set({ ...shared, ...look.shine })
  }
  return {
    object,
    look,
    set(pond) {
      object.visible = look.show && pond.island.show
      const middle = islandMiddle(pond)
      const x = middle.x + look.x
      const z = middle.z + look.z
      object.position.set(x, groundOf(pond, x, z) + look.y, z)
      object.rotation.y = (look.turn * Math.PI) / 180
      object.scale.setScalar(look.size / MODEL_HEIGHT)
    },
    reach: () => (MODEL_REACH * look.size) / MODEL_HEIGHT,
    door() {
      // Its door faces the file's +z, turned with it.
      const out = (MODEL_REACH * look.size) / MODEL_HEIGHT + DOOR_OUT
      const turn = (look.turn * Math.PI) / 180
      return { x: object.position.x + Math.sin(turn) * out, z: object.position.z + Math.cos(turn) * out }
    },
    recolour,
    setShell(shell) {
      shared = shell
      shineChanged()
    },
    shineChanged,
  }
}
