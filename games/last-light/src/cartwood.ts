// The cage's cart's wood (goosescenes.ts): a plank set laid on it from three
// sides at once, since its file has no uvs, each side's tiles blended by how
// squarely the face looks along it, and the set's relief laid the same way
// (Ben Golus's whiteout triplanar), in the cart's own units. Its colour and
// normal, for a shell to take; `set` lays the cart wood folder's values on
// them, a set swapped in once loaded.
import { DataTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2, type Texture } from 'three/webgpu'
import { abs, float, hue, materialColor, mix, normalLocal, positionGeometry, pow, renderGroup, saturation, select, texture, transformNormalToView, uniform, vec2, vec3 } from 'three/tsl'
import type { Node } from 'three/webgpu'

/** The plank sets, from the woodTexture download of 2026-10-26: each its colour and OpenGL normal map, in public/textures/wood/`set`/, cut to jpg; `none` the cart's own colour. */
export const CART_WOODS = ['none', 'wood_08', 'wood_11'] as const
export type CartWoodName = (typeof CART_WOODS)[number]

/** What the cart wood folder edits, as the dead trees' bark folder edits theirs. */
export interface CartWoodLook {
  /** Which set is laid, or `none`, the cart's own colour. */
  texture: CartWoodName
  /** Brightness, as a multiplier: 1 the map's own. */
  lightness: number
  /** How much of the cart's own colour shows in place of the map's, 0 none, 1 all of it, the map's relief kept. */
  wood: number
  /** Colour strength: 1 the map's own, 0 grey. */
  saturation: number
  /** How far round the colour wheel its colours turn, degrees. */
  hue: number
  /** How wide one tile is on the cart, m. */
  scale: number
  /** How far the tiles are turned, degrees: 0 as painted, the planks along the cart. */
  rotation: number
  /** How deep the relief: 1 the normal map as painted, 0 flat. */
  relief: number
}

/** wood_11's stylised planks, as the map has them. */
export function defaultCartWood(): CartWoodLook {
  return { texture: 'wood_11', lightness: 1, wood: 0, saturation: 1, hue: 0, scale: 0.8, rotation: 0, relief: 1 }
}

/** What stands in for `none`'s maps: no colour of its own, no relief. */
function pixel(r: number, g: number, b: number): Texture {
  const map = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  map.colorSpace = NoColorSpace
  map.needsUpdate = true
  return map
}
const noWood: [Texture, Texture] = [pixel(255, 255, 255), pixel(128, 128, 255)]

/** Each set's colour and normal map, loaded once asked for, kept after. */
const woods = new Map<CartWoodName, Promise<[Texture, Texture]>>()
function loadWood(name: CartWoodName): Promise<[Texture, Texture]> {
  if (name === 'none') return Promise.resolve(noWood)
  let pair = woods.get(name)
  if (!pair) {
    const loader = new TextureLoader()
    const tile = (map: Texture, colour: boolean) => {
      map.wrapS = map.wrapT = RepeatWrapping
      map.minFilter = LinearMipmapLinearFilter
      map.anisotropy = 8
      map.colorSpace = colour ? SRGBColorSpace : NoColorSpace
      return map
    }
    pair = Promise.all([loader.loadAsync(`./textures/wood/${name}/color.jpg`), loader.loadAsync(`./textures/wood/${name}/normal.jpg`)]).then(([map, normals]): [Texture, Texture] => [tile(map, true), tile(normals, false)])
    woods.set(name, pair)
  }
  return pair
}

export interface CartWood {
  /** The wood's colour, the material's own where no set is laid. */
  color: Node<'vec3'>
  /** The face's normal with the set's relief on it, in view space. */
  normal: Node<'vec3'>
  set(look: CartWoodLook): void
}

