// The old road's walls: what is left of the walls that once ran beside it,
// broken down, out in the dark between its fires. Built of the arches' stone
// (arches.ts, `createStone`): the road's slabs, painted, tiled and wet as the
// walls folder has them, in a toon shell of their own.
//
// Four kinds to try (`RoadWallStyle`), each its own rule for what is left:
// - field: low dry-stone walls along one side or the other, long runs, a
//   breach here and there;
// - lane: the road walled on both sides, taller, as a lane between fields;
// - ruins: short, tall pieces of a building's walls, broken in steps, some
//   still turning a corner away from the road;
// - tumbled: walls all but gone, a course or three high.
//
// Each wall a block of stone along the road, bending with it, its top broken
// course by course, falling away from its higher end. None stands by an arch: the wall breaks
// off either side of it and leaves the arch its gap. All one mesh, laid again
// on every change, hugging the ground as it rolls. She, her goslings and the
// rats keep out of them.
import { BufferAttribute, BufferGeometry, Mesh } from 'three/webgpu'
import { attribute, positionLocal } from 'three/tsl'
import { alongOf, clearRoad, createStone, intoClear, roadAt, type ArchShell, type ArchStone } from './arches'
import type { Plain, Point } from './plain'
import type { RoadLine } from './road'
import { random } from './swarm'
import { WALL_THICKNESS, type Wall } from './walls'

export type RoadWallStyle = 'field' | 'lane' | 'ruins' | 'tumbled'

/** The kinds of wall the walls folder offers, and none. */
export const ROAD_WALL_STYLES = ['none', 'field', 'lane', 'ruins', 'tumbled'] as const

/**
 * The walls as the walls folder edits them: which kind; how many stand along the road; how far the face of each is
 * off the road's middle, m; how tall, how thick and how long, times the kind's; and the seed their shapes and places
 * are drawn from.
 */
export interface RoadWallLook {
  style: (typeof ROAD_WALL_STYLES)[number]
  count: number
  off: number
  height: number
  thickness: number
  length: number
  seed: number
}

/** As the walls folder was set on 2026-10-25: a lane, eight runs either side, low and thin. */
export function defaultRoadWallLook(): RoadWallLook {
  return { style: 'lane', count: 8, off: 1.7, height: 0.45, thickness: 0.4, length: 1, seed: 65 }
}

/** How far along the road from a fire no wall stands, m, either way: clear of its brazier, its scene and its light. */
export const ROAD_WALL_CLEAR = 5
/** How far along the road from an arch's middle no wall stands, m, either way: clear of its legs and its foot. */
export const ROAD_WALL_DOOR_GAP = 1.2

/**
 * A block of stone, a wall: its middle line, from one end to the other, a point at each end of each of its columns;
 * how thick it is, m; how tall its top stands over each column, m off the ground; and how far down into the ground it
 * goes, m.
 */
export interface StoneBlock {
  line: Point[]
  thick: number
  tops: number[]
  bottom: number
}

/**
 * A kind of wall: how long a run, m; how tall, m; how thick, m; whether on both sides of the road; the chance of a
 * breach in a run; of a corner turning away from the road at its higher end; and how much of its height it falls away
 * by toward its lower end, at the most.
 */
interface Kind {
  length: [number, number]
  height: [number, number]
  thick: number
  both: boolean
  breach: number
  corner: number
  fall: number
}

const KINDS: Record<RoadWallStyle, Kind> = {
  field: { length: [4, 8], height: [0.7, 1.05], thick: 0.45, both: false, breach: 0.5, corner: 0, fall: 0.5 },
  lane: { length: [5, 9], height: [1.1, 1.5], thick: 0.5, both: true, breach: 0.4, corner: 0, fall: 0.5 },
  ruins: { length: [1.6, 3.4], height: [1.6, 2.6], thick: 0.6, both: false, breach: 0, corner: 0.6, fall: 0.8 },
  tumbled: { length: [3, 6], height: [0.3, 0.65], thick: 0.55, both: false, breach: 0.3, corner: 0, fall: 0.6 },
}

