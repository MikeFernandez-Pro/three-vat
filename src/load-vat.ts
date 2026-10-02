// Loading a baked file (ADR-0034, #113): `loadVAT(url)` turns the `.glb` the
// bake command wrote back into the VAT `bakeVAT` would have returned, so
// `createVATMesh` cannot tell the two apart.
//
// The mechanism is a `GLTFLoader` plugin that reads the `THREEVAT_vat`
// extension, which is why a caller's own configured loader works: the plugin
// is registered on it, and the Draco, meshopt and KTX2 set-up is the caller's.
// Core, beside `bakeVAT`, with no subpath of its own (ADR-0005). `GLTFLoader`
// is three's own, and the exporter is never reached from here.
import { Box3, BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import type { DataTexture, Material, Mesh, Object3D, TypedArray } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { BAKED_FILE_EXTENSION, BAKED_FILE_VERSION, BAKED_LAYER_FORMATS, positionDigest } from './baked-file.js'
import type { BakedFileExtension, BakedLayer } from './baked-file.js'
import type { VAT } from './types.js'

export interface LoadVATOptions {
  /**
   * The loader to read the file with: yours, configured as your page already
   * configures it. A plain `GLTFLoader` when none is passed. The plugin that
   * reads the baked file is registered on it once, and leaves every other
   * file it loads alone.
   */
  loader?: GLTFLoader
  /**
   * Your own materials, to use in place of the file's: one for each
   * `materialIndex`, in that order, as `vat.materials` holds them. Replaces
   * them wholesale, so a crowd is restyled without a re-bake. An array of
   * another length is refused.
   */
  materials?: Material[]
}

/**
 * Load a baked file, written by `npx three-vat bake <input> --out <file>`, as
 * the VAT `bakeVAT` returned when the command baked it: every texel, the clip
 * table with its defaults, the bounds and `fallback`. Hand it to
 * `createVATMesh` exactly as a fresh one.
 *
 * Refuses, by name, a file of another format version, which is to be baked
 * again, and a file whose geometry no longer matches the one its texels are
 * addressed by, which an optimizer that reorders, welds or simplifies vertices
 * is the likely cause of.
 */
export async function loadVAT(url: string, { loader = new GLTFLoader(), materials }: LoadVATOptions = {}): Promise<VAT> {
  if (!withPlugin.has(loader)) {
    loader.register((parser) => new VATPlugin(parser))
    withPlugin.add(loader)
  }
  let gltf: GLTF
  try {
    gltf = await loader.loadAsync(url)
  } catch (error) {
    if (error instanceof Refusal) throw new Error(`three-vat: ${url} ${error.message}`)
    throw error
  }
  const vat = loaded.get(gltf)
  if (vat === undefined) {
    throw new Error(
      `three-vat: ${url} is not a baked file: it carries no ${BAKED_FILE_EXTENSION} extension. ` +
        'Write one with `npx three-vat bake <input> --out <file>`',
    )
  }
  if (materials !== undefined) {
    const plural = (n: number) => `${n} material${n === 1 ? '' : 's'}`
    if (materials.length !== vat.materials.length) {
      throw new Error(
        `three-vat: loadVAT's \`materials\` holds ${plural(materials.length)}, and ${url} has ` +
          `${plural(vat.materials.length)}, one for each materialIndex; pass one for each, in that order`,
      )
    }
    vat.materials = [...materials]
  }
  return vat
}

/** Loaders the plugin is already registered on, so a second `loadVAT` does not register it twice. */
const withPlugin = new WeakSet<GLTFLoader>()

/** Each loaded baked file's VAT, keyed by the result the loader hands `loadVAT`. */
const loaded = new WeakMap<GLTF, VAT>()

/** A refusal of the file, worded to follow its URL, which only `loadVAT` knows. */
class Refusal extends Error {}

/** Reads the extension, if the file has one: its version before anything else, then the VAT. */
class VATPlugin implements GLTFLoaderPlugin {
  readonly name = BAKED_FILE_EXTENSION

  constructor(private readonly parser: GLTFParser) {}

  private get extension(): BakedFileExtension | undefined {
    return (this.parser.json as { extensions?: Record<string, BakedFileExtension> }).extensions?.[BAKED_FILE_EXTENSION]
  }

  beforeRoot() {
    const extension = this.extension
    if (extension !== undefined && extension.version !== BAKED_FILE_VERSION) {
      throw new Refusal(
        `is a baked file of format version ${extension.version}, and this three-vat reads version ${BAKED_FILE_VERSION} only; ` +
          'bake it again with this version of `three-vat bake`',
      )
    }
    return null
  }

  async afterRoot(result: GLTF) {
    const extension = this.extension
    if (extension !== undefined) loaded.set(result, await this.build(extension))
  }

  private async build(extension: BakedFileExtension): Promise<VAT> {
    const node = (await this.parser.getDependency('mesh', extension.mesh)) as Object3D
    const primitives = ((node as Mesh).isMesh ? [node] : node.children) as Mesh[]
    const geometry = mergedGeometry(primitives, extension)

    const materials: Material[] = []
    extension.groups.forEach((group, i) => (materials[group.materialIndex] = primitives[i]!.material as Material))

    const bounds = new Box3(new Vector3().fromArray(extension.bounds.min), new Vector3().fromArray(extension.bounds.max))
    // As the bake leaves them: the union of every frame, for culling.
    geometry.boundingBox = bounds.clone()
    geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())

    const shared = {
      geometry,
      materials,
      clips: extension.clips.map((clip) => ({ ...clip })),
      bounds,
      frameBounds: await this.floats(extension.frameBounds, extension.totalFrames * 6),
      vertexCount: extension.vertexCount,
      totalFrames: extension.totalFrames,
    }
    if (extension.encoding === 'rig') {
      // The skin the file carries is the preview's, and not read (ADR-0034):
      // the slots are the rig texture's, and the skinning attributes come
      // back as they were written, before the loader normalized them for it.
      geometry.setAttribute('skinWeight', await this.writtenWeights(extension.mesh))
      return {
        encoding: 'rig',
        rigTexture: await this.texture(extension.layers.rig, extension.totalFrames),
        slotCount: extension.slotCount,
        ...shared,
      }
    }
    const { position, normal } = extension.layers
    return {
      encoding: 'delta',
      positionTexture: await this.texture(position, extension.totalFrames),
      normalTexture: normal ? await this.texture(normal, extension.totalFrames) : null,
      rowsPerFrame: extension.rowsPerFrame,
      fallback: extension.fallback,
      ...shared,
    }
  }

  /**
   * The skin weights of the mesh's primitives as the file holds them, four
   * floats a vertex, read from the file rather than taken from the geometry:
   * `GLTFLoader` normalizes a skinned primitive's weights in place, and the
   * bake's are the source's, unrounded. That geometry is a view over the loaded buffer view,
   * so the bytes are read from the buffer beneath it, which nothing writes to.
   * The primitives share the attribute, so the first one's is read.
   */
  private async writtenWeights(mesh: number): Promise<BufferAttribute> {
    const json = this.parser.json as {
      meshes: { primitives: { attributes: Record<string, number> }[] }[]
      accessors: { bufferView: number; byteOffset?: number; count: number; componentType: number }[]
      bufferViews: { buffer: number; byteOffset?: number; byteStride?: number }[]
    }
    const accessor = json.accessors[json.meshes[mesh]!.primitives[0]!.attributes['WEIGHTS_0']!]!
    const view = json.bufferViews[accessor.bufferView]!
    // As the writer wrote them: four packed floats. A tool that quantized them
    // rewrote the skinning the rig texture is read through.
    if (accessor.componentType !== 5126 || (view.byteStride ?? 16) !== 16) {
      throw rewritten('its skin weights are no longer the floats the bake wrote')
    }
    const buffer = (await this.parser.getDependency('buffer', view.buffer)) as ArrayBuffer
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    return new BufferAttribute(new Float32Array(buffer.slice(start, start + accessor.count * 16)), 4)
  }

  /** `count` floats from the front of a buffer view, as the writer wrote them. */
  private async floats(bufferView: number, count: number): Promise<Float32Array> {
    const buffer = (await this.parser.getDependency('bufferView', bufferView)) as ArrayBuffer
    if (buffer.byteLength < count * 4) {
      throw new Refusal(`holds ${buffer.byteLength / 4} frame bounds floats where ${count} were written`)
    }
    return new Float32Array(buffer.slice(0, count * 4))
  }

  /** A layer's texels, as stored over `frames` frames, handed to the builder the bake used for that layer. */
  private async texture({ bufferView, width, height, format }: BakedLayer, frames: number): Promise<DataTexture> {
    if (!Object.prototype.hasOwnProperty.call(BAKED_LAYER_FORMATS, format)) {
      throw new Refusal(`holds a texture layer of unknown format "${format as string}"`)
    }
    const { bytesPerTexel, build } = BAKED_LAYER_FORMATS[format]
    const buffer = (await this.parser.getDependency('bufferView', bufferView)) as ArrayBuffer
    // The view is padded to four bytes; the texels are the front of it.
    return build(buffer.slice(0, width * height * bytesPerTexel), width, height, frames)
  }
}