/** The wood on a mesh whose own units are `metresPerUnit` m on the ground. */
export function createCartWood(metresPerUnit: number): CartWood {
  // A uniform of the render's group each, since the cart is a still mesh.
  const textured = uniform(0).setGroup(renderGroup)
  const lightness = uniform(1).setGroup(renderGroup)
  const plain = uniform(0).setGroup(renderGroup)
  const saturated = uniform(1).setGroup(renderGroup)
  const turned = uniform(0).setGroup(renderGroup)
  const tile = uniform(1).setGroup(renderGroup)
  const relief = uniform(1).setGroup(renderGroup)
  /** The tiles' turn's cosine and sine. */
  const turn = uniform(new Vector2(1, 0)).setGroup(renderGroup)

  const p = positionGeometry.mul(metresPerUnit).div(tile)
  const n = normalLocal
  // Each side's share: sharply the side the face looks along most.
  const lean = pow(abs(n), vec3(4))
  const share = lean.div(lean.x.add(lean.y).add(lean.z))
  // Which way along each axis the face looks, so the far sides' tiles are not mirrored.
  const side = vec3(select(n.x.lessThan(0), float(-1), float(1)), select(n.y.lessThan(0), float(-1), float(1)), select(n.z.lessThan(0), float(-1), float(1)))
  const turnUv = (at: Node<'vec2'>) => vec2(at.x.mul(turn.x).sub(at.y.mul(turn.y)), at.x.mul(turn.y).add(at.y.mul(turn.x)))
  // The map's lean back out of the turned tile, into the side's own u and v.
  const unturn = (lean: Node<'vec2'>) => vec2(lean.x.mul(turn.x).add(lean.y.mul(turn.y)), lean.y.mul(turn.x).sub(lean.x.mul(turn.y)))
  const [noColour, noNormals] = noWood
  const colours: ReturnType<typeof texture>[] = []
  const normals: ReturnType<typeof texture>[] = []
  /** One side's colour, and its relief as a lean in its u and v, its u flipped with the side. */
  const sideOf = (at: Node<'vec2'>, flip: Node<'float'>) => {
    const turnedAt = turnUv(at)
    const colour = texture(noColour, turnedAt)
    const normal = texture(noNormals, turnedAt)
    colours.push(colour)
    normals.push(normal)
    const m = normal.xyz.mul(2).sub(1)
    const leant = unturn(m.xy.mul(relief).mul(textured))
    return { colour: colour.rgb, tn: vec3(leant.x.mul(flip), leant.y, m.z) }
  }
  const x = sideOf(vec2(p.z.mul(side.x), p.y), side.x)
  const y = sideOf(vec2(p.x.mul(side.y), p.z), side.y)
  const z = sideOf(vec2(p.x.mul(side.z.negate()), p.y), side.z.negate())
  const colour = x.colour.mul(share.x).add(y.colour.mul(share.y)).add(z.colour.mul(share.z))
  // Whiteout: each side's lean over the face's own normal, swizzled back to the cart's axes.
  const nx = vec3(x.tn.xy.add(n.zy), abs(x.tn.z).mul(n.x))
  const ny = vec3(y.tn.xy.add(n.xz), abs(y.tn.z).mul(n.y))
  const nz = vec3(z.tn.xy.add(n.xy), abs(z.tn.z).mul(n.z))
  const local = nx.zyx.mul(share.x).add(ny.xzy.mul(share.y)).add(nz.xyz.mul(share.z)).normalize()
  let asked: CartWoodName | undefined
  return {
    // The cart's own colour, or the set's lit, darkened and turned, or the cart's again over it as much as the folder has it.
    color: mix(materialColor, saturation(hue(colour, turned), saturated).mul(lightness), textured.mul(plain.oneMinus())) as Node<'vec3'>,
    normal: transformNormalToView(local).normalize() as Node<'vec3'>,
    set(look) {
      lightness.value = look.lightness
      plain.value = look.wood
      saturated.value = look.saturation
      turned.value = (look.hue * Math.PI) / 180
      tile.value = Math.max(0.05, look.scale)
      relief.value = look.relief
      const angle = (look.rotation * Math.PI) / 180
      turn.value.set(Math.cos(angle), Math.sin(angle))
      // Another set: its maps swapped into the same nodes once loaded; a newer ask while one loads wins.
      if (look.texture === asked) return
      const name = (asked = look.texture)
      void loadWood(name).then(([map, normal]) => {
        if (asked !== name) return
        for (const c of colours) c.value = map
        for (const c of normals) c.value = normal
        textured.value = name === 'none' ? 0 : 1
      })
    },
  }
}
