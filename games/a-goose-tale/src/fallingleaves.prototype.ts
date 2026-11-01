// PROTOTYPE: leaves falling round the goose, always on. Brought
// back on 2026-10-25 from the parked leaves prototype
// (ThreJsJourney/parked/last-light-leaves/leaves.prototype.ts), the falling
// alone: no litter on the ground, so a leaf lies a while where it lands and
// shrinks away. Its colours are the litter's as they were, unless the game
// gives it the dead trees' (main.ts).
import { BufferGeometry, Color, DataTexture, DataUtils, DoubleSide, Float32BufferAttribute, HalfFloatType, LinearFilter, Mesh, MeshLambertNodeMaterial, RedFormat, Uint16BufferAttribute, Vector2, type Node } from 'three/webgpu'
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js'
import { abs, attribute, cos, float, floor, fract, Fn, int, max, mix, normalLocal, select, sin, smoothstep, step, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'
import type { HeightGrid } from './heights'
import { leaveOutOfBloom } from './post'
import { random } from './swarm'

/** Leaves falling at most, a quad each. */
const FALLING = 2 ** 11

/** What the falling leaves' folder edits. */
export interface FallLook {
  /** The share of the leaves falling, 0 none, 1 all. */
  amount: number
  /** The square round the goose they fall in, m a side, and how high over the ground they start, m. */
  square: number
  height: number
  /** How fast a leaf comes down, m/s, and how long it lies on the litter before it is part of it, s. */
  speed: number
  lies: number
  /** How far a leaf sways either way as it falls, m, and how fast it tumbles, turns a second. */
  sway: number
  tumble: number
  /** How far the wind carries a leaf over its fall, m, along x and z. */
  windX: number
  windZ: number
  /** How long a falling leaf is, m. */
  size: number
  /** The leaves' colours, and how much each leaf's brightness strays. */
  colours: [number, number, number, number]
  stray: number
  /** How much of its own colour a leaf shows whatever light falls on it, 0 none, lit alone, as the dead trees' leaves (LeafLook.glow). */
  glow: number
  /** How dark a leaf's edge and vein, 0 none. */
  edge: number
  vein: number
}

export const defaultFallLook = (): FallLook => ({
  amount: 0.5,
  square: 24,
  height: 6,
  speed: 0.7,
  lies: 3,
  sway: 0.5,
  tumble: 0.6,
  windX: 1.5,
  windZ: -0.8,
  size: 0.105,
  colours: [0xc8641e, 0x9a3a14, 0xd49a2a, 0x5a3418],
  stray: 0.25,
  glow: 0,
  edge: 0.35,
  vein: 0.3,
})

export interface FallingLeaves {
  readonly object: Mesh
  readonly look: FallLook
  /** Take the look's values. */
  set(): void
  /** The leaves `dt` s on, falling round (x, z). */
  update(dt: number, x: number, z: number): void
}

/**
 * Leaves falling from the sky round the goose: one mesh, a quad a leaf, its
 * every move in the vertex shader, as the old woods' rain was. A leaf has its
 * place in a square repeating round her, lands somewhere new each fall, sways
 * and tumbles on the way down, carried by the wind, lies flat on the ground a
 * while, then shrinks away, and falls again.
 */
export function createFallingLeaves(ground: HeightGrid, look = defaultFallLook()): FallingLeaves {
  const places = new Float32Array(FALLING * 4 * 3)
  const normals = new Float32Array(FALLING * 4 * 3)
  const corners = new Float32Array(FALLING * 4 * 2)
  const draws = new Float32Array(FALLING * 4 * 2)
  const index = new Uint16Array(FALLING * 6)
  const next = random(23)
  for (let k = 0; k < FALLING; k++) {
    const x = next()
    const z = next()
    const draw = next()
    const pace = next()
    for (let c = 0; c < 4; c++) {
      const v = k * 4 + c
      places.set([x, 0, z], v * 3)
      normals.set([0, 1, 0], v * 3)
      corners.set([c === 0 || c === 1 ? 1 : 0, c === 0 || c === 3 ? 1 : 0], v * 2)
      draws.set([draw, pace], v * 2)
    }
    // Wound so the front faces up, as the normal does: a double-sided back face flips its normal, and a leaf lying seen from above went dark.
    index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 3, k * 4], k * 6)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(places, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2))
  geometry.setAttribute('draw', new Float32BufferAttribute(draws, 2))
  geometry.setIndex(new Uint16BufferAttribute(index, 1))

  // The ground's height, a texel a point of the grid, smoothed between them, as the rain reads it.
  const halves = new Uint16Array(ground.heights.length)
  for (let k = 0; k < halves.length; k++) halves[k] = DataUtils.toHalfFloat(ground.heights[k]!)
  const heights = new DataTexture(halves, ground.nx, ground.nz, RedFormat, HalfFloatType)
  heights.magFilter = heights.minFilter = LinearFilter
  heights.needsUpdate = true

  const centre = uniform(new Vector2())
  /** The leaves' clock, s, and how far through its round a leaf is, rounds. */
  const time = uniform(0)
  const rounds = uniform(0)
  /** The share of a round a leaf is falling; the rest it lies. */
  const falls = uniform(0.7)
  const shown = uniform(look.amount)
  const square = uniform(look.square)
  const height = uniform(look.height)
  const sway = uniform(look.sway)
  const tumble = uniform(look.tumble)
  const wind = uniform(new Vector2(look.windX, look.windZ))
  const size = uniform(look.size)

  const colours = look.colours.map((c) => uniform(new Color(c)))
  const stray = uniform(look.stray)
  const glow = uniform(look.glow)
  const edge = uniform(look.edge)
  const vein = uniform(look.vein)
  /** A leaf's colour: its pick of the colours and its brightness, two hashes, at (along, across) its length and width, each -1 to 1. */
  const paint = (pickHash: Node<'float'>, brightHash: Node<'float'>, along: Node<'float'>, across: Node<'float'>) => {
    const pick = pickHash.mul(4)
    const tint = select(pick.lessThan(1), colours[0]!, select(pick.lessThan(2), colours[1]!, select(pick.lessThan(3), colours[2]!, colours[3]!)))
    const bright = brightHash.sub(0.5).mul(stray).add(1)
    const rim = mix(float(1), float(1).sub(edge), smoothstep(0.55, 1, max(across, abs(along))))
    const veined = mix(float(1), float(1).sub(vein), smoothstep(0.12, 0.02, across).mul(smoothstep(0.95, 0.7, abs(along))))
    return tint.mul(bright).mul(rim).mul(veined)
  }

  /** The ground's height at (x, z), m. */
  const floorAt = (x: Node<'float'>, z: Node<'float'>) => {
    const u = x.sub(ground.minX).div(ground.cell).add(0.5).div(ground.nx)
    const v = z.sub(ground.minZ).div(ground.cell).add(0.5).div(ground.nz)
    return texture(heights, vec2(u, v)).level(int(0)).r
  }

  /** A leaf as it is now: its middle, its vertex's corner from the middle and its normal, turned, and how far up it is hidden, m. */
  const leafNow = () => {
    const place = attribute<'vec3'>('position')
    const corner = attribute<'vec2'>('corner')
    const draw = attribute<'vec2'>('draw')
    // Its own pace through the rounds, and the round it is in: a new landing spot each.
    const life = rounds.mul(mix(0.85, 1.15, draw.y)).add(draw.x)
    const round = floor(life)
    const phase = fract(life)
    const jump = vec2(fract(sin(round.mul(12.9898).add(draw.x.mul(78.233))).mul(43758.5453)), fract(sin(round.mul(39.346).add(draw.y.mul(11.135))).mul(24634.6345)))
    const spot = fract(place.xz.add(jump))
    // How far down it is, 0 at the top to 1 landed, and how much of it is in the air.
    const down = phase.div(falls).min(1)
    const air = down.oneMinus().mul(8).min(1)
    // The copy of its spot, the square repeating, nearest the centre; then carried by the wind as it falls, and swaying.
    const seed = draw.x.mul(97.3)
    const swaying = vec2(sin(time.mul(1.3).add(seed)), cos(time.mul(1.7).add(seed.mul(1.3)))).mul(sway).mul(air)
    const x = centre.x.add(fract(spot.x.sub(centre.x.div(square)).add(0.5)).sub(0.5).mul(square)).add(wind.x.mul(down)).add(swaying.x)
    const z = centre.y.add(fract(spot.y.sub(centre.y.div(square)).add(0.5)).sub(0.5).mul(square)).add(wind.y.mul(down)).add(swaying.y)
    const floorY = floorAt(x, z)
    const y = floorY.add(height.mul(down.oneMinus())).add(0.02)
    // Tumbling in the air, lying flat once down; its own turn about up either way.
    const spin = time.mul(tumble).mul(Math.PI * 2)
    const tilt = sin(spin.add(seed)).mul(1.2).mul(air)
    const roll = cos(spin.mul(0.7).add(seed.mul(2))).mul(0.9).mul(air)
    const yaw = draw.x.mul(Math.PI * 2).add(spin.mul(0.4).mul(air))
    // Shrinking into the litter over the last of its lying; and hidden, far up, past the share shown.
    const left = smoothstep(1, mix(falls, float(1), 0.5), phase)
    const along = corner.y.sub(0.5).mul(size).mul(left)
    const across = corner.x.sub(0.5).mul(size).mul(0.6).mul(left)
    // Tilted about x, rolled about z, then turned about up: the corner and the normal alike.
    const ct = cos(tilt)
    const st = sin(tilt)
    const cr = cos(roll)
    const sr = sin(roll)
    const cy = cos(yaw)
    const sy = sin(yaw)
    const turn = (p: Node<'vec3'>) => {
      const y1 = p.y.mul(ct).sub(p.z.mul(st))
      const z1 = p.y.mul(st).add(p.z.mul(ct))
      const x2 = p.x.mul(cr).sub(y1.mul(sr))
      const y2 = p.x.mul(sr).add(y1.mul(cr))
      return vec3(x2.mul(cy).add(z1.mul(sy)), y2, x2.negate().mul(sy).add(z1.mul(cy)))
    }
    const hidden = step(shown, fract(draw.x.mul(57.1).add(draw.y.mul(13.7)))).mul(999)
    return { at: vec3(x, y, z), corner: turn(vec3(across, 0, along)), normal: turn(vec3(0, 1, 0)), hidden }
  }

  const material = new MeshLambertNodeMaterial({ side: DoubleSide, alphaTest: 0.5 })
  material.positionNode = Fn(() => {
    const leaf = leafNow()
    normalLocal.assign(leaf.normal)
    return leaf.at.add(leaf.corner).add(vec3(0, leaf.hidden, 0))
  })()
  // The leaf's shape on its quad, pointed at both ends.
  const draw = attribute<'vec2'>('draw')
  const corner = attribute<'vec2'>('corner')
  const along = corner.y.mul(2).sub(1)
  const across = abs(corner.x.mul(2).sub(1)).div(max(along.mul(along).oneMinus(), 1e-4))
  material.opacityNode = step(across, float(1))
  const painted = paint(fract(draw.x.mul(31.7)), fract(draw.y.mul(17.3)), along, across)
  material.colorNode = vec4(painted, 1)
  // Its own colour as its own light, but no light for the bloom to halo. Typed on the standard node material but not on
  // the Lambert one; three's node material reads it on both.
  ;(material as unknown as { emissiveNode: Node }).emissiveNode = painted.mul(glow)
  leaveOutOfBloom(material)

  const object = new Mesh(geometry, material)
  object.frustumCulled = false
  object.castShadow = object.receiveShadow = false

  const falling: FallingLeaves = {
    object,
    look,
    set() {
      shown.value = look.amount
      square.value = Math.max(1, look.square)
      height.value = Math.max(0.5, look.height)
      sway.value = look.sway
      tumble.value = look.tumble
      wind.value.set(look.windX, look.windZ)
      size.value = look.size
      look.colours.forEach((c, k) => colours[k]!.value.set(c))
      stray.value = look.stray
      glow.value = look.glow
      edge.value = look.edge
      vein.value = look.vein
      // A round: the fall, at its speed, and the lying after it.
      const fall = look.height / Math.max(0.05, look.speed)
      falls.value = fall / (fall + Math.max(0.01, look.lies))
      object.visible = look.amount > 0
    },
    update(dt, x, z) {
      const fall = look.height / Math.max(0.05, look.speed)
      time.value += dt
      rounds.value += dt / (fall + Math.max(0.01, look.lies))
      centre.value.set(x, z)
    },
  }
  falling.set()
  return falling
}

