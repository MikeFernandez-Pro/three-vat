// What the drop pages decide that is not rendering: which file of a drop is
// the asset and in which format, which dropped file each resource a .gltf
// names is, what a drop the page does not take is told, and where each
// instance of the crowd stands.
//
// Kept free of three.js and the DOM — like vat-facts, params and spawning, and
// for the same reason: the page's answer to "will it take my file?" is the
// first thing it says to a visitor, so it is asserted in drop.test.ts on plain
// file sets rather than eyeballed with a file dragged onto a browser. A file is
// seen only as its path, and a .gltf as its text too; the page carries the
// bytes beside them.
import { hash } from "./crowd.js";

/** The asset formats the page loads (ADR-0031): glTF, binary or not, and FBX. */
export type AssetFormat = "gltf" | "fbx";

/** What an extension loads as. The supported formats, and so the refusal's list. */
const FORMAT_OF: Readonly<Record<string, AssetFormat>> = { ".glb": "gltf", ".gltf": "gltf", ".fbx": "fbx" };

/** The extensions the page takes, in the order a refusal names them. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMAT_OF);

/**
 * One dropped file, as the page sees it: where it sat in the drop — its name,
 * or its path under the folder dropped — and its text, read only if it is a
 * `.gltf` whose resources have to be found.
 */
export interface DroppedFile {
  path: string;
  text(): Promise<string>;
}

/**
 * What a drop resolves to: the asset's own file and its format, or why the
 * page will not take it.
 *
 * `resources` answers the LoadingManager's URL modifier for a `.gltf`: each
 * URI the `.gltf` names, exactly as it writes it, to the dropped file it
 * stands for — or to `null` for a texture the drop lacks, which the page
 * stands a blank image in for and `warnings` names. A URI it does not hold is
 * not the drop's to answer (an embedded `data:` URI, the loader's own `blob:`
 * ones). Empty for a `.glb`, which carries what it needs, and for an `.fbx`,
 * whose external textures the page does not look for.
 */
export type DropResolution<F extends DroppedFile> =
  | { ok: true; entry: F; format: AssetFormat; resources: Map<string, F | null>; warnings: string[] }
  | { ok: false; refusal: string };

/** A path's extension, lower-cased, dot included — `""` when it has none. */
function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Which file of a drop is the asset, which loader reads it, and — for a
 * `.gltf` — where in the drop each file it names is.
 *
 * The entry is the first file whose extension is a supported format. A drop
 * with none is refused, and the refusal names the formats the page takes and
 * the files it was given — a visitor who dropped an `.obj` should not be left
 * wondering whether it is still loading.
 *
 * A `.gltf`'s buffers and images are found as a server would find them,
 * against the `.gltf`'s own folder in the drop; failing that, by name alone,
 * because files picked together arrive flat whatever folders the `.gltf`
 * names. A texture still not found is a warning and the asset bakes without
 * it. A buffer still not found is a refusal: there is no geometry without it.
 */
export async function resolveDrop<F extends DroppedFile>(files: readonly F[]): Promise<DropResolution<F>> {
  const entry = files.find((file) => FORMAT_OF[extensionOf(file.path)]);
  if (!entry) {
    const got = files.length === 0 ? "nothing" : files.map((f) => f.path).join(", ");
    return { ok: false, refusal: `this page takes ${SUPPORTED_EXTENSIONS.join(", ")} — got ${got}` };
  }
  const format = FORMAT_OF[extensionOf(entry.path)]!;
  const resources = new Map<string, F | null>();
  const warnings: string[] = [];
  if (extensionOf(entry.path) !== ".gltf") return { ok: true, entry, format, resources, warnings };

  const { buffers, images } = await referencesOf(entry);
  const lacking: string[] = [];
  for (const [uris, required] of [[buffers, true], [images, false]] as const) {
    for (const uri of uris) {
      if (resources.has(uri) || /^(data|blob):/i.test(uri)) continue;
      const found = findResource(files, entry.path, uri);
      if (found) resources.set(uri, found);
      else if (required) {
        if (!lacking.includes(uri)) lacking.push(uri);
      }
      else {
        resources.set(uri, null);
        warnings.push(`${entry.path} refers to ${uri}, which the drop lacks — baked without it`);
      }
    }
  }
  if (lacking.length > 0) {
    return { ok: false, refusal: `${entry.path} needs ${lacking.join(", ")} — drop it with the .gltf` };
  }
  return { ok: true, entry, format, resources, warnings };
}

