// PROTOTYPE — throwaway. See ./README.md and issue #47.
//
// One crowd, five decodes, one sweep button. Everything on screen is measured
// or derived from a bake; nothing here is a number that was typed in.
//
// Deliberate deviations from the shipped demo, all of which change the absolute
// numbers and none of which change the ratio the issue is asking about:
//
//   - No shadows. A shadow pass draws the crowd a second time and would fold
//     two measurements into one.
//   - A fixed camera and static instance matrices. The demo moves its robots on
//     the CPU each frame; here that would be CPU noise on a GPU measurement.
//   - Its own ring layout rather than `crowd.ts`, whose band table names
//     RobotExpressive's clips and would throw on Soldier.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { bakeVAT, createVATPlaybackTexture } from 'three-vat'
import type { VATClip, VATInstance, VATPlaybackTexture } from 'three-vat'
import { getMaxTextureSize, patchVATMaterial } from 'three-vat/webgl'
import { bakeBones, BoneEncodingRefusal, TEXELS_PER_SLOT } from './bake-bones.js'
import type { BoneBake } from './bake-bones.js'
import { patchBoneMaterial, VARIANTS } from './decode.js'
import type { VariantName } from './decode.js'
import { createGpuTimer, runSweep, SATURATION_MS } from './bench.js'
import type { SweepResult } from './bench.js'

// ------------------------------------------------------------------ inputs
const url = new URL(location.href)
const ASSETS = {
  robot: { file: 'RobotExpressive.glb', clips: ['Idle', 'Walking', 'Running'], height: 1.8 },
  soldier: { file: 'Soldier.glb', clips: ['Idle', 'Walk', 'Run'], height: 1.8 },
} as const
type AssetName = keyof typeof ASSETS

const assetName = (url.searchParams.get('asset') ?? 'robot') as AssetName
const asset = ASSETS[assetName] ?? ASSETS.robot
const MAX_COUNT = Number(url.searchParams.get('max') ?? 340)
const BENCH_COUNTS = [340, MAX_COUNT].filter((n, i, a) => a.indexOf(n) === i && n > 0)
let variant = (url.searchParams.get('enc') ?? 'vat') as VariantName

const el = (id: string) => document.getElementById(id)!
const status = (text: string) => {
  el('status').textContent = text
}

// ------------------------------------------------------------------ stage
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
renderer.setPixelRatio(1) // pinned: a retina pixel ratio would time a different frame
renderer.setSize(innerWidth, innerHeight)
document.getElementById('stage')!.append(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x11141a)
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x30302a, 2.0))
const sun = new THREE.DirectionalLight(0xffffff, 1.6)
sun.position.set(20, 30, 15)
scene.add(sun)

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 400)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// ------------------------------------------------------------------ asset
status(`loading ${asset.file}…`)
const gltf = await new GLTFLoader().loadAsync(`../${asset.file}`)
gltf.scene.updateMatrixWorld(true)
const clips = gltf.animations.filter((c) => (asset.clips as readonly string[]).includes(c.name))
if (clips.length === 0) {
  throw new Error(
    `prototype: none of ${asset.clips.join(', ')} are in ${asset.file} — it has ` +
      gltf.animations.map((a) => a.name).join(', '),
  )
}

const maxTextureSize = getMaxTextureSize(renderer)

// ------------------------------------------------------------------ bakes
// The control, and the four encodings. Both 30 fps bakes and both 60 fps ones
// are built whether or not their variant is on screen, because the memory and
// bake-time columns are part of the answer and a reader should not have to
// visit four URLs to fill in a table.
status('baking the VAT (control)…')
const vatStarted = performance.now()
const vat = bakeVAT(gltf.scene, clips, { fps: 30, maxTextureSize })
const vatBakeMs = performance.now() - vatStarted
const vatBytes =
  (vat.positionTexture.image.data as Float32Array).byteLength +
  ((vat.normalTexture?.image.data as Float32Array | undefined)?.byteLength ?? 0)

