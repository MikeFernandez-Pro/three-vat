// The ground: one flat plane under a tiled, hand-painted floor and its normal
// map, `public/textures/floor.png` and `floor-normal.png`, one set of
// coordinates reading both. The panel's floor folder sets how light it is,
// how saturated, which way its hue turns, how big a tile is on the ground, and how deep its relief,
// through uniforms, so a slider recompiles nothing.
import { LinearMipmapLinearFilter, Mesh, NoColorSpace, PlaneGeometry, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu'
import { cameraViewMatrix, hue, positionWorld, saturation, texture, uniform, vec3, vec4 } from 'three/tsl'
import { ShellToonMaterial } from './shell'
import { createStrokes } from './strokes'

/** How far the plane runs from the centre: past the largest arena, into the fog. */
const EXTENT = 60

/** What the floor folder edits. */
export interface FloorLook {
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
}

export interface Floor {
  readonly mesh: Mesh
  /** Its shell, the same material as the rats': the floor folder's shading and toon steps. */
  readonly material: ShellToonMaterial
  /** Take the floor folder's values. */
  set(look: FloorLook): void
}

export async function floor(): Promise<Floor> {
  const loader = new TextureLoader()
  const [map, normals] = await Promise.all([loader.loadAsync('./textures/floor.png'), loader.loadAsync('./textures/floor-normal.png')])
  tile(map).colorSpace = SRGBColorSpace
  tile(normals).colorSpace = NoColorSpace

  const lightness = uniform(1)
  const saturated = uniform(1)
  const turned = uniform(0)
  const scale = uniform(1)
  const relief = uniform(1)

  const at = positionWorld.xz.div(scale)
  // The map's normal leans east in its red and up the image in its green, its
  // blue out of the floor; up the image is +z on the ground, since the
  // coordinates are the world's x and z. Relief scales the lean.
  const mapped = texture(normals, at).xyz.mul(2).sub(1)
  const world = vec3(mapped.x.mul(relief), mapped.z, mapped.y.mul(relief)).normalize()
  // The shell paints its strokes over the map's normal, as the camera sees it; a stroke's density counts per metre.
  const material = new ShellToonMaterial({
    painted: { strokes: createStrokes(), extent: 1, base: cameraViewMatrix.mul(vec4(world, 0)).xyz.normalize() },
  })
  material.colorNode = saturation(hue(texture(map, at).rgb, turned), saturated).mul(lightness)

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
