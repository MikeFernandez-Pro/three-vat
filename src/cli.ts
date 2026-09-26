// The bake command (ADR-0034, #112): `three-vat bake <input>` bakes an asset in
// Node through the same `bakeVAT` a page calls, and reports what it chose.
//
// A function, not a process: argv in, an exit code out, and every byte read or
// printed through the IO it is handed. The package's `bin` is a shim that hands
// it Node's own (src/bin.ts), and the tests hand it a table in memory. Nothing
// here is reached from a page-facing entry point, which is pinned beside the
// subpath isolation it extends (ADR-0005): the loaders below would otherwise
// land in every bundle that imports the library.
import {
  AnimationMixer,
  InterleavedBufferAttribute,
  LoadingManager,
  LoopOnce,
  LoopPingPong,
  LoopRepeat,
  Texture,
} from 'three'
import type {
  AnimationActionLoopStyles,
  AnimationClip,
  BufferAttribute,
  DataTexture,
  Loader,
  Mesh,
  Object3D,
} from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { deinterleaveAttribute, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { bakeVAT } from './bake.js'
import type { BakeInput, BakeOptions } from './bake.js'
import { EndMode, INFINITE_REPETITIONS, LoopMode } from './instance-playback.js'
import { writeBakedFile } from './write-vat.js'
import type { VAT, VATClip } from './types.js'

/** Everything the command touches outside itself. */
export interface CommandIO {
  /** The directory a relative path is read from. */
  cwd: string
  /** A file's bytes; throws when it cannot be read. */
  readFile(path: string): Uint8Array
  exists(path: string): boolean
  /** Write a file's bytes, replacing it; throws when it cannot be written. */
  writeFile(path: string, bytes: Uint8Array): void
  stdout(text: string): void
  stderr(text: string): void
  /** Milliseconds, for the bake time. Defaults to `performance.now`. */
  now?(): number
}

/** The bake went through, a fallback included. */
export const EXIT_OK = 0
/** The asset was refused: by the bake, or by the byte budget. */
export const EXIT_REFUSED = 1
/** The invocation was: a flag, a config key, a clip name, or an input the command cannot read. */
export const EXIT_USAGE = 2
/** The command itself failed: a bug, reported by the `bin` with its stack. */
export const EXIT_CRASH = 3

/** The config file looked for beside the input when `--config` names none. */
const CONFIG_NAME = 'vat.config.json'

const USAGE = `usage: three-vat bake <input.glb|input.gltf|input.fbx> [flags]

  --fps <n>                 sample rate, default 30
  --clips <name,...>        the clips to bake, default every clip in the file
  --encoding <auto|rig|delta>
  --max-texture-size <n>    the target GPU's largest texture dimension
  --no-normals              drop the vertex encoding's normal layer
  --merge-flat-materials    collapse materials that differ only in colour
  --max-bytes <n>           fail when the VAT's textures exceed this many bytes
  --config <path>           a vat.config.json, default the one beside the input
  --out <path>              also write a baked file, for loadVAT to load
`

/** A refusal the command makes itself, with the exit code it carries. */
class CommandError extends Error {
  constructor(
    message: string,
    readonly code: number,
    /** Whether the usage text follows: for a mistake in the command line, not in a file. */
    readonly showUsage = false,
  ) {
    super(message)
  }
}

const usage = (message: string) => new CommandError(`three-vat: ${message}`, EXIT_USAGE)

// ---------------------------------------------------------------- options --

/** What one bake is asked for, from the flags and the config together. */
interface CommandOptions {
  fps?: number
  clips?: string[]
  encoding?: Encoding
  maxTextureSize?: number
  bakeNormals?: boolean
  mergeFlatMaterials?: boolean
  maxBytes?: number
  clipDefaults?: Record<string, ClipDefaultsEntry>
}

/** One clip's defaults as the config spells them. */
interface ClipDefaultsEntry {
  loopMode?: 'repeat' | 'once' | 'pingpong'
  repetitions?: number
  endMode?: 'clamp' | 'rewind'
  speed?: number
}

interface Invocation {
  input: string
  config?: string
  /** Where write mode writes the baked file; report mode when absent. */
  out?: string
  flags: CommandOptions
}

const ENCODINGS = ['auto', 'rig', 'delta'] as const
type Encoding = (typeof ENCODINGS)[number]

function positiveInteger(name: string, raw: unknown): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw usage(`${name} takes a positive integer, not ${JSON.stringify(raw)}`)
  }
  return value
}