const bones = {} as Record<Exclude<VariantName, 'vat'>, BoneBake>
for (const [name, spec] of Object.entries(VARIANTS)) {
  if (name === 'vat' || !spec.format) continue
  status(`baking ${name}…`)
  bones[name as Exclude<VariantName, 'vat'>] = bakeBones(gltf.scene, clips, {
    fps: spec.fps,
    format: spec.format,
    maxTextureSize,
    // Not the shipped behaviour — see `onMorphAnimation`. The refusal is
    // exercised for real, and reported, in `refusalReport()` below; this is
    // how the *timing* still happens on an asset the refusal would stop dead.
    onMorphAnimation: 'drop',
  })
}

// ------------------------------------------------------------------ layout
// Scale and footprint from the VAT's all-frames bounds, so every variant places
// its crowd identically and the A/B toggle compares poses, not positions.
const size = vat.bounds.getSize(new THREE.Vector3())
const scale = asset.height / size.y
const footprint = Math.max(size.x, size.z) * scale * 1.25

/** Concentric rings, innermost first — enough to fill a frame reproducibly. */
function layout(count: number) {
  const placed: { x: number; z: number; angle: number }[] = []
  let ring = 0
  while (placed.length < count) {
    const radius = ring === 0 ? 0 : ring * footprint * 1.15
    const slots = ring === 0 ? 1 : Math.max(1, Math.floor((2 * Math.PI * radius) / footprint))
    for (let s = 0; s < slots && placed.length < count; s++) {
      const angle = (s / slots) * Math.PI * 2
      placed.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, angle: -angle })
    }
    ring++
  }
  return placed
}

const places = layout(MAX_COUNT)
const extent = Math.max(...places.map((p) => Math.hypot(p.x, p.z))) + footprint
camera.position.set(0, extent * 0.55, extent * 1.25)
camera.lookAt(0, asset.height * 0.5, 0)

/**
 * One instance per place: a clip off the table and a start time a little way
 * back, which is the whole of what desyncs a crowd. Seeded rather than random,
 * so two runs of the sweep measure the same crowd.
 */
function instancesFor(table: VATClip[]): VATInstance[] {
  let seed = 1
  const next = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  return places.map(() => ({
    clip: table[Math.floor(next() * table.length)]!,
    startTime: -next() * 4,
    speed: 0.9 + next() * 0.3,
  }))
}

// ------------------------------------------------------------------ crowds
interface Crowd {
  mesh: THREE.InstancedMesh
  playback: VATPlaybackTexture
}

const time = { value: 0 }
const crowds = {} as Record<VariantName, Crowd>

function place(mesh: THREE.InstancedMesh) {
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const s = new THREE.Vector3().setScalar(scale)
  places.forEach((p, i) => {
    q.setFromAxisAngle(up, p.angle)
    mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, 0, p.z), q, s))
  })
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
}

// The control, built from the shipped primitives rather than `createVATMesh`,
// only so it shares this page's clock and reads as the sibling of the four
// below. The decode it runs is the shipped one, untouched.
{
  const playback = createVATPlaybackTexture(instancesFor(vat.clips))
  const materials = vat.materials.map((m) => patchVATMaterial(m.clone(), vat, { uVatTime: time }, playback))
  const mesh = new THREE.InstancedMesh(vat.geometry, materials, MAX_COUNT)
  place(mesh)
  crowds.vat = { mesh, playback }
}

for (const name of Object.keys(bones) as Exclude<VariantName, 'vat'>[]) {
  const bake = bones[name]
  const playback = createVATPlaybackTexture(instancesFor(bake.clips))
  const materials = bake.materials.map((m) => patchBoneMaterial(m.clone(), bake, name, time, playback))
  const geometry = bake.geometry
  geometry.boundingBox = bake.bounds.clone()
  geometry.boundingSphere = bake.bounds.getBoundingSphere(new THREE.Sphere())
  const mesh = new THREE.InstancedMesh(geometry, materials, MAX_COUNT)
  place(mesh)
  crowds[name] = { mesh, playback }
}

