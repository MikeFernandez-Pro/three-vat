// What the drop pages decide that is not rendering: which file of a drop is
// the asset and in which format, what a drop the page does not take is told,
// which choices its bake starts from, and where each instance of the crowd
// stands.
//
// Kept free of three.js and the DOM — like vat-facts, params and spawning, and
// for the same reason: the page's answer to "will it take my file?" is the
// first thing it says to a visitor, so it is asserted in drop.test.ts on plain
// file sets rather than eyeballed with a file dragged onto a browser. A file is
// seen only as its path; the page carries the bytes beside it.
import { hash } from "./crowd.js";

/** The asset formats the page loads (ADR-0031): glTF, binary or not, and FBX. */
export type AssetFormat = "gltf" | "fbx";

/** What an extension loads as. The supported formats, and so the refusal's list. */
const FORMAT_OF: Readonly<Record<string, AssetFormat>> = { ".glb": "gltf", ".gltf": "gltf", ".fbx": "fbx" };

/** The extensions the page takes, in the order a refusal names them. */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.keys(FORMAT_OF);

/** One dropped file, as the page sees it before reading it: where it sat in the drop. */
export interface DroppedFile {
  path: string;
}

/** What a drop resolves to: the asset's own file and its format, or why the page will not take it. */
export type DropResolution<F extends DroppedFile> =
  | { ok: true; entry: F; format: AssetFormat }
  | { ok: false; refusal: string };

/** A path's extension, lower-cased, dot included — `""` when it has none. */
function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * Which file of a drop is the asset, and which loader reads it.
 *
 * The entry is the first file whose extension is a supported format. A drop
 * with none is refused, and the refusal names the formats the page takes and
 * the files it was given — a visitor who dropped an `.obj` should not be left
 * wondering whether it is still loading.
 */
export function resolveDrop<F extends DroppedFile>(files: readonly F[]): DropResolution<F> {
  for (const entry of files) {
    const format = FORMAT_OF[extensionOf(entry.path)];
    if (format) return { ok: true, entry, format };
  }
  const got = files.length === 0 ? "nothing" : files.map((f) => f.path).join(", ");
  return { ok: false, refusal: `this page takes ${SUPPORTED_EXTENSIONS.join(", ")} — got ${got}` };
}

/**
 * What a visitor chooses about a bake before it runs. A choice the format does
 * not offer is absent, not false: the page shows no control for it.
 */
export interface DropChoices {
  /**
   * Run `mergeVertices` over every mesh before the bake. FBX only: FBXLoader
   * never builds an index, so Samba arrives as 165 960 vertices and merges to
   * 35 440 — and the baker never changes geometry uninvited (ADR-0031), so the
   * page does it on its own side. glTF keeps its index, and has nothing to merge.
   */
  mergeVertices?: boolean;
}

/** The choices a fresh drop in `format` starts from: FBX merged, glTF with nothing to choose. */
export function defaultChoices(format: AssetFormat): DropChoices {
  return format === "fbx" ? { mergeVertices: true } : {};
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
