// three-vat demo: a tornado of birds. Three morph-target species (stork,
// flamingo, parrot) are each baked into a VAT at load, then rendered as one
// InstancedMesh per species. Wing-flap runs entirely on the GPU (zero per-frame
// CPU); only the orbital transform is updated on the CPU each frame.
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GUI } from 'three/addons/libs/lil-gui.module.min.js'
import Stats from 'stats-gl'
import { bakeVAT } from 'three-vat'
import type { VAT } from 'three-vat'
import { addInstancedVATAttributes, createVATDepthMaterial, createVATUniforms, patchVATMaterial } from 'three-vat/webgl'

// forwardYaw: heading correction if a model's forward axis doesn't match its
// travel direction (tweak per species after looking at it).
const SPECIES = [
  { file: 'Stork.glb', forwardYaw: 0 },
  { file: 'Flamingo.glb', forwardYaw: 0 },
  { file: 'Parrot.glb', forwardYaw: 0 },
]
const TARGET_SIZE = 2.6 // baseline wingspan (world units) before the per-species scale slider

// Live-tunable via the GUI. Shape/speed/scale apply each frame; count rebuilds.
const params = {
  bottomWidth: 5, // orbit radius at the base of the funnel
  topWidth: 12.5, // orbit radius at the top
  height: 0.5, // vertical spread multiplier
  speed: 0.45, // orbital rate multiplier
  maxZoom: 120,
  animateTornado: true, // orbital motion on/off
  animateWings: true, // wing-flap on/off
  species: {} as Record<string, { count: number; scale: number }>,
}

// ---------------------------------------------------------------- scene
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8fb2d6)
scene.fog = new THREE.Fog(0x8fb2d6, 60, 190)

const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 400)
camera.position.set(0, 15, 34)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 14, 0)
controls.enableDamping = true
controls.minDistance = 4
controls.maxDistance = params.maxZoom

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

scene.add(new THREE.HemisphereLight(0xeaf2fb, 0x6b7360, 1.3))
const sun = new THREE.DirectionalLight(0xfff2df, 2.2)
sun.position.set(35, 55, 25)
sun.castShadow = true
sun.shadow.mapSize.set(2048, 2048)
sun.shadow.camera.left = sun.shadow.camera.bottom = -40
sun.shadow.camera.right = sun.shadow.camera.top = 40
sun.shadow.camera.far = 160
sun.shadow.bias = -0.0005
scene.add(sun)

// Five-tone gradient map (three.js examples). Nearest filtering + no mipmaps
// keep the toon bands hard instead of smearing them.
const gradientMap = new THREE.TextureLoader().load('/fiveTone.jpg')
gradientMap.minFilter = THREE.NearestFilter
gradientMap.magFilter = THREE.NearestFilter
gradientMap.generateMipmaps = false

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshStandardMaterial({ color: 0x8a9b6e, roughness: 1 }),
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// ---------------------------------------------------------------- one bird's orbit
// Height fraction u drives the funnel: higher birds fly a wider ring, lower
// birds circle faster — that shear is what reads as a tornado. Per-bird phase,
// radius jitter, and vertical bob keep the rings from collapsing into surfaces.
// The GUI's bottom/top widths, height, and speed are all applied each frame,
// so u and the jitter are what's stored; the actual radius is derived live.
interface Bird {
  u: number // normalized height (0 = base, 1 = top)
  angle: number
  radiusJitter: number
  angularSpeed: number
  bobAmp: number
  bobFreq: number
  bobPhase: number
  timeOffset: number // wing-flap phase (GPU)
  speed: number // wing-flap rate (GPU)
}

function makeBird(): Bird {
  const u = Math.random()
  return {
    u,
    angle: Math.random() * Math.PI * 2,
    radiusJitter: (Math.random() - 0.5) * 2.5,
    angularSpeed: 0.5 + (1 - u) * 0.9,
    bobAmp: 0.4 + Math.random() * 0.8,
    bobFreq: 0.6 + Math.random() * 0.8,
    bobPhase: Math.random() * Math.PI * 2,
    timeOffset: Math.random() * 10,
    speed: 1.6 + Math.random() * 1.1,
  }
}

// ---------------------------------------------------------------- load + bake each species
const uniforms = createVATUniforms() // shared flap clock across all species
const loader = new GLTFLoader()

interface Flock {
  name: string
  forwardYaw: number
  vat: VAT
  worldMatrix: THREE.Matrix4
  baseGeometry: THREE.BufferGeometry
  normScale: number
  mesh: THREE.InstancedMesh | null
  birds: Bird[]
}
const flocks: Flock[] = []

for (const spec of SPECIES) {
  const name = spec.file.replace('.glb', '')
  const gltf = await loader.loadAsync('/' + spec.file)
  gltf.scene.updateMatrixWorld(true)

  let src!: THREE.Mesh
  gltf.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) src ??= o as THREE.Mesh
  })
  const worldMatrix = src.matrixWorld.clone()
  const vat = bakeVAT(gltf.scene, src, gltf.animations, { fps: 30 }) // also derives normals in-place

  // Normalize size from the world-space bounding box so all three read at a
  // comparable scale regardless of each model's native units.
  src.geometry.computeBoundingBox()
  const bbox = src.geometry.boundingBox!.clone().applyMatrix4(worldMatrix)
  const size = bbox.getSize(new THREE.Vector3())
  const normScale = TARGET_SIZE / Math.max(size.x, size.y, size.z)

  params.species[name] = { count: 300, scale: 1 }
  flocks.push({
    name,
    forwardYaw: spec.forwardYaw,
    vat,
    worldMatrix,
    baseGeometry: src.geometry,
    normScale,
    mesh: null,
    birds: [],
  })
}