function positiveNumber(name: string, raw: unknown): number {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw usage(`${name} takes a positive number, not ${JSON.stringify(raw)}`)
  }
  return value
}

function encodingOf(name: string, raw: unknown): Encoding {
  if (!ENCODINGS.includes(raw as never)) {
    throw usage(`${name} takes ${ENCODINGS.join(', ')}, not ${JSON.stringify(raw)}`)
  }
  return raw as Encoding
}

/** `bake <input> [flags]`, parsed. Refuses by name anything it does not know. */
function parseArgs(argv: string[]): Invocation {
  const [command, ...rest] = argv
  if (command !== 'bake') {
    throw usage(command === undefined ? 'no command given' : `unknown command "${command}"; the one command is "bake"`)
  }

  const flags: CommandOptions = {}
  let input: string | undefined
  let config: string | undefined
  let out: string | undefined

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (!arg.startsWith('--')) {
      if (input !== undefined) throw usage(`one input at a time: "${input}", then "${arg}"`)
      input = arg
      continue
    }
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const value = (): string => {
      if (eq !== -1) return arg.slice(eq + 1)
      const next = rest[++i]
      if (next === undefined) throw usage(`${flag} takes a value`)
      return next
    }
    const bare = () => {
      if (eq !== -1) throw usage(`${flag} takes no value`)
    }
    switch (flag) {
      case '--fps':
        flags.fps = positiveNumber(flag, value())
        break
      case '--clips':
        flags.clips = value()
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name !== '')
        if (flags.clips.length === 0) throw usage('--clips names no clip')
        break
      case '--encoding':
        flags.encoding = encodingOf(flag, value())
        break
      case '--max-texture-size':
        flags.maxTextureSize = positiveInteger(flag, value())
        break
      case '--no-normals':
        bare()
        flags.bakeNormals = false
        break
      case '--merge-flat-materials':
        bare()
        flags.mergeFlatMaterials = true
        break
      case '--max-bytes':
        flags.maxBytes = positiveInteger(flag, value())
        break
      case '--config':
        config = value()
        break
      case '--out':
        out = value()
        break
      default:
        throw usage(`unknown flag ${flag}`)
    }
  }

  if (input === undefined) throw usage('bake takes an input file')
  return { input, config, out, flags }
}