/** How wide a column of a wall's top is, m: how finely it breaks along its length. */
const COLUMN = 0.3
/** How tall a course of its stones is, m: its top breaks in steps of it. */
const COURSE = 0.17
/** How far a wall goes down into the ground, m, so it stands on a slope. */
const BURY = 0.35
/** How short a piece of wall is left out, m, once cut round the arches. */
const SHORTEST = 1
/** How far apart the shell's strokes are counted on the stone, m, as the arches'. */
const STROKE_BODY = 0.9

const between = ([from, to]: readonly [number, number], t: number) => from + (to - from) * t
const unit = (p: Point) => {
  const l = Math.hypot(p.x, p.z) || 1
  return { x: p.x / l, z: p.z / l }
}
/** How many columns of a wall one of its bodies takes. */
const BODY_COLUMNS = 4
/** How many columns of a wall one of the rats' walls takes along it. */
const RAT_COLUMNS = 8

/**
 * Either face of `block`'s middle line, at each of its points: its left (+1, to the left of the way it runs) or right
 * face, set out half its thickness, mitred at its bends so its columns meet; and its sides' ways, along each column.
 */
function facesOf({ line, thick }: StoneBlock): { left: Point[]; right: Point[]; ways: Point[] } {
  const ways = line.slice(1).map((p, k) => unit({ x: p.x - line[k]!.x, z: p.z - line[k]!.z }))
  const left: Point[] = []
  const right: Point[] = []
  line.forEach((p, i) => {
    const a = ways[Math.max(0, i - 1)]!
    const b = ways[Math.min(ways.length - 1, i)]!
    const n = unit({ x: -(a.z + b.z), z: a.x + b.x })
    // As far out as the faces need for the column after to stand its thickness off the line, no further than half again.
    const miter = Math.min(1.5, 1 / Math.max(1e-3, n.x * -b.z + n.z * b.x))
    const out = (thick / 2) * miter
    left.push({ x: p.x + n.x * out, z: p.z + n.z * out })
    right.push({ x: p.x - n.x * out, z: p.z - n.z * out })
  })
  return { left, right, ways }
}

/** How many columns a wall `length` m long breaks into. */
const columnsOf = (length: number) => Math.max(1, Math.round(length / COLUMN))

/**
 * A wall's top, `length` m long, `height` m tall at its higher end, as `kind` breaks it: column by column, falling
 * away toward its lower end, its end columns crumbled a course or two, maybe a breach near its middle down to its
 * footing, and every column a whole number of courses. Its higher end the first (`high` 0) or the last, drawn if not given.
 */
function topsOf(length: number, height: number, kind: Kind, rand: () => number, high = rand() < 0.5 ? 0 : 1): { tops: number[]; high: number } {
  const columns = columnsOf(length)
  const fall = kind.fall * (0.4 + 0.6 * rand())
  const breach = rand() < kind.breach ? { at: 0.25 + 0.5 * rand(), half: (0.4 + 0.5 * rand()) / length } : undefined
  const tops = Array.from({ length: columns }, (_, k) => {
    const t = (k + 0.5) / columns
    const low = high === 0 ? t : 1 - t
    let top = height * (1 - fall * low ** 1.5) * (0.9 + 0.2 * rand())
    if (k === 0 || k === columns - 1) top -= COURSE * Math.floor(rand() * 3)
    if (breach && Math.abs(t - breach.at) < breach.half) top = COURSE * (1 + Math.floor(rand() * 2))
    return Math.max(COURSE, Math.round(top / COURSE) * COURSE)
  })
  return { tops, high }
}

/** `[a, b]` with every `cuts` stretch taken out, the pieces left at least SHORTEST long. */
function cutAround(a: number, b: number, cuts: readonly [number, number][]): [number, number][] {
  let pieces: [number, number][] = [[a, b]]
  for (const [from, to] of cuts) {
    pieces = pieces.flatMap(([p, q]): [number, number][] => {
      if (to <= p || from >= q) return [[p, q]]
      return [
        [p, Math.min(q, from)],
        [Math.max(p, to), q],
      ].filter(([x, y]) => y > x) as [number, number][]
    })
  }
  return pieces.filter(([p, q]) => q - p >= SHORTEST)
}