// Build (or rebuild, on a count change) a species' InstancedMesh + bird set.
function buildFlock(flock: Flock) {
  if (flock.mesh) {
    scene.remove(flock.mesh)
    flock.mesh.geometry.dispose()
    ;(flock.mesh.material as THREE.Material).dispose()
    ;(flock.mesh.customDepthMaterial as THREE.Material | undefined)?.dispose()
  }
  const count = params.species[flock.name]!.count
  flock.birds = Array.from({ length: count }, makeBird)

  const geometry = flock.baseGeometry.clone()
  addInstancedVATAttributes(
    geometry,
    flock.birds.map((b) => ({ clip: flock.vat.clips[0]!, timeOffset: b.timeOffset, speed: b.speed })),
  )
  // Toon shading with the five-tone ramp; vertexColors keeps each bird's own
  // COLOR_0 tint (flamingo pink, parrot green, …). flatShading derives normals
  // from screen-space derivatives of the VAT-displaced position, so it looks
  // faceted and ignores the (merely computed) baked normals.
  const material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap, flatShading: true })
  patchVATMaterial(material, flock.vat, uniforms)

  const mesh = new THREE.InstancedMesh(geometry, material, count)
  mesh.customDepthMaterial = createVATDepthMaterial(flock.vat, uniforms)
  mesh.castShadow = true
  mesh.frustumCulled = false // instances are placed by per-frame matrices
  scene.add(mesh)
  flock.mesh = mesh
  updateInfo()
}

const infoEl = document.getElementById('info')!
function updateInfo() {
  const total = flocks.reduce((n, f) => n + f.birds.length, 0)
  infoEl.textContent = `${total} birds · ${flocks.length} species · wing-flap on GPU, zero per-frame CPU`
}

for (const flock of flocks) buildFlock(flock)

// ---------------------------------------------------------------- GUI
const gui = new GUI({ title: 'bird tornado' })
gui.add(params, 'animateTornado').name('tornado motion')
gui.add(params, 'animateWings').name('wing flap')
gui.add(params, 'bottomWidth', 0, 20, 0.5).name('bottom width')
gui.add(params, 'topWidth', 0, 30, 0.5).name('top width')
gui.add(params, 'height', 0.3, 2.5, 0.05).name('tornado height')
gui.add(params, 'speed', 0, 3, 0.05).name('tornado speed')
gui.add(params, 'maxZoom', 20, 240, 5).name('max zoom out').onChange((v: number) => {
  controls.maxDistance = v
})
for (const flock of flocks) {
  const f = gui.addFolder(flock.name)
  f.add(params.species[flock.name]!, 'scale', 0.2, 3, 0.05).name('scale')
  f.add(params.species[flock.name]!, 'count', 0, 600, 10)
    .name('count')
    .onFinishChange(() => buildFlock(flock)) // rebuild only when the drag ends
}

// ---------------------------------------------------------------- perf panel
const stats = new Stats({ trackGPU: true })
document.body.appendChild(stats.dom)
stats.dom.style.cssText = 'position:fixed;bottom:0;left:0'
await stats.init(renderer)
const drawsEl = document.getElementById('draws')!

// ---------------------------------------------------------------- loop
const up = new THREE.Vector3(0, 1, 0)
const q = new THREE.Quaternion()
const s = new THREE.Vector3()
const pos = new THREE.Vector3()
const m = new THREE.Matrix4()

// t: continuous time (bob + wing-flap). spin: accumulated orbital phase, so the
// speed slider changes the rate without teleporting birds' angles.
function orbit(t: number, spin: number) {
  const { bottomWidth, topWidth, height } = params
  for (const flock of flocks) {
    if (!flock.mesh) continue
    const scale = flock.normScale * params.species[flock.name]!.scale
    const birds = flock.birds
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i]!
      const a = b.angle + b.angularSpeed * spin
      const r = bottomWidth + (topWidth - bottomWidth) * b.u + b.radiusJitter
      pos.set(
        Math.cos(a) * r,
        (3 + b.u * 26) * height + Math.sin(t * b.bobFreq + b.bobPhase) * b.bobAmp,
        Math.sin(a) * r,
      )
      q.setFromAxisAngle(up, -a + flock.forwardYaw) // face the tangent of travel
      s.setScalar(scale)
      flock.mesh.setMatrixAt(i, m.compose(pos, q, s).multiply(flock.worldMatrix))
    }
    flock.mesh.instanceMatrix.needsUpdate = true
  }
}

// Independent clocks so each toggle freezes only its own motion: flapTime feeds
// the GPU wing animation, spin + bobTime drive the orbit. Positions are still
// recomputed every frame (cheap) so the shape sliders respond while paused.
const clock = new THREE.Clock()
let flapTime = 0
let bobTime = 0
let spin = 0
renderer.setAnimationLoop(() => {
  stats.begin()
  const dt = clock.getDelta()
  if (params.animateWings) flapTime += dt
  if (params.animateTornado) {
    spin += dt * params.speed
    bobTime += dt
  }
  uniforms.uVatTime.value = flapTime
  orbit(bobTime, spin)
  controls.update()
  renderer.render(scene, camera)
  drawsEl.textContent = `${renderer.info.render.calls} draw calls · ${renderer.info.render.triangles.toLocaleString()} tris`
  stats.end()
  stats.update()
})
