// PROTOTYPE — throwaway. See README.md beside this file.
//
// The question: can a three-vat crowd ride on `@three.ez/instanced-mesh`'s
// `InstancedMesh2`, so the library gets per-instance culling and LOD for free?
//
// The experiment: lay the crowd out in a grid and pick each robot's clip from
// its **grid column**, so a correct render is a set of clean vertical stripes —
// Dance | Idle | Wave, repeating. Any mismatch between "which instance am I"
// and "which playback slot did I read" scrambles the stripes, and scrambles
// them differently as the camera moves. The pattern is the instrument.
import {
  AmbientLight,
  Box3,
  Clock,
  Color,
  DirectionalLight,
  Fog,
  InstancedMesh,
  Matrix4,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { InstancedMesh2 } from '@three.ez/instanced-mesh'
import { addVATInstanceAttributes, bakeVAT, type VAT, type VATInstance } from 'three-vat'
import {
  createVATMesh,
  createVATUniforms,
  getMaxTextureSize,
  patchVATMaterial,
} from 'three-vat/webgl'

const CLIPS = ['Dance', 'Idle', 'Wave'] as const
const COLS = 20
const ROWS = 17
const COUNT = COLS * ROWS
const SPACING = 1.6

type Mode = 'plain' | 'ez-culled' | 'ez-unculled'

const hud = document.getElementById('hud') as HTMLElement
const verdict = document.getElementById('verdict') as HTMLElement

const renderer = new WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)

const scene = new Scene()
scene.background = new Color(0x0f1115)
scene.fog = new Fog(0x0f1115, 30, 80)
scene.add(new AmbientLight(0xffffff, 1.4))
const sun = new DirectionalLight(0xffffff, 2.2)
sun.position.set(5, 10, 7)
scene.add(sun)

const camera = new PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, 9, 26)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1, 0)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

// --- the crowd, described once, built three ways -----------------------------

/** Column decides the clip: a correct crowd is vertical stripes. */
const clipOf = (i: number) => (i % COLS) % CLIPS.length

const matrixOf = (() => {
  const m = new Matrix4()
  const p = new Vector3()
  return (i: number, scale: number) => {
    const col = i % COLS
    const row = (i / COLS) | 0
    p.set((col - (COLS - 1) / 2) * SPACING, 0, (row - (ROWS - 1) / 2) * SPACING)
    return m.makeScale(scale, scale, scale).setPosition(p)
  }
})()

const instancesFor = (vat: VAT): VATInstance[] =>
  Array.from({ length: COUNT }, (_, i) => ({
    clip: vat.clips[clipOf(i)],
    // Desync, so a scrambled stripe cannot be mistaken for robots simply out of
    // phase with each other.
    startTime: -((i * 0.137) % 2),
    speed: 1,
  }))

function buildPlain(vat: VAT, scale: number) {
  const { mesh, time } = createVATMesh(vat, instancesFor(vat))
  for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, matrixOf(i, scale))
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  return { object: mesh, time }
}

function buildEz(vat: VAT, scale: number, culled: boolean) {
  const uniforms = createVATUniforms()
  const geometry = vat.geometry.clone()
  // The public contract writer, on a geometry InstancedMesh2 will own.
  addVATInstanceAttributes(geometry, instancesFor(vat))
  const materials = vat.materials.map((m) => patchVATMaterial(m.clone(), vat, uniforms))

  // Patch first, hand over second: InstancedMesh2 chains the material's
  // existing `onBeforeCompile` (it stashes it as `_onBeforeCompileBase` and
  // calls it before its own), so three-vat's injection survives — but only if
  // it is already on the material when InstancedMesh2 adopts it.
  const mesh = new InstancedMesh2(geometry, materials as never, {
    capacity: COUNT,
    renderer,
  })
  mesh.addInstances(COUNT, (obj, i) => {
    obj.position.setFromMatrixPosition(matrixOf(i, scale))
    obj.scale.setScalar(scale)
  })
  mesh.perObjectFrustumCulled = culled
  mesh.computeBVH()
  return { object: mesh, time: uniforms.uVatTime }
}

// --- boot --------------------------------------------------------------------

const gltf = await new GLTFLoader().loadAsync('RobotExpressive.glb')
const root = gltf.scene
const clips = CLIPS.map((name) => gltf.animations.find((c) => c.name === name)!)
const height = new Box3().setFromObject(root).getSize(new Vector3()).y
const scale = 1.8 / height

const vat = bakeVAT(root, clips, { fps: 30, maxTextureSize: getMaxTextureSize(renderer) })

const built = {
  plain: buildPlain(vat, scale),
  'ez-culled': buildEz(vat, scale, true),
  'ez-unculled': buildEz(vat, scale, false),
} as Record<Mode, { object: InstancedMesh | InstancedMesh2; time: { value: number } }>

let mode: Mode = 'plain'
function show(next: Mode) {
  scene.remove(built[mode].object as never)
  mode = next
  scene.add(built[mode].object as never)
  for (const b of document.querySelectorAll('#modes button')) {
    b.classList.toggle('on', (b as HTMLElement).dataset.mode === mode)
  }
  verdict.textContent = {
    plain: 'Référence. Les bandes doivent être nettes et le rester en tournant.',
    'ez-culled': 'InstancedMesh2, culling par instance ACTIF. Tournez la caméra.',
    'ez-unculled': 'InstancedMesh2, culling par instance COUPÉ. Tournez la caméra.',
  }[next]
}
for (const b of document.querySelectorAll('#modes button')) {
  b.addEventListener('click', () => show((b as HTMLElement).dataset.mode as Mode))
}
show('plain')

// The decisive read, exposed for the headless capture: after InstancedMesh2 has
// culled and sorted, `instanceIndex[slot]` is the *logical* instance drawn in
// that slot. three-vat's playback is in plain `InstancedBufferAttribute`s, which
// the GPU indexes by **slot**. So the two agree only while this array is the
// identity — and a crowd is only correct while they agree.
declare global {
  // eslint-disable-next-line no-var
  var __probe: (() => unknown) | undefined
}
globalThis.__probe = () => {
  const obj = built[mode].object
  if (!(obj instanceof InstancedMesh2)) return { mode, kind: 'InstancedMesh', identity: true }
  const drawn = Array.from(obj.instanceIndex.array.slice(0, obj.count) as Uint32Array)
  const firstBreak = drawn.findIndex((logical, slot) => logical !== slot)
  return {
    mode,
    kind: 'InstancedMesh2',
    instances: COUNT,
    drawn: obj.count,
    identity: firstBreak === -1,
    firstBreak,
    head: drawn.slice(0, 12),
    // What the shader will actually read in those slots vs what it should.
    clipReadVsWanted: drawn.slice(0, 12).map((logical, slot) => ({
      slot,
      wanted: CLIPS[clipOf(logical)],
      read: CLIPS[clipOf(slot)],
    })),
  }
}

const clock = new Clock()
renderer.setAnimationLoop(() => {
  built[mode].time.value = clock.getElapsedTime()
  controls.update()
  renderer.render(scene, camera)
  const obj = built[mode].object
  const drawn = obj instanceof InstancedMesh2 ? obj.count : COUNT
  hud.textContent = `mode ${mode} · instances ${COUNT} · dessinées ${drawn} · draw calls ${renderer.info.render.calls}`
})
