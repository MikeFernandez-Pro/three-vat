// The ground: one flat plane under a tiled, hand-painted floor and its normal
// map, `public/textures/floor.png` and `floor-normal.png`, one set of
// coordinates reading both; or earth, `ground.png` and `ground-normal.png`,
// which the woods start on; or painted dirt, `dirt.png`, on a flat normal map; or one of the hand-painted stylized sets
// in `floors/`, the goose game's, which starts on the grass. The panel's floor folder picks which, and sets how light it is,
// how saturated, which way its hue turns, how big a tile is on the ground, which way it is turned, and how deep its relief,
// through uniforms, so a slider recompiles nothing.
import { LinearMipmapLinearFilter, Mesh, NoColorSpace, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, type Texture } from 'three/webgpu'
import { cameraViewMatrix, hue, positionWorld, saturation, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { ShellToonMaterial } from './shell'
import { createStrokes } from './strokes'

/** How far the plane runs from the centre: past the largest arena, into the fog. */
const EXTENT = 60

/** A hand-painted set's colour and normal map, in public/textures/floors/`set`/. */
const handPainted = (set: string) => ({ map: `./textures/floors/${set}/color.jpg`, normals: `./textures/floors/${set}/normal.jpg` })

/** The floors there are: each a painting and its normal map, in public/textures. */
export const FLOORS = {
  flagstones: { map: './textures/floor.png', normals: './textures/floor-normal.png' },
  earth: { map: './textures/ground.png', normals: './textures/ground-normal.png' },
  // Painted dirt, leaves, twigs, stones and moss: it came with no normal map, so its own is flat.
  dirt: { map: './textures/dirt.png', normals: './textures/dirt-normal.png' },
  // The goose game's hand-painted sets, 2026-10-21, the only floors its folder offers: the Stylized_GrassAndDirt pack's
  // colour and OpenGL normal maps, cut from 4096 to 2048. Its plain starts on the grass.
  stylized_grass_01: handPainted('stylized_grass_01'),
  stylized_dirt_01: handPainted('stylized_dirt_01'),
  stylized_sand_01: handPainted('stylized_sand_01'),
  stylized_stones_02: handPainted('stylized_stones_02'),
}
export type FloorName = keyof typeof FLOORS
/** The floors the goose game's folder offers: the stylized sets. */
export const STYLIZED_FLOORS = (Object.keys(FLOORS) as FloorName[]).filter((name) => name.startsWith('stylized_'))

/** What the floor folder edits. */
export interface FloorLook {
  /** Which floor is laid. */
  texture: FloorName
  /** Brightness, as a multiplier: 1 the painting's own, less darker, more lighter. */
  lightness: number
  /** Colour strength: 1 the painting's own, 0 grey, more richer. */
  saturation: number
  /** How far round the colour wheel its colours turn, degrees: 0 the painting's own. */
  hue: number
  /** How wide one tile of the floor is on the ground, in metres. */
  scale: number
  /** How deep the relief: 1 the normal map as painted, 0 flat, more steeper. */
  relief: number
  /** How far the tiles are turned on the ground, degrees: 0 as painted. */
  rotation: number
}

export interface Floor {
  readonly mesh: Mesh
  /** Its shell, the same material as the rats': the floor folder's shading and toon steps. */
  readonly material: ShellToonMaterial
  /** Take the floor folder's values. */
  set(look: FloorLook): void
}

/** Each floor's painting and normal map, loaded once asked for, kept after. */
const loaded = new Map<FloorName, Promise<[Texture, Texture]>>()
function load(name: FloorName): Promise<[Texture, Texture]> {
  let pair = loaded.get(name)
  if (!pair) {
    const loader = new TextureLoader()
    pair = Promise.all([loader.loadAsync(FLOORS[name].map), loader.loadAsync(FLOORS[name].normals)]).then(([map, normals]) => {
      tile(map).colorSpace = SRGBColorSpace
      tile(normals).colorSpace = NoColorSpace
      return [map, normals]
    })
    loaded.set(name, pair)
  }
  return pair
}

export async function floor(start: FloorName = 'flagstones'): Promise<Floor> {
  const [map, normals] = await load(start)
  /** The floor laid, and the one last asked for: a newer ask while one loads wins. */
  let asked = start

  const lightness = uniform(1)
  const saturated = uniform(1)
  const turned = uniform(0)
  const scale = uniform(1)
  const relief = uniform(1)
  /** The turn's cosine and sine. */
  const turn = uniform(new Vector2(1, 0))

  // The world's x and z turned by the rotation, then scaled to the tile.
  const ground = positionWorld.xz
  const at = vec2(ground.x.mul(turn.x).sub(ground.y.mul(turn.y)), ground.x.mul(turn.y).add(ground.y.mul(turn.x))).div(scale)
  // The map's normal leans east in its red and up the image in its green, its
  // blue out of the floor; up the image is +z on the ground, since the
  // coordinates are the world's x and z, turned back by the rotation. Relief scales the lean.
  const normalTexel = texture(normals, at)
  const mapped = normalTexel.xyz.mul(2).sub(1)
  const leanX = mapped.x.mul(turn.x).add(mapped.y.mul(turn.y))
  const leanZ = mapped.y.mul(turn.x).sub(mapped.x.mul(turn.y))
  const world = vec3(leanX.mul(relief), mapped.z, leanZ.mul(relief)).normalize()
  // The shell paints its strokes over the map's normal, as the camera sees it; a stroke's density counts per metre.
  const material = new ShellToonMaterial({
    painted: { strokes: createStrokes(), extent: 1, base: cameraViewMatrix.mul(vec4(world, 0)).xyz.normalize() },
  })
  const colourTexel = texture(map, at)
  material.colorNode = saturation(hue(colourTexel.rgb, turned), saturated).mul(lightness)

  const mesh = new Mesh(new PlaneGeometry(EXTENT * 2, EXTENT * 2), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true
  return {
    mesh,
    material,
    set(look) {
      lightness.value = look.lightness
      saturated.value = look.saturation
      turned.value = (look.hue * Math.PI) / 180
      scale.value = Math.max(0.05, look.scale)
      relief.value = look.relief
      const angle = (look.rotation * Math.PI) / 180
      turn.value.set(Math.cos(angle), Math.sin(angle))
      // Another floor: its textures swapped into the same nodes once loaded, so nothing recompiles.
      if (look.texture !== asked) {
        const name = (asked = look.texture)
        void load(name).then(([newMap, newNormals]) => {
          if (asked !== name) return
          colourTexel.value = newMap
          normalTexel.value = newNormals
        })
      }
    },
  }
}

/** `texture` set to repeat across the ground, mipmapped and sharp at a slant. */
function tile(texture: Texture): Texture {
  texture.wrapS = texture.wrapT = RepeatWrapping
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 8
  return texture
}
