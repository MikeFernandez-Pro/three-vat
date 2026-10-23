// The sewers as a scene for Blender, to model on: the level of sewers.ts at
// scale, metres, x east, z south (north is +Y in Blender). The stone stands
// at the faces as drawn, not at the walls' middle lines the run collides
// with: the floor laid again with no growth, its edge traced and stood up into
// walls of one height, deep water sunk into its channel, the canal's shallow
// bed sunk a little under its water. No vaults, no ceiling: the walls stop at
// the springing.
//
// Over it, every piece the play reads, as a named placeholder with its data
// as custom properties (glTF extras): the lights by look and their reach on
// the floor, the levers, the huge door and its three rods, the symbol door
// and its buttons, the plates, the gas jets, the holes and pipes, the
// chandeliers and their swing, the canal's edge,
// the corpse, the chest, the ladder, the checkpoints, the labels and the
// plan's props.
//
// Run by export-sewers.mjs, which writes the GLB.
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Path,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three'
import { GRID, lay, loops, sewers, type Grid, type Point } from '../src/sewers'

/** Where the walls stop, m: a guide for the vaults' springing, not a ceiling. */
const HEIGHT = 3.5
/** Deep water and its bed, and the canal's water and its bed, m below the walk. */
const WATER = -0.35
const BED = -1
const CANAL_WATER = -0.1
const CANAL_BED = -0.6

/** The grid's cells as the export reads them: 0 stone, 1 floor, 2 deep water, 3 the canal. */
const STONE = 0
const FLOOR = 1
const DEEP = 2
const CANAL = 3
const base = (cell: number) => (cell === DEEP ? BED : cell === CANAL ? CANAL_BED : 0)

export function buildSewers(): Group {
  const map = sewers()
  // The faces as drawn, the canal's cells marked: its grid is laid on the same cells.
  const grid = lay(map.pieces, 0)
  for (let k = 0; k < grid.cells.length; k++) if (grid.cells[k] === FLOOR && map.water.cells[k] === 1) grid.cells[k] = CANAL

  const root = new Group()
  root.name = 'Last Light sewers'
  root.userData = { units: 'm', axes: 'x east, z south (Blender: +Y north)', wallTop: HEIGHT, water: WATER, waterBed: BED, canalWater: CANAL_WATER, canalBed: CANAL_BED }
  root.add(stone(grid), gameplay(map))
  root.updateMatrixWorld(true)
  return root
}

const materials = new Map<string, MeshStandardMaterial>()
/** A plain material by name, made once; see-through below an opacity of 1, glowing if `glow`. */
function material(name: string, color: number, opacity = 1, glow = false): MeshStandardMaterial {
  let out = materials.get(name)
  if (!out) {
    out = new MeshStandardMaterial({ name, color, roughness: 1, metalness: 0, transparent: opacity < 1, opacity, emissive: glow ? color : 0x000000, depthWrite: opacity === 1 })
    materials.set(name, out)
  }
  return out
}

/** The stone: the floor, the walls, deep water's channel and water, the canal's bed and water. */
function stone(grid: Grid): Group {
  const group = new Group()
  group.name = 'Stone'
  const read = (x: number, z: number) => {
    const c = Math.floor((x - grid.minX) / GRID)
    const r = Math.floor((z - grid.minZ) / GRID)
    return c < 0 || r < 0 || c >= grid.cols || r >= grid.rows ? STONE : grid.cells[r * grid.cols + c]!
  }

  const walls = new Sides()
  // The outer edge, round everything that is not stone: up to the top from whatever floor it stands on.
  for (const loop of loops(grid, (v) => v !== STONE)) {
    eachEdge(loop, (a, b, n) => {
      for (const run of runs(a, b, n, 0.2, read)) walls.quad(run.from, run.to, base(run.cell), HEIGHT, n)
    })
  }
  // The walk's edge where it drops into deep water or the canal: down from the walk, facing away from it.
  const drops = new Sides()
  for (const loop of loops(grid, (v) => v === FLOOR)) {
    eachEdge(loop, (a, b, n) => {
      const away = { x: -n.x, z: -n.z }
      for (const run of runs(a, b, away, 0.2, read)) if (run.cell === DEEP || run.cell === CANAL) drops.quad(run.from, run.to, base(run.cell), 0, away)
    })
  }

  const add = (name: string, geometry: BufferGeometry, mat: MeshStandardMaterial) => {
    const mesh = new Mesh(geometry, mat)
    mesh.name = name
    group.add(mesh)
  }
  const stoneMat = material('stone', 0x6f7a72)
  add('floor', flat(loops(grid, (v) => v === FLOOR), 0), material('stone-floor', 0x56605a))
  add('walls', walls.geometry(), stoneMat)
  add('drops', drops.geometry(), stoneMat)
  add('water bed', flat(loops(grid, (v) => v === DEEP), BED), material('silt', 0x2c3328))
  add('water', flat(loops(grid, (v) => v === DEEP), WATER), material('water', 0x2e4a3c, 0.85))
  add('canal bed', flat(loops(grid, (v) => v === CANAL), CANAL_BED), material('silt', 0x2c3328))
  add('canal water', flat(loops(grid, (v) => v === CANAL), CANAL_WATER), material('water', 0x2e4a3c, 0.85))
  return group
}

