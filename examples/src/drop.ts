// What the drop pages decide that is not rendering: which file of a drop is
// the asset and in which format, which dropped file each resource a .gltf
// names is, what a drop the page does not take is told, which choices its
// bake starts from, where each instance of the crowd stands, and the code a
// visitor takes away to reproduce the bake on their own page.
//
// Kept free of three.js and the DOM — like vat-facts, params and spawning, and
// for the same reason: the page's answer to "will it take my file?" is the
// first thing it says to a visitor, so it is asserted in drop.test.ts on plain
// file sets rather than eyeballed with a file dragged onto a browser. A file is
// seen only as its path, and a .gltf as its text too; the page carries the
// bytes beside them.
import { hash } from "./crowd.js";
import { BAKE_DEFAULTS, type BakeChoices } from "./params.js";

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

/** A loaded clip, seen only as the facts that decide whether it is worth baking. */
export interface ClipFacts {
  name: string;
  duration: number;
  trackCount: number;
}

/** Whether a clip starts checked for the bake, and why not when it does not. */
export interface ClipChoice {
  name: string;
  checked: boolean;
  /** What makes an unchecked clip empty, as the page prints it beside the box; `null` for a checked one. */
  reason: string | null;
}

/**
 * Which of an asset's clips start checked. Every clip that animates does; an
 * empty one — zero duration or no tracks, such as Mixamo's `Take 001` — starts
 * unchecked, with what makes it empty. Baked, an empty clip is a band of the
 * rest pose held still: the page would be spending rows on a crowd member
 * that never moves. Unchecked rather than hidden, so a visitor who wants it
 * anyway can have it.
 *
 * One choice per clip, in the order the clips were given.
 */
export function clipChoices(clips: readonly ClipFacts[]): ClipChoice[] {
  return clips.map(({ name, duration, trackCount }) => {
    const why = [duration > 0 ? null : "0 s", trackCount > 0 ? null : "no tracks"].filter((w) => w !== null);
    return why.length === 0
      ? { name, checked: true, reason: null }
      : { name, checked: false, reason: `empty: ${why.join(", ")}` };
  });
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

/** The page's renderer, which decides the decode path a snippet imports (ADR-0011). */
export type DropRenderer = "webgl" | "webgpu";

/** Where the gallery is served: the snippet's link to the worker example is a link a visitor can follow from their own code. */
export const GALLERY_URL = "https://mikefernandez-pro.github.io/three-vat/";

const DECODE_PATH: Readonly<Record<DropRenderer, string>> = { webgl: "three-vat/webgl", webgpu: "three-vat/tsl" };

/** What a snippet is written from: the bake on screen, and the page it is on. */
export interface SnippetInput {
  /** The asset's file, at its path in the drop: what the snippet loads. */
  asset: string;
  format: AssetFormat;
  choices: DropChoices;
  bake: BakeChoices;
  /** Every clip the asset carries, in order, and whether it was baked. */
  clips: readonly { name: string; checked: boolean }[];
  renderer: DropRenderer;
}

/** A string as a single-quoted JavaScript literal: JSON's escapes, with the quotes swapped. */
function quote(text: string): string {
  const inner = JSON.stringify(text).slice(1, -1);
  return `'${inner.replace(/\\.|'/g, (token) => (token === '\\"' ? '"' : token === "'" ? "\\'" : token))}'`;
}

/**
 * The code that reproduces the bake on screen on a visitor's own page: the
 * loader, the `mergeVertices` pass for an FBX the page merged, `bakeVAT` with
 * the checked clips and only the options moved off their defaults, and
 * `createVATMesh` from this page's decode path. What it leaves out it links
 * to: baking in a worker is the worker example's recipe, and it has one home.
 *
 * The clips are named only where some were left out: a bake of every clip is
 * a bake of what the loader handed over. A bake of none still draws, one
 * instance holding the rest pose, because a crowd of none is refused.
 *
 * Plain JavaScript, so it pastes into a `.js` file or a `.ts` one; every
 * shape of it is type-checked against the public API by the release suite
 * (release/packaging/snippet.test.ts).
 */
export function snippetOf({ asset, format, choices, bake, clips, renderer }: SnippetInput): string {
  const fbx = format === "fbx";
  const merge = fbx && choices.mergeVertices === true;
  const loaded = fbx ? "root.animations" : "gltf.animations";

  const imports = [
    ...(merge ? ["import { Mesh } from 'three'"] : []),
    fbx
      ? "import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'"
      : "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'",
    ...(merge ? ["import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'"] : []),
    "import { bakeVAT } from 'three-vat'",
    `import { createVATMesh } from '${DECODE_PATH[renderer]}'`,
  ];

  const load = fbx
    ? [`const root = await new FBXLoader().loadAsync(${quote(`/${asset}`)})`]
    : [
        // The page reads compressed glTF too; a bare loader does not, and the
        // snippet cannot see which compression an asset carries.
        "// A Draco-, meshopt- or KTX2-compressed file needs the loader's decoders set first.",
        `const gltf = await new GLTFLoader().loadAsync(${quote(`/${asset}`)})`,
        "const root = gltf.scene",
      ];
  if (merge) {
    load.push(
      "// FBXLoader builds no index: weld the vertices it repeats before the bake.",
      "root.traverse((o) => {",
      "  if (o instanceof Mesh) o.geometry = mergeVertices(o.geometry)",
      "})",
    );
  }

  const checked = clips.filter((clip) => clip.checked).map((clip) => clip.name);
  const moved = [
    bake.fps !== BAKE_DEFAULTS.fps ? `fps: ${bake.fps}` : null,
    bake.encoding !== BAKE_DEFAULTS.encoding ? `encoding: ${quote(bake.encoding)}` : null,
    bake.mergeFlatMaterials !== BAKE_DEFAULTS.mergeFlatMaterials ? `mergeFlatMaterials: ${bake.mergeFlatMaterials}` : null,
  ].filter((option) => option !== null);
  const options = moved.length > 0 ? `, { ${moved.join(", ")} }` : "";
  const bakeLines = [
    ...(checked.length === 0
      ? [`const vat = bakeVAT(root, []${options})`]
      : [
          checked.length === clips.length
            ? `const clips = ${loaded}`
            : `const clips = ${loaded}.filter((clip) => [${checked.map(quote).join(", ")}].includes(clip.name))`,
          `const vat = bakeVAT(root, clips${options})`,
        ]),
    // The page passed its own GPU's ceiling, which a bare bake assumes is 16 384.
    "// On a GPU below 16 384 (a phone), pass maxTextureSize: getMaxTextureSize(renderer) too.",
  ];

  const crowd = [
    checked.length === 0
      ? "// No clips baked: one instance, holding the rest pose.\nconst instances = [{ clip: { startFrame: 0, frames: 1, fps: 1 }, startTime: 0 }]"
      : "const instances = vat.clips.map((clip) => ({ clip, startTime: 0 }))",
    "const { mesh, time } = createVATMesh(vat, instances)",
    "scene.add(mesh)",
    "// Each frame: time.value += the seconds since the last one.",
  ];

  const worker = [
    "// This bakes on the main thread. To bake in a Web Worker instead, see",
    `// ${GALLERY_URL}${renderer}_worker.html`,
  ];

  return [imports, [...load, ...bakeLines], crowd, worker].map((lines) => lines.join("\n")).join("\n\n") + "\n";
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
