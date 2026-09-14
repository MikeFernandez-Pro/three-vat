// three-vat demo: a VAT crowd vs. a cloned-SkinnedMesh baseline, so the
// draw-call and CPU gap is visible. Baked live from Soldier.glb at load.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import { bakeVAT } from 'three-vat'
import type { VAT, VATClip } from 'three-vat'
import { addInstancedVATAttributes, createVATDepthMaterial, createVATUniforms, patchVATMaterial } from 'three-vat/webgl'

let count = 500
let mode: 'vat' | 'skinned' = 'vat'

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87a8c4)
scene.fog = new THREE.Fog(0x87a8c4, 60, 160)

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 300)
camera.position.set(0, 14, 34)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1, 0)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x777466, 1.2))
const sun = new THREE.DirectionalLight(0xfff2df, 2.4)
sun.position.set(30, 45, 20)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = sun.shadow.camera.bottom = -50
sun.shadow.camera.right = sun.shadow.camera.top = 50
sun.shadow.camera.far = 120
sun.shadow.bias = -0.0005
scene.add(sun)

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshStandardMaterial({ color: 0x8a9b6e, roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// ---------------------------------------------------------------- load + bake
const hud = document.getElementById('hud')!
const statsEl = document.getElementById('stats')!
const infoEl = document.getElementById('info')!

const gltf = await new GLTFLoader().loadAsync('/Soldier.glb')
gltf.scene.updateMatrixWorld(true)

const skinnedMeshes: THREE.SkinnedMesh[] = []
gltf.scene.traverse((o) => {
  if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinnedMeshes.push(o as THREE.SkinnedMesh)
})
const sourceMesh = skinnedMeshes[0]!
const meshWorldMatrix = sourceMesh.matrixWorld.clone()

const clips = gltf.animations.filter((c) => c.name !== 'TPose')
const t0 = performance.now()
const vat: VAT = bakeVAT(gltf.scene, sourceMesh, clips, { fps: 30 })
const bakeMs = performance.now() - t0
const bytes = vat.vertexCount * vat.totalFrames * 16 * 2 // 2 RGBA float textures

infoEl.textContent =
  `bake ${bakeMs.toFixed(0)} ms | ${vat.vertexCount} verts × ${vat.totalFrames} frames ` +
  `| 2 × RGBA32F = ${(bytes / 1e6).toFixed(1)} MB | ` +
  vat.clips.map((c) => `${c.name}(${c.frames}f, maxΔ ${c.maxDelta.toFixed(2)}m)`).join(' ')

// ---------------------------------------------------------------- crowd data
interface Instance {
  position: THREE.Vector3
  rotationY: number
  scale: number
  color: THREE.Color
  clip: VATClip
  timeOffset: number
  speed: number
}

let instances: Instance[] = []
function regenInstances(n: number) {
  const radius = Math.sqrt(n) * 1.4 + 4
  instances = Array.from({ length: n }, () => {
    const r = Math.sqrt(Math.random()) * radius
    const a = Math.random() * Math.PI * 2
    return {
      position: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
      rotationY: Math.random() * Math.PI * 2,
      scale: 0.75 + Math.random() * 0.55,
      color: new THREE.Color().setHSL(Math.random(), 0.45, 0.65),
      clip: vat.clips[Math.floor(Math.random() * vat.clips.length)]!,
      timeOffset: Math.random() * 10,
      speed: 0.8 + Math.random() * 0.4,
    }
  })
}

function instanceMatrix(inst: Instance, target: THREE.Matrix4) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotationY)
  const s = new THREE.Vector3(inst.scale, inst.scale, inst.scale)
  return target.compose(inst.position, q, s).multiply(meshWorldMatrix)
}

// ---------------------------------------------------------------- VAT crowd
const vatUniforms = createVATUniforms()
let vatMesh: THREE.InstancedMesh | null = null