/**
 * The walls along the road through `plain`, as `line` lays it, as `look` has them: `look.count` runs evenly spaced up
 * the road from her start to home, a little off even, never within ROAD_WALL_CLEAR of a fire along it, nor within
 * ROAD_WALL_DOOR_GAP of any of `doors`, the arches over it; each beside the road, its face `look.off` m off its middle,
 * on one side or, for a lane, both; some turning a corner.
 */
export function roadWallsOf(plain: Plain, line: RoadLine, look: RoadWallLook, doors: readonly Point[] = []): StoneBlock[] {
  if (look.style === 'none' || look.count < 1) return []
  const { thick, length: lengths, ...rest } = KINDS[look.style]
  const kind: Kind = { ...rest, thick: thick * look.thickness, length: [lengths[0] * look.length, lengths[1] * look.length] }
  const road = clearRoad(plain, line, ROAD_WALL_CLEAR)
  if (road.total <= 0) return []
  const gaps = doors.map((door): [number, number] => {
    const at = alongOf(line, road.along, door)
    return [at - ROAD_WALL_DOOR_GAP, at + ROAD_WALL_DOOR_GAP]
  })
  const rand = random(look.seed)
  const blocks: StoneBlock[] = []
  for (let k = 0; k < look.count; k++) {
    const middle = intoClear(road, ((k + 0.5 + (rand() - 0.5) * 0.5) / look.count) * road.total)
    // The clear stretch it is in: no run reaches out of it toward a fire.
    const [from, to] = road.clear.find(([a, b]) => middle >= a - 1e-9 && middle <= b + 1e-9) ?? road.clear[0]!
    for (const side of kind.both ? [-1, 1] : [rand() < 0.5 ? -1 : 1]) {
      const length = between(kind.length, rand())
      const at = middle + (kind.both ? (rand() - 0.5) * 2 : 0)
      const height = between(kind.height, rand()) * look.height
      const corner = rand() < kind.corner
      const turnLength = between([1, 2.2], rand())
      for (const [a, b] of cutAround(Math.max(from, at - length / 2), Math.min(to, at + length / 2), gaps)) {
        // Its middle line beside the road and bending with it, off the road's by its face's distance and half its
        // thickness, a point at each end of each column.
        const beside = (along: number) => {
          const on = roadAt(line, road.along, along)
          const off = side * (look.off + kind.thick / 2)
          return { x: on.x - on.way.z * off, z: on.z + on.way.x * off }
        }
        const { tops, high } = topsOf(b - a, height, kind, rand)
        const wall = Array.from({ length: tops.length + 1 }, (_, i) => beside(a + ((b - a) * i) / tops.length))
        blocks.push({ line: wall, thick: kind.thick, tops, bottom: BURY })
        if (!corner) continue
        // A corner at its higher end, turning straight away from the road, from its far face on.
        const [endAt, before] = high === 0 ? [wall[0]!, wall[1]!] : [wall[wall.length - 1]!, wall[wall.length - 2]!]
        // The way the road runs there, and from the end back into the wall.
        const way = high === 0 ? unit({ x: before.x - endAt.x, z: before.z - endAt.z }) : unit({ x: endAt.x - before.x, z: endAt.z - before.z })
        const inward = high === 0 ? way : { x: -way.x, z: -way.z }
        const away = { x: -way.z * side, z: way.x * side }
        const from = { x: endAt.x + inward.x * (kind.thick / 2) + away.x * (kind.thick / 2), z: endAt.z + inward.z * (kind.thick / 2) + away.z * (kind.thick / 2) }
        const turnTops = topsOf(turnLength, height * between([0.8, 1], rand()), kind, rand, 0).tops
        blocks.push({
          line: Array.from({ length: turnTops.length + 1 }, (_, i) => ({ x: from.x + (away.x * turnLength * i) / turnTops.length, z: from.z + (away.z * turnLength * i) / turnTops.length })),
          thick: kind.thick,
          tops: turnTops,
          bottom: BURY,
        })
      }
    }
  }
  return blocks
}