/** Each side of a closed loop, with its normal toward the open side: the loops keep it on their left, x east, z south. */
function eachEdge(loop: Point[], visit: (a: Point, b: Point, n: Point) => void): void {
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length]!
    const l = Math.hypot(b.x - a.x, b.z - a.z)
    if (l > 0) visit(a, b, { x: (b.z - a.z) / l, z: -(b.x - a.x) / l })
  })
}

/** An edge cut where what lies `off` m beyond it, along `side`, changes, read every cell's length. */
function runs(a: Point, b: Point, side: Point, off: number, read: (x: number, z: number) => number): { from: Point; to: Point; cell: number }[] {
  const l = Math.hypot(b.x - a.x, b.z - a.z)
  const steps = Math.max(1, Math.round(l / GRID))
  const point = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
  const out: { from: Point; to: Point; cell: number }[] = []
  for (let s = 0; s < steps; s++) {
    const m = point((s + 0.5) / steps)
    const cell = read(m.x + side.x * off, m.z + side.z * off)
    const last = out[out.length - 1]
    if (last && last.cell === cell) last.to = point((s + 1) / steps)
    else out.push({ from: point(s / steps), to: point((s + 1) / steps), cell })
  }
  return out
}

/** Upright quads gathered into one geometry, uv in metres: along the wall, and up. */
class Sides {
  private positions: number[] = []
  private normals: number[] = []
  private uvs: number[] = []
  private u = 0

  /** A quad from `a` to `b`, `y0` to `y1`, facing `n`. */
  quad(a: Point, b: Point, y0: number, y1: number, n: Point): void {
    const l = Math.hypot(b.x - a.x, b.z - a.z)
    const A = [a.x, y0, a.z, this.u, y0]
    const B = [b.x, y0, b.z, this.u + l, y0]
    const C = [b.x, y1, b.z, this.u + l, y1]
    const D = [a.x, y1, a.z, this.u, y1]
    // A, B, C turns to face (-dz, dx): the open side's normal is (dz, -dx), so wind the other way when it is asked for.
    const flip = -(b.z - a.z) * n.x + (b.x - a.x) * n.z < 0
    const tris = flip ? [A, C, B, A, D, C] : [A, B, C, A, C, D]
    for (const v of tris) {
      this.positions.push(v[0]!, v[1]!, v[2]!)
      this.normals.push(n.x, 0, n.z)
      this.uvs.push(v[3]!, v[4]!)
    }
    this.u += l
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.positions, 3))
    g.setAttribute('normal', new Float32BufferAttribute(this.normals, 3))
    g.setAttribute('uv', new Float32BufferAttribute(this.uvs, 2))
    return g
  }
}

/** Twice a loop's signed area in (x, z): below 0 round the outside of what it encloses, above 0 round a hole in it. */
const area = (loop: Point[]) => loop.reduce((s, a, i) => s + a.x * loop[(i + 1) % loop.length]!.z - loop[(i + 1) % loop.length]!.x * a.z, 0)

