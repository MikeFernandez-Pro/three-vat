// PROTOTYPE, throwaway (kid-ghosts.html): the open arena's pumpkin kid with his torch, on its flagstones, and the
// goose game's sheet ghosts (ghosts.prototype.ts, its `ball` preset: no goose under the sheet) where the rats would be.
// Asked for on 2026-10-29 as a test: five ghosts wandering about at random, paying him no heed; and a vacuum, its
// canister on his back, its hose to the nozzle in his free left hand. Held down, the space bar has it suck: a cone of
// draught ahead of the nozzle, pulling on the ghosts' cloth itself (ghosts.prototype.ts, `suck`). A ghost held in it
// is drawn toward him, its skirt streaming at the mouth, until its sheet lets go of it and is sucked in whole, the
// cloth swallowed point by point; let go too soon and it drifts free again, or a loose sheet drops to the floor.
// No swarm, no play, no panel. WebGPU only, as the ghosts' cloth is.
import {
  AdditiveBlending,
  AmbientLight,
  CatmullRomCurve3,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu'
import { color, float, pow, sin, smoothstep, time, uniform, uv } from 'three/tsl'
import { createFlame, defaultFlame } from './flame'
import { createGhosts, mountGhostControls, type Walk } from './ghosts.prototype'
import { load } from './ground'
import { createMeat, defaultMeat } from './meat'

const url = new URLSearchParams(location.search)
/** How many ghosts, and their sheet, a preset of ghosts.prototype.ts: the panel sets both, and reloads. */
const GHOSTS = Math.max(1, Math.min(12, Math.round(Number(url.get('ghostcount') ?? 5)) || 5))
const PRESET = url.get('ghosts') || 'ball'
/** How many times each cloth square is cut a side where it is drawn, so its folds are round: the panel sets it, and reloads. */
const REFINE = Math.max(1, Math.min(6, Math.round(Number(url.get('ghostrefine') ?? 3)) || 3))
/** His walk, m/s. */
const SPEED = 2
/** The floor's side, m, and its tiles' size, m. */
const FLOOR = 80
const TILE = 4
/** The camera behind and over him, m; the wheel moves it nearer or further by this share. */
const VIEW = new Vector3(0, 5.5, 7)
const START = new Vector3(0, 0, 0)
/** How far round his start the ghosts' wanders are centred, m, and how far each strays off its centre, m. */
const HOMES = [3.5, 7]
const STRAY = 3
const SEED = 29
/** The vacuum, as its panel folder edits it. */
const vacuum = {
  /** The suction: how far ahead of the mouth it reaches, m, and how wide, radians off his facing either way. */
  reach: 4.5,
  halfAngle: 0.45,
  /** How long a ghost must be held in it before its sheet lets go of it, s, and how long one let go takes to drift back out, s. */
  drawIn: 1.5,
  letGo: 1.2,
  /** The suction's strength on a sheet still on its ghost, at the end of its hold: its skirt streams, its body holds. */
  heldPull: 0.5,
  /** How far toward the mouth a ghost held in it is drawn, by the end of its hold, as a share of the way. */
  drawnNear: 0.35,
}
/** The share of its sheet swallowed at which a ghost is caught, the rest going in after; and how often that is read, s. */
const CAUGHT_AT = 0.95
const READ_EVERY = 0.25

const renderer = new WebGPURenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
await renderer.init()

const scene = new Scene()
scene.fog = new FogExp2(0x0d1011, 0.06)
scene.background = scene.fog.color
const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200)

// A night: a dim blue dome and moon, the torch the warm light.
scene.add(new HemisphereLight(0x5a6c88, 0x1a1f1c, 0.6))
scene.add(new AmbientLight(0x202838, 0.4))
const moon = new DirectionalLight(0x8fa4c8, 0.5)
moon.position.set(-6, 10, 4)
scene.add(moon)