/** The keys a config entry may carry: the whole-bake options, and the per-clip table. */
const CONFIG_KEYS = [
  'fps',
  'clips',
  'encoding',
  'maxTextureSize',
  'bakeNormals',
  'mergeFlatMaterials',
  'maxBytes',
  'clipDefaults',
]
const CLIP_DEFAULT_KEYS = ['loopMode', 'repetitions', 'endMode', 'speed']
const LOOP_NAMES = ['repeat', 'once', 'pingpong'] as const
const END_NAMES = ['clamp', 'rewind'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** One config entry, checked key by key. JSON only: nothing in it is ever evaluated. */
function parseConfigEntry(where: string, entry: unknown): CommandOptions {
  if (!isRecord(entry)) throw usage(`${where} is not an object`)
  const options: CommandOptions = {}
  for (const [key, raw] of Object.entries(entry)) {
    const name = `${where}.${key}`
    switch (key) {
      case 'fps':
        options.fps = positiveNumber(name, raw)
        break
      case 'clips':
        if (!Array.isArray(raw) || raw.length === 0 || raw.some((c) => typeof c !== 'string')) {
          throw usage(`${name} takes a list of clip names`)
        }
        options.clips = raw as string[]
        break
      case 'encoding':
        options.encoding = encodingOf(name, raw)
        break
      case 'maxTextureSize':
        options.maxTextureSize = positiveInteger(name, raw)
        break
      case 'maxBytes':
        options.maxBytes = positiveInteger(name, raw)
        break
      case 'bakeNormals':
      case 'mergeFlatMaterials':
        if (typeof raw !== 'boolean') throw usage(`${name} takes true or false`)
        options[key] = raw
        break
      case 'clipDefaults':
        if (!isRecord(raw)) throw usage(`${name} is not an object keyed by clip name`)
        options.clipDefaults = {}
        for (const [clip, defaults] of Object.entries(raw)) {
          options.clipDefaults[clip] = parseClipDefaults(`${name}.${clip}`, defaults)
        }
        break
      default:
        throw usage(`unknown config key "${key}" in ${where}; expected one of ${CONFIG_KEYS.join(', ')}`)
    }
  }
  return options
}

function parseClipDefaults(where: string, raw: unknown): ClipDefaultsEntry {
  if (!isRecord(raw)) throw usage(`${where} is not an object`)
  const defaults: ClipDefaultsEntry = {}
  for (const [key, value] of Object.entries(raw)) {
    const name = `${where}.${key}`
    switch (key) {
      case 'loopMode':
        if (!LOOP_NAMES.includes(value as never)) throw usage(`${name} takes ${LOOP_NAMES.join(', ')}`)
        defaults.loopMode = value as ClipDefaultsEntry['loopMode']
        break
      case 'endMode':
        if (!END_NAMES.includes(value as never)) throw usage(`${name} takes ${END_NAMES.join(', ')}`)
        defaults.endMode = value as ClipDefaultsEntry['endMode']
        break
      case 'repetitions':
        defaults.repetitions = positiveInteger(name, value)
        break
      case 'speed':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw usage(`${name} takes a number`)
        defaults.speed = value
        break
      default:
        throw usage(`unknown config key "${key}" in ${where}; expected one of ${CLIP_DEFAULT_KEYS.join(', ')}`)
    }
  }
  return defaults
}

// ------------------------------------------------------------------ paths --

const isAbsolute = (path: string) => /^([A-Za-z]:)?[\\/]/.test(path)

/** `path` against `from`, forward slashes, `.` and `..` resolved. Enough for a file table and for Node. */
function resolvePath(from: string, path: string): string {
  const joined = isAbsolute(path) ? path : `${from.replace(/[\\/]+$/, '')}/${path}`
  // A drive letter, or a UNC share's leading pair, is kept as it stands.
  const drive = /^[A-Za-z]:/.exec(joined)?.[0] ?? (/^[\\/]{2}(?![\\/])/.test(joined) ? '/' : '')
  const parts: string[] = []
  for (const part of joined.slice(drive.length).split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `${drive}/${parts.join('/')}`
}

const dirnameOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '/'

/**
 * The config entry for `input`, if there is one: from `--config`, or from a
 * `vat.config.json` beside the input. Keys name an input relative to the
 * config file's own directory. A config with no entry for this input is not an
 * error — one config serves every asset in its folder.
 */
function readConfig(io: CommandIO, input: string, named: string | undefined) {
  const path = named !== undefined ? resolvePath(io.cwd, named) : resolvePath(dirnameOf(input), CONFIG_NAME)
  if (named === undefined && !io.exists(path)) return { path: null, options: {} }

  let text: string
  try {
    text = new TextDecoder().decode(io.readFile(path))
  } catch (error) {
    throw usage(`cannot read the config ${named ?? path}: ${(error as Error).message}`)
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw usage(`the config ${named ?? path} is not JSON: ${(error as Error).message}`)
  }
  if (!isRecord(json)) throw usage(`the config ${named ?? path} is not an object keyed by input file`)

  const dir = dirnameOf(path)
  for (const [key, entry] of Object.entries(json)) {
    if (resolvePath(dir, key) === input) return { path: named ?? path, options: parseConfigEntry(`"${key}"`, entry) }
  }
  return { path: named ?? path, options: {} }
}

// ---------------------------------------------------------------- loading --

/** A loaded asset, ready for `bakeVAT`. */
interface Loaded {
  root: Object3D
  clips: AnimationClip[]
  /** Every mesh's vertices as the loader built them, before any merge. */
  loadedVertices: number
}

const DRACO = 'KHR_draco_mesh_compression'

/**
 * The bytes in a buffer of their own. A Node `Buffer` may be a window on a
 * pool shared with other reads, and its `.slice()` is another window on it, so
 * neither's `.buffer` is safe to hand a loader.
 */
const ownBuffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer

/** The JSON of a `.glb` or `.gltf`, read without three, so a refusal can be made before a load. */
function gltfJSON(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const isGLB = bytes.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67
  const text = isGLB
    ? new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12, true)))
    : new TextDecoder().decode(bytes)
  const json = JSON.parse(text) as unknown
  if (!isRecord(json)) throw new Error('its JSON is not an object')
  return json
}