let count = Math.min(340, MAX_COUNT)
function show(name: VariantName, n = count) {
  variant = name
  count = n
  for (const [key, crowd] of Object.entries(crowds)) {
    crowd.mesh.visible = key === name
    crowd.mesh.count = n
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-variant]')) {
    button.classList.toggle('on', button.dataset.variant === name)
  }
  el('now').textContent = `${VARIANTS[name].label} — ${VARIANTS[name].fetches} texel fetches per vertex — ${n} instances`
  el('now-note').textContent = VARIANTS[name].note
}
for (const crowd of Object.values(crowds)) scene.add(crowd.mesh)

// ------------------------------------------------------------------ refusal
// The check the issue asks to see: bake the asset with *every* clip it ships,
// and report what the encoding says about the ones it cannot store.
function refusalReport(): string {
  try {
    bakeBones(gltf.scene, gltf.animations, {
      fps: 30,
      format: 'mat4',
      maxTextureSize,
      onMorphAnimation: 'refuse',
    })
    const morphing = gltf.animations.filter((c) =>
      c.tracks.some((t) => t.name.includes('morphTargetInfluences')),
    )
    return morphing.length > 0
      ? `NOT REFUSED, and it should have been — ${morphing.map((c) => c.name).join(', ')} animate morph targets.`
      : `No refusal: not one of ${asset.file}'s ${gltf.animations.length} clips animates a morph target, ` +
          'so there is nothing here the encoding cannot store. (Try ?asset=robot.)'
  } catch (error) {
    if (error instanceof BoneEncodingRefusal) return `REFUSED — ${error.message}`
    return `Threw something else: ${String(error)}`
  }
}

// ------------------------------------------------------------------ tables
function bytes(n: number): string {
  const units = ['B', 'kB', 'MB', 'GB']
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function costTable(): string {
  const rows = [
    `| encoding | texture | vs VAT | rows | width | bake |`,
    `| --- | --- | --- | --- | --- | --- |`,
    `| VAT (control) | ${bytes(vatBytes)} | 1.00x | ${vat.totalFrames} | ${vat.vertexCount} verts | ${vatBakeMs.toFixed(0)} ms |`,
  ]
  for (const name of Object.keys(bones) as Exclude<VariantName, 'vat'>[]) {
    const b = bones[name]
    rows.push(
      `| ${name} | ${bytes(b.bytes)} | ${(b.bytes / vatBytes).toFixed(4)}x | ${b.totalFrames} | ` +
        `${b.slotCount} slots x ${TEXELS_PER_SLOT[b.format]} | ${b.bakeMs.toFixed(0)} ms |`,
    )
  }
  return rows.join('\n')
}

function resultTable(results: SweepResult[]): string {
  // The control is the *best* VAT frame at the same count, because the best
  // frame is the statistic the rows are ranked on — see `SweepResult.min`.
  const control = new Map(results.filter((r) => r.variant === 'vat').map((r) => [r.count, r.min]))
  const rows = [
    `| encoding | instances | best ms | vs VAT | median | max | n | |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- |`,
  ]
  for (const r of results) {
    const base = control.get(r.count)
    const ratio = base && Number.isFinite(base) ? `${(r.min / base).toFixed(2)}x` : '—'
    rows.push(
      `| ${r.variant} | ${r.count} | ${r.min.toFixed(3)} | ${ratio} | ${r.median.toFixed(3)} | ` +
        `${r.max.toFixed(3)} | ${r.samples} | ${r.saturated ? '**SATURATED**' : ''} |`,
    )
  }
  if (results.some((r) => r.saturated)) {
    rows.push(
      '',
      `Rows marked SATURATED spent more than ${SATURATION_MS} ms a frame and were fighting the ` +
        'display cadence. Every number in such a row is an upper bound, and the ratio between two ' +
        'of them says nothing — both are pinned against the same ceiling.',
    )
  }
  return rows.join('\n')
}

/**
 * The real GPU, not "WebKit WebGL" — `RENDERER` is masked unless the debug
 * extension is asked for, and a frame time is meaningless without knowing
 * which chip produced it.
 */
function gpuName(gl: WebGL2RenderingContext): string {
  const debug = gl.getExtension('WEBGL_debug_renderer_info')
  const unmasked = debug ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string) : null
  return unmasked ?? (gl.getParameter(gl.RENDERER) as string)
}

