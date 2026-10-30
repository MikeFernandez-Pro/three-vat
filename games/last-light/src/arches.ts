// The old road's arches: pointed gateways of stone the road (road.ts) was laid
// through in the days it was kept, still standing over it all the way up the
// plain: what is left of a way someone once marked, and a shape she reads it
// by from further off than the slabs. `public/models/gothicArchDoor.glb`, the
// arch whole, one mesh.
//
// As many as the road folder asks for stand evenly spaced along the road from
// her start to home, but never within ARCH_CLEAR of a fire along it, the road
// running through each, square to it. She and her goslings keep out of its
// legs (gooseplay.ts, `setStones`); the rats run through them. Sized and raised
// or sunk as the ground folder has it (`ArchLook`).
//
// It is built of the road's stone: the road's slabs laid along the arch as the
// road lays them along the road, up one leg, over the point and down the
// other, and across it out from its middle line, or through it on its inner
// and outer faces (`archSurface`), as big, turned, coloured and as deep in
// relief as the doors folder has them (`ArchStone`), and as wet (`ArchWet`):
// darker, more saturated and glossier where the water is, its joints filled,
// damp rising from the ground and streaks run down; in a toon shell of its
// own, its highlight, strokes and steps the doors folder's (`ArchShell`). Both
// start much as the road and the floor are as the page opens (main.ts). The
// file has no texture layout of its own, so the arch's is worked out as it
// loads.
import { BufferAttribute, Group, Mesh, Vector2, type BufferGeometry, type Node } from 'three/webgpu'
import { attribute, cameraViewMatrix, float, hue, mix, modelWorldMatrix, mx_noise_float, normalWorld, positionLocal, renderGroup, saturation, smoothstep, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { loadRoad, type RoadLook } from './ground'
import type { Plain, Point } from './plain'
import type { RoadLine } from './road'
import { ShellToonMaterial, type PaintLook, type ShellLook } from './shell'
import type { ToonLook } from './toon'
import { createStrokes } from './strokes'

/** How far along the road from a fire no arch stands, m, either way: clear of its brazier and its scene. */
export const ARCH_CLEAR = 4

/** An arch over the road: where its middle stands, and which way the road runs through it, a unit vector. */
export interface Arch extends Point {
  way: Point
}

/**
 * The arches as the road, ground and doors folders edit them, read live: how many stand along the road, how big one is,
 * times the file's size, its metres (9.5 m tall), how far up off the ground it stands, m, less than nought sunk into
 * it.
 */
export interface ArchLook {
  count: number
  scale: number
  y: number
}

/** The arches as set on 2026-10-25: five, 3.8 m tall, sunk a metre into the ground. */
export function defaultArchLook(): ArchLook {
  return { count: 5, scale: 0.38, y: -1 }
}

/**
 * The road's slabs on the arch as the doors folder edits them, read live: their painting and tiles, as the road folder
 * has the road's (ground.ts); how far the tiles are slid along the stone and up it, m, none if not given; and how wet.
 */
export type ArchStone = Pick<RoadLook, 'lightness' | 'saturation' | 'hue' | 'scale' | 'rotation' | 'relief'> & { offsetX?: number; offsetY?: number; wet: ArchWet }

/**
 * How wet the arch's stone is, as the doors folder edits it, read live. `wetness` how wet where it is wettest, 0 dry;
 * where wet, the stone `darken` darker (0 not, 1 black), `saturate` more saturated, its highlight `shine` times the
 * shell's and its joints `fill`ed (0 its full relief, 1 flat); where dry, its highlight `dryShine` times the shell's.
 * Wet all over up to `rise` m off the ground, drying over `fade` m above, `top` as wet as that above (0 dry, 1 as wet);
 * and `streaks` of it run down the stone from there (0 none, 1 as wet), each about `streakWidth` m wide and
 * `streakLength` m long.
 */
export interface ArchWet {
  wetness: number
  darken: number
  saturate: number
  shine: number
  dryShine: number
  fill: number
  rise: number
  fade: number
  top: number
  streaks: number
  streakWidth: number
  streakLength: number
}

/** As the doors folder was set on 2026-10-25: a little wet, wettest near the ground with wide streaks down, dull where dry. */
export function defaultArchWet(): ArchWet {
  return { wetness: 0.27, darken: 0, saturate: 0, shine: 1.84, dryShine: 0.32, fill: 0.13, rise: 1.45, fade: 0.59, top: 0.03, streaks: 0.2, streakWidth: 0.65, streakLength: 1.65 }
}

/** The arches' own toon shell as the doors folder edits it, read live: its highlight and rim, its painted strokes and its toon steps. */
export type ArchShell = ShellLook & { paint: PaintLook; toon: ToonLook }

/**
 * The file, in its own units: the arch's mesh, and the middle of its foot. The
 * arch runs across z, its legs ±MODEL_LEGS off its middle, each MODEL_LEG
 * either way square; the road goes through it along x. Its shape, from its
 * foot's middle: its legs' middle lines straight up to MODEL_SPRING, then on
 * each side an arc MODEL_ARC round the other leg's middle line at that height,
 * the two meeting over the middle, a third of the way round each.
 */
const MODEL = './models/gothicArchDoor.glb'
const MODEL_MESH = 'door003'
const MODEL_FOOT = { y: -4.644, z: -2.5 }
const MODEL_LEGS = 2.5
const MODEL_LEG = 0.456
const MODEL_SPRING = 4.644
const MODEL_ARC = 5
/** How far the arch's middle line runs from a foot to the point over the middle, in the file's units. */
const MODEL_HALF = MODEL_SPRING + (MODEL_ARC * Math.PI) / 3
/** How far apart the shell's strokes are counted on the stone, as the scenes' bodies'. */
const STROKE_BODY = 0.9

/**
 * `count` arches over the road through `plain`, as `line` lays it: evenly spaced along the road from her start up
 * through the braziers to home, over what is left of it once ARCH_CLEAR either way of each fire is taken out.
 */
export function archesOf(plain: Plain, line: RoadLine, count: number): Arch[] {
  const road = clearRoad(plain, line, ARCH_CLEAR)
  if (road.total <= 0 || count < 1) return []
  return Array.from({ length: count }, (_, k) => roadAt(line, road.along, intoClear(road, ((k + 0.5) / count) * road.total)))
}

/**
 * The road through `plain`, as `line` lays it, clear of its fires: how far along it each of its points is from its first,
 * m; the stretches of it clear of every fire by `clear` m either way, from her start to home, from and to how far along;
 * and how long they are all together.
 */
export interface ClearRoad {
  along: number[]
  clear: [number, number][]
  total: number
}

/** The road `line` lays through `plain`, its stretches `clear` m clear of every fire either way (`ClearRoad`). */
export function clearRoad(plain: Plain, line: RoadLine, clear: number): ClearRoad {
  const { points } = line
  if (points.length < 2) return { along: [], clear: [], total: 0 }
  const along = [0]
  for (let k = 1; k < points.length; k++) along.push(along[k - 1]! + Math.hypot(points[k]!.x - points[k - 1]!.x, points[k]!.z - points[k - 1]!.z))
  // Each fire where the road passes it, along it.
  const fires = [plain.start, ...plain.braziers, plain.home].map((p) => alongOf(line, along, p)).sort((a, b) => a - b)
  const stretches: [number, number][] = []
  for (let k = 0; k + 1 < fires.length; k++) {
    const from = fires[k]! + clear
    const to = fires[k + 1]! - clear
    if (to > from) stretches.push([from, to])
  }
  return { along, clear: stretches, total: stretches.reduce((sum, [from, to]) => sum + to - from, 0) }
}

/** How far along the road `line` lays, `along` how far along each of its points is, it passes nearest `p`, m. */
export function alongOf({ points }: RoadLine, along: readonly number[], p: Point): number {
  let best = 0
  points.forEach((q, k) => {
    if (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(points[best]!.x - p.x, points[best]!.z - p.z)) best = k
  })
  return along[best]!
}

/** How far along the whole road `into` m into its clear stretches is, the stretches laid end to end. */
export function intoClear({ clear }: ClearRoad, into: number): number {
  let stretch = 0
  while (stretch + 1 < clear.length && into > clear[stretch]![1] - clear[stretch]![0]) into -= clear[stretch]![1] - clear[stretch++]![0]
  return clear[stretch]![0] + into
}

/** Where on the road `line` lays it is, `at` m along it, `along` how far along each of its points is; and which way it runs there, a unit vector. */
export function roadAt({ points }: RoadLine, along: readonly number[], at: number): Point & { way: Point } {
  let piece = 0
  while (piece + 2 < points.length && along[piece + 1]! < at) piece++
  const a = points[piece]!
  const b = points[piece + 1]!
  const long = along[piece + 1]! - along[piece]! || 1
  const t = (at - along[piece]!) / long
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, way: { x: (b.x - a.x) / long, z: (b.z - a.z) / long } }
}

