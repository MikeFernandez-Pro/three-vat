// The tree on the pond's island: public/models/oak-3118.glb (brought in on
// 2026-11-02), an oak of justASimpleTree's, seed 3118, in leaf, as its own export
// writes it (glb.js): the wood, and the cards with their shade baked in their
// colours. It keeps the colours its file carries, the ramps in its materials'
// extras, but is drawn as the dead trees are (deadtrees.ts): their bark's relief
// on its wood colour, their tips thinned, their leaf texture, their shell,
// its wood and leaves swaying in a wind of its own (treesway.ts). At its foot its
// bark gives way to the floor's grass, as the dead trees' does.
//
// Its leaves fall as justASimpleTree's do (falling-leaves.js): from inside the
// crown, drifting downwind, levelling out as they near the ground, creeping on
// as they settle, then shrinking away, one cell of the leaf texture each, its
// shade of the tree's colours. There each lives in a compute shader; here each
// walks a path laid once, from a card of the crown to where it lands on the island
// or the water, all of it in the vertex shader, as the game's other falling leaves
// (fallingleaves.prototype.ts): one mesh, no storage and no compute pass. They cast
// no shadow, as those don't.
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshLambertNodeMaterial, NoColorSpace, Sphere, TextureLoader, Uint16BufferAttribute, Vector2, Vector3, type BufferAttribute, type Material, type Node, type Texture } from 'three/webgpu'
import { attribute, float, floor, fract, Fn, mix, mx_noise_vec3, normalLocal, renderGroup, rotate, saturation, sin, smoothstep, step, texture, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { LEAF_TEXTURE, createBark, createFootGrass, createLeafMaterial, createStretches, defaultBarkLook, defaultGrassLook, defaultLeafLook, thinTips, type BarkLook, type GrassLook, type LeafLook, type Stretches } from './deadtrees'
import type { FloorLook } from './ground'
import { modelLoader } from './gltf'
import type { Point } from './plain'
import { groundOf, islandMiddle, type PondLook } from './pond'
import { leaveOutOfBloom } from './post'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import { createStrokes } from './strokes'
import { random } from './swarm'
import type { ToonLook } from './toon'
import { cardCentres, createTreeWind, defaultTreeWindLook, type TreeWindLook } from './treesway'

const MODEL = './models/oak-3118.glb'
/** How far round its middle the file's trunk stands, m, over its first fork; and at its foot, what he and the goslings keep out of. */
const MODEL_TRUNK = 0.26
const MODEL_FOOT = 0.45
/** The strokes' size over a scene piece, m, as goosescenes.ts lays them. */
const STROKE_BODY = 0.9
/** The most leaves falling at once, a quad each. */
const MOST_FALLING = 512
/** How much of a leaf's life it may spend in the air: the rest it lies on the ground and shrinks away. */
const MOST_IN_AIR = 0.85
/** How fast a leaf drifts downwind in the air and creeps once it has landed, m/s for each m of the wind's strength: justASimpleTree's AIR_DRIFT and FLOOR_CREEP. */
const AIR_DRIFT = 2
const FLOOR_CREEP = 0.15
/** How high over the ground a leaf lies, m, how far over it it levels out, m, and how far it rocks either way above that, rad. */
const LIES_AT = 0.02
const LEVELS_OUT = 0.9
const ROCK = 1.2
/** How far the wind's turbulence strays a leaf off its path, m. */
const STRAYS = 0.6
/** How much more vivid than the tree's colours a falling leaf is. */
const VIVID = 1.25

/** What the tree folder edits. */
export interface IslandTreeLook {
  show: boolean
  /** Where it stands off the island's middle, m, and how far up or down from the ground there. */
  x: number
  z: number
  y: number
  /** Which way it is turned, degrees about y. */
  turn: number
  /** How tall it stands, m. */
  size: number
  /** Its wood's colour, the file's own to start. */
  wood: number
  leaves: LeafLook
  wind: TreeWindLook
  fall: IslandFallLook
  /** Its bark and the floor's grass up its foot, as the dead trees' (deadtrees.ts). */
  bark: BarkLook
  grass: GrassLook
}

/** What the tree's falling leaves folder edits, justASimpleTree's values to start. */
export interface IslandFallLook {
  /** How many fall at once. */
  amount: number
  /** How long one lives, s, from leaving the crown to shrinking away. */
  lifetime: number
  /** How fast one comes down, m/s, and how wide it is, m. */
  speed: number
  size: number
}

/**
 * The tree to start: in the island's top left as the game's camera sees it, the far side from him and the left, beside
 * the tent, the picnic in front of it; 5 m tall, its crown over the tent and the nest;
 * the wind justASimpleTree's own for an oak, blowing the way the dead trees' does. Its leaves' bands split the baked
 * shade about a fifth shadow, half mid and a third light, which this file's shade (0.25 to 0.95) needs.
 */
export function defaultIslandTreeLook(): IslandTreeLook {
  return {
    show: true,
    x: -3.1,
    z: -0.6,
    y: -0.05,
    turn: 0,
    size: 5,
    wood: 0xffffff,
    leaves: { ...defaultLeafLook(), shadowTo: 0.45, lightFrom: 0.8 },
    wind: { ...defaultTreeWindLook(), strength: 0.22 },
    fall: { amount: 277, lifetime: 14, speed: 0.42, size: 0.17 },
    bark: defaultBarkLook(),
    grass: defaultGrassLook(),
  }
}

/** One leaf's fall: where it leaves the crown and lands, m, and the share of its life it is in the air. */
export interface LeafFall {
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
  inAir: number
}

/**
 * `count` leaves' falls: each from one of `crown`, drifting `drift` m/s along `downwind` (a unit x and z) as it comes down
 * at `speed` m/s, to the ground `groundAt` has where it lands; `lifetime` s long, in the air MOST_IN_AIR of that at most,
 * however far it has to come.
 */
export function leafFalls(crown: readonly Point3[], count: number, seed: number, { speed, lifetime }: { speed: number; lifetime: number }, downwind: Point, drift: number, groundAt: (x: number, z: number) => number): LeafFall[] {
  const next = random(seed)
  const pace = Math.max(0.01, speed)
  return Array.from({ length: count }, () => {
    const from = crown[Math.floor(next() * crown.length) % crown.length]!
    // The ground where it lands sets how long it falls and so where it lands: the island's so gentle that twice is enough.
    let seconds = 0
    let to = { x: from.x, y: groundAt(from.x, from.z), z: from.z }
    for (let k = 0; k < 2; k++) {
      seconds = Math.max(0, from.y - to.y) / pace
      const x = from.x + downwind.x * drift * seconds
      const z = from.z + downwind.z * drift * seconds
      to = { x, y: groundAt(x, z), z }
    }
    return { from: { ...from }, to, inAir: Math.min(MOST_IN_AIR, seconds / Math.max(0.01, lifetime)) }
  })
}

/** A point in the world, m. */
export interface Point3 {
  x: number
  y: number
  z: number
}

/** The falling leaves drawn: laid once, and laid again as anything their paths go by changes. */
interface TreeFall {
  object: Mesh
  lay(falls: readonly LeafFall[]): void
  /** The look's values, the tree's colours and the wind's. */
  set(look: IslandTreeLook, downwind: Point): void
  update(dt: number): void
}

/** The tree's falling leaves, each cut out by a cell of `leaf`, the leaf texture, white leaves on black. */
function createTreeFall(leaf: Texture): TreeFall {
  const count = MOST_FALLING
  const corners = new Float32Array(count * 4 * 2)
  const draws = new Float32Array(count * 4 * 4)
  const index = new Uint16Array(count * 6)
  const next = random(29)
  for (let k = 0; k < count; k++) {
    // How far through its life it starts, its own seed, its shade of the colours, and where it comes in the amount shown.
    const draw = [next(), next(), next(), k / count]
    for (let c = 0; c < 4; c++) {
      corners.set([c === 1 || c === 2 ? 1 : 0, c === 2 || c === 3 ? 1 : 0], (k * 4 + c) * 2)
      draws.set(draw, (k * 4 + c) * 4)
    }
    // Wound so the front faces up as it lies: a double-sided back face flips its normal, and a leaf seen from above would go dark.
    index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 2, k * 4 + 3, k * 4], k * 6)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(count * 4 * 3), 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(new Float32Array(count * 4 * 3), 3))
  geometry.setAttribute('corner', new Float32BufferAttribute(corners, 2))
  geometry.setAttribute('landing', new Float32BufferAttribute(new Float32Array(count * 4 * 4), 4))
  geometry.setAttribute('draw', new Float32BufferAttribute(draws, 4))
  geometry.setIndex(new Uint16BufferAttribute(index, 1))

  /** The leaves' clock, s, on with the play's. */
  const clock = uniform(0).setGroup(renderGroup)
  const lifetime = uniform(14).setGroup(renderGroup)
  const shown = uniform(0.5).setGroup(renderGroup)
  const size = uniform(0.17).setGroup(renderGroup)
  const glow = uniform(0).setGroup(renderGroup)
  const gustSpeed = uniform(0.83).setGroup(renderGroup)
  const gustSize = uniform(0.05).setGroup(renderGroup)
  /** How fast a leaf creeps downwind once it has landed, m/s along x and z. */
  const creep = uniform(new Vector2()).setGroup(renderGroup)
  const colours = { shadow: uniform(new Color()).setGroup(renderGroup), mid: uniform(new Color()).setGroup(renderGroup), light: uniform(new Color()).setGroup(renderGroup) }
  const [shadow, mid, light] = [colours.shadow, colours.mid, colours.light] as unknown as Node<'vec3'>[]

  const from = attribute<'vec3'>('position')
  const landing = attribute<'vec4'>('landing')
  const corner = attribute<'vec2'>('corner')
  const draw = attribute<'vec4'>('draw')
  const material = new MeshLambertNodeMaterial({ side: DoubleSide, alphaTest: 0.5 })
  material.positionNode = Fn(() => {
    const life = fract(clock.div(lifetime).add(draw.x))
    const seed = draw.y
    const down = life.div(landing.w.max(1e-3)).min(1)
    const onPath = mix(from, landing.xyz, down)
    // 0 high up, rising smoothly to 1 at the ground.
    const level = smoothstep(0, 1, float(1).sub(onPath.y.sub(landing.y).div(LEVELS_OUT).clamp(0, 1)))
    const strays = mx_noise_vec3(from.mul(gustSize.mul(4)).add(time.mul(gustSpeed).mul(0.25))).mul(STRAYS).mul(float(1).sub(level))
    // Landed, it creeps on downwind for the rest of its life.
    const lain = life.sub(landing.w).max(0).mul(lifetime)
    const at = onPath.add(strays).add(vec3(creep.x, 0, creep.y).mul(lain)).add(vec3(0, LIES_AT, 0))
    // Grows in as it leaves the tree, shrinks away at the end; past the amount shown, none of it.
    const grown = life.div(0.03).min(float(1).sub(life).div(0.15)).clamp(0, 1)
    const scale = size.mul(grown).mul(seed.mul(0.6).add(0.7)).mul(step(draw.w, shown))
    // A flat leaf, face up, rocking about that as it falls and turning slowly; level by the time it lands, and still after.
    const phase = at.y.mul(4).add(seed.mul(Math.PI * 2))
    const rock = vec3(sin(phase), 0, sin(phase.mul(0.7).add(1.3))).mul(float(ROCK).mul(float(1).sub(level)))
    const heading = vec3(0, at.y.mul(1.5).add(seed.mul(Math.PI * 2)), 0)
    const place = (v: Node<'vec3'>) => rotate(rotate(rotate(v, vec3(-Math.PI / 2, 0, 0)), rock), heading)
    normalLocal.assign(place(vec3(0, 0, 1)))
    return at.add(place(vec3(corner.x.sub(0.5), corner.y.sub(0.5), 0).mul(scale)))
  })()
  // One cell of the leaf texture's 2 x 2, each leaf its own.
  const cell = floor(fract(draw.y.mul(7.3)).mul(4))
  material.opacityNode = texture(leaf, corner.add(vec2(cell.mod(2), floor(cell.div(2)))).mul(0.5)).r
  // The tree's mid colour, each leaf its own shade of it, a little toward the shadow's to a little toward the light's, a touch more vivid.
  const painted = saturation(mix(mix(mid!, shadow!, 0.4), mix(mid!, light!, 0.4), draw.z), VIVID) as unknown as Node<'vec3'>
  material.colorNode = vec4(painted, 1)
  // Its own colour as its own light, as the crown's, but no light for the bloom to halo. Typed on the standard node
  // material but not on the Lambert one; three's node material reads it on both.
  ;(material as unknown as { emissiveNode: Node }).emissiveNode = painted.mul(glow)
  leaveOutOfBloom(material)

  const object = new Mesh(geometry, material)
  object.castShadow = object.receiveShadow = false
  const point = new Vector3()
  return {
    object,
    lay(falls) {
      const places = geometry.getAttribute('position') as BufferAttribute
      const lands = geometry.getAttribute('landing') as BufferAttribute
      // Round where they fall, and the most they stray: three culls the mesh by it, unseen from the road.
      const bound = new Sphere()
      const seen: Vector3[] = []
      falls.forEach(({ from: a, to: b, inAir }, k) => {
        for (let c = 0; c < 4; c++) {
          places.setXYZ(k * 4 + c, a.x, a.y, a.z)
          lands.setXYZW(k * 4 + c, b.x, b.y, b.z, inAir)
        }
        seen.push(point.set(a.x, a.y, a.z).clone(), point.set(b.x, b.y, b.z).clone())
      })
      places.needsUpdate = lands.needsUpdate = true
      bound.setFromPoints(seen)
      bound.radius += STRAYS + 1
      geometry.boundingSphere = bound
    },
    set({ leaves, wind, fall }, downwind) {
      lifetime.value = Math.max(0.1, fall.lifetime)
      shown.value = fall.amount / MOST_FALLING
      size.value = fall.size
      glow.value = leaves.glow
      gustSpeed.value = wind.speed
      gustSize.value = 1 / Math.max(1, wind.gustSize)
      creep.value.set(downwind.x, downwind.z).multiplyScalar(wind.strength * FLOOR_CREEP)
      colours.shadow.value.setHex(leaves.shadow)
      colours.mid.value.setHex(leaves.mid)
      colours.light.value.setHex(leaves.light)
    },
    update(dt) {
      clock.value += dt
    },
  }
}