const [map, normalMap] = await load('flagstones')
map.repeat.setScalar(FLOOR / TILE)
normalMap.repeat.setScalar(FLOOR / TILE)
const floor = new Mesh(new PlaneGeometry(FLOOR, FLOOR), new MeshStandardNodeMaterial({ map, normalMap, roughness: 0.9 }))
floor.rotation.x = -Math.PI / 2
scene.add(floor)

// The kid: meat.ts gives the pumpkin kid on this page.
const kid = await createMeat()
const kidLook = defaultMeat()
kidLook.parts = kid.parts.map((part) => ({ ...part }))
kid.set(kidLook)
kid.object.position.copy(START)
scene.add(kid.object)
/** The group meat.ts turns to face his way: its yaw, 0 facing +z. */
const kidTurn = kid.object.children[0]!
const leftHand = kid.bone('skinned_l_handPlacement_bn')!
const back = kid.bone('skinned_c_thoracic2_bn')!

// His torch: the flame on its end, and its lamp in the flame.
const flame = createFlame()
flame.set(defaultFlame())
scene.add(flame.object)
const torch = new PointLight(0xffa25a, 14, 10, 1.2)
scene.add(torch)
const torchEnd = new Vector3()
const flameOffset = new Vector3()

// The vacuum: a canister on his back, a nozzle in his left hand, and the hose between them, laid again each frame.
const body = new MeshStandardNodeMaterial({ color: 0x3f8f6a, roughness: 0.45, metalness: 0.3 })
const metal = new MeshStandardNodeMaterial({ color: 0xb8bcc0, roughness: 0.3, metalness: 0.8 })
const rubber = new MeshStandardNodeMaterial({ color: 0x23262a, roughness: 0.8 })
const canister = new Group()
canister.add(new Mesh(new CylinderGeometry(0.11, 0.11, 0.36, 20), body))
for (const y of [-0.15, 0.15]) {
  const band = new Mesh(new TorusGeometry(0.112, 0.012, 6, 20), metal)
  band.rotation.x = Math.PI / 2
  band.position.y = y
  canister.add(band)
}
const cap = new Mesh(new CylinderGeometry(0.06, 0.09, 0.05, 16), metal)
cap.position.y = 0.2
canister.add(cap)
scene.add(canister)
/** The nozzle: a wand ahead of the hand, and its mouth flaring wide at the wand's end; the hose meets its back end. */
const nozzle = new Group()
const WAND = 0.38
const wand = new Mesh(new CylinderGeometry(0.022, 0.022, WAND, 10), metal)
wand.rotation.x = Math.PI / 2
wand.position.z = WAND / 2 - 0.08
const mouth = new Mesh(new CylinderGeometry(0.085, 0.035, 0.12, 16, 1, true), new MeshStandardNodeMaterial({ color: 0x3f8f6a, roughness: 0.45, metalness: 0.3, side: DoubleSide }))
mouth.rotation.x = Math.PI / 2
mouth.position.z = WAND - 0.08 + 0.05
/** The mouth's open end, along the nozzle, m from the hand. */
const MOUTH_END = WAND - 0.08 + 0.11
nozzle.add(wand, mouth)
scene.add(nozzle)

// The draught: a cone from the mouth as far as the suction reaches, streaks running down it into the mouth, there
// as strong as the suction is. The cylinder's v runs 0 at the mouth to 1 at its far end; turned to lie along +z.
const draught = uniform(0)
const coneGeometry = () =>
  new CylinderGeometry(Math.tan(vacuum.halfAngle) * vacuum.reach * 0.6, 0.07, vacuum.reach, 24, 1, true)
    .rotateX(Math.PI / 2)
    .translate(0, 0, MOUTH_END + vacuum.reach / 2)
const coneMaterial = new MeshBasicNodeMaterial({ side: DoubleSide, transparent: true, depthWrite: false, blending: AdditiveBlending })
const v = uv().y
const streaks = pow(sin(v.mul(14).add(uv().x.mul(Math.PI * 6)).add(time.mul(9))).mul(0.5).add(0.5), float(6))
coneMaterial.colorNode = color(0xbfe6ff)
coneMaterial.opacityNode = streaks.mul(smoothstep(1, 0.5, v)).mul(smoothstep(0, 0.08, v)).mul(0.35).mul(draught)
const cone = new Mesh(coneGeometry(), coneMaterial)
/** The cone laid again to the suction's reach and width, as the panel moves them. */
const reshapeCone = () => {
  cone.geometry.dispose()
  cone.geometry = coneGeometry()
}
nozzle.add(cone)