function buildVATCrowd() {
  const geometry = sourceMesh.geometry.clone()
  addInstancedVATAttributes(geometry, instances)
  // Bounds = union of all baked frames, or instances get culled mid-animation.
  geometry.boundingBox = vat.bounds.clone()
  geometry.boundingSphere = vat.bounds.getBoundingSphere(new THREE.Sphere())

  const material = (sourceMesh.material as THREE.Material).clone()
  patchVATMaterial(material, vat, vatUniforms)

  // Instanced shadows use the depth material, which knows nothing about our
  // vertex displacement until patched too.
  const mesh = new THREE.InstancedMesh(geometry, material, instances.length)
  mesh.customDepthMaterial = createVATDepthMaterial(vat, vatUniforms)
  mesh.castShadow = true
  mesh.receiveShadow = true

  const m = new THREE.Matrix4()
  instances.forEach((inst, i) => {
    mesh.setMatrixAt(i, instanceMatrix(inst, m))
    mesh.setColorAt(i, inst.color)
  })
  mesh.computeBoundingSphere()
  scene.add(mesh)
  return mesh
}

// ---------------------------------------------------------------- skinned crowd (baseline)
let skinnedGroup: THREE.Group | null = null
let mixers: THREE.AnimationMixer[] = []

function buildSkinnedCrowd() {
  const group = new THREE.Group()
  mixers = []
  const m = new THREE.Matrix4()
  for (const inst of instances) {
    const clone = cloneSkeleton(gltf.scene)
    instanceMatrix(inst, m)
    clone.position.copy(inst.position)
    clone.rotation.y = inst.rotationY
    clone.scale.setScalar(inst.scale)
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.frustumCulled = false // skeleton animation breaks per-mesh culling
      }
    })
    const mixer = new THREE.AnimationMixer(clone)
    const source = clips.find((c) => c.name === inst.clip.name)!
    mixer.clipAction(source).play()
    mixer.setTime(inst.timeOffset)
    mixer.timeScale = inst.speed
    mixers.push(mixer)
    group.add(clone)
  }
  scene.add(group)
  return group
}

// ---------------------------------------------------------------- mode switching
function rebuild() {
  if (vatMesh) {
    scene.remove(vatMesh)
    vatMesh.geometry.dispose()
    vatMesh = null
  }
  if (skinnedGroup) {
    scene.remove(skinnedGroup)
    skinnedGroup = null
    mixers = []
  }
  regenInstances(count)
  if (mode === 'vat') vatMesh = buildVATCrowd()
  else skinnedGroup = buildSkinnedCrowd()
}

for (const btn of hud.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
  btn.onclick = () => {
    mode = btn.dataset.mode as 'vat' | 'skinned'
    syncButtons()
    rebuild()
  }
}
for (const btn of hud.querySelectorAll<HTMLButtonElement>('[data-count]')) {
  btn.onclick = () => {
    count = Number(btn.dataset.count)
    syncButtons()
    rebuild()
  }
}
function syncButtons() {
  for (const btn of hud.querySelectorAll<HTMLButtonElement>('button')) {
    const active = btn.dataset.mode === mode || Number(btn.dataset.count) === count
    btn.classList.toggle('active', active)
  }
}

syncButtons()
rebuild()

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock()
let fpsAccum = 0
let fpsFrames = 0
let fpsValue = 0
let cpuMs = 0

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta()
  const cpuStart = performance.now()

  vatUniforms.uVatTime.value = clock.elapsedTime
  if (mode === 'skinned') for (const mixer of mixers) mixer.update(dt)

  controls.update()
  renderer.render(scene, camera)

  cpuMs = cpuMs * 0.95 + (performance.now() - cpuStart) * 0.05
  fpsAccum += dt
  fpsFrames++
  if (fpsAccum >= 0.5) {
    fpsValue = fpsFrames / fpsAccum
    fpsAccum = 0
    fpsFrames = 0
  }
  statsEl.textContent =
    `${mode.toUpperCase()} × ${count} | ${fpsValue.toFixed(0)} fps | ` +
    `js ${cpuMs.toFixed(1)} ms/frame | draw calls ${renderer.info.render.calls}`
})
