// What the simulation's tests draw with: the game's own baked files, read in
// Node through the library's `loadVAT` as the browser reads them, so the clips
// and their playback defaults are the bake config's and nothing written here;
// and the game's own rows over a real `InstancedMesh` for the horde, so a
// spawn is numbered as the game numbers it — the lowest freed row first.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BoxGeometry, InstancedMesh, MeshBasicMaterial, Texture } from 'three'
import { GLTFLoader, type GLTF, type GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createVATPlaybackTexture, loadVAT, type VAT } from 'three-vat'
import { InstanceRows } from '../instance-rows'
import { elfClipsOf, type ElfClips } from './elves'
import { SKELETON_CAPACITY, skeletonClipsOf, type SkeletonClips, type SkeletonCrowd } from './horde'
import { createSimulation, type Simulation, type SimulationInput, type SimulationOptions } from './simulation'

/** The character's own `shoot` clip, as character.glb ships it. */
export const SHOOT_CLIP = 0.6083
export const FPS = 60

export const idle: SimulationInput = { move: { x: 0, z: 0 }, aim: null, fire: false }

/** Step `sim` at 60 Hz from `from` for `seconds`, feeding `input(t)`; returns the time reached. */
export function run(sim: Simulation, from: number, seconds: number, input: (t: number) => SimulationInput = () => idle) {
  const start = Math.round(from * FPS)
  const frames = Math.round(seconds * FPS)
  for (let frame = 1; frame <= frames; frame++) {
    const t = (start + frame) / FPS
    sim.step(t, input(t))
  }
  return (start + frames) / FPS
}

/**
 * Behind Santa's back as the tests aim him — south-west of the camp — so a
 * test about something else never shoots or meets a skeleton by chance.
 */
const OUT_OF_THE_WAY = () => 0.625

/**
 * A `GLTFLoader` that reads from the disk, which Node's `fetch` cannot, and
 * decodes no image, which Node cannot either: the skull's baked file carries
 * its texture, and the game draws its own.
 */
class DiskLoader extends GLTFLoader {
  constructor() {
    super()
    this.register((parser: GLTFParser) => {
      ;(parser as unknown as { loadImageSource: () => Promise<Texture> }).loadImageSource = () => Promise.resolve(new Texture())
      return { name: 'ho-ho-no:no-images' }
    })
  }

  override load(url: string, onLoad: (gltf: GLTF) => void, _: unknown, onError?: (error: unknown) => void): void {
    let bytes: Buffer
    try {
      bytes = readFileSync(url)
    } catch (error) {
      onError?.(new Error(`${url} is not baked: run \`pnpm --filter ho-ho-no bake\` (${(error as Error).message})`))
      return
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    this.parse(buffer, '', onLoad, onError)
  }
}

const baked = (name: string) => fileURLToPath(new URL(`../../public/models/${name}`, import.meta.url))

const loads = new Map<string, Promise<VAT>>()
function load(name: string): Promise<VAT> {
  // Three's loaders reach for `self`, which Node has not got.
  ;(globalThis as { self?: unknown }).self ??= globalThis
  let vat = loads.get(name)
  if (!vat) loads.set(name, (vat = loadVAT(baked(name), { loader: new DiskLoader() })))
  return vat
}

export async function skeletonClips(): Promise<SkeletonClips> {
  return skeletonClipsOf(await load('skeleton.vat.glb'))
}

export async function elfClips(): Promise<ElfClips> {
  return elfClipsOf(await load('elf.vat.glb'))
}

/** A horde on a fresh carrier: the game's rows over a real `InstancedMesh`, and a playback texture over them. */
export async function testCrowd(): Promise<SkeletonCrowd & { rows: InstanceRows }> {
  return {
    clips: await skeletonClips(),
    playback: createVATPlaybackTexture([], { capacity: SKELETON_CAPACITY }),
    rows: new InstanceRows(new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), SKELETON_CAPACITY)),
  }
}

/** A simulation on the game's own clips, its horde on a fresh carrier, spawning out of the way unless told where. */
export async function simulate(options: Partial<SimulationOptions> = {}) {
  const crowd = await testCrowd()
  const simulation = await createSimulation({
    shootClipDuration: SHOOT_CLIP,
    skeletons: crowd,
    elves: await elfClips(),
    random: OUT_OF_THE_WAY,
    ...options,
  })
  return { simulation, crowd }
}