let hose: Mesh | undefined
const canisterAt = new Vector3()
const handAt = new Vector3()
const hoseStart = new Vector3()
const hoseEnd = new Vector3()
const forward = new Vector3()
const left = new Vector3()
const mouthAt = new Vector3()
/** Where the cloth is swallowed: a little inside the mouth. */
const intakeAt = new Vector3()
const curve = new CatmullRomCurve3([new Vector3(), new Vector3(), new Vector3(), new Vector3()])
/** How far the nozzle tips down, radians: ahead and a little down at rest, level while it sucks. */
let pitch = 0.35
function carryVacuum(dt: number) {
  const yaw = kidTurn.rotation.y
  forward.set(Math.sin(yaw), 0, Math.cos(yaw))
  left.set(forward.z, 0, -forward.x)
  back.getWorldPosition(canisterAt).addScaledVector(forward, -0.17)
  canisterAt.y -= 0.05
  canister.position.copy(canisterAt)
  canister.rotation.set(0, yaw, 0)
  leftHand.getWorldPosition(handAt)
  nozzle.position.copy(handAt)
  pitch += ((sucking ? 0 : 0.35) - pitch) * (1 - Math.exp(-dt / 0.12))
  nozzle.rotation.set(pitch, yaw, 0, 'YXZ')
  nozzle.updateMatrixWorld(true)
  nozzle.localToWorld(mouthAt.set(0, 0, MOUTH_END))
  nozzle.localToWorld(intakeAt.set(0, 0, MOUTH_END - 0.06))
  hoseStart.copy(canisterAt).y -= 0.16
  hoseEnd.set(0, 0, -0.08).applyEuler(nozzle.rotation).add(handAt)
  const [a, b, c, d] = curve.points as [Vector3, Vector3, Vector3, Vector3]
  a.copy(hoseStart)
  d.copy(hoseEnd)
  // Sagging between them, out to his left side.
  b.lerpVectors(hoseStart, hoseEnd, 0.35).addScaledVector(left, 0.12).y -= 0.25
  c.lerpVectors(hoseStart, hoseEnd, 0.7).addScaledVector(left, 0.06).y -= 0.18
  hose?.geometry.dispose()
  if (!hose) {
    hose = new Mesh(undefined, rubber)
    scene.add(hose)
  }
  hose.geometry = new TubeGeometry(curve, 24, 0.022, 8, false)
}

// The ghosts' wanders: each round a home of its own about his start, along two waves a side at speeds of its own, so
// it drifts and turns as if at random and never leaves its corner of the floor.
let seed = SEED
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 2 ** 32
}
const wanders = Array.from({ length: GHOSTS }, (_, g) => {
  const angle = (g / GHOSTS) * Math.PI * 2 + random() * 0.8
  const home = HOMES[0]! + random() * (HOMES[1]! - HOMES[0]!)
  const wave = () => ({ size: STRAY * (0.4 + random() * 0.6), rate: 0.08 + random() * 0.18, phase: random() * Math.PI * 2 })
  return { x: START.x + Math.cos(angle) * home, z: START.z + Math.sin(angle) * home, waves: [wave(), wave(), wave(), wave()] }
})
const along = (w: { size: number; rate: number; phase: number }, t: number) => w.size * 0.5 * Math.sin(w.rate * t + w.phase)
/** How far through its hold each ghost is, 0 free to 1 its sheet let go; whether its sheet is released, and where it was
 * then, its body held there; and whether it is caught for good. */
