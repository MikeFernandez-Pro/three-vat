// A dropped asset, read from its bytes: what the drop pages bake. Shared by
// both pages, like assets.ts beside it — a loader is renderer-agnostic, and a
// glTF is a glTF whichever renderer draws it (ADR-0011).
//
// The bytes are the browser's own copy of the visitor's files. Nothing here, or
// anywhere on the page, sends them anywhere: the loaders parse in memory, and a
// .gltf's resources are handed to them as `blob:` URLs of the dropped files.
import {
  InterleavedBufferAttribute,
  LoadingManager,
  Mesh,
  type AnimationClip,
  type BufferAttribute,
  type BufferGeometry,
  type Object3D,
} from "three";
import * as GeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { DRACOLoader, DRACO_GLTF_CONFIG } from "three/addons/loaders/DRACOLoader.js";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { CharacterAsset } from "./assets.js";
import type { AssetFormat, DroppedFile } from "./drop.js";

/** One file of a drop as the page carries it: the drop module's view of it, and the file itself. */
export interface PageFile extends DroppedFile {
  file: File;
}

function pageFile(path: string, file: File): PageFile {
  return { path, file, text: () => file.text() };
}

/** The files a button picked — one by one, or a folder's, each at its path under the folder. */
export function pickedFiles(list: FileList | null): PageFile[] {
  return [...(list ?? [])].map((file) => pageFile(file.webkitRelativePath || file.name, file));
}

/**
 * The files a drop carries, a dropped folder's included, each at its path in
 * the drop — so a `.gltf` finds `textures/albedo.png` where its exporter put it.
 *
 * The entries are taken while the `drop` event is still being handled: the
 * browser empties the transfer as soon as it returns, and the folders are
 * walked after.
 */
export function droppedFiles(transfer: DataTransfer | null): Promise<PageFile[]> {
  if (!transfer) return Promise.resolve([]);
  const walks = [...transfer.items]
    .filter((item) => item.kind === "file")
    .map((item) => {
      const entry = item.webkitGetAsEntry();
      if (entry) return walk(entry);
      const file = item.getAsFile();
      return Promise.resolve(file ? [pageFile(file.name, file)] : []);
    });
  return Promise.all(walks).then((lists) => lists.flat());
}

/** Every file at or under a dropped entry, at its path in the drop. */
async function walk(entry: FileSystemEntry): Promise<PageFile[]> {
  const path = entry.fullPath.replace(/^\//, "");
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [pageFile(path, file)];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  // A directory reads in batches — Chrome's are a hundred long — until one comes back empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  return (await Promise.all(children.map(walk))).flat();
}

/**
 * What a `.gltf`'s missing texture loads as: one transparent pixel. The drop
 * warns by name that it is missing, and the asset still bakes — the texture
 * is not the bake's business, and without a stand-in the loader rejects the
 * whole asset over it.
 */
const BLANK_IMAGE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Every interleaved attribute under `root` copied out into a plain one, morph
 * targets included — what gltfpack's meshopt output is made of, and what the
 * baker refuses rather than read wrong. On the page's side, as the FBX merge
 * is, because the baker never changes geometry uninvited (ADR-0031).
 * three's `deinterleaveGeometry` would do it but for the morph targets: it
 * reads `geometry.morphTargets`, which r186 does not have.
 */
function deinterleave(root: Object3D) {
  // Typed in @types/three 0.186 as taking a geometry and returning nothing;
  // three's source takes the attribute and returns its plain copy.
  const deinterleaveAttribute = GeometryUtils.deinterleaveAttribute as unknown as (
    attribute: InterleavedBufferAttribute,
  ) => BufferAttribute;
  const copies = new Map<InterleavedBufferAttribute, BufferAttribute>();
  const plain = (attribute: BufferAttribute | InterleavedBufferAttribute) => {
    if (!(attribute instanceof InterleavedBufferAttribute)) return attribute;
    let copy = copies.get(attribute);
    if (!copy) copies.set(attribute, (copy = deinterleaveAttribute(attribute)));
    return copy;
  };
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry as BufferGeometry;
    for (const [name, attribute] of Object.entries(geometry.attributes)) geometry.setAttribute(name, plain(attribute));
    for (const targets of Object.values(geometry.morphAttributes)) {
      targets.forEach((attribute, i) => (targets[i] = plain(attribute)));
    }
  });
}

