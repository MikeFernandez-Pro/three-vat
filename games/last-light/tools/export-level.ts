// The woods as a scene for Blender: what the game draws of the level, built by
// the game's own code (scenery.ts, river.ts, lights.ts, blockout.ts), its
// node materials swapped for plain standard ones in the same colours, every
// instanced tree its own mesh, the lamps' lights and halos left out. Over it a
// gameplay layer, never drawn in the game: the level's walls as low red strips
// on the ground, and an empty at the start and at each light, its reach and
// kind on it as custom properties.
//
// Run by export-level.mjs, which writes the GLB.
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type MeshBasicMaterial,
} from 'three'
import { createBlockout } from '../src/blockout'
import { standingAt } from '../src/heights'
import { createLights } from '../src/lights'
import { createRiver } from '../src/river'
import { BIG_FLAME, CART_FLAME, COLOURS, CROWN_FLAME, STEPS_LAMP, createScenery } from '../src/scenery'
import { createToonGradient } from '../src/toon'
import { WALL_THICKNESS } from '../src/walls'
import { woods } from '../src/woods'
import { uniform } from 'three/tsl'
import { DataTexture } from 'three/webgpu'

/** What the colours are called, for the materials' names. */
const NAMES = new Map<number, string>([
  ...Object.entries(COLOURS).map(([name, hex]) => [hex, name] as [number, string]),
  [0x6b6670, 'stand'],
  [0xffa040, 'flame'],
  [0xffe6a8, 'window-glow'],
  [0xffb860, 'fragile-flame'],
  [0xffc23a, 'key'],
  [0xd8d4c8, 'post'],
  [0xff8a2a, 'lantern-lit'],
  [0xffc070, 'lamplight'],
])

export function buildWoods(): Group {
  const map = woods()
  const { level } = map
  const groundAt = (x: number, z: number) => standingAt(map, x, z)

  const scenery = createScenery(map)
  scenery.object.name = 'Scenery'
  const ground = new Mesh(scenery.ground, new MeshStandardMaterial({ color: 0x3b3a2c, roughness: 1, name: 'ground' }))
  ground.name = 'ground'
  scenery.object.add(ground)

  // The water's colour is a node of noise and foam: here, its dark water alone.
  const river = createRiver(map, createToonGradient()).object
  river.name = 'River'
  river.material = new MeshStandardMaterial({ color: 0x14212b, roughness: 0.2, name: 'water' })

  const looks = level.lights.map((_, k) =>
    k === map.bigTree ? BIG_FLAME : k === map.crown ? CROWN_FLAME : k === map.brazier ? CART_FLAME : k === map.stepsLight ? STEPS_LAMP : undefined,
  )
  const lights = createLights(level.lights, new DataTexture(), uniform(0), level.start, { looks, groundAt }).object
  lights.name = 'Lights'

  const pieces = createBlockout({ walls: [], gates: [], keys: level.keys, levers: level.levers }).object
  pieces.name = 'Keys and levers'

  const root = new Group()
  root.name = 'Last Light woods'
  root.add(scenery.object, river, lights, pieces, gameplay(map, groundAt))
  root.updateMatrixWorld(true)
  plain(root)
  return root
}

/** The level's walls, start and lights, as the run reads them. */
function gameplay(map: ReturnType<typeof woods>, groundAt: (x: number, z: number) => number): Group {
  const { level } = map
  const layer = new Group()
  layer.name = 'Gameplay (reference)'
  const red = new MeshStandardMaterial({ color: 0xd02020, emissive: 0x601010, name: 'gameplay-wall' })
  level.walls.forEach((wall, k) => {
    const dx = wall.to.x - wall.from.x
    const dz = wall.to.z - wall.from.z
    const x = (wall.from.x + wall.to.x) / 2
    const z = (wall.from.z + wall.to.z) / 2
    const strip = new Mesh(new BoxGeometry(Math.hypot(dx, dz), 0.08, WALL_THICKNESS), red)
    strip.name = `wall.${String(k).padStart(3, '0')}`
    strip.position.set(x, groundAt(x, z) + 0.04, z)
    strip.rotation.y = -Math.atan2(dz, dx)
    layer.add(strip)
  })
  const empty = (name: string, x: number, z: number, data: Record<string, unknown> = {}) => {
    const o = new Object3D()
    o.name = name
    o.position.set(x, groundAt(x, z), z)
    o.userData = data
    layer.add(o)
  }
  empty('start', level.start.x, level.start.z)
  level.lights.forEach((light, k) =>
    empty(`light.${String(k).padStart(2, '0')}`, light.x, light.z, {
      reach: light.reach,
      kind: light.flame ? (light.fragile ? 'fragile flame' : 'flame') : 'window',
    }),
  )
  if (level.exit) empty('exit', level.exit.x, level.exit.z, { radius: level.exit.radius })
  return layer
}

/**
 * The tree made exportable in place: lights and sprites gone, each instanced
 * mesh broken into meshes, each node material a standard one of its colour,
 * the glows emissive. Names follow the colours.
 */
function plain(root: Object3D): void {
  const materials = new Map<string, MeshStandardMaterial>()
  const counts = new Map<string, number>()
  const named = (base: string) => {
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    return `${base}.${String(n).padStart(3, '0')}`
  }
  const swap = (source: Material): Material => {
    if (!(source as { isNodeMaterial?: boolean }).isNodeMaterial) return source
    const color = (source as MeshBasicMaterial).color ?? new Color(0xffffff)
    const name = NAMES.get(color.getHex()) ?? `colour-${color.getHexString()}`
    const glows = (source as { isMeshBasicNodeMaterial?: boolean }).isMeshBasicNodeMaterial === true
    const key = `${name}/${glows}/${source.side}`
    let out = materials.get(key)
    if (!out) {
      out = new MeshStandardMaterial({ name, color, roughness: 1, metalness: 0, side: source.side, emissive: glows ? color : 0x000000 })
      materials.set(key, out)
    }
    return out
  }

  const all: Object3D[] = []
  root.traverse((o) => all.push(o))
  for (const o of all) {
    const anyO = o as Object3D & { isLight?: boolean; isSprite?: boolean }
    if (anyO.isLight || anyO.isSprite) {
      o.removeFromParent()
      continue
    }
    if (!(o as Mesh).isMesh) continue
    const mesh = o as Mesh
    const material = swap(Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material)
    if ((mesh as InstancedMesh).isInstancedMesh) {
      const instanced = mesh as InstancedMesh
      const m = new Matrix4()
      for (let k = 0; k < instanced.count; k++) {
        instanced.getMatrixAt(k, m)
        const one = new Mesh(instanced.geometry, material)
        one.name = named(material.name)
        m.premultiply(instanced.matrix).decompose(one.position, one.quaternion, one.scale)
        instanced.parent!.add(one)
      }
      instanced.removeFromParent()
      continue
    }
    mesh.material = material
    if (!mesh.name) mesh.name = named(material.name)
  }
}