// ------------------------------------------------------------------ loop
let running = true
const clock = new THREE.Clock()
function frame() {
  time.value = clock.getElapsedTime()
  renderer.render(scene, camera)
}
renderer.setAnimationLoop(() => {
  if (running) frame()
})

// ------------------------------------------------------------------ controls
const variantBar = el('variants')
for (const [name, spec] of Object.entries(VARIANTS)) {
  const button = document.createElement('button')
  button.dataset.variant = name
  button.textContent = `${spec.label} · ${spec.fetches}`
  button.onclick = () => show(name as VariantName)
  variantBar.append(button)
}

const countInput = el('count') as HTMLInputElement
countInput.max = String(MAX_COUNT)
countInput.value = String(count)
countInput.oninput = () => show(variant, Number(countInput.value))

el('sweep').addEventListener('click', async () => {
  const button = el('sweep') as HTMLButtonElement
  button.disabled = true
  running = false
  const gl = renderer.getContext() as WebGL2RenderingContext
  const FALLBACK_RENDERS = 8
  const timer = createGpuTimer(gl, FALLBACK_RENDERS)
  el('method').textContent =
    timer.method === 'gpu-query'
      ? 'timed with EXT_disjoint_timer_query_webgl2 — real GPU milliseconds'
      : `no GPU timer in this browser — wall clock around ${FALLBACK_RENDERS} renders and a finish(); read the ratios, not the absolutes`

  const steps = BENCH_COUNTS.flatMap((n) =>
    (Object.keys(VARIANTS) as VariantName[]).map((v) => ({ variant: v, count: n })),
  )
  const results = await runSweep({
    steps,
    apply: (step) => show(step.variant as VariantName, step.count),
    render: frame,
    timer,
    warmup: 45,
    frames: 90,
    fallbackRenders: FALLBACK_RENDERS,
    onProgress: status,
  })
  timer.dispose()

  const report =
    `## ${asset.file} — ${assetName}\n\n` +
    `${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} · ${gpuName(gl)}\n\n` +
    `**Frame time** (${timer.method}, best of ${90})\n\n${resultTable(results)}\n\n` +
    `**Cost of the bake**\n\n${costTable()}\n\n` +
    `**Refusal**\n\n${refusalReport()}\n\n` +
    (Object.values(bones).some((b) => b.nonUniformBones.length > 0)
      ? `**Non-uniform bone scale** (quat+trans cannot store it): ` +
        `${[...new Set(Object.values(bones).flatMap((b) => b.nonUniformBones))].join(', ')}\n`
      : `**Non-uniform bone scale**: none in this asset.\n`)

  ;(el('report') as HTMLTextAreaElement).value = report
  el('report-wrap').classList.remove('hidden')
  status('done — copy the report onto issue #47')
  button.disabled = false
  running = true
})

el('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText((el('report') as HTMLTextAreaElement).value)
  status('report copied')
})

// ------------------------------------------------------------------ first paint
// Whatever the bone bakes had to leave behind, at the top of the page rather
// than in a footnote: every frame time below was measured on this mesh.
const dropped = [...new Set(Object.values(bones).flatMap((b) => b.droppedParts))]
if (dropped.length > 0) {
  el('dropped').textContent =
    `The bone bakes are missing ${dropped.join(', ')} — ${dropped.length === 1 ? 'its' : 'their'} ` +
    'morph targets are animated by these clips, which the encoding cannot store. The VAT control ' +
    'still renders the whole mesh, so the bone variants are timed on slightly less geometry. ' +
    'See “What the encoding refuses”.'
  el('dropped-wrap').classList.remove('hidden')
}

el('cost').textContent = costTable()
el('refusal').textContent = refusalReport()
show(variant)
status(`${asset.file} · ${vat.vertexCount} verts · ${Object.values(bones)[0]?.slotCount ?? 0} slots · ready`)