/** What the walls in `blocks` stand on, as bodies on the ground, a few columns each so they bend with the walls: each its middle and its outline from that, m. */
export function roadWallStones(blocks: readonly StoneBlock[]): { at: Point; outline: Point[] }[] {
  return blocks.flatMap((block) => {
    const { left, right } = facesOf(block)
    const bodies: { at: Point; outline: Point[] }[] = []
    for (let i = 0; i < block.tops.length; i += BODY_COLUMNS) {
      const j = Math.min(i + BODY_COLUMNS, block.tops.length)
      const corners = [right[i]!, right[j]!, left[j]!, left[i]!]
      const at = { x: corners.reduce((sum, c) => sum + c.x, 0) / 4, z: corners.reduce((sum, c) => sum + c.z, 0) / 4 }
      bodies.push({ at, outline: corners.map((c) => ({ x: c.x - at.x, z: c.z - at.z })) })
    }
    return bodies
  })
}

/**
 * The walls in `blocks` as the rats keep out of them (walls.ts, each WALL_THICKNESS thick): straight pieces along
 * their middle lines, RAT_COLUMNS columns each; and, along a wall thicker than that, a piece just inside either face too.
 */
export function roadWallLines(blocks: readonly StoneBlock[]): Wall[] {
  return blocks.flatMap((block) => {
    const { line, thick } = block
    const { left, right } = facesOf(block)
    const ends: number[] = []
    for (let i = 0; i < block.tops.length; i += RAT_COLUMNS) ends.push(i)
    ends.push(block.tops.length)
    // How far from the middle line toward a face the faces' pieces stand, a share of the way.
    const inside = Math.max(0, (thick - WALL_THICKNESS) / thick)
    const lines = inside > 0.25 ? [0, inside, -inside] : [0]
    return ends.slice(1).flatMap((j, k) => {
      const i = ends[k]!
      const at = (n: number, share: number) => {
        const face = share >= 0 ? left[n]! : right[n]!
        const s = Math.abs(share)
        return { x: line[n]!.x + (face.x - line[n]!.x) * s, z: line[n]!.z + (face.z - line[n]!.z) * s }
      }
      return lines.map((share) => ({ from: at(i, share), to: at(j, share) }))
    })
  })
}

type Vec = [number, number, number]

/**
 * `blocks` as one geometry, on the ground `groundAt` has under each point of them: their faces, their tops and the
 * steps between, bending with their lines, with the stone's texture layout (`createStone`): `stoneUv`, where on the
 * face, m; `stoneAlong` and `stoneOut`, the ways those grow; and `stoneUp`, how far up off the ground, m.
 */