/** The renderer the KTX2 transcoder asks which compressed formats it can upload. */
type Renderer = Parameters<KTX2Loader["detectSupport"]>[0];

/**
 * The page's reader: GLTFLoader with the Draco, meshopt and KTX2 decoders,
 * and FBXLoader. One per page, because the Draco and KTX2 loaders each keep a
 * pool of workers and their decoder once it is fetched.
 *
 * The decoders are three's own files, from the pinned package: the loaders
 * find them next to themselves (`new URL(…, import.meta.url)`), and the build
 * copies them beside the chunks, so they always match the loader's version.
 * Fetched only when an asset needs one.
 */
export function createAssetReader(renderer: Renderer) {
  const draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
  const ktx2 = new KTX2Loader().detectSupport(renderer);

  /**
   * Parse an asset's bytes in the format the drop resolved, and hand back the
   * subtree to bake, world matrices up to date, with every clip it carries.
   *
   * `resources` is the drop's answer for each URI a `.gltf` names: the loader
   * asks for it through a LoadingManager's URL modifier, as it would ask a
   * server, and gets the dropped file — or a blank image for a missing
   * texture. A URI the drop does not answer (an embedded `data:` URI, the
   * loader's own `blob:` ones) goes through as it is.
   *
   * Throws what the loader throws: the page shows that message and keeps the
   * crowd it had.
   */
  return async function parseAsset(
    bytes: ArrayBuffer,
    format: AssetFormat,
    resources: ReadonlyMap<string, PageFile | null> = new Map(),
  ): Promise<CharacterAsset> {
    const urls: string[] = [];
    const manager = new LoadingManager().setURLModifier((url) => {
      if (!resources.has(url)) return url;
      const found = resources.get(url);
      if (!found) return BLANK_IMAGE;
      const blob = URL.createObjectURL(found.file);
      urls.push(blob);
      return blob;
    });
    try {
      let root: Object3D;
      let clips: AnimationClip[];
      if (format === "fbx") {
        root = new FBXLoader(manager).parse(bytes, "");
        clips = root.animations;
      } else {
        // A KTX2 texture a .gltf names by URI is fetched by the KTX2 loader,
        // through its own manager: it has to be the drop's too.
        ktx2.manager = manager;
        const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
        // Parsed at the path `""`, so each URI reaches the URL modifier
        // exactly as the .gltf writes it, which is how `resources` is keyed.
        const gltf = await loader.parseAsync(bytes, "");
        root = gltf.scene;
        clips = gltf.animations;
      }
      deinterleave(root);
      root.updateMatrixWorld(true);
      return { root, clips };
    } finally {
      // Every texture is decoded by the time the parse settles.
      for (const url of urls) URL.revokeObjectURL(url);
    }
  };
}

/** Every mesh's vertices, summed: what a bake of this subtree carries across. */
function vertexTotal(meshes: readonly Mesh[]): number {
  return meshes.reduce((n, mesh) => n + mesh.geometry.attributes.position!.count, 0);
}

/**
 * Weld every mesh's shared vertices in place, as the usage guide's Loading FBX
 * section does, and say how many there were before. How many are left is the
 * bake's to say: the HUD reads it off the VAT, as it does for any asset. Here
 * and not in the baker, which never changes geometry uninvited (ADR-0031): the
 * merge is the page's choice, made where the visitor can see and undo it.
 */
export function mergeAssetVertices(root: Object3D): number {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if ((object as Mesh).isMesh) meshes.push(object as Mesh);
  });
  const before = vertexTotal(meshes);
  for (const mesh of meshes) {
    const unmerged = mesh.geometry;
    mesh.geometry = GeometryUtils.mergeVertices(unmerged);
    unmerged.dispose();
  }
  return before;
}
