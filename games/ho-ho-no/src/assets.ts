// Everything the game downloads before Play, with progress for the loader. The
// original's `Resources`, with meshopt decoding added: every model the game
// ships is meshopt-compressed, the camp from 8.5 MB to 1.4 MB. The crowds are
// two baked files, which the game's `bake` script wrote before the build:
// loading them is the download and nothing more, and no bake ever runs in the
// browser.
import {
  ClampToEdgeWrapping,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { loadVAT, type VAT } from 'three-vat'

export interface Assets {
  /** The colour atlas every model's UVs index into. */
  gradient: Texture
  /** The toon ramp: five flat tones. */
  fiveTone: Texture
  /** The floor's voronoi noise. */
  voronoi: Texture
  character: GLTF
  camp: GLTF
  snowBall: GLTF
  arenaCollider: GLTF
  /** The horde's VAT, baked from the skull. */
  skeleton: VAT
  /** The elves' VAT. */
  elf: VAT
}

/** Load every asset; `onProgress` gets the share loaded, 0 to 1, as each one lands. */
export async function loadAssets(onProgress: (share: number) => void): Promise<Assets> {
  const textures = new TextureLoader()
  const models = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

  const jobs = {
    gradient: textures.loadAsync('textures/gradient.png'),
    fiveTone: textures.loadAsync('textures/fiveTone.jpg'),
    voronoi: textures.loadAsync('textures/voronoi.png'),
    character: models.loadAsync('models/character.glb'),
    camp: models.loadAsync('models/camp.glb'),
    snowBall: models.loadAsync('models/snowBall.glb'),
    arenaCollider: models.loadAsync('models/arenaCollider.glb'),
    skeleton: loadVAT('models/skeleton.vat.glb', { loader: models }),
    elf: loadVAT('models/elf.vat.glb', { loader: models }),
  }
  const entries = Object.entries(jobs)
  let loaded = 0
  onProgress(0)
  const settled = await Promise.all(
    entries.map(async ([name, job]) => {
      const value = await job
      onProgress(++loaded / entries.length)
      return [name, value] as const
    }),
  )
  const assets = Object.fromEntries(settled) as unknown as Assets

  // The atlas is read by glTF UVs, which run the other way up from an image.
  assets.gradient.colorSpace = SRGBColorSpace
  assets.gradient.flipY = false

  // Five hard steps: nearest, or the ramp blurs into a gradient.
  const ramp = assets.fiveTone
  ramp.colorSpace = SRGBColorSpace
  ramp.flipY = false
  ramp.minFilter = NearestFilter
  ramp.magFilter = NearestFilter
  ramp.wrapS = ClampToEdgeWrapping
  ramp.wrapT = ClampToEdgeWrapping
  ramp.generateMipmaps = false

  // Data, not colour, and tiled across the floor.
  assets.voronoi.colorSpace = NoColorSpace
  assets.voronoi.wrapS = RepeatWrapping
  assets.voronoi.wrapT = RepeatWrapping

  return assets
}