const meshesIn = (root: Object3D): Mesh[] => {
  const meshes: Mesh[] = []
  root.traverse((o) => void ((o as Mesh).isMesh && meshes.push(o as Mesh)))
  return meshes
}

const vertexTotal = (root: Object3D) =>
  meshesIn(root).reduce((n, mesh) => n + (mesh.geometry.attributes.position?.count ?? 0), 0)

/**
 * A glTF, loaded the way a page loads it, less the images: a bake only carries
 * materials through, and Node has no image decoder to give them. Every texture
 * is an empty `Texture`, KTX2 included, which is why no KTX2 transcoder is set
 * up — its extension only needs a loader to exist. A `.gltf`'s external
 * buffers are read beside it; its images are never read. Meshopt is decoded on this
 * thread. Draco is refused before the load (ADR-0034): its decoder wants
 * `fetch` and a Worker.
 */
async function loadGLTF(io: CommandIO, input: string, argPath: string, bytes: Uint8Array): Promise<Loaded> {
  let json: Record<string, unknown>
  try {
    json = gltfJSON(bytes)
  } catch (error) {
    throw usage(`cannot read ${argPath} as glTF: ${(error as Error).message}`)
  }
  const used = Array.isArray(json.extensionsUsed) ? (json.extensionsUsed as unknown[]) : []
  if (used.includes(DRACO)) {
    const decoded = argPath.replace(/(\.[^./\\]+)?$/, '.decoded$1')
    throw usage(
      `${argPath} is Draco-compressed (${DRACO}), which the command cannot decode in Node. ` +
        `Decode it first, then bake the result:\n\n  npx @gltf-transform/cli copy ${argPath} ${decoded}\n`,
    )
  }

  // Every buffer is read through the command's IO rather than fetched: Node's
  // `fetch` has no `file:`, and the tests' files live in memory. A GLB's own
  // chunk never reaches this, and a `data:` URI is decoded where it stands.
  const readBuffer = (url: string): ArrayBuffer => {
    const data = /^data:[^,]*;base64,(.*)$/s.exec(url)
    if (data) return Uint8Array.from(atob(data[1]!), (c) => c.charCodeAt(0)).buffer
    return ownBuffer(io.readFile(resolvePath(dirnameOf(input), decodeURIComponent(url))))
  }
  const fileLoader = {
    load(url: string, onLoad: (buffer: ArrayBuffer) => void, _: unknown, onError: (error: unknown) => void) {
      let buffer: ArrayBuffer
      try {
        buffer = readBuffer(url)
      } catch (error) {
        onError(error)
        return
      }
      onLoad(buffer)
    },
  }

  await MeshoptDecoder.ready
  const loader = new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    // Present so a required KHR_texture_basisu does not refuse the file; never
    // called, because no image is decoded.
    .setKTX2Loader({} as never)
    .register((parser: GLTFParser) => {
      const reach = parser as unknown as { fileLoader: unknown; loadImageSource: () => Promise<Texture> }
      reach.fileLoader = fileLoader
      reach.loadImageSource = () => Promise.resolve(new Texture())
      return { name: 'three-vat:read-through-the-command' }
    })
  let gltf: { scene: Object3D; animations: AnimationClip[] }
  try {
    gltf = await loader.parseAsync(ownBuffer(bytes), '')
  } catch (error) {
    throw usage(`cannot load ${argPath}: ${(error as Error).message}`)
  }
  deinterleave(gltf.scene)
  return { root: gltf.scene, clips: gltf.animations, loadedVertices: vertexTotal(gltf.scene) }
}

/**
 * Every interleaved attribute under `root` copied out into a plain one, morph
 * targets included: what gltfpack's meshopt output is made of, and what the
 * bake refuses rather than read wrong. The drop tool does the same on its side
 * (examples/src/asset-file.ts), for the same reason: the baker never changes
 * geometry uninvited (ADR-0031). three's `deinterleaveGeometry` would do it
 * but for the morph targets, which it looks for where r186 does not keep them.
 */
