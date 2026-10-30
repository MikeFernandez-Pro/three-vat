// A texture set's colour and normal map, laid on a material's texture nodes, as
// the cart's wood (cartwood.ts), the dead trees' bark (deadtrees.ts) and the
// graves' stone (graves.prototype.ts) lay theirs: its normal map loaded once
// the set is asked for, its colour only once some of it shows. A set laid all
// plain, its plain share 1, shows its relief alone, so its colour map is never
// fetched until a folder's slider brings some of it back.
import { DataTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu'

/** What stands in for `none`'s maps: no colour of its own, no relief. */
function pixel(r: number, g: number, b: number): Texture {
  const map = new DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
  map.colorSpace = NoColorSpace
  map.needsUpdate = true
  return map
}
export const NO_COLOUR = pixel(255, 255, 255)
export const NO_NORMALS = pixel(128, 128, 255)

/** Each map, loaded once asked for, kept after, tiled. */
const maps = new Map<string, Promise<Texture>>()
export function loadMap(url: string, colour: boolean): Promise<Texture> {
  let map = maps.get(url)
  if (!map) {
    map = new TextureLoader().loadAsync(url).then((loaded) => {
      loaded.wrapS = loaded.wrapT = RepeatWrapping
      loaded.minFilter = LinearMipmapLinearFilter
      loaded.anisotropy = 8
      loaded.colorSpace = colour ? SRGBColorSpace : NoColorSpace
      return loaded
    })
    maps.set(url, map)
  }
  return map
}

/** The nodes a set is laid on: its maps' texture nodes, and the uniforms its share is mixed by. */
export interface SetNodes {
  colours: readonly { value: Texture }[]
  normals: readonly { value: Texture }[]
  /** 1 with a set laid, 0 with none. */
  textured: { value: number }
  /** How much of the plain colour shows in place of the map's, 0 none, 1 all of it. */
  plain: { value: number }
}

/**
 * What lays the set `folder`/`name`/ on `nodes`, `none` no set, with `plain` of the plain colour over its own: its
 * normal map once loaded; its colour map asked for only while `plain` is under 1, all the plain colour showing until
 * it is in. A newer ask while one loads wins.
 */
export function setLayer<N extends string>(folder: string, nodes: SetNodes, load: typeof loadMap = loadMap): (name: N, plain: number) => void {
  let asked: N | undefined
  let share = 1
  /** The set whose colour map the colour nodes hold. */
  let coloured: N | undefined
  return (name, plain) => {
    share = plain
    if (name !== asked) {
      asked = name
      if (name === 'none') {
        for (const node of nodes.normals) node.value = NO_NORMALS
        nodes.textured.value = 0
      } else {
        void load(`${folder}/${name}/normal.webp`, false).then((map) => {
          if (asked !== name) return
          for (const node of nodes.normals) node.value = map
          nodes.textured.value = 1
        })
      }
    }
    nodes.plain.value = coloured === name ? plain : 1
    if (name === 'none' || plain >= 1 || coloured === name) return
    void load(`${folder}/${name}/color.webp`, true).then((map) => {
      if (asked !== name) return
      for (const node of nodes.colours) node.value = map
      coloured = name
      nodes.plain.value = share
    })
  }
}