/** What `arch` stands on, `size` times the file's size, as bodies on the ground: its two legs, each one's middle, and its outline from that, m. */
export function archStones(arch: Arch, size: number): { at: Point; outline: Point[] }[] {
  const { way } = arch
  // From the file's x along the road and z across it to the ground's.
  const onGround = (x: number, z: number) => ({ x: (x * way.x - z * way.z) * size, z: (x * way.z + z * way.x) * size })
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => onGround(x! * MODEL_LEG, z! * MODEL_LEG))
  return [-MODEL_LEGS, MODEL_LEGS].map((leg) => {
    const middle = onGround(0, leg)
    return { at: { x: arch.x + middle.x, z: arch.z + middle.z }, outline: corners }
  })
}

/**
 * Where (z, y) on the arch's face lies in the arch's own way, in the file's units from its foot's middle: how far along
 * its middle line, from the left foot (z less than nought) up over the point and down to the right foot; how far out
 * of that line, toward its outside; and, on the face, which way along grows and which way out grows, (z, y) unit
 * vectors.
 */
export function archSurface(z: number, y: number): { along: number; out: number; way: { z: number; y: number }; outward: { z: number; y: number } } {
  const side = z < 0 ? -1 : 1
  let up: number
  let out: number
  let way: { z: number; y: number }
  let outward: { z: number; y: number }
  if (y <= MODEL_SPRING) {
    up = y
    out = Math.abs(z) - MODEL_LEGS
    way = { z: 0, y: 1 }
    outward = { z: side, y: 0 }
  } else {
    // Round the other leg's middle line at the spring: from level there, up toward the point.
    const dz = z + side * MODEL_LEGS
    const dy = y - MODEL_SPRING
    const r = Math.hypot(dz, dy) || 1
    const angle = Math.atan2(dy, side * dz)
    up = MODEL_SPRING + MODEL_ARC * Math.min(angle, Math.PI / 3)
    out = r - MODEL_ARC
    way = { z: -side * Math.sin(angle), y: Math.cos(angle) }
    outward = { z: dz / r, y: dy / r }
  }
  // The left side climbed, the right come down.
  return side < 0 ? { along: up, out, way, outward } : { along: 2 * MODEL_HALF - up, out, way: { z: -way.z, y: -way.y }, outward }
}