const drawn = new Float32Array(GHOSTS)
const released = new Array<boolean>(GHOSTS).fill(false)
const spots: { x: number; z: number }[] = []
const caught = new Array<boolean>(GHOSTS).fill(false)
/** Where ghost `g` is at `t`: on its wander, drawn toward the mouth by its hold, shaking as it fights the pull. */
const ghostAt = (g: number, t: number) => {
  if (released[g]) return spots[g]!
  const { x, z, waves } = wanders[g]!
  const wx = x + along(waves[0]!, t) + along(waves[1]!, t * 2.3)
  const wz = z + along(waves[2]!, t) + along(waves[3]!, t * 2.3)
  const k = drawn[g]! * drawn[g]! * (3 - 2 * drawn[g]!) * vacuum.drawnNear
  const shake = Math.sin(t * 13 + g * 2.1) * 0.25 * drawn[g]! * (1 - drawn[g]!)
  return { x: wx + (mouthAt.x - wx) * k + left.x * shake, z: wz + (mouthAt.z - wz) * k + left.z * shake }
}
const walk: Walk = { count: GHOSTS, reach: 1.75, speed: 1, at: ghostAt }
const ghosts = await createGhosts(renderer, START, () => 0, PRESET, GHOSTS, walk, undefined, REFINE)
// Set from the panel on 2026-10-29, this page's own: a soft, heavily damped sheet in still air, near white, over a
// bigger sphere, rising and falling as it floats along; no clip played, the sphere has no goose to walk.
Object.assign(ghosts.look, { stiffness: 0.2, bend: 0.8, damping: 0.999, opacity: 0.85, gravity: 0.98, wind: 0, colour: 0xe0e7ff, bodies: 1.3, bob: 0.06, bobRate: 0.7, pace: 0 })
ghosts.wear()
scene.add(ghosts.object)

/** Whether ghost `g`, where it is now, is in the draught ahead of the mouth. */
const inDraught = (g: number, t: number) => {
  const at = ghostAt(g, t)
  const dx = at.x - mouthAt.x
  const dz = at.z - mouthAt.z
  const d = Math.hypot(dx, dz)
  if (d < 0.4) return true
  if (d > vacuum.reach) return false
  return Math.acos(Math.min(1, (dx * forward.x + dz * forward.z) / d)) < vacuum.halfAngle
}

const help = document.getElementById('help')!
const showCount = () => {
  const n = caught.filter(Boolean).length
  help.textContent = `WASD or the arrows to walk, space to vacuum; the wheel to zoom. Ghosts caught: ${n} / ${GHOSTS}`
}
showCount()

/** Every ghost let out again: back on its wander, its sheet laid on it afresh. */
const freeAll = () => {
  drawn.fill(0)
  released.fill(false)
  caught.fill(false)
  for (let g = 0; g < GHOSTS; g++) ghosts.suck(g, intakeAt.x, intakeAt.y, intakeAt.z, 0, false, false)
  ghosts.wear()
  showCount()
}

// The ghosts' panel, as the goose game has it, with the vacuum's folder first.
if (!url.has('nopanel'))
  mountGhostControls(ghosts, (gui) => {
    const page = { count: GHOSTS, refine: REFINE }
    gui
      .add(page, 'count', 1, 12, 1)
      .name('how many (reloads)')
      .onFinishChange((v: number) => {
        const next = new URL(location.href)
        next.searchParams.set('ghostcount', String(v))
        location.href = next.toString()
      })
    gui
      .add(page, 'refine', 1, 6, 1)
      .name('smoothing (reloads)')
      .onFinishChange((v: number) => {
        const next = new URL(location.href)
        next.searchParams.set('ghostrefine', String(v))
        location.href = next.toString()
      })
    const folder = gui.addFolder('vacuum')
    folder.add(vacuum, 'reach', 1, 10, 0.1).name('reach m').onChange(reshapeCone)
    folder.add(vacuum, 'halfAngle', 0.1, 1.2, 0.01).name('half width rad').onChange(reshapeCone)
    folder.add(vacuum, 'drawIn', 0.2, 5, 0.05).name('hold before release s')
    folder.add(vacuum, 'letGo', 0.2, 5, 0.05).name('drift back out s')
    folder.add(vacuum, 'heldPull', 0, 1, 0.01).name('pull while held')
    folder.add(vacuum, 'drawnNear', 0, 1, 0.01).name('drawn near share')
    folder.add(ghosts.look, 'suck', 0, 40, 0.5).name('suction m/s2')
    folder.add({ freeAll }, 'freeAll').name('let them all out')
  })

