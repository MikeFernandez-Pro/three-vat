// The environment maps the panel's environment folder picks from: three's own
// examples' maps, which the dev server lists and serves (tools/envmaps-plugin.ts).
// A map lights the scene's shells as a sky does (shell.ts), and may stand behind
// it in place of the night's colour. A build lists none, and the folder offers
// only `none`.
import { CubeTextureLoader, EquirectangularReflectionMapping, SRGBColorSpace, TextureLoader, type Texture } from 'three/webgpu'
import { HDRCubeTextureLoader } from 'three/examples/jsm/loaders/HDRCubeTextureLoader.js'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { UltraHDRLoader } from 'three/examples/jsm/loaders/UltraHDRLoader.js'
import type { EnvMapEntry } from '../tools/envmaps-plugin'

const ROOT = './envmaps/'

/** What the folder edits: which map, `none` for none; how strongly it lights; whether it is the background, how blurred, and how far it is turned about up, degrees. */
export interface EnvLook {
  map: string
  intensity: number
  background: boolean
  blur: number
  rotation: number
}

/** The maps the dev server offers; none off it. */
export async function listEnvMaps(): Promise<EnvMapEntry[]> {
  try {
    const response = await fetch(`${ROOT}index.json`)
    return response.ok ? ((await response.json()) as EnvMapEntry[]) : []
  } catch {
    return []
  }
}

const loaded = new Map<string, Promise<Texture>>()

/** `entry` as a texture the scene can take as its environment and its background: loaded once, kept after. */
export function loadEnvMap(entry: EnvMapEntry): Promise<Texture> {
  let texture = loaded.get(entry.name)
  if (!texture) {
    texture = read(entry)
    loaded.set(entry.name, texture)
  }
  return texture
}

async function read({ kind, files }: EnvMapEntry): Promise<Texture> {
  const url = `${ROOT}${files[0]}`
  if (kind === 'cube') {
    const cube = await new CubeTextureLoader().setPath(ROOT).loadAsync(files)
    cube.colorSpace = SRGBColorSpace
    return cube
  }
  if (kind === 'cubehdr') return new HDRCubeTextureLoader().setPath(ROOT).loadAsync(files)
  const texture = kind === 'hdr' ? await new HDRLoader().loadAsync(url) : kind === 'ultrahdr' ? await new UltraHDRLoader().loadAsync(url) : await new TextureLoader().loadAsync(url)
  if (kind === 'image') texture.colorSpace = SRGBColorSpace
  texture.mapping = EquirectangularReflectionMapping
  return texture
}
