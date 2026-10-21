// The sewers' corridor drawn (2026-10-11): its floor and its walls, each in a
// surface of its own (surfaces.ts), the page laying both in the same look: two,
// since the see-through cuts the walls and never the floor. The walls are the level's, WALL_THICKNESS thick, each run
// half a thickness past its ends so the corners close; the floor runs under
// the level's box out to the walls' outer faces.
//
// The corridor stands open, its walls `height` high, or under a dome, as the
// test hall had it (ADR-0049, never merged): the walls running along it rise
// straight to where the arch springs, and the arch, a half circle of the
// corridor's half-width, tops out `height` up; lower than the half-width, a
// flatter segment of a wider circle, from the ground. The walls across its
// ends stand the dome's full height. The dome is the walls' stone, both its
// faces drawn: from above, the camera sees its outside.
//
// The camera looks in through whatever stands between it and the holder: the
// near wall, or the dome over him, is dithered away round him (blockout.ts's
// see-through), the floor never.
//
// Every face is laid in metres: its uv the point's place along the face's own
// two ways, which it carries as `tangentU` and `tangentV`, in the world, for
// the surface's normal map and parallax. A wall's long faces and top run
// along the wall, its sides and ends up it; the floor runs along x and z; the
// dome along the corridor and round its arch, on from the wall's height.
import { BufferAttribute, BufferGeometry, DoubleSide, Group, type Mesh, Vector3 } from 'three/webgpu'
import { seeThrough, type SeeThrough } from './blockout'
import type { Bounds } from './swarm'
import { materialsOf, type Surface } from './surfaces'
import { WALL_THICKNESS, type Wall } from './walls'

/** Open walls, or a dome over them. */
export type CorridorShape = 'open' | 'dome'

/** What the corridor folder edits: the width is the level's, its walls moved apart. */
export interface CorridorLook {
  /** How far apart the walls' faces stand, m. */
  width: number
  /** How high the walls stand, m: under a dome, its top. */
  height: number
  shape: CorridorShape
}

/** Segments round the dome's arch. */
const ARCH_SEGMENTS = 32

export interface Corridor {
  readonly object: Group
  /** Build it again round `walls` over `bounds`, `look`'s height and shape: the level's walls moved, or the folder's height or shape. */
  build(walls: readonly Wall[], bounds: Bounds, look: CorridorLook): void
  /** Where the see-through's hole is cut round, this frame: the holder. */
  seeThroughTo(subject: Vector3): void
  /** Take the see-through folder's values: the hole's size, its edge, its dither. */
  setSeeThrough(look: SeeThrough): void
}

/** The corridor, its floor in `floor`, its walls and dome in `wallSurface`, built when `build` is first called. */
export function createCorridor(floor: Surface, wallSurface: Surface): Corridor {
  const object = new Group()
  const empty = new BufferGeometry()
  const floorMeshes = floor.meshes(empty, false)
  const wallMeshes = wallSurface.meshes(empty, true)
  object.add(floorMeshes, wallMeshes)
  // Both faces: from above, the camera sees the dome's outside, and the hole through it.
  for (const material of materialsOf(wallSurface)) material.side = DoubleSide
  // The near wall and the dome dithered away round the holder; the floor is never cut.
  const see = seeThrough()
  const { subject, cut } = see
  for (const material of materialsOf(wallSurface)) cut(material)

  const lay = (group: Group, geometry: BufferGeometry) => {
    const meshes = group.children as Mesh[]
    if (meshes[0]!.geometry !== empty) meshes[0]!.geometry.dispose()
    for (const mesh of meshes) mesh.geometry = geometry
  }
  return {
    object,
    build(walls, bounds, { height, shape }) {
      const t = WALL_THICKNESS
      const half = (bounds.maxX - bounds.minX) / 2
      const middle = (bounds.maxX + bounds.minX) / 2
      const up = new Vector3(0, 1, 0)
      const ground = new Faces()
      ground.quad(new Vector3(bounds.minX - t, 0, bounds.minZ - t), new Vector3(1, 0, 0), new Vector3(0, 0, 1), 2 * half + 2 * t, bounds.maxZ - bounds.minZ + 2 * t, up)
      lay(floorMeshes, ground.geometry())

      // Under a dome the arch springs from straight sides, or from the ground where it is lower than the half-width.
      const straight = shape === 'dome' ? Math.max(0, height - half) : height
      const sides = new Faces()
      for (const { from, to } of walls) {
        const along = new Vector3(to.x - from.x, 0, to.z - from.z)
        // A wall along the corridor stops where the arch springs; one across it, an end, stands the full height.
        const tall = Math.abs(along.z) >= Math.abs(along.x) ? straight : height
        if (tall < 0.01) continue
        const length = along.length() + t
        along.normalize()
        const across = new Vector3(-along.z, 0, along.x)
        // The wall's foot at its start, half a thickness back and to one side.
        const foot = new Vector3(from.x, 0, from.z).addScaledVector(along, -t / 2).addScaledVector(across, -t / 2)
        // Its two long faces, its two ends, and its top.
        sides.quad(foot, along, up, length, tall, across.clone().negate())
        sides.quad(foot.clone().addScaledVector(across, t), along, up, length, tall, across)
        sides.quad(foot, across, up, t, tall, along.clone().negate())
        sides.quad(foot.clone().addScaledVector(along, length), across, up, t, tall, along)
        sides.quad(foot.clone().setY(tall), along, across, length, t, up)
      }
      if (shape === 'dome') sides.arch(middle, half, straight, height, bounds.minZ, bounds.maxZ)
      lay(wallMeshes, sides.geometry())
    },
    seeThroughTo(point) {
      subject.value.copy(point)
    },
    setSeeThrough: see.set,
  }
}