/**
 * The URIs a `.gltf` names for its buffers and images. Nothing for one that
 * is not JSON: that is the loader's to report, in its own words.
 */
async function referencesOf(entry: DroppedFile): Promise<{ buffers: string[]; images: string[] }> {
  type Refs = { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] };
  let json: Refs;
  try {
    json = JSON.parse(await entry.text()) as Refs;
  } catch {
    return { buffers: [], images: [] };
  }
  const uris = (list: { uri?: unknown }[] | undefined) =>
    (Array.isArray(list) ? list : []).map((item) => item?.uri).filter((uri): uri is string => typeof uri === "string");
  return { buffers: uris(json.buffers), images: uris(json.images) };
}

/** The dropped file a `.gltf` at `entryPath` means by `uri`: beside it by path, or anywhere by name. */
function findResource<F extends DroppedFile>(files: readonly F[], entryPath: string, uri: string): F | undefined {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // A stray `%` in a hand-written URI: take it as the file name it spells.
  }
  const folder = entryPath.slice(0, entryPath.lastIndexOf("/") + 1);
  const path = normalizePath(folder + decoded);
  const beside = files.find((file) => normalizePath(file.path) === path);
  if (beside) return beside;
  const name = path.slice(path.lastIndexOf("/") + 1);
  const named = files.filter((file) => file.path.slice(file.path.lastIndexOf("/") + 1) === name);
  return named.length === 1 ? named[0] : undefined;
}

/** A relative path with its `.` and `..` segments walked, as a server resolves them. */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/");
}

/**
 * Where instance `index` of the crowd stands, as a cell of a square grid.
 *
 * A square spiral out from the centre: the first instance stands in the
 * middle, and each square ring fills before the next begins. So the count
 * slider draws a prefix of the full crowd — nothing is rebuilt behind it, as on
 * the crowd pages — and every prefix is a crowd gathered round the middle
 * rather than a line running off to one side.
 */
export function spiralCell(index: number): { x: number; z: number } {
  if (index === 0) return { x: 0, z: 0 };
  // Ring k holds the 8k cells on the square of side 2k + 1, after the
  // (2k - 1)² cells inside it.
  const k = Math.ceil((Math.sqrt(index + 1) - 1) / 2);
  const j = index - (2 * k - 1) ** 2;
  const side = Math.floor(j / (2 * k));
  const t = j % (2 * k);
  switch (side) {
    case 0:
      return { x: k, z: -k + 1 + t };
    case 1:
      return { x: k - 1 - t, z: k };
    case 2:
      return { x: -k, z: k - 1 - t };
    default:
      return { x: -k + 1 + t, z: -k };
  }
}

/** The only things the crowd needs to know about a baked clip. */
export interface PlayableClip {
  name: string;
  duration: number;
}

const CLIP = 0; // salt: which clip an instance plays
const PHASE = 10_000; // salt: how far into it the instance started

/**
 * What instance `index` of the crowd plays: one of the asset's clips, from a
 * phase inside it, at the clip's own rate. Every clip shows up across a crowd
 * and no two neighbours march in step, so the crowd looks like the workload a
 * visitor would ship rather than a synchronised line. `null` for an asset
 * with no clips — there is nothing to play, and the page holds its first
 * frame.
 */
export function playbackOf<C extends PlayableClip>(
  index: number,
  clips: readonly C[],
): { clip: C; startTime: number; speed: number } | null {
  if (clips.length === 0) return null;
  const clip = clips[Math.floor(hash(index, CLIP) * clips.length)]!;
  return { clip, startTime: -hash(index, PHASE) * clip.duration, speed: 1 };
}