function inside(loop: Point[], p: Point): boolean {
  let hit = false
  for (let k = 0, j = loop.length - 1; k < loop.length; j = k++) {
    const a = loop[j]!
    const b = loop[k]!
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit
  }
  return hit
}

/** Loops filled flat at height `y`, each hole in the smallest outer loop round it; uv in metres. */
function flat(all: Point[][], y: number): BufferGeometry {
  const outers = all.filter((l) => area(l) < 0)
  const shapes = outers.map((l) => new Shape(l.map((p) => new Vector2(p.x, -p.z))))
  for (const hole of all.filter((l) => area(l) > 0)) {
    let best = -1
    outers.forEach((o, k) => {
      if (inside(o, hole[0]!) && (best < 0 || -area(o) < -area(outers[best]!))) best = k
    })
    if (best >= 0) shapes[best]!.holes.push(new Path(hole.map((p) => new Vector2(p.x, -p.z))))
  }
  const g = new ShapeGeometry(shapes)
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  return g
}

/** Every piece the play reads, as placeholders. */
function gameplay(map: ReturnType<typeof sewers>): Group {
  const layer = new Group()
  layer.name = 'Gameplay (placeholders)'
  const folder = (name: string) => {
    const g = new Group()
    g.name = name
    layer.add(g)
    return g
  }
  const box = (parent: Object3D, name: string, w: number, h: number, d: number, mat: MeshStandardMaterial, x: number, y: number, z: number, data: Record<string, unknown> = {}, angle = 0): Mesh => {
    const mesh = new Mesh(new BoxGeometry(w, h, d), mat)
    mesh.name = name
    mesh.position.set(x, y + h / 2, z)
    mesh.rotation.y = angle
    mesh.userData = data
    parent.add(mesh)
    return mesh
  }
  const cylinder = (parent: Object3D, name: string, r: number, h: number, mat: MeshStandardMaterial, x: number, y: number, z: number, data: Record<string, unknown> = {}): Mesh => {
    const mesh = new Mesh(new CylinderGeometry(r, r, h, 16), mat)
    mesh.name = name
    mesh.position.set(x, y + h / 2, z)
    mesh.userData = data
    parent.add(mesh)
    return mesh
  }
  const empty = (parent: Object3D, name: string, x: number, y: number, z: number, data: Record<string, unknown> = {}): Object3D => {
    const o = new Object3D()
    o.name = name
    o.position.set(x, y, z)
    o.userData = data
    parent.add(o)
    return o
  }
  const ring = (parent: Object3D, name: string, r: number, mat: MeshStandardMaterial, x: number, z: number, data: Record<string, unknown> = {}): Mesh => {
    const mesh = new Mesh(new RingGeometry(Math.max(0, r - 0.04), r, 48).rotateX(-Math.PI / 2), mat)
    mesh.name = name
    mesh.position.set(x, 0.02, z)
    mesh.userData = data
    parent.add(mesh)
    return mesh
  }
  const line = (parent: Object3D, name: string, points: Point[], y: number, color: number, data: Record<string, unknown> = {}): Line => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(points.flatMap((p) => [p.x, y, p.z]), 3))
    const l = new Line(g, new LineBasicMaterial({ color, name: `line-${name}` }))
    l.name = name
    l.userData = data
    parent.add(l)
    return l
  }
  /** The angle that turns a placeholder's +z to face along `n`. */
  const facing = (n: Point) => Math.atan2(n.x, n.z)
  const pad = (k: number) => String(k).padStart(2, '0')

  const flameMat = material('flame', 0xffa040, 1, true)
  const ironMat = material('iron', 0x3a3a3e)
  const woodMat = material('wood', 0x6b4a2e)
  const reachMat = material('light-reach', 0xfff0c0, 0.6, true)
  const gasMat = material('gas', 0x9fbf3a, 0.3)

  // The start, with a child-sized block for scale.
  box(layer, 'start (child, ~1.2 m)', 0.4, 1.2, 0.3, material('child', 0xe07a20), map.level.start.x, 0, map.level.start.z)

  // The lights: each on the floor where it stands, its reach drawn round it; a chandelier hung from the wall tops,
  // swinging along its axis.
  const lights = folder('Lights')
  map.lights.forEach((light, k) => {
    const swing = map.chandeliers.find((c) => c.light === k)
    const data: Record<string, unknown> = { look: light.look, reach: light.reach, flame: light.flame }
    if (swing) Object.assign(data, { axisX: swing.axis.x, axisZ: swing.axis.z, amplitude: swing.amplitude, period: swing.period, phase: swing.phase })
    const o = empty(lights, `light.${pad(k)} ${light.name}`, light.x, 0, light.z, data)
    if (light.look === 'lamp') box(o, `${light.name}.body`, 0.22, 0.4, 0.22, flameMat, 0, 0, 0)
    if (light.look === 'brazier') {
      cylinder(o, `${light.name}.bowl`, 0.35, 0.9, ironMat, 0, 0, 0)
      cylinder(o, `${light.name}.flame`, 0.25, 0.4, flameMat, 0, 0.9, 0)
    }
    if (light.look === 'fire') {
      cylinder(o, `${light.name}.ring`, 0.7, 0.4, ironMat, 0, 0, 0)
      cylinder(o, `${light.name}.flame`, 0.55, 0.8, flameMat, 0, 0.4, 0)
    }
    if (light.look === 'chandelier' && swing) {
      cylinder(o, `${light.name}.chain`, 0.03, HEIGHT - 2.5, ironMat, 0, 2.5, 0)
      cylinder(o, `${light.name}.ring`, 0.5, 0.12, flameMat, 0, 2.4, 0)
      const a = swing.amplitude
      line(o, `${light.name}.swing`, [{ x: -swing.axis.x * a, z: -swing.axis.z * a }, { x: swing.axis.x * a, z: swing.axis.z * a }], 2.45, 0xffa040)
    }
    ring(o, `${light.name}.reach`, light.reach, reachMat, 0, 0)
  })

  // The levers: a post and its handle.
  const levers = folder('Levers')
  for (const lever of map.levers) {
    const o = empty(levers, `lever.${lever.name}`, lever.x, 0, lever.z, { hold: lever.hold })
    box(o, `lever.${lever.name}.post`, 0.2, 1, 0.2, ironMat, 0, 0, 0)
    box(o, `lever.${lever.name}.handle`, 0.08, 0.6, 0.08, woodMat, 0, 1, 0)
  }

  // The doors: the huge one, shut by three rods, the hub's moving last; the symbol door and its four buttons.
  const doors = folder('Doors')
  const slab = (name: string, a: Point, b: Point, thick: number, mat: MeshStandardMaterial, data: Record<string, unknown>) =>
    box(doors, name, Math.hypot(b.x - a.x, b.z - a.z), HEIGHT, thick, mat, (a.x + b.x) / 2, 0, (a.z + b.z) / 2, data, -Math.atan2(b.z - a.z, b.x - a.x))
  for (const door of map.doors) {
    const mesh = slab(door.name, door.from, door.to, 0.4, woodMat, { hold: door.hold, pushX: door.at.x, pushZ: door.at.z })
    const length = Math.hypot(door.to.x - door.from.x, door.to.z - door.from.z)
    ;(['gas', 'water', 'hub'] as const).forEach((name, k) => {
      const rod = new Mesh(new CylinderGeometry(0.06, 0.06, length + 0.6, 12).rotateZ(Math.PI / 2), ironMat)
      rod.name = `${door.name}.rod.${name}`
      rod.position.set(0, 0.9 + k * 0.85 - HEIGHT / 2, -0.3)
      mesh.add(rod)
    })
    empty(doors, `${door.name}.push`, door.at.x, 0, door.at.z)
  }
  slab('symbol door', map.symbolDoor.from, map.symbolDoor.to, 0.3, ironMat, {})
  map.buttons.forEach((button, k) => {
    const o = empty(doors, `symbol door.button.${k + 1} ${button.symbol}`, button.x, 0, button.z, { symbol: button.symbol, order: k + 1 })
    box(o, `button.${button.symbol}.stand`, 0.3, 1, 0.3, ironMat, 0, 0, 0)
    box(o, `button.${button.symbol}.face`, 0.24, 0.24, 0.08, material('glyph', 0xc8b070), 0, 1, 0)
  })

  // The cistern's plates, numbered I to IV.
  const plates = folder('Plates')
  const numerals = ['I', 'II', 'III', 'IV']
  for (const plate of map.plates) cylinder(plates, `plate.${numerals[plate.numeral - 1]} ${plate.symbol}`, 0.45, 0.04, material('glyph', 0xc8b070), plate.x, 0, plate.z, { numeral: plate.numeral, symbol: plate.symbol })

  // The gas jets: a nozzle on the wall, the cloud it puts out, as far as it reaches.
  const jets = folder('Gas jets')
  map.jets.forEach((jet, k) => {
    const o = empty(jets, `jet.${pad(k)}`, jet.x, 0, jet.z, { dx: jet.dx, dz: jet.dz, length: jet.length, half: jet.half, period: jet.period, on: jet.on, phase: jet.phase })
    o.rotation.y = facing({ x: jet.dx, z: jet.dz })
    cylinder(o, `jet.${pad(k)}.nozzle`, 0.1, 0.25, ironMat, 0, 0.8, 0.1)
    box(o, `jet.${pad(k)}.cloud`, jet.half * 2, 1.6, jet.length, gasMat, 0, 0, jet.length / 2)
  })

  // The escape holes in the chandeliers' gallery, at the foot of the wall nearest each: rats go in, none comes out.
  const escapes = folder('Escape holes')
  map.escapes.forEach((hole, k) => box(escapes, `escape.${pad(k)}`, 2 * hole.half, 0.25, 0.4, material('hole', 0x050505), hole.x, 0, hole.z, { half: hole.half }, Math.atan2(hole.dx, hole.dz) - Math.PI / 2))

  // The way: the canal's edge, the ladder, the corpse, the chest.
  const way = folder('Way')
  const edge = new Group()
  edge.name = 'canal edge (no rat crosses)'
  way.add(edge)
  map.ratWalls.forEach((wall, k) => line(edge, `canal edge.${pad(k)}`, [wall.from, wall.to], 0.05, 0xd02020))
  box(way, 'ladder (climbs to the manhole)', 0.6, 6, 0.1, ironMat, map.ladder.x, 0, map.ladder.z)
  empty(way, 'manhole', map.ladder.x, 6, map.ladder.z)
  box(way, 'corpse (the key)', 0.5, 0.3, 1.6, material('bone', 0xd8d0b8), map.corpse.x, 0, map.corpse.z)
  box(way, 'chest', 0.8, 0.5, 0.5, woodMat, map.chest.x, 0, map.chest.z)

  // The checkpoints: their zone, and where the child stands again.
  const checkpoints = folder('Checkpoints')
  ;(map.level.checkpoints ?? []).forEach((c, k) => {
    const mesh = box(checkpoints, `checkpoint.${k} ${k === map.hubZone ? 'hub' : k === map.cisternZone ? 'landing' : ''}`.trim(), c.maxX - c.minX, 0.05, c.maxZ - c.minZ, material('checkpoint', 0x2080d0, 0.35), (c.minX + c.maxX) / 2, 0, (c.minZ + c.maxZ) / 2)
    mesh.userData = { atX: c.at.x, atZ: c.at.z }
  })

  // The plan's labels and props: names to model to, nothing the play reads.
  const labels = folder('Labels')
  for (const label of map.labels) empty(labels, `label: ${label.text}`, label.x, 0, label.z)
  const props = folder('Props')
  const counts = new Map<string, number>()
  for (const prop of map.props) {
    const n = counts.get(prop.kind) ?? 0
    counts.set(prop.kind, n + 1)
    const size = prop.size ?? 0.5
    const data = { kind: prop.kind, angle: prop.angle ?? 0, size }
    box(props, `prop.${prop.kind}.${pad(n)}`, size, prop.kind === 'ladder' ? 3 : 0.3, prop.kind === 'pipes' ? 0.3 : size, material(`prop-${prop.kind}`, 0x9a8a6a), prop.x, 0, prop.z, data, prop.angle ?? 0)
  }
  return layer
}