/** Faces gathered into one geometry, each laid in metres along its own two ways. */
class Faces {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []
  private readonly tangentU: number[] = []
  private readonly tangentV: number[] = []
  private readonly index: number[] = []

  /** The rectangle from `corner`, `width` along `u` and `height` along `v`, facing `normal`: wound to face it. */
  quad(corner: Vector3, u: Vector3, v: Vector3, width: number, height: number, normal: Vector3): void {
    const first = this.positions.length / 3
    for (const [a, b] of [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ]) {
      const p = corner.clone().addScaledVector(u, a).addScaledVector(v, b)
      // Laid by the world's place, so the stone runs on across faces that meet.
      this.vertex(p, normal, p.dot(u), p.dot(v), u, v)
    }
    // Counter-clockwise as seen from the side the normal faces.
    const facing = new Vector3().crossVectors(u, v).dot(normal) > 0
    if (facing) this.index.push(first, first + 1, first + 2, first, first + 2, first + 3)
    else this.index.push(first, first + 2, first + 1, first, first + 3, first + 2)
  }

  /**
   * The dome over the corridor centred on x `middle`, from z `minZ` to `maxZ`:
   * an arch from one wall's face, `half` out, at `straight` m up, over to the
   * other's, its top `top` m up, facing in. Laid along the corridor and round
   * the arch, on from the wall's own height.
   */
  arch(middle: number, half: number, straight: number, top: number, minZ: number, maxZ: number): void {
    // The circle through both springing points and the top.
    const rise = top - straight
    const radius = rise >= half ? half : (half * half + rise * rise) / (2 * rise)
    const centre = straight + rise - radius
    const from = Math.atan2(straight - centre, -half)
    const to = Math.atan2(straight - centre, half)
    const first = this.positions.length / 3
    const along = new Vector3(0, 0, 1)
    let round = straight
    for (let i = 0; i <= ARCH_SEGMENTS; i++) {
      const a = from + ((to - from) * i) / ARCH_SEGMENTS
      if (i > 0) round += (radius * Math.abs(to - from)) / ARCH_SEGMENTS
      const x = middle + radius * Math.cos(a)
      const y = centre + radius * Math.sin(a)
      // In toward the circle's centre; round the arch the way it is laid, from the first wall over to the other.
      const normal = new Vector3(-Math.cos(a), -Math.sin(a), 0)
      const tangent = new Vector3(Math.sin(a), -Math.cos(a), 0)
      for (const z of [minZ, maxZ]) this.vertex(new Vector3(x, y, z), normal, z, round, along, tangent)
    }
    for (let i = 0; i < ARCH_SEGMENTS; i++) {
      const a = first + 2 * i
      // Wound to face in, down toward the floor.
      this.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }

  private vertex(p: Vector3, normal: Vector3, u: number, v: number, uWay: Vector3, vWay: Vector3): void {
    this.positions.push(p.x, p.y, p.z)
    this.normals.push(normal.x, normal.y, normal.z)
    this.uvs.push(u, v)
    this.tangentU.push(uWay.x, uWay.y, uWay.z)
    this.tangentV.push(vWay.x, vWay.y, vWay.z)
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3))
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3))
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2))
    geometry.setAttribute('tangentU', new BufferAttribute(new Float32Array(this.tangentU), 3))
    geometry.setAttribute('tangentV', new BufferAttribute(new Float32Array(this.tangentV), 3))
    geometry.setIndex(this.index)
    return geometry
  }
}
