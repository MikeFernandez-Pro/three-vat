// The sewers' surfaces (2026-10-11): stone, brick and tile sets, each a colour
// map and as many of a normal, roughness, metallic, ambient occlusion and
// height map as it came with, in `public/textures/surfaces/<set>/`, and the
// painted floors the woods and the arena lay, colour and normal only. A
// surface is one set laid over its meshes in metres, a tile `scale` metres
// wide, every map read through the same coordinates.
//
// Each map can be switched off to judge the rest without it, through
// uniforms, so a switch recompiles nothing:
// - the colour, off, a plain mid grey;
// - the normal, off, the face's own; read as OpenGL's (green up the image) or
//   DirectX's (green down), the two ways the sets are authored;
// - the roughness and the metallic, off, a value of the folder's own; they
//   show only on the PBR shading, three's standard material, since the toon
//   shell has no roughness or metal;
// - the ambient occlusion, laid over the colour, so it darkens under the torch
//   and the braziers too: three's own AO input reaches only the fill;
// - the height, as parallax: each map read where the surface's relief would
//   put it as the camera sees it, the height's mid grey on the face.
//
// The shading is the toon shell the rats wear, with its strokes over the
// normal map, or three's standard PBR material, for judging the sets as they
// were made. A surface's meshes are drawn twice, once in each, and the
// shading shows the one.
//
// The coordinates come from the geometry, not from three's tangents: every
// vertex carries its uv in metres and, in world space, the way its u and v
// run along the face (`tangentU`, `tangentV`), the meshes standing where they
// were built.
import {
  BufferGeometry,
  DataTexture,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardNodeMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type NodeMaterial,
  type Texture,
} from 'three/webgpu'
import { attribute, cameraPosition, cameraViewMatrix, faceDirection, float, hue, mix, positionWorld, saturation, texture, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import type { ToonLook } from './toon'

/** The maps a set may have. */
export type MapKind = 'color' | 'normal' | 'roughness' | 'metallic' | 'ao' | 'height'

/** A set's maps, each by its file. */
type MapFiles = Partial<Record<MapKind, string>>

/** The downloaded sets and the maps each came with, all but the colour optional. */
const SETS: Record<string, MapKind[]> = {
  bricks_wall_07: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  cliff_rocks_02: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  concrete_slabs_05: ['color', 'normal', 'roughness', 'ao', 'height'],
  floor_tiles_01: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  floor_tiles_04: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  floor_tiles_20: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  ground_stones_03: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  ground_tiles_03: ['color', 'normal', 'roughness', 'ao', 'height'],
  ground_tiles_24: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  stone_bricks_wall_07: ['color', 'normal', 'roughness', 'metallic', 'ao', 'height'],
  stone_wall_01: ['color', 'normal', 'roughness', 'ao', 'height'],
  stone_wall_04: ['color', 'normal', 'roughness', 'ao', 'height'],
}

/** Every surface there is: the downloaded sets, and the painted floors (ground.ts). */
export const SURFACES: Record<string, MapFiles> = {
  ...Object.fromEntries(Object.entries(SETS).map(([name, kinds]) => [name, Object.fromEntries(kinds.map((kind) => [kind, `./textures/surfaces/${name}/${kind}.png`]))])),
  flagstones: { color: './textures/floor.png', normal: './textures/floor-normal.png' },
  earth: { color: './textures/ground.png', normal: './textures/ground-normal.png' },
  dirt: { color: './textures/dirt.png', normal: './textures/dirt-normal.png' },
}

/** What a surface's folder edits. */
export interface SurfaceLook {
  /** Which set is laid, by its name in SURFACES. */
  texture: string
  /** The toon shell, or three's standard material. */
  shading: 'toon' | 'pbr'
  /** How wide one tile is, m. */
  scale: number
  /** Brightness, as a multiplier: 1 the map's own. */
  lightness: number
  /** Colour strength: 1 the map's own, 0 grey. */
  saturation: number
  /** Which way the hue turns, degrees. */
  hue: number
  /** Each map on or off, and what stands in for it off. */
  color: boolean
  normal: boolean
  /** The normal map read as DirectX's: its green flipped. */
  normalDirectX: boolean
  /** How deep the normal map's relief: 1 as authored, 0 flat. */
  relief: number
  roughness: boolean
  /** The roughness with its map off, 0 mirror to 1 matt. */
  roughnessValue: number
  metallic: boolean
  /** The metalness with its map off. */
  metalnessValue: number
  ao: boolean
  /** How much of the ambient occlusion is laid over the colour, 0 none, 1 all. */
  aoStrength: number
  height: boolean
  /** How far the parallax shifts the maps, m, between the height map's black and white. */
  heightDepth: number
  /** The toon shading's shell, painted strokes and steps. */
  shell: ShellLook
  paint: PaintLook
  toon: ToonLook
}

/** A surface: its two materials, the meshes laid in it, and its folder's values. */
export interface Surface {
  readonly toon: ShellToonMaterial
  readonly pbr: MeshStandardNodeMaterial
  /** `geometry` laid in the surface, in both shadings, the folder's showing: built in metres, with `tangentU` and `tangentV`. */
  meshes(geometry: BufferGeometry, cast: boolean): Group
  /** Take the folder's values: a new set is loaded and swapped in, nothing recompiled. */
  set(look: SurfaceLook): void
}

/** What stands in for a map a set lacks: no relief, no metal, no occlusion, a flat height. The roughness's is matt. */
const STAND_INS: Record<Exclude<MapKind, 'color'>, [number, number, number]> = {
  normal: [128, 128, 255],
  roughness: [255, 255, 255],
  metallic: [0, 0, 0],
  ao: [255, 255, 255],
  height: [128, 128, 128],
}
const standIns = Object.fromEntries(
  Object.entries(STAND_INS).map(([kind, [r, g, b]]) => {
    const pixel = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
    pixel.colorSpace = NoColorSpace
    pixel.needsUpdate = true
    return [kind, pixel]
  }),
) as unknown as Record<Exclude<MapKind, 'color'>, Texture>

/** Each map, loaded once asked for, kept after. */
const loaded = new Map<string, Promise<Texture>>()
function load(file: string, colour: boolean): Promise<Texture> {
  let map = loaded.get(file)
  if (!map) {
    map = new TextureLoader().loadAsync(file).then((texture) => {
      texture.wrapS = texture.wrapT = RepeatWrapping
      texture.minFilter = LinearMipmapLinearFilter
      texture.anisotropy = 8
      texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace
      return texture
    })
    loaded.set(file, map)
  }
  return map
}

/** Every map of set `name`, the ones it lacks stood in for. */
async function loadSet(name: string): Promise<Record<MapKind, Texture>> {
  const files = SURFACES[name] ?? SURFACES.flagstones
  const kinds: MapKind[] = ['color', 'normal', 'roughness', 'metallic', 'ao', 'height']
  const maps = await Promise.all(kinds.map((kind) => (files[kind] ? load(files[kind], kind === 'color') : Promise.resolve(standIns[kind as Exclude<MapKind, 'color'>]))))
  return Object.fromEntries(kinds.map((kind, k) => [kind, maps[k]])) as Record<MapKind, Texture>
}

/** A surface laid in set `start.texture`, its uniforms at `start`. */
export async function createSurface(start: SurfaceLook): Promise<Surface> {
  const maps = await loadSet(start.texture)
  let asked = start.texture

  const scale = uniform(1)
  const lightness = uniform(1)
  const saturated = uniform(1)
  const turned = uniform(0)
  const colorOn = uniform(1)
  const normalOn = uniform(1)
  const green = uniform(1)
  const relief = uniform(1)
  const roughnessOn = uniform(1)
  const roughnessValue = uniform(1)
  const metallicOn = uniform(1)
  const metalnessValue = uniform(0)
  const aoOn = uniform(1)
  const heightOn = uniform(1)
  const heightDepth = uniform(0.03)

  // The face's own frame, in the world: u's way, v's way and out of it.
  const along = attribute('tangentU', 'vec3')
  const up = attribute('tangentV', 'vec3')
  // Out of the face toward whichever side is seen: a face drawn on both sides, the dome's, is lit on its outside too.
  const out = attribute('normal', 'vec3').mul(faceDirection)
  const base = uv().div(scale)
  // The parallax: the maps read where the relief over this point would stand
  // as the camera sees it, toward the camera by the height over the face's mid grey.
  // Offset-limited: no division by the slant, so a grazing look shifts no more than a head-on one.
  const heightTexel = texture(maps.height, base)
  const toCamera = cameraPosition.sub(positionWorld).normalize()
  const lift = heightTexel.r.sub(0.5).mul(heightDepth).mul(heightOn)
  const at = base.add(vec2(toCamera.dot(along), toCamera.dot(up)).mul(lift).div(scale))

  const colorTexel = texture(maps.color, at)
  const normalTexel = texture(maps.normal, at)
  const roughnessTexel = texture(maps.roughness, at)
  const metallicTexel = texture(maps.metallic, at)
  const aoTexel = texture(maps.ao, at)
  const texels: Record<MapKind, { value: Texture }> = {
    color: colorTexel,
    normal: normalTexel,
    roughness: roughnessTexel,
    metallic: metallicTexel,
    ao: aoTexel,
    height: heightTexel,
  }

  // The normal map's lean along u and v, scaled by the relief, its green flipped for DirectX's; off, no lean.
  const mapped = normalTexel.xyz.mul(2).sub(1)
  const lean = relief.mul(normalOn)
  const world = along.mul(mapped.x.mul(lean)).add(up.mul(mapped.y.mul(green).mul(lean))).add(out.mul(mapped.z)).normalize()
  const viewNormal = cameraViewMatrix.mul(vec4(world, 0)).xyz.normalize()
  const occlusion = mix(float(1), aoTexel.r, aoOn)
  const colour = mix(vec3(0.5), saturation(hue(colorTexel.rgb, turned), saturated), colorOn).mul(lightness).mul(occlusion)

  // The toon shell paints its strokes over the map's normal; a stroke's density counts per metre.
  const toon = new ShellToonMaterial({ painted: { strokes: createStrokes(), extent: 1, base: viewNormal } })
  toon.colorNode = colour
  const pbr = new MeshStandardNodeMaterial()
  pbr.colorNode = colour
  pbr.normalNode = viewNormal
  pbr.roughnessNode = mix(roughnessValue, roughnessTexel.r, roughnessOn)
  pbr.metalnessNode = mix(metalnessValue, metallicTexel.r, metallicOn)

  const laid: { toon: Mesh; pbr: Mesh }[] = []
  let shading: SurfaceLook['shading'] = start.shading
  const surface: Surface = {
    toon,
    pbr,
    meshes(geometry, cast) {
      const group = new Group()
      const pair = { toon: new Mesh(geometry, toon), pbr: new Mesh(geometry, pbr) }
      for (const mesh of [pair.toon, pair.pbr]) {
        mesh.receiveShadow = true
        mesh.castShadow = cast
        group.add(mesh)
      }
      pair.toon.visible = shading === 'toon'
      pair.pbr.visible = shading === 'pbr'
      laid.push(pair)
      return group
    },
    set(look) {
      scale.value = Math.max(0.05, look.scale)
      lightness.value = look.lightness
      saturated.value = look.saturation
      turned.value = (look.hue * Math.PI) / 180
      colorOn.value = look.color ? 1 : 0
      normalOn.value = look.normal ? 1 : 0
      green.value = look.normalDirectX ? -1 : 1
      relief.value = look.relief
      roughnessOn.value = look.roughness ? 1 : 0
      roughnessValue.value = look.roughnessValue
      metallicOn.value = look.metallic ? 1 : 0
      metalnessValue.value = look.metalnessValue
      aoOn.value = look.ao ? look.aoStrength : 0
      heightOn.value = look.height ? 1 : 0
      heightDepth.value = look.heightDepth
      toon.set(look.shell)
      toon.setPaint(look.paint)
      toon.setToon(look.toon)
      shading = look.shading
      for (const pair of laid) {
        pair.toon.visible = shading === 'toon'
        pair.pbr.visible = shading === 'pbr'
      }
      // Another set: its maps swapped into the same nodes once loaded; a newer ask while one loads wins.
      if (look.texture !== asked) {
        const name = (asked = look.texture)
        void loadSet(name).then((next) => {
          if (asked !== name) return
          for (const kind of Object.keys(texels) as MapKind[]) texels[kind].value = next[kind]
        })
      }
    },
  }
  surface.set(start)
  return surface
}

/** Every material of `surfaces`, for what is done to them all: the see-through's cut. */
export const materialsOf = (...surfaces: Surface[]): NodeMaterial[] => surfaces.flatMap((surface) => [surface.toon, surface.pbr])