export function blocksGeometry(blocks: readonly StoneBlock[], groundAt: (x: number, z: number) => number): BufferGeometry {
  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []
  const alongs: number[] = []
  const outs: number[] = []
  const up: number[] = []
  /** A corner: where on the ground, how far up off it, and where on its face's texture. */
  type Corner = { at: Point; y: number; u: number; v: number }
  const quad = (corners: [Corner, Corner, Corner, Corner], facing: Vec, along: Vec, out: Vec) => {
    const [a, b, c] = corners
    const ab = [b.at.x - a.at.x, b.y - a.y, b.at.z - a.at.z]
    const ac = [c.at.x - a.at.x, c.y - a.y, c.at.z - a.at.z]
    const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!]
    const facingRight = cross[0]! * facing[0] + cross[1]! * facing[1] + cross[2]! * facing[2] > 0
    const [p0, p1, p2, p3] = facingRight ? corners : [corners[0], corners[3], corners[2], corners[1]]
    for (const p of [p0, p1, p2, p0, p2, p3]) {
      position.push(p.at.x, p.y + groundAt(p.at.x, p.at.z), p.at.z)
      normal.push(...facing)
      uv.push(p.u, p.v)
      alongs.push(...along)
      outs.push(...out)
      up.push(p.y)
    }
  }
  blocks.forEach((block, index) => {
    const { thick, tops, bottom } = block
    const { left, right, ways } = facesOf(block)
    // How far along its line each point is, m, its slabs laid from a place of its own so no two walls match.
    const along = [index * 3.7]
    for (let i = 1; i < block.line.length; i++) along.push(along[i - 1]! + Math.hypot(block.line[i]!.x - block.line[i - 1]!.x, block.line[i]!.z - block.line[i - 1]!.z))
    const t = thick / 2
    const corner = (at: Point, y: number, u: number, v: number): Corner => ({ at, y, u, v })
    for (let k = 0; k < tops.length; k++) {
      const h = tops[k]!
      const way = ways[k]!
      const across: Vec = [-way.z, 0, way.x]
      const ahead: Vec = [way.x, 0, way.z]
      const [s0, s1] = [along[k]!, along[k + 1]!]
      for (const [face, sign] of [[left, 1], [right, -1]] as const) {
        quad([corner(face[k]!, -bottom, s0, -bottom), corner(face[k + 1]!, -bottom, s1, -bottom), corner(face[k + 1]!, h, s1, h), corner(face[k]!, h, s0, h)], [across[0] * sign, 0, across[2] * sign], ahead, [0, 1, 0])
      }
      quad([corner(right[k]!, h, s0, -t), corner(right[k + 1]!, h, s1, -t), corner(left[k + 1]!, h, s1, t), corner(left[k]!, h, s0, t)], [0, 1, 0], ahead, across)
      // The step down to the next column, facing the lower side; or its far end, facing out.
      const next = k + 1 < tops.length ? tops[k + 1]! : -bottom
      if (next !== h) {
        const [low, high] = next < h ? [next, h] : [h, next]
        const facing: Vec = next < h ? ahead : [-ahead[0], 0, -ahead[2]]
        quad([corner(right[k + 1]!, low, -t, low), corner(left[k + 1]!, low, t, low), corner(left[k + 1]!, high, t, high), corner(right[k + 1]!, high, -t, high)], facing, across, [0, 1, 0])
      }
      if (k === 0) quad([corner(right[0]!, -bottom, -t, -bottom), corner(left[0]!, -bottom, t, -bottom), corner(left[0]!, h, t, h), corner(right[0]!, h, -t, h)], [-ahead[0], 0, -ahead[2]], across, [0, 1, 0])
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3))
  geometry.setAttribute('stoneUv', new BufferAttribute(new Float32Array(uv), 2))
  geometry.setAttribute('stoneAlong', new BufferAttribute(new Float32Array(alongs), 3))
  geometry.setAttribute('stoneOut', new BufferAttribute(new Float32Array(outs), 3))
  geometry.setAttribute('stoneUp', new BufferAttribute(new Float32Array(up), 1))
  geometry.computeBoundingSphere()
  return geometry
}

/** The walls drawn: laid where `lay` has them, their slabs as `setStone` has them, in the shell as `setShell` has it. */
export interface RoadWalls {
  object: Mesh
  lay(blocks: readonly StoneBlock[]): void
  setStone(stone: ArchStone): void
  setShell(look: ArchShell): void
}

/** The walls, none laid yet, their slabs as `stone` has them, standing on the ground `groundAt` has under them. */
export async function createRoadWalls(stone: ArchStone, groundAt: (x: number, z: number) => number = () => 0): Promise<RoadWalls> {
  // Laid in the world's metres, so where a point is is where it is, and how far up off the ground its own.
  const slabs = await createStone(stone, STROKE_BODY, () => ({ metres: positionLocal, offGround: attribute<'float'>('stoneUp', 'float') }))
  const object = new Mesh(new BufferGeometry(), slabs.shell)
  object.castShadow = object.receiveShadow = true
  object.visible = false
  return {
    object,
    lay(blocks) {
      const old = object.geometry
      object.geometry = blocksGeometry(blocks, groundAt)
      old.dispose()
      object.visible = blocks.length > 0
    },
    setStone: slabs.setStone,
    setShell: slabs.setShell,
  }
}