export function mountFallControls(falling: FallingLeaves): void {
  const container = document.createElement('div')
  container.style.cssText = 'position:fixed;bottom:8px;left:276px;z-index:1000'
  document.body.append(container)
  const gui = new GUI({ title: 'falling leaves (prototype)', container, width: 240 } as ConstructorParameters<typeof GUI>[0])
  gui.close()
  const { look } = falling
  const changed = () => falling.set()
  gui.add(look, 'amount', 0, 1, 0.01).name('how many').onChange(changed)
  gui.add(look, 'square', 4, 60, 1).name('square round her m').onChange(changed)
  gui.add(look, 'height', 1, 20, 0.1).name('fall from m').onChange(changed)
  gui.add(look, 'speed', 0.1, 4, 0.05).name('fall m/s').onChange(changed)
  gui.add(look, 'lies', 0, 20, 0.1).name('lies s').onChange(changed)
  gui.add(look, 'sway', 0, 2, 0.01).name('sway m').onChange(changed)
  gui.add(look, 'tumble', 0, 3, 0.01).name('tumble turns/s').onChange(changed)
  gui.add(look, 'windX', -5, 5, 0.1).name('wind x m').onChange(changed)
  gui.add(look, 'windZ', -5, 5, 0.1).name('wind z m').onChange(changed)
  gui.add(look, 'size', 0.03, 0.5, 0.005).name('size m').onChange(changed)
  const leaf = gui.addFolder('leaf').close()
  look.colours.forEach((_, k) => leaf.addColor(look.colours, k as 0).name(`colour ${k + 1}`).onChange(changed))
  leaf.add(look, 'stray', 0, 1, 0.01).name('brightness strays').onChange(changed)
  leaf.add(look, 'glow', 0, 1, 0.01).name('own colour, unlit (0 = lit only)').onChange(changed)
  leaf.add(look, 'edge', 0, 1, 0.01).name('edge dark').onChange(changed)
  leaf.add(look, 'vein', 0, 1, 0.01).name('vein dark').onChange(changed)
  // The values as the folder has them, to hand back; and the values the page started on.
  gui.add({ copy: () => {
    const text = JSON.stringify(look)
    console.log(text)
    void navigator.clipboard?.writeText(text)
  } }, 'copy').name('copy values')
  gui.add({ reset: () => gui.reset() }, 'reset').name('reset to defaults')
}