const held = new Set<string>()
addEventListener('keydown', (e) => {
  held.add(e.code)
  if (e.code === 'Space') e.preventDefault()
})
addEventListener('keyup', (e) => held.delete(e.code))
addEventListener('blur', () => held.clear())
let zoom = 1
addEventListener('wheel', (e) => (zoom = Math.min(3, Math.max(0.4, zoom * Math.exp(e.deltaY * 0.001)))), { passive: true })
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

const down = (...codes: string[]) => codes.some((code) => held.has(code))
let sucking = false
let reading = false
let sinceRead = 0
let clock = 0
let last = performance.now()
renderer.setAnimationLoop(() => {
  const now = performance.now()
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  clock += dt

  // The camera looks along -z, so W walks him away from it.
  let vx = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0)
  let vz = (down('KeyS', 'ArrowDown') ? 1 : 0) - (down('KeyW', 'ArrowUp') ? 1 : 0)
  const length = Math.hypot(vx, vz)
  if (length > 0) {
    vx = (vx / length) * SPEED
    vz = (vz / length) * SPEED
  }
  kid.object.position.x += vx * dt
  kid.object.position.z += vz * dt
  kid.pose(clock, vx, vz)
  kid.object.updateMatrixWorld(true)
  sucking = down('Space')
  carryVacuum(dt)
  draught.value += ((sucking ? 1 : 0) - draught.value) * (1 - Math.exp(-dt / 0.15))

  // Each ghost in the draught held on toward the mouth, its skirt pulled harder the longer; out of it, or the suction
  // off, drifting back out. Held to the end, its sheet lets go of it, and the suction takes the cloth whole wherever it
  // lies; caught, the last of it goes in.
  for (let g = 0; g < GHOSTS; g++) {
    let strength = 0
    if (caught[g]) strength = 1
    else if (released[g]) strength = sucking ? 1 : 0
    else {
      const pulled = sucking && inDraught(g, clock)
      drawn[g] = Math.min(1, Math.max(0, drawn[g]! + (pulled ? dt / vacuum.drawIn : -dt / vacuum.letGo)))
      strength = pulled ? vacuum.heldPull * drawn[g]! : 0
      if (drawn[g] === 1) {
        spots[g] = ghostAt(g, clock)
        released[g] = true
        strength = 1
      }
    }
    ghosts.suck(g, intakeAt.x, intakeAt.y, intakeAt.z, strength, released[g]!, caught[g]!)
  }
  // How much of each loose sheet is swallowed, read back from the GPU now and then, one read at a time.
  sinceRead += dt
  if (!reading && sinceRead >= READ_EVERY && released.some((r, g) => r && !caught[g])) {
    reading = true
    sinceRead = 0
    void ghosts.swallowed().then((shares) => {
      reading = false
      shares.forEach((share, g) => {
        if (released[g] && !caught[g] && share >= CAUGHT_AT) caught[g] = true
      })
      showCount()
    })
  }

  const draw = (channel: number) => {
    const rate = 4 + ((channel * 1.37) % 5)
    return Math.sin(clock * rate + channel * 1.7) * 0.6 + Math.sin(clock * rate * 2.3 + channel) * 0.4
  }
  flame.shape(draw, vx, vz)
  flame.place(kid.tip(torchEnd, flame.offset(flameOffset)))
  torch.position.copy(torchEnd)
  torch.intensity = 14 * (1 + 0.08 * draw(50))

  ghosts.update(dt)

  camera.position.copy(kid.object.position).addScaledVector(VIEW, zoom)
  camera.lookAt(kid.object.position.x, kid.object.position.y + 0.6, kid.object.position.z)
  renderer.render(scene, camera)
})