export interface IslandTree {
  /** The wood and the leaves, falling ones too. */
  readonly object: Group
  /** The crown alone, for the see-through to cut round him, the wood left whole. */
  readonly crown: Group
  readonly look: IslandTreeLook
  /** Stand it again on the island of `pond`, as the folder has it, and lay its falling leaves' paths again. */
  set(pond: PondLook): void
  /** Its trunk, a body he and the goslings keep out of; none while it is hidden. */
  trunk(): { at: Point; radius: number } | undefined
  /** Its wood's colour again, as the folder has it. */
  woodChanged(): void
  /** The bark folder's values again. */
  barkChanged(): void
  /** The grass folder's values again, and the floor's look it takes its grass from. */
  setGrass(floor: FloorLook): void
  /** Its leaves' colours again, as the leaves folder has them, on the crown and the falling leaves alike. */
  leavesChanged(): void
  /** The wind's values again, and the falling leaves' paths they drift along. */
  windChanged(): void
  /** The falling leaves folder's values again, and their paths. */
  fallChanged(): void
  /** The scene pieces' shell, as the look folder sets it. */
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
  /** The falling leaves `dt` s on. */
  update(dt: number): void
}

/** The tree, in `look`; its colours are its file's own, read from the ramps in its materials' extras. */
export async function createIslandTree(look: IslandTreeLook = defaultIslandTreeLook()): Promise<IslandTree> {
  const file = (await modelLoader().loadAsync(MODEL)).scene
  const part = (name: string) => file.getObjectByName(name) as Mesh
  const woodMesh = part('wood')
  const leafMesh = part('leaves')
  const wood = woodMesh.geometry.clone()
  thinTips(wood)
  const cards = leafMesh.geometry.clone()
  cardCentres(cards)
  cards.computeBoundingBox()
  const laid = cards.boundingBox!.max.y
  const { min, max } = cards.boundingBox!
  const crownReach = Math.max(-min.x, max.x, -min.z, max.z)
  const leafFile = leafMesh.material as Material & { userData: { celRamp: [number, string][] } }
  const woodFile = woodMesh.material as Material & { userData: { celRamp: [number, string][] } }
  // The ramps' three colours, shadow, mid and light.
  const ramp = (material: { userData: { celRamp: [number, string][] } }) => material.userData.celRamp.map(([, colour]) => new Color(colour).getHex())
  ;[look.leaves.shadow, look.leaves.mid, look.leaves.light] = ramp(leafFile) as [number, number, number]
  look.wood = ramp(woodFile)[1]!

  const wind = createTreeWind(laid, MODEL_TRUNK, crownReach)
  const grass = createFootGrass()
  const barkLaid = createBark(grass)
  barkLaid.set(look.bark)
  const bark = new ShellToonMaterial({ color: look.wood, side: DoubleSide, painted: { strokes: createStrokes(), extent: (STROKE_BODY * laid) / look.size, base: barkLaid.normal } })
  bark.positionNode = wind.wood
  bark.colorNode = mix(barkLaid.colour, grass.colour, grass.amount)
  // The dead trees' leaf texture, white leaves on black, read as they read it.
  const leafMap = await new TextureLoader().loadAsync(LEAF_TEXTURE)
  leafMap.colorSpace = NoColorSpace
  const leafy = createLeafMaterial(texture(leafMap, uv()).r)
  const leafMaterial = leafy.material
  leafMaterial.positionNode = wind.leaves
  wind.flutter(leafMaterial)
  // In the shadow too, its alpha the colour's, its cut-out its own: three's shadow pass reads neither off the material.
  leafMaterial.colorNode = vec4(leafMaterial.colorNode as Node<'vec3'>, 1)
  leafMaterial.maskShadowNode = (leafMaterial.opacityNode as Node<'float'>).greaterThan(0.5)
  leafMaterial.shadowSide = DoubleSide

  let pond: PondLook | undefined
  const groundAt = (x: number, z: number) => (pond ? groundOf(pond, x, z) : 0)
  const woodStretch: Stretches = createStretches([wood], bark as Material, laid, groundAt, true)
  const crownStretch: Stretches = createStretches([cards], leafMaterial as Material, laid, groundAt, true)
  const fall = createTreeFall(leafMap)
  const object = new Group().add(woodStretch.object, crownStretch.object, fall.object)

  // The cards' centres, as laid: the crown's points the leaves fall from.
  const centres = cards.getAttribute('card')
  const cardAt = (k: number, scale: number, cos: number, sin: number, at: Point, foot: number): Point3 => {
    const x = centres.getX(k) * scale
    const z = centres.getZ(k) * scale
    return { x: at.x + x * cos + z * sin, y: foot + centres.getY(k) * scale, z: at.z - x * sin + z * cos }
  }
  const downwind = () => {
    const angle = (look.wind.direction * Math.PI) / 180
    return { x: Math.cos(angle), z: Math.sin(angle) }
  }
  const middleOf = (at: PondLook): Point => {
    const middle = islandMiddle(at)
    return { x: middle.x + look.x, z: middle.z + look.z }
  }
  const layFall = () => {
    if (!pond) return
    const at = middleOf(pond)
    const scale = look.size / laid
    const turn = (look.turn * Math.PI) / 180
    const foot = groundOf(pond, at.x, at.z) + look.y
    const crown = Array.from({ length: centres.count }, (_, k) => cardAt(k, scale, Math.cos(turn), Math.sin(turn), at, foot))
    const here = pond
    fall.lay(leafFalls(crown, MOST_FALLING, 3118, look.fall, downwind(), AIR_DRIFT * look.wind.strength, (x, z) => Math.max(groundOf(here, x, z), here.water)))
    fall.set(look, downwind())
  }
  leafy.set(look.leaves)
  wind.set(look.wind)

  return {
    object,
    crown: crownStretch.object,
    look,
    set(at) {
      pond = at
      object.visible = look.show && at.island.show
      const { x, z } = middleOf(at)
      const tree = { x, z, variant: 0, turn: (look.turn * Math.PI) / 180, height: look.size, width: look.size / laid, lift: look.y }
      woodStretch.lay([tree])
      crownStretch.lay([tree])
      layFall()
    },
    trunk() {
      if (!object.visible || !pond) return undefined
      return { at: middleOf(pond), radius: (MODEL_FOOT * look.size) / laid }
    },
    barkChanged() {
      barkLaid.set(look.bark)
    },
    setGrass(ground) {
      grass.set(look.grass, ground)
    },
    woodChanged() {
      bark.color.setHex(look.wood)
    },
    leavesChanged() {
      crownStretch.object.visible = look.leaves.show
      leafy.set(look.leaves)
      fall.set(look, downwind())
    },
    windChanged() {
      wind.set(look.wind)
      layFall()
    },
    fallChanged: layFall,
    setShell(shell) {
      bark.set(shell)
      bark.setPaint(shell.paint)
      bark.setToon(shell.toon)
      leafMaterial.set(shell)
      leafMaterial.setToon(shell.toon)
    },
    update: fall.update,
  }
}