/**
 * The arch's own texture layout on `geometry`, its foot's middle on the origin, as attributes: `stoneUv`, how far
 * along it and how far out of its middle line on its two faces, or how far through it on its inner and outer faces,
 * in the file's units; and `stoneAlong` and `stoneOut`, the ways each of those grows, in the file's frame.
 */
function layOut(geometry: BufferGeometry): void {
  const position = geometry.getAttribute('position')
  const normal = geometry.getAttribute('normal')
  const uv = new Float32Array(position.count * 2)
  const along = new Float32Array(position.count * 3)
  const out = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const surface = archSurface(position.getZ(i), position.getY(i))
    along.set([0, surface.way.y, surface.way.z], i * 3)
    // On a face the arch is seen flat on, out of its middle line; on its inner and outer faces, through it.
    const flat = Math.abs(normal.getX(i)) > 0.5
    uv.set([surface.along, flat ? surface.out : x], i * 2)
    out.set(flat ? [0, surface.outward.y, surface.outward.z] : [1, 0, 0], i * 3)
  }
  geometry.setAttribute('stoneUv', new BufferAttribute(uv, 2))
  geometry.setAttribute('stoneAlong', new BufferAttribute(along, 3))
  geometry.setAttribute('stoneOut', new BufferAttribute(out, 3))
}

