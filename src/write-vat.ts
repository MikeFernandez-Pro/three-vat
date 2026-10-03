// The baked file's writer (ADR-0034, #113): a VAT in, one `.glb` out, through
// three's own `GLTFExporter` and a plugin of this module's.
//
// Public through `three-vat/write` (ADR-0035), a subpath of its own, and the
// bake command's too. It is never reached from the other entry points, which
// is pinned beside the subpath isolation: the exporter would otherwise land in
// every bundle that imports the library.
//
// The glTF holds what it has a name for: the merged geometry as one mesh, a
// primitive per material group, and the materials. Everything else a VAT holds
// goes in the `THREEVAT_vat` extension, and its texels in buffer views of their
// own in the same binary chunk. Nothing goes in `userData`, which the exporter
// writes out as `extras`.
import { Bone, BufferAttribute, Group, Matrix4, Mesh, Skeleton, SkinnedMesh } from 'three'
import type { DataTexture, Material, Object3D } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { BAKED_FILE_EXTENSION, BAKED_FILE_VERSION, BAKED_LAYER_FORMATS, layersOf, positionDigest } from './baked-file.js'
import type { BakedDeltaExtension, BakedFileExtension, BakedLayer, BakedLayerFormat, BakedRigExtension } from './baked-file.js'
import { restSlotsOf } from './bake.js'
import type { RigVAT, VAT } from './types.js'
import { BakedMaterialsWriter, strippedMaterials } from './write-materials.js'
import type { MaterialWriter, SourceImages } from './write-materials.js'

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
 * A textured material's images are copied from `images`, the source file's
 * own bytes (src/write-materials.ts). A rig-encoded VAT is written with a
 * preview skin, and only as `bakeVAT` returned it ({@link previewSkin}).
 */
export async function writeBakedFile(vat: VAT, { images = new Map() }: { images?: SourceImages } = {}): Promise<Uint8Array> {
  // A baked file holds one bake and no record of where an atlas's characters
  // sit (ADR-0040), so an atlas written as one would load as one character and
  // its batch be refused, far from the write that lost the record. Levels need
  // no refusal: a VAT with levels writes its bake, and the levels are made
  // again after loading (ADR-0043).
  if (vat.characters) {
    throw new Error(
      `three-vat: this VAT is an atlas of ${vat.characters.length} characters, and a baked file holds one bake with no record ` +
        'of where each character sits — write each bake to a file of its own, and compose the atlas after loading them',
    )
  }
  const { stripped, originals } = strippedMaterials(vat.materials, images)

  const mesh = vat.encoding === 'rig' ? previewSkin(vat, stripped) : new Mesh(vat.geometry, stripped)
  const exporter = new GLTFExporter()
    .register((writer) => new VATExtensionWriter(writer as unknown as Writer, vat))
    .register((writer) => new BakedMaterialsWriter(writer as unknown as MaterialWriter, originals, images))
  const glb = (await exporter.parseAsync(mesh as Object3D, { binary: true })) as ArrayBuffer
  return new Uint8Array(glb)
}

/** The exporter plugin: records the mesh it wrote, then the extension and its texel buffer views. */
class VATExtensionWriter {
  readonly name = BAKED_FILE_EXTENSION
  private mesh = -1

  constructor(
    private readonly writer: Writer,
    private readonly vat: VAT,
  ) {}

  writeMesh() {
    // Called before the mesh is pushed, so its index is the count so far.
    this.mesh = this.writer.json.meshes?.length ?? 0
  }

  afterParse() {
    const { vat, writer } = this
    const common = {
      version: BAKED_FILE_VERSION,
      mesh: this.mesh,
      groups: vat.geometry.groups.map(({ start, count, materialIndex }) => ({ start, count, materialIndex: materialIndex! })),
      vertexCount: vat.vertexCount,
      totalFrames: vat.totalFrames,
      clips: vat.clips,
      bounds: { min: vat.bounds.min.toArray(), max: vat.bounds.max.toArray() },
      frameBounds: this.floats(vat.frameBounds),
      digest: positionDigest(vat.geometry.attributes.position!),
    }
    const layers = Object.fromEntries(layersOf(vat).map(({ name, texture, format }) => [name, this.layer(texture, format)]))
    const extension: BakedFileExtension =
      vat.encoding === 'rig'
        ? { ...common, encoding: 'rig', slotCount: vat.slotCount, layers: layers as BakedRigExtension['layers'] }
        : {
            ...common,
            encoding: 'delta',
            fallback: vat.fallback,
            rowsPerFrame: vat.rowsPerFrame,
            layers: layers as BakedDeltaExtension['layers'],
          }

    writer.json.extensions = { ...writer.json.extensions, [BAKED_FILE_EXTENSION]: extension }
    writer.extensionsUsed[BAKED_FILE_EXTENSION] = true
  }

  /** Floats as a buffer view of their own, written as the floats they are. */
  private floats(data: Float32Array): number {
    const { componentType } = BAKED_LAYER_FORMATS.RGBA32F // a float, as the rig texture's are
    return this.writer.processBufferView(new BufferAttribute(data, 1), componentType, 0, data.length).id
  }

  /** One texture's texels as a buffer view, stored as its format says, written as the integers or floats they are. */
  private layer(texture: DataTexture, format: BakedLayerFormat): BakedLayer {
    type Texels = Float32Array | Uint16Array | Uint8Array
    const { componentType } = BAKED_LAYER_FORMATS[format]
    const store = BAKED_LAYER_FORMATS[format].store as (texels: Texels, frames: number) => Texels
    const data = store(texture.image.data as unknown as Texels, this.vat.totalFrames)
    const view = this.writer.processBufferView(new BufferAttribute(data, 1), componentType, 0, data.length)
    return { bufferView: view.id, width: texture.image.width, height: texture.image.height, format }
  }
}

/**
 * A rig-encoded VAT as a viewer can show it (ADR-0034): its part-local
 * geometry under a glTF skin whose joints are the slots, each at its rest
 * matrix, with the geometry's `skinIndex` and `skinWeight` as the skin's
 * `JOINTS_0` and `WEIGHTS_0`. A rigid part is already one slot of weight one.
 * The joints sit at the top of the scene, so a joint's transform is its world
 * matrix, and every inverse bind matrix is the identity. A rest matrix is
 * where a part's node puts it, which breaks down into the translation,
 * rotation and scale a glTF node holds wherever the node's own matrix does; a
 * part under an unevenly scaled, rotated parent would preview slightly off,
 * and only preview so.
 *
 * Only a VAT `bakeVAT` or `bakeVATInWorker` returned carries its rest slots;
 * a loaded file is refused rather than written with a skin that shows nothing.
 */
function previewSkin(vat: RigVAT, materials: Material[]): Group {
  const rest = restSlotsOf(vat)
  if (rest === undefined) {
    throw new Error(
      "three-vat: this rig-encoded VAT does not know its slots' rest matrices, which its baked file's preview " +
        'skin is built from. Only a VAT bakeVAT or bakeVATInWorker returned carries them, not one loadVAT read; ' +
        'bake the asset and write that',
    )
  }
  const matrix = new Matrix4()
  const joints = Array.from({ length: vat.slotCount }, (_, slot) => {
    const joint = new Bone()
    joint.name = `slot ${slot}`
    matrix.fromArray(rest, slot * 16).decompose(joint.position, joint.quaternion, joint.scale)
    return joint
  })
  const mesh = new SkinnedMesh(vat.geometry, materials)
  mesh.bind(new Skeleton(joints, joints.map(() => new Matrix4())), new Matrix4())
  return new Group().add(mesh, ...joints)
}
