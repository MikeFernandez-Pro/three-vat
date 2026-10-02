// A baked file's materials (ADR-0034, #115), for the writer (src/write-vat.ts),
// and the source images they are written from, read out of a loaded glTF for
// the command (src/cli.ts) and for a page, through `three-vat/write` (ADR-0035).
//
// The exporter writes an image by drawing it to a canvas and encoding it
// again. Node has neither a canvas nor a decoded image to draw. So a textured
// material goes to the exporter with its texture maps stripped, and this
// module's plugin writes each map back onto the material it wrote: the image's
// original bytes, copied from the source file as they are, with the sampler,
// channel and transform the map carries. No image is re-encoded, so none loses
// anything.
//
// The slots are glTF's own five: base colour, normal, emissive, occlusion, and
// metallic-roughness, and the two of KHR_materials_specular (#154): specular
// colour and intensity. A texture anywhere else, or one whose bytes the caller
// did not hand over, is refused by name rather than dropped.
import { LoaderUtils } from 'three'
import type { Material, Texture } from 'three'
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'

/** One image of the source file, as the file held it. */
export interface SourceImage {
  bytes: Uint8Array
  mimeType: string
  name?: string
}

/**
 * How a source texture reaches its image: through its own `source`, through
 * one of the {@link IMAGE_EXTENSIONS}, or both, one the fallback of the other. Copied through
 * in the same shape, so a KTX2 texture stays KTX2.
 */
export interface SourceTexture {
  source?: SourceImage
  extensions: Record<string, SourceImage>
  /** The image-format extensions the source file required. */
  required: string[]
}

/** Each source texture's images, keyed by the image a loaded texture holds, which its clones share. */
export type SourceImages = Map<Texture['source'], SourceTexture>

/** The image-format extensions a glTF texture may reach its image through, beside or instead of its `source`. */
const IMAGE_EXTENSIONS = ['KHR_texture_basisu', 'EXT_texture_webp', 'EXT_texture_avif']

/** An image's type by the extension its URI ends in, where the file names none. */
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  ktx2: 'image/ktx2',
}

interface GLTFTextureDef {
  source?: number
  extensions?: Record<string, { source?: number }>
}

interface GLTFImageDef {
  uri?: string
  bufferView?: number
  mimeType?: string
  name?: string
}

/**
 * How a `.gltf`'s image file beside it is read: its bytes, now or later, for
 * the URI exactly as the `.gltf` writes it.
 */
export type ReadImageFile = (uri: string) => ArrayBuffer | Promise<ArrayBuffer>

/**
 * Every texture the loaded materials hold, keyed by its image, with that
 * image's bytes as the file holds them, for {@link writeBakedFile} to copy
 * into the baked file as they are (ADR-0034). `parser` is the loaded glTF's
 * own (`gltf.parser`): an image in the binary chunk is read through its
 * `getDependency('bufferView', i)`, and a `data:` URI is decoded where it
 * stands. An image in a file beside a `.gltf` is read through `readFile`,
 * which by default fetches it from where the loader found the `.gltf`.
 */
export async function readSourceImages(parser: GLTFParser, readFile: ReadImageFile = fetchBeside(parser)): Promise<SourceImages> {
  const json = parser.json as { textures?: GLTFTextureDef[]; images?: GLTFImageDef[]; extensionsRequired?: string[] }
  const read = new Map<number, SourceImage>()
  const image = async (index: number): Promise<SourceImage> => {
    const cached = read.get(index)
    if (cached) return cached
    const def = json.images![index]!
    const bytes =
      def.bufferView !== undefined
        ? new Uint8Array(((await parser.getDependency('bufferView', def.bufferView)) as ArrayBuffer).slice(0))
        : new Uint8Array(dataURI(def.uri!) ?? (await readFile(def.uri!)))
    const mimeType = def.mimeType ?? mimeTypeOf(def.uri!)
    if (mimeType === undefined) {
      const where = def.uri!.startsWith('data:') ? 'embedded' : def.uri
      throw new Error(`image ${index} (${where}) is of no type a baked file knows`)
    }
    const loaded: SourceImage = { bytes, mimeType, ...(def.name ? { name: def.name } : {}) }
    read.set(index, loaded)
    return loaded
  }

  const images: SourceImages = new Map()
  for (const [object, reference] of parser.associations as Map<unknown, { textures?: number }>) {
    const texture = object as Texture
    if (!texture.isTexture || reference.textures === undefined || images.has(texture.source)) continue
    const def = json.textures![reference.textures]!
    const entry: SourceTexture = { extensions: {}, required: [] }
    if (def.source !== undefined) entry.source = await image(def.source)
    for (const name of IMAGE_EXTENSIONS) {
      const source = def.extensions?.[name]?.source
      if (source === undefined) continue
      entry.extensions[name] = await image(source)
      if (json.extensionsRequired?.includes(name)) entry.required.push(name)
    }
    images.set(texture.source, entry)
  }
  return images
}