/** The arches drawn: laid over the road where `lay` has them, sized as `set` has them, its slabs as `setStone` has them, in the shell as `setShell` has it. */
export interface Arches {
  object: Group
  lay(arches: readonly Arch[]): void
  set(look: ArchLook): void
  setStone(stone: ArchStone): void
  setShell(look: ArchShell): void
}

/** The arches, from the file, none laid yet, its slabs as `stone` has them, standing on the ground `groundAt` has under them. */
export async function createArches(look: ArchLook, stone: ArchStone, groundAt: (x: number, z: number) => number = () => 0): Promise<Arches> {
  const file = (await new GLTFLoader().loadAsync(MODEL)).scene
  file.updateMatrixWorld(true)
  const model = file.getObjectByName(MODEL_MESH) as Mesh
  const geometry = (model.geometry as BufferGeometry).clone().applyMatrix4(model.matrixWorld).translate(0, -MODEL_FOOT.y, -MODEL_FOOT.z)
  layOut(geometry)
  // How far it is sunk, for heights off the ground in metres; its strokes counted on the stone at the size it is first set to.
  const sunk = uniform(look.y).setGroup(renderGroup)
  const slabs = await createStone(stone, STROKE_BODY / look.scale, (size) => {
    const metres = positionLocal.mul(size)
    return { metres, offGround: metres.y.add(sunk) }
  })
  const object = new Group()
  let laid: readonly Arch[] = []
  const setStretch = () => {
    slabs.setSize(look.scale)
    sunk.value = look.y
  }
  setStretch()
  const place = () => {
    object.children.forEach((mesh, k) => {
      const { x, z, way } = laid[k]!
      mesh.position.set(x, groundAt(x, z) + look.y, z)
      // The file's x turned onto the road's way.
      mesh.rotation.y = Math.atan2(-way.z, way.x)
      mesh.scale.setScalar(look.scale)
    })
  }
  return {
    object,
    lay(arches) {
      laid = arches
      object.clear()
      for (let k = 0; k < arches.length; k++) {
        const arch = new Mesh(geometry, slabs.shell)
        arch.castShadow = arch.receiveShadow = true
        object.add(arch)
      }
      place()
    },
    set(next) {
      look = next
      setStretch()
      place()
    },
    setStone: slabs.setStone,
    setShell: slabs.setShell,
  }
}

/** The road's slabs on a piece of stone, drawn: its shell, its slabs as `setStone` has them, `setSize` m to a unit of it, in the shell as `setShell` has it. */
export interface Stone {
  shell: ShellToonMaterial
  setStone(stone: ArchStone): void
  setSize(size: number): void
  setShell(look: ArchShell): void
}

/**
 * The road's slabs, its colour and normal maps, laid on a piece of stone as the floor lays them along the road, by its
 * geometry's `stoneUv`, where on it in its units, and `stoneAlong` and `stoneOut`, the ways those grow in its frame: its
 * tiles stretched to `setSize`'s metres a unit, turned, coloured by a hue, saturation and lightness and leaning by a
 * relief, and as wet as `stone` has them, `where` saying, from the size, where a point is in metres and how far it is
 * up off the ground. Its strokes counted `extent` of its units apart.
 */