/** The refusal of a geometry that is no longer the one the texels are addressed by, saying how it differs. */
const rewritten = (what: string) =>
  new Refusal(
    `holds a geometry rewritten after the bake: ${what}. Its texels are addressed by the vertex order the bake ` +
      'wrote, so an optimizer that reorders, welds or simplifies vertices (a gltfpack or gltf-transform pass) ' +
      'is the likely cause; bake it again, and keep the baked file out of that step',
  )

/**
 * The merged geometry, back in one piece: the attributes the primitives share,
 * and each primitive's indices as its group's run of the index. Refused where
 * the geometry is no longer the one the texels are addressed by.
 */
function mergedGeometry(primitives: Mesh[], extension: BakedFileExtension): BufferGeometry {
  if (primitives.length !== extension.groups.length) {
    throw rewritten(`${primitives.length} primitives where ${extension.groups.length} were written`)
  }
  const shared = primitives[0]!.geometry
  const position = shared.attributes.position!
  if (position.count !== extension.vertexCount) {
    throw rewritten(`${position.count} vertices where ${extension.vertexCount} were written`)
  }
  if (positionDigest(position) !== extension.digest) throw rewritten('its rest positions no longer match')

  const geometry = new BufferGeometry()
  for (const [name, attribute] of Object.entries(shared.attributes)) geometry.setAttribute(name, attribute)

  const runs = primitives.map((mesh, i) => {
    const index = mesh.geometry.index
    const group = extension.groups[i]!
    if (mesh.geometry.attributes.position !== position || index === null || index.count !== group.count) {
      throw rewritten(`primitive ${i} no longer draws the run of vertices it was written with`)
    }
    return index.array
  })
  const IndexArray = runs[0]!.constructor as new (length: number) => TypedArray
  const indices = new IndexArray(runs.reduce((n, run) => n + run.length, 0))
  extension.groups.forEach((group, i) => indices.set(runs[i]!, group.start))
  geometry.setIndex(new BufferAttribute(indices, 1))
  for (const { start, count, materialIndex } of extension.groups) geometry.addGroup(start, count, materialIndex)
  return geometry
}
