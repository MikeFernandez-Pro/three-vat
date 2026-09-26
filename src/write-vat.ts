// The baked file's writer (ADR-0034, #113): a VAT in, one `.glb` out, through
// three's own `GLTFExporter` and a plugin of this module's.
//
// Internal. The bake command is its one caller, and whether it is ever exported
// is the drop tool's download ticket to decide (#116). It is never reached from
// a page-facing entry point, which is pinned beside the subpath isolation: the
// exporter would otherwise land in every bundle that imports the library.
//
// The glTF holds what it has a name for: the merged geometry as one mesh, a
// primitive per material group, and the materials. Everything else a VAT holds
// goes in the `THREEVAT_vat` extension, and its texels in buffer views of their
// own in the same binary chunk. Nothing goes in `userData`, which the exporter
// writes out as `extras`.
import { BufferAttribute, Mesh } from 'three'
import type { DataTexture, Material, Object3D, Texture } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { BAKED_FILE_EXTENSION, BAKED_FILE_VERSION, BAKED_LAYER_FORMATS, positionDigest } from './baked-file.js'
import type { BakedFileExtension, BakedLayer, BakedLayerFormat } from './baked-file.js'
import type { DeltaVAT, VAT } from './types.js'

/** The sliver of the exporter's writer the plugin uses. */
interface Writer {
  json: { meshes?: unknown[]; extensions?: Record<string, unknown> }
  extensionsUsed: Record<string, boolean>
  processBufferView(attribute: BufferAttribute, componentType: number, start: number, count: number): { id: number }
}

/**
 * Write `vat` as a baked file. Resolves to the `.glb`'s bytes. In Node, a
 * `FileReader` has to be installed first (src/file-reader.ts): the exporter
 * reads its own output back through one.
 *
 * Refuses a rig-encoded VAT, whose file is #114, and a material carrying a
 * texture, whose image bytes are #115.
 */
export async function writeBakedFile(vat: VAT): Promise<Uint8Array> {
  if (vat.encoding !== 'delta') {
    throw new Error(
      "three-vat: a rig-encoded VAT cannot be written to a baked file yet; bake it with `encoding: 'delta'` (`--encoding delta`)",
    )
  }
  vat.materials.forEach(refuseTextures)

  const mesh = new Mesh(vat.geometry, vat.materials)
  const exporter = new GLTFExporter().register((writer) => new VATExtensionWriter(writer as unknown as Writer, vat))
  const glb = (await exporter.parseAsync(mesh as Object3D, { binary: true })) as ArrayBuffer
  return new Uint8Array(glb)
}

function refuseTextures(material: Material) {
  for (const [key, value] of Object.entries(material)) {
    if ((value as Texture | null)?.isTexture) {
      throw new Error(
        `three-vat: material "${material.name}" carries a texture (${key}), which a baked file cannot carry yet`,
      )
    }
  }
}

/** The exporter plugin: records the mesh it wrote, then the extension and its texel buffer views. */
class VATExtensionWriter {
  readonly name = BAKED_FILE_EXTENSION
  private mesh = -1

  constructor(
    private readonly writer: Writer,
    private readonly vat: DeltaVAT,
  ) {}

  writeMesh() {
    // Called before the mesh is pushed, so its index is the count so far.
    this.mesh = this.writer.json.meshes?.length ?? 0
  }

  afterParse() {
    const { vat, writer } = this
    const extension: BakedFileExtension = {
      version: BAKED_FILE_VERSION,
      encoding: vat.encoding,
      fallback: vat.fallback,
      mesh: this.mesh,
      groups: vat.geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex: materialIndex! })),
      vertexCount: vat.vertexCount,
      totalFrames: vat.totalFrames,
      rowsPerFrame: vat.rowsPerFrame,
      clips: vat.clips,
      bounds: { min: vat.bounds.min.toArray(), max: vat.bounds.max.toArray() },
      digest: positionDigest(vat.geometry.attributes.position!),
      layers: { position: this.layer(vat.positionTexture, 'RGBA16F') },
    }
    if (vat.normalTexture) extension.layers.normal = this.layer(vat.normalTexture, 'RG8')

    writer.json.extensions = { ...writer.json.extensions, [BAKED_FILE_EXTENSION]: extension }
    writer.extensionsUsed[BAKED_FILE_EXTENSION] = true
  }

  /** One texture's texels as a buffer view, written as the integers or floats they are. */
  private layer(texture: DataTexture, format: BakedLayerFormat): BakedLayer {
    const data = texture.image.data as unknown as Uint16Array | Uint8Array
    const { componentType } = BAKED_LAYER_FORMATS[format]
    const view = this.writer.processBufferView(new BufferAttribute(data, 1), componentType, 0, data.length)
    return { bufferView: view.id, width: texture.image.width, height: texture.image.height, format }
  }
}