function deinterleave(root: Object3D) {
  // Typed in @types/three 0.186 as taking a geometry and returning nothing;
  // three's source takes the attribute and returns its plain copy.
  const copyOut = deinterleaveAttribute as unknown as (attribute: InterleavedBufferAttribute) => BufferAttribute
  const copies = new Map<InterleavedBufferAttribute, BufferAttribute>()
  const plain = (attribute: BufferAttribute | InterleavedBufferAttribute) => {
    if (!(attribute instanceof InterleavedBufferAttribute)) return attribute
    let copy = copies.get(attribute)
    if (!copy) copies.set(attribute, (copy = copyOut(attribute)))
    return copy
  }
  for (const mesh of meshesIn(root)) {
    const geometry = mesh.geometry
    for (const [name, attribute] of Object.entries(geometry.attributes)) geometry.setAttribute(name, plain(attribute))
    for (const targets of Object.values(geometry.morphAttributes)) {
      targets.forEach((attribute, i) => (targets[i] = plain(attribute)))
    }
  }
}

/** A stand-in for every texture an FBX names: the bake reads none of them. */
class NoImageLoader {
  path = ''
  setPath(path: string) {
    this.path = path
    return this
  }
  load() {
    return new Texture()
  }
}

/**
 * An FBX, loaded as the usage guide's Loading FBX section says: every mesh
 * through `mergeVertices`, because `FBXLoader` never builds an index, and
 * Mixamo's empty `Take 001` left out.
 */
function loadFBX(argPath: string, bytes: Uint8Array): Loaded {
  const manager = new LoadingManager()
  manager.addHandler(/./, new NoImageLoader() as unknown as Loader)
  let root: Object3D & { animations: AnimationClip[] }
  try {
    root = new FBXLoader(manager).parse(ownBuffer(bytes), '') as Object3D & { animations: AnimationClip[] }
  } catch (error) {
    throw usage(`cannot load ${argPath}: ${(error as Error).message}`)
  }
  const loadedVertices = vertexTotal(root)
  for (const mesh of meshesIn(root)) mesh.geometry = mergeVertices(mesh.geometry)
  const clips = root.animations.filter((clip) => !(clip.name === 'Take 001' && clip.tracks.length === 0))
  return { root, clips, loadedVertices }
}

async function load(io: CommandIO, input: string, argPath: string): Promise<Loaded> {
  const extension = /\.([^./\\]+)$/.exec(input)?.[1]?.toLowerCase()
  if (extension !== 'glb' && extension !== 'gltf' && extension !== 'fbx') {
    throw usage(`${argPath} is not a supported format; the command bakes .glb, .gltf and .fbx`)
  }
  let bytes: Uint8Array
  try {
    bytes = io.readFile(input)
  } catch (error) {
    throw usage(`cannot read ${argPath}: ${(error as Error).message}`)
  }
  return extension === 'fbx' ? loadFBX(argPath, bytes) : loadGLTF(io, input, argPath, bytes)
}

// ------------------------------------------------------------------- bake --

const LOOP_STYLES: Record<NonNullable<ClipDefaultsEntry['loopMode']>, AnimationActionLoopStyles> = {
  repeat: LoopRepeat,
  once: LoopOnce,
  pingpong: LoopPingPong,
}

/**
 * The clips to bake, each a bare clip or, where the config gives it defaults,
 * an action configured the way a page would configure one — so the clip table
 * is `bakeVAT`'s own reading of it. The one default an action cannot carry is
 * the end mode, which the bake never reads off one (ADR-0017); it is returned
 * to be written onto the clip table afterwards.
 */