/** A `data:` URI's bytes, base64 or percent-encoded; `undefined` for any other URI. */
export function dataURI(uri: string): ArrayBuffer | undefined {
  const data = /^data:([^,]*),(.*)$/s.exec(uri)
  if (!data) return undefined
  if (/;base64$/.test(data[1]!)) return Uint8Array.from(atob(data[2]!), (c) => c.charCodeAt(0)).buffer
  return Uint8Array.from(unescape(data[2]!), (c) => c.charCodeAt(0)).buffer
}

/** The default {@link ReadImageFile}: a fetch of the URI, resolved where the loader found the `.gltf`. */
function fetchBeside(parser: GLTFParser): ReadImageFile {
  const path = (parser.options as { path?: string }).path ?? ''
  return async (uri) => {
    const url = LoaderUtils.resolveURL(uri, path)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`cannot fetch ${url}: ${response.status} ${response.statusText}`)
    return response.arrayBuffer()
  }
}

/** The type a URI names: a `data:` URI's own, or the one its file extension implies. */
function mimeTypeOf(uri: string): string | undefined {
  const data = /^data:([^;,]+)/.exec(uri)
  if (data) return data[1]
  return MIME_TYPES[/\.([^./]+)$/.exec(uri)?.[1]?.toLowerCase() ?? '']
}

/** The material slots a baked file carries a texture in. */
const SLOTS = [
  'map',
  'normalMap',
  'emissiveMap',
  'aoMap',
  'metalnessMap',
  'roughnessMap',
  'specularColorMap',
  'specularIntensityMap',
] as const
type Slot = (typeof SLOTS)[number]

type Textured = Material & Partial<Record<Slot, Texture | null>> & {
  normalScale?: { x: number }
  aoMapIntensity?: number
  specularIntensity?: number
  specularColor?: { toArray(): number[] }
}

/** The sliver of the exporter's writer the materials plugin uses: images and textures, and the buffer views under them. */
export interface MaterialWriter {
  json: {
    images?: unknown[]
    textures?: unknown[]
    bufferViews?: unknown[]
  }
  extensionsUsed: Record<string, boolean>
  extensionsRequired: Record<string, boolean>
  /** Where the next buffer view starts in the binary chunk. */
  byteOffset: number
  processBuffer(buffer: ArrayBuffer): number
  processSampler(texture: Texture): number
  applyTextureTransform(mapDef: object, texture: Texture): void
}

interface TextureInfo {
  index: number
  texCoord: number
  scale?: number
  strength?: number
}

interface MaterialDef {
  pbrMetallicRoughness?: { baseColorTexture?: TextureInfo; metallicRoughnessTexture?: TextureInfo }
  normalTexture?: TextureInfo
  emissiveTexture?: TextureInfo
  occlusionTexture?: TextureInfo
  extensions?: Record<string, unknown>
}

/** glTF's `KHR_materials_specular`, as the exporter writes its factors. */
interface SpecularDef {
  specularFactor: number
  specularColorFactor: number[]
  specularTexture?: TextureInfo
  specularColorTexture?: TextureInfo
}

const SPECULAR = 'KHR_materials_specular'

/**
 * The materials to hand the exporter: each textured one as a copy with its
 * maps stripped, every other as it is. Refuses a texture in a slot a baked
 * file does not carry, or one whose image is not in `images`.
 */
export function strippedMaterials(materials: Material[], images: SourceImages) {
  const originals = new Map<Material, Textured>()
  const stripped = materials.map((material) => {
    const textured = material as Textured
    const keys = Object.keys(material).filter((key) => (textured[key as Slot] as Texture | null)?.isTexture)
    if (keys.length === 0) return material
    for (const key of keys) refuseUncarriedTexture(material, key, textured[key as Slot]!, images)
    const { metalnessMap, roughnessMap } = textured
    if (metalnessMap && roughnessMap && metalnessMap.source !== roughnessMap.source) {
      throw new Error(
        `three-vat: material "${material.name}" reads metalness and roughness from two images, ` +
          'which glTF packs into one; a baked file carries them as its source packed them',
      )
    }
    const copy = material.clone() as Textured
    for (const key of keys) (copy as unknown as Record<string, null>)[key] = null
    originals.set(copy, textured)
    return copy as Material
  })
  return { stripped, originals }
}

/** Refuses a texture in a slot a baked file has no place for, or one with no source bytes to copy. */
function refuseUncarriedTexture(material: Material, key: string, texture: Texture, images: SourceImages) {
  if (!(SLOTS as readonly string[]).includes(key)) {
    throw new Error(
      `three-vat: material "${material.name}" carries a texture in ${key}, which a baked file does not carry; ` +
        `it carries ${SLOTS.join(', ')}`,
    )
  }
  if (!images.has(texture.source)) {
    throw new Error(
      `three-vat: material "${material.name}" carries a texture (${key}) whose image was not read from a glTF source, ` +
        'so there are no bytes to copy into a baked file',
    )
  }
}

/** The exporter plugin: writes a stripped material's maps back, as the source's own image bytes. */
export class BakedMaterialsWriter {
  readonly name = 'three-vat:materials'
  private readonly images = new Map<SourceImage, number>()
  private readonly textures = new Map<string, number>()

  constructor(
    private readonly writer: MaterialWriter,
    private readonly originals: Map<Material, Textured>,
    private readonly sources: SourceImages,
  ) {}