export async function createStone(stone: ArchStone, extent: number, where: (size: Node<'float'>) => { metres: Node<'vec3'>; offGround: Node<'float'> }): Promise<Stone> {
  const [roadColour, roadNormal] = await loadRoad()
  const colourMap = texture(roadColour)
  const normalMap = texture(roadNormal)
  const stretch = uniform(1).setGroup(renderGroup)
  const slide = uniform(new Vector2()).setGroup(renderGroup)
  const turn = uniform(new Vector2(1, 0)).setGroup(renderGroup)
  const turned = uniform(0).setGroup(renderGroup)
  const saturated = uniform(1).setGroup(renderGroup)
  const lightness = uniform(1).setGroup(renderGroup)
  const relief = uniform(1).setGroup(renderGroup)
  // How wet, and where (`ArchWet`).
  const wetness = uniform(0).setGroup(renderGroup)
  const darken = uniform(0).setGroup(renderGroup)
  const saturate = uniform(0).setGroup(renderGroup)
  const shine = uniform(1).setGroup(renderGroup)
  const dryShine = uniform(1).setGroup(renderGroup)
  const fill = uniform(0).setGroup(renderGroup)
  const rise = uniform(1).setGroup(renderGroup)
  const fade = uniform(1).setGroup(renderGroup)
  const top = uniform(0).setGroup(renderGroup)
  const streaks = uniform(0).setGroup(renderGroup)
  const streakWidth = uniform(0.1).setGroup(renderGroup)
  const streakLength = uniform(1).setGroup(renderGroup)
  const size = uniform(1).setGroup(renderGroup)
  // Where it is wet, 0 to 1: up from the ground, less above, and streaks run down from there, long and thin, upright.
  const { metres, offGround } = where(size)
  const low = float(1).sub(smoothstep(rise, rise.add(fade), offGround))
  const streak = smoothstep(0.15, 0.55, mx_noise_float(vec3(metres.x.div(streakWidth), metres.z.div(streakWidth), metres.y.div(streakLength))))
  const height = mix(top, 1, low)
  const wet = height.add(streak.mul(streaks).mul(float(1).sub(height))).clamp().mul(wetness)
  const laidAt = attribute<'vec2'>('stoneUv', 'vec2').add(slide).mul(stretch)
  const at = vec2(laidAt.x.mul(turn.x).sub(laidAt.y.mul(turn.y)), laidAt.x.mul(turn.y).add(laidAt.y.mul(turn.x)))
  const onGround = (name: string) => modelWorldMatrix.mul(vec4(attribute<'vec3'>(name, 'vec3'), 0)).xyz.normalize()
  const along = onGround('stoneAlong')
  const out = onGround('stoneOut')
  const u = along.mul(turn.x).sub(out.mul(turn.y))
  const v = along.mul(turn.y).add(out.mul(turn.x))
  const painted = colourMap.sample(at).rgb
  // Its lean alone: its blue holds the road's height, not the normal's (ground.ts).
  const mapped = normalMap.sample(at).xyz.mul(2).sub(1)
  const wetNormal = normalWorld.add(u.mul(mapped.x).add(v.mul(mapped.y)).mul(relief.mul(float(1).sub(fill.mul(wet))))).normalize()
  const shell = new ShellToonMaterial({
    painted: { strokes: createStrokes(), extent, base: cameraViewMatrix.mul(vec4(wetNormal, 0)).xyz.normalize() },
    specularScale: mix(dryShine, shine, wet),
  })
  shell.colorNode = saturation(hue(painted, turned), saturated.mul(saturate.mul(wet).add(1)))
    .mul(lightness)
    .mul(float(1).sub(darken.mul(wet)))
  let tile = stone.scale
  let offset = { x: 0, y: 0 }
  // Its tiles' size and slide in metres, in its own units.
  const setStretch = () => {
    stretch.value = size.value / Math.max(0.05, tile)
    slide.value.set(offset.x / size.value, offset.y / size.value)
  }
  const setStone = (next: ArchStone) => {
    tile = next.scale
    offset = { x: next.offsetX ?? 0, y: next.offsetY ?? 0 }
    setStretch()
    const angle = (next.rotation * Math.PI) / 180
    turn.value.set(Math.cos(angle), Math.sin(angle))
    turned.value = (next.hue * Math.PI) / 180
    saturated.value = next.saturation
    lightness.value = next.lightness
    relief.value = next.relief
    const { wet } = next
    wetness.value = wet.wetness
    darken.value = wet.darken
    saturate.value = wet.saturate
    shine.value = wet.shine
    dryShine.value = wet.dryShine
    fill.value = wet.fill
    rise.value = wet.rise
    fade.value = Math.max(0.01, wet.fade)
    top.value = wet.top
    streaks.value = wet.streaks
    streakWidth.value = Math.max(0.01, wet.streakWidth)
    streakLength.value = Math.max(0.01, wet.streakLength)
  }
  setStone(stone)
  return {
    shell,
    setStone,
    setSize(next) {
      size.value = next
      setStretch()
    },
    setShell(next) {
      shell.set(next)
      shell.setPaint(next.paint)
      shell.setToon(next.toon)
    },
  }
}