function bakeInputs(loaded: Loaded, options: CommandOptions) {
  const byName = new Map(loaded.clips.map((clip) => [clip.name, clip]))
  const known = () => [...byName.keys()].map((name) => `"${name}"`).join(', ') || 'none'
  const names = options.clips ?? [...byName.keys()]
  for (const name of [...names, ...Object.keys(options.clipDefaults ?? {})]) {
    if (!byName.has(name)) throw usage(`no clip named "${name}"; the file has ${known()}`)
  }

  const mixer = new AnimationMixer(loaded.root)
  const endModes = new Map<string, EndMode>()
  const inputs: BakeInput[] = names.map((name) => {
    const clip = byName.get(name)!
    const defaults = options.clipDefaults?.[name]
    if (defaults === undefined) return clip
    const action = mixer.clipAction(clip)
    if (defaults.loopMode !== undefined) action.loop = LOOP_STYLES[defaults.loopMode]
    if (defaults.repetitions !== undefined) action.repetitions = defaults.repetitions
    if (defaults.speed !== undefined) action.timeScale = defaults.speed
    if (defaults.endMode !== undefined) endModes.set(name, defaults.endMode === 'rewind' ? EndMode.Rewind : EndMode.Clamp)
    return action
  })
  return { inputs, endModes }
}

// ----------------------------------------------------------------- report --

/** Bytes, channel names and precision of every texture layer the VAT holds. */
function layersOf(vat: VAT): { name: string; texture: DataTexture; format: string }[] {
  if (vat.encoding === 'rig') return [{ name: 'rig', texture: vat.rigTexture, format: 'RGBA32F' }]
  const layers = [{ name: 'position', texture: vat.positionTexture, format: 'RGBA16F' }]
  if (vat.normalTexture) layers.push({ name: 'normal', texture: vat.normalTexture, format: 'RG8' })
  return layers
}

const bytesOf = (texture: DataTexture) => (texture.image.data as unknown as ArrayBufferView).byteLength

/** At most two decimals, and none where there are none. */
const round = (n: number) => String(Number(n.toFixed(2)))

function describeDefaults(clip: VATClip): string {
  const times = clip.repetitions === INFINITE_REPETITIONS ? 'forever' : `x${clip.repetitions}`
  const loop =
    clip.loopMode === LoopMode.Once ? 'once' : clip.loopMode === LoopMode.PingPong ? `pingpong ${times}` : `repeat ${times}`
  const end = clip.endMode === EndMode.Rewind ? 'rewind' : 'clamp'
  return `${loop}, ${end}, speed ${round(clip.speed)}`
}

/** A baked file as the report names it: the path it was asked for, and its size. */
interface Written {
  path: string
  bytes: number
}

/** The report: plain text, and the same text for the same bake but for its last line. */
function report(
  argPath: string,
  config: string | null,
  loaded: Loaded,
  vat: VAT,
  ms: number,
  written: Written | null,
): string {
  const lines = [`three-vat bake ${argPath}`, `config: ${config ?? 'none'}`]

  if (vat.encoding === 'rig') {
    lines.push(`encoding: rig, ${vat.slotCount} slot${vat.slotCount === 1 ? '' : 's'}`)
  } else {
    const rows = vat.rowsPerFrame > 1 ? `, ${vat.rowsPerFrame} rows per frame` : ''
    lines.push(`encoding: delta${vat.fallback === null ? '' : ', fallen back from rig'}${rows}`)
    if (vat.fallback !== null) lines.push(`fallback: ${vat.fallback}`)
  }

  lines.push(`clips: ${vat.clips.length}, ${vat.totalFrames} frames`)
  for (const clip of vat.clips) {
    lines.push(`  ${clip.name}: ${clip.frames} frames at ${round(clip.fps)} fps, ${describeDefaults(clip)}`)
  }

  const layers = layersOf(vat)
  lines.push('textures:')
  for (const { name, texture, format } of layers) {
    lines.push(`  ${name}: ${texture.image.width} x ${texture.image.height} ${format}, ${bytesOf(texture)} bytes`)
  }
  lines.push(`  total: ${textureBytes(vat)} bytes`)

  lines.push(`vertices: ${loaded.loadedVertices} as loaded, ${vat.vertexCount} merged`)
  lines.push(`materials: ${vat.materials.length}`)
  if (written) lines.push(`written: ${written.path}, ${written.bytes} bytes`)
  // Its own line, and the last: the one number a diff should ignore.
  lines.push(`bake time: ${Math.round(ms)} ms`)
  return `${lines.join('\n')}\n`
}

const textureBytes = (vat: VAT) => layersOf(vat).reduce((n, { texture }) => n + bytesOf(texture), 0)

// ---------------------------------------------------------------- command --