  async writeMaterialAsync(material: Material, def: MaterialDef) {
    const original = this.originals.get(material)
    if (original === undefined) return
    const { map, normalMap, emissiveMap, aoMap, metalnessMap, roughnessMap, specularColorMap, specularIntensityMap } = original
    def.pbrMetallicRoughness ??= {}
    if (map) def.pbrMetallicRoughness.baseColorTexture = this.info(map)
    const metalRough = metalnessMap ?? roughnessMap
    if (metalRough) def.pbrMetallicRoughness.metallicRoughnessTexture = this.info(metalRough)
    if (normalMap) {
      def.normalTexture = this.info(normalMap)
      // The loader keeps glTF's scale in x, sign and all, and flips y itself
      // where it must, so x is the scale the source wrote.
      const scale = original.normalScale!.x
      if (scale !== 1) def.normalTexture.scale = scale
    }
    if (emissiveMap) def.emissiveTexture = this.info(emissiveMap)
    if (aoMap) {
      def.occlusionTexture = this.info(aoMap)
      if (original.aoMapIntensity !== 1) def.occlusionTexture.strength = original.aoMapIntensity!
    }
    if (specularColorMap || specularIntensityMap) {
      // The exporter writes the factors only where they are not glTF's
      // defaults, and the maps it was handed none of: so the extension may
      // not be there yet. Only a MeshPhysicalMaterial has specular maps, and
      // it always has both factors.
      def.extensions ??= {}
      const specular = (def.extensions[SPECULAR] ??= {
        specularFactor: original.specularIntensity!,
        specularColorFactor: original.specularColor!.toArray(),
      }) as SpecularDef
      if (specularIntensityMap) specular.specularTexture = this.info(specularIntensityMap)
      if (specularColorMap) specular.specularColorTexture = this.info(specularColorMap)
      this.writer.extensionsUsed[SPECULAR] = true
    }
  }

  private info(texture: Texture): TextureInfo {
    const info = { index: this.texture(texture), texCoord: texture.channel }
    this.writer.applyTextureTransform(info, texture)
    return info
  }

  /** A texture definition: the source's image layout, with this map's sampler. */
  private texture(texture: Texture): number {
    const { writer } = this
    const { magFilter, minFilter, wrapS, wrapT } = texture
    const key = [texture.source.uuid, texture.name, magFilter, minFilter, wrapS, wrapT].join(':')
    const cached = this.textures.get(key)
    if (cached !== undefined) return cached

    const source = this.sources.get(texture.source)!
    const def: { sampler: number; name?: string; source?: number; extensions?: Record<string, { source: number }> } = {
      sampler: writer.processSampler(texture),
    }
    if (texture.name) def.name = texture.name
    if (source.source) def.source = this.image(source.source)
    for (const [name, image] of Object.entries(source.extensions)) {
      def.extensions = { ...def.extensions, [name]: { source: this.image(image) } }
      writer.extensionsUsed[name] = true
      if (source.required.includes(name)) writer.extensionsRequired[name] = true
    }
    const index = (writer.json.textures ??= []).push(def) - 1
    this.textures.set(key, index)
    return index
  }

  /**
   * An image: its bytes as they were, in a buffer view of its own. Not the
   * exporter's `processBufferViewImage`, whose view spans the padding to four
   * bytes as well, so the image it holds would end in up to three zeros.
   */
  private image(image: SourceImage): number {
    const cached = this.images.get(image)
    if (cached !== undefined) return cached
    const { writer } = this
    const padded = new Uint8Array(Math.ceil(image.bytes.byteLength / 4) * 4)
    padded.set(image.bytes)
    const view = { buffer: writer.processBuffer(padded.buffer), byteOffset: writer.byteOffset, byteLength: image.bytes.byteLength }
    writer.byteOffset += padded.byteLength
    const bufferView = (writer.json.bufferViews ??= []).push(view) - 1
    const def: { mimeType: string; bufferView: number; name?: string } = { mimeType: image.mimeType, bufferView }
    if (image.name) def.name = image.name
    const index = (writer.json.images ??= []).push(def) - 1
    this.images.set(image, index)
    return index
  }
}

/** A material the exporter writes as glTF's one shading model, and what it could not carry over. */
export interface MaterialConversion {
  name: string
  from: string
  lost: string[]
}

/** The materials glTF describes as they are: its PBR, and the basic material it writes as unlit. */
const KEPT = ['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial']

/** What each kind of material loses on the way to glTF's PBR: the properties three's exporter drops. */
const LOST: Record<string, string[]> = {
  MeshPhongMaterial: ['specular', 'shininess'],
}

/**
 * The materials three's exporter converts to PBR: every one but the standard
 * and physical materials glTF describes, and the basic material it writes as
 * unlit. An FBX's Phong and Lambert materials are the ones a bake meets.
 */
export function pbrConversions(materials: Material[]): MaterialConversion[] {
  return materials
    .filter((material) => !KEPT.includes(material.type))
    .map((material) => ({ name: material.name, from: material.type, lost: LOST[material.type] ?? [] }))
}
