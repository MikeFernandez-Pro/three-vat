// Slims the game's GLBs in place, from games/last-light: `pnpm models` for
// every file under public/models (not the baked rat), or `pnpm models
// public/models/geese.glb ...` for some. A file already packed is left as it
// is: packing again would round its normals and keys again.
//
// It drops the clips the game never plays (KEEP_CLIPS), the hidden preview
// scenes, the vertex channels nothing reads, and the keyframes a straight
// line between their neighbours already gives; then packs the file with
// meshopt (EXT_meshopt_compression): normals, colours and weights as
// normalised integers, positions and uvs left as floats, so no node, skin or
// hierarchy changes. The game's loader (src/gltf.ts) carries the decoder.
// A clip the code starts playing must go in KEEP_CLIPS before the next run.
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions'
import { dedup, prune, quantize, reorder, resample } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MODELS = join(root, 'public/models')
// Clips the code plays, per file; files not listed keep every clip.
const KEEP_CLIPS = {
  'geese.glb': [
    // the goose (meat.ts)
    'idle', 'run', 'walk', 'jump', 'water_idle', 'swim', 'death',
    // the goslings (goslings.ts, islandgeese.ts)
    'baby_idle', 'baby_idle_scared', 'baby_run', 'baby_run_happy', 'baby_walk', 'baby_water_idle', 'baby_swim', 'baby_jump', 'baby_shake_dry',
  ],
  // islandgeese.ts
  'gooseMother.glb': ['lady_nest_idle', 'lady_idle', 'lady_run_happy'],
  // ghosts.prototype.ts: its panel's rig clips
  'ghostGoose.glb': ['idle', 'water_idle', 'swim', 'walk', 'shake_dry'],
  // meat.ts, on kid-ghosts.html
  'pumpkinKid.glb': ['Idle', 'Run'],
}
// Scenes nobody loads: the default scene stays, these go.
const DROP_SCENES = ['Lady Goose - Preview']
// Read by nothing: three names them color_1.. and uv1, and no material here samples them.
const DROP_ATTRIBUTES = /^(COLOR_[1-9]|TEXCOORD_[1-9])$/
// Read in their vertices' order: deadtrees.ts's thinTips walks justASimpleTree's rings one after the next.
const KEEP_ORDER = /^spooky-\d+\.glb$/

const files = []
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const path = join(d, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (name.endsWith('.glb') && !name.endsWith('.vat.glb')) files.push(path)
  }
}
if (process.argv.length > 2) files.push(...process.argv.slice(2).map((file) => resolve(file)))
else walk(MODELS)

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
let before = 0
let after = 0
for (const path of files) {
  const name = basename(path)
  const size = statSync(path).size
  const doc = await io.read(path)
  const top = doc.getRoot()
  if (top.listExtensionsUsed().some((e) => e.extensionName === 'EXT_meshopt_compression')) {
    console.log(`${relative(MODELS, path).padEnd(32)} packed already`)
    continue
  }

  const keep = KEEP_CLIPS[name]
  const dropped = keep ? top.listAnimations().filter((a) => !keep.includes(a.getName())) : []
  if (keep) {
    const missing = keep.filter((k) => !top.listAnimations().some((a) => a.getName() === k))
    if (missing.length) throw new Error(`${name}: no clip ${missing.join(', ')}`)
  }
  // A disposed animation leaves its channels and samplers, and they keep their accessors.
  for (const a of dropped) {
    for (const c of a.listChannels()) c.dispose()
    for (const sampler of a.listSamplers()) sampler.dispose()
    a.dispose()
  }

  for (const scene of top.listScenes()) {
    if (!DROP_SCENES.includes(scene.getName())) continue
    if (top.getDefaultScene() === scene) throw new Error(`${name}: ${scene.getName()} is the default scene`)
    const nodes = []
    scene.traverse((n) => nodes.push(n))
    scene.dispose()
    // Its meshes too, where no node left draws them, and their primitives, which hold the accessors.
    const meshes = new Set(nodes.map((n) => n.getMesh()).filter(Boolean))
    for (const n of nodes) n.dispose()
    for (const mesh of meshes) {
      if (mesh.listParents().some((p) => p.propertyType === PropertyType.NODE)) continue
      for (const prim of mesh.listPrimitives()) prim.dispose()
      mesh.dispose()
    }
  }

  const attributes = new Set()
  for (const mesh of top.listMeshes())
    for (const prim of mesh.listPrimitives())
      for (const semantic of prim.listSemantics())
        if (DROP_ATTRIBUTES.test(semantic)) {
          attributes.add(semantic)
          prim.setAttribute(semantic, null)
        }

  await doc.transform(
    resample(),
    // Accessors only: the code finds parts by material name, and twin materials would merge.
    dedup({ propertyTypes: [PropertyType.ACCESSOR] }),
    // Only what's now unreferenced: empty nodes stay, the code finds some by name. Attributes stay too: prune's own
    // rule drops any uv no texture samples, and the code reads them.
    prune({ keepAttributes: true, keepLeaves: true, keepExtras: true, propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH, PropertyType.MATERIAL, PropertyType.SKIN, PropertyType.ANIMATION, PropertyType.TEXTURE] }),
    ...(KEEP_ORDER.test(name) ? [] : [reorder({ encoder: MeshoptEncoder, target: 'size' })]),
    // Not POSITION: quantizing it moves each mesh into a unit box and puts the scale on its node or skin, and the
    // code bakes and scales positions in place, which would wrap past [-1, 1]. Not TEXCOORD: deadtrees.ts scales uvs
    // past 1 in place. Not JOINTS: already bytes. No cleanup: its dedup would merge twin skins.
    quantize({ pattern: /^(NORMAL|COLOR_\d|WEIGHTS_\d)$/, quantizeNormal: 10, cleanup: false }),
    // What reorder and quantize replaced.
    prune({ keepAttributes: true, keepLeaves: true, keepExtras: true, propertyTypes: [PropertyType.ACCESSOR] }),
  )
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER })
  await io.write(path, doc)
  const now = statSync(path).size
  before += size
  after += now
  console.log(
    `${relative(MODELS, path).padEnd(32)} ${(size / 1024).toFixed(0).padStart(5)} KB -> ${(now / 1024).toFixed(0).padStart(5)} KB` +
      (dropped.length ? `  clips -${dropped.length}` : '') +
      (attributes.size ? `  ${[...attributes].join(' ')}` : ''),
  )
}
console.log(`total ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`)