/**
 * Run `three-vat <argv>`. Resolves to the exit code: {@link EXIT_OK} on a
 * bake, a fallback included; {@link EXIT_REFUSED} when the asset is refused,
 * by the bake or by `--max-bytes`; {@link EXIT_USAGE} when the invocation is —
 * a flag, a config key, a clip name, or an input it cannot read.
 */
export async function runCommand(argv: string[], io: CommandIO): Promise<number> {
  if (argv.length === 0) {
    io.stderr(USAGE)
    return EXIT_USAGE
  }
  // Asked for where a flag could stand, so a clip or a file of that name is not a request for help.
  const [first, ...rest] = argv
  if (first === '--help' || first === '-h' || (first === 'bake' && rest.includes('--help'))) {
    io.stdout(USAGE)
    return EXIT_OK
  }
  try {
    return await bake(argv, io)
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    io.stderr(`${error.message}\n`)
    if (error.showUsage) io.stderr(`\n${USAGE}`)
    return error.code
  }
}

async function bake(argv: string[], io: CommandIO): Promise<number> {
  let invocation: Invocation
  try {
    invocation = parseArgs(argv)
  } catch (error) {
    // A mistake in the command line, answered with the usage; one in a file it
    // read is answered with the mistake alone.
    if (error instanceof CommandError) throw new CommandError(error.message, error.code, true)
    throw error
  }
  const { input: argPath, config: named, out, flags } = invocation
  const input = resolvePath(io.cwd, argPath)
  const config = readConfig(io, input, named)
  // A flag beats the config, key by key.
  const defined = Object.fromEntries(Object.entries(flags).filter(([, v]) => v !== undefined))
  const options: CommandOptions = { ...config.options, ...defined }

  const loaded = await load(io, input, argPath)
  const { inputs, endModes } = bakeInputs(loaded, options)
  const bakeOptions: BakeOptions = {
    fps: options.fps,
    encoding: options.encoding,
    maxTextureSize: options.maxTextureSize,
    bakeNormals: options.bakeNormals,
    mergeFlatMaterials: options.mergeFlatMaterials,
  }

  const now = io.now ?? (() => performance.now())
  const start = now()
  let vat: VAT
  try {
    vat = bakeVAT(loaded.root, inputs, bakeOptions)
  } catch (error) {
    // The bake's own words: one refusal, documented once (ADR-0034).
    throw refusal(error)
  }
  const ms = now() - start
  for (const clip of vat.clips) {
    const endMode = endModes.get(clip.name)
    if (endMode !== undefined) clip.endMode = endMode
  }

  // Refused over budget or by the writer, the report is still printed, since
  // what the bake chose is the diagnosis; and nothing is written.
  const printReport = (written: Written | null) =>
    io.stdout(report(argPath, config.path, loaded, vat, ms, written))
  const bytes = textureBytes(vat)
  if (options.maxBytes !== undefined && bytes > options.maxBytes) {
    printReport(null)
    throw new CommandError(
      `three-vat: the VAT's textures are ${bytes} bytes, over the ${options.maxBytes} --max-bytes allows`,
      EXIT_REFUSED,
    )
  }

  let written: Written | null = null
  if (out !== undefined) {
    let file: Uint8Array
    try {
      file = await writeBakedFile(vat)
    } catch (error) {
      printReport(null)
      throw refusal(error)
    }
    written = writeBakedFileTo(io, out, file)
  }
  printReport(written)
  return EXIT_OK
}

/**
 * A plain `Error` from the bake or the writer is a refusal, and becomes one in
 * its own words. A `TypeError` or its kin is a bug, and is rethrown to crash
 * rather than pass for a verdict on the asset.
 */
function refusal(error: unknown): CommandError {
  if (!(error instanceof Error) || error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError) {
    throw error
  }
  return new CommandError(error.message, EXIT_REFUSED)
}

/** Write mode: the baked file written, at `out` against the working directory. */
function writeBakedFileTo(io: CommandIO, out: string, file: Uint8Array): Written {
  try {
    io.writeFile(resolvePath(io.cwd, out), file)
  } catch (error) {
    throw usage(`cannot write ${out}: ${(error as Error).message}`)
  }
  return { path: out, bytes: file.byteLength }
}
