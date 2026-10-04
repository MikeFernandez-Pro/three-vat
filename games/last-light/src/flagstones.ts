// The ground: flagstones built in code, no texture. A jittered lattice cut into
// irregular stones, some of them two cells long, each inset from its neighbours
// to open a dark joint, set at its own height and tilt, in its own tone, and
// bevelled down to the joint. Flat-shaded, one geometry, one draw.
import { BufferGeometry, Color, Float32BufferAttribute, Mesh, MeshStandardNodeMaterial } from 'three/webgpu'
import { random } from './swarm'

/** How far the paving runs from the centre, in metres: past the largest arena, into the fog. */
const EXTENT = 44
/** A lattice cell, in metres: about a stone. */
const CELL = 0.8
/** How far a lattice point strays from its place, as a fraction of a cell. */
const JITTER = 0.28
/** The share of stones that run two cells long. */
const LONG = 0.35
/** How far a stone's top is inset from its corners, and its foot, in metres: the joint between two is about twice that. */
const TOP_INSET = 0.06
const FOOT_INSET = 0.02
/** Where the joints lie, below the rats' feet at 0. */
const JOINT = -0.05
/** A stone's top stands this far above or below 0, and each corner tips by up to TILT. */
const HEIGHT = 0.012
const TILT = 0.008

/** A stone's tone before its own lightness and hue, and the joints'. */
const STONE = new Color(0x6c736b)
const JOINT_COLOR = new Color(0x161917)

/** The paving, from a seed: the same stones every run. It receives the lamp's shadow when the lamp casts one. */
export function flagstones(seed = 1): Mesh {
  const rand = random(seed)
  /** A random value between -x and x. */
  const spread = (x: number) => (rand() - 0.5) * 2 * x
  const n = Math.ceil(EXTENT / CELL)
  const side = 2 * n + 1

  // The lattice, jittered once, so neighbouring stones share their edges.
  const px = new Float32Array(side * side)
  const pz = new Float32Array(side * side)
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const edge = i === 0 || j === 0 || i === side - 1 || j === side - 1
      const k = j * side + i
      px[k] = (i - n) * CELL + (edge ? 0 : spread(JITTER * CELL))
      pz[k] = (j - n) * CELL + (edge ? 0 : spread(JITTER * CELL))
    }
  }

  const position: number[] = []
  const color: number[] = []
  const tone = new Color()
  const push = (x: number, y: number, z: number, c: Color) => {
    position.push(x, y, z)
    color.push(c.r, c.g, c.b)
  }

  // The joints: one dark floor under every stone, out to the edge of the paving.
  const half = n * CELL
  for (const [x, z] of [[-half, -half], [-half, half], [half, half], [-half, -half], [half, half], [half, -half]]) {
    push(x, JOINT, z, JOINT_COLOR)
  }

  const corners: number[] = []
  const top: number[] = []
  const foot: number[] = []
  const taken = new Uint8Array(side * side)
  for (let j = 0; j < side - 1; j++) {
    for (let i = 0; i < side - 1; i++) {
      if (taken[j * side + i]) continue
      const long = i < side - 2 && !taken[j * side + i + 1] && rand() < LONG
      const w = long ? 2 : 1
      for (let s = 0; s < w; s++) taken[j * side + i + s] = 1

      // The stone's outline: along the row at lower z, then back along the
      // next. That runs clockwise seen from above, so every face below is
      // pushed with its corners reversed, to face up and out.
      corners.length = 0
      for (let s = 0; s <= w; s++) corners.push(j * side + i + s)
      for (let s = w; s >= 0; s--) corners.push((j + 1) * side + i + s)

      let cx = 0
      let cz = 0
      for (const k of corners) {
        cx += px[k]
        cz += pz[k]
      }
      cx /= corners.length
      cz /= corners.length
      if (Math.hypot(cx, cz) > EXTENT) continue

      const y = spread(HEIGHT)
      tone.copy(STONE).multiplyScalar(0.55 + rand() * 0.7)
      tone.offsetHSL(spread(0.02), spread(0.03), 0)

      // Each corner pulled toward the middle: by TOP_INSET at the top, FOOT_INSET at the joint.
      top.length = 0
      foot.length = 0
      for (const k of corners) {
        const dx = cx - px[k]
        const dz = cz - pz[k]
        const d = Math.hypot(dx, dz)
        top.push(px[k] + (dx / d) * TOP_INSET, y + spread(TILT), pz[k] + (dz / d) * TOP_INSET)
        foot.push(px[k] + (dx / d) * FOOT_INSET, JOINT, pz[k] + (dz / d) * FOOT_INSET)
      }

      // The top, a fan from its middle, which a jittered outline always sees;
      // the bevel, a quad down each edge.
      const m = corners.length
      for (let c = 0; c < m; c++) {
        const a = 3 * c
        const b = 3 * ((c + 1) % m)
        push(cx, y, cz, tone)
        push(top[b], top[b + 1], top[b + 2], tone)
        push(top[a], top[a + 1], top[a + 2], tone)
        push(top[a], top[a + 1], top[a + 2], tone)
        push(top[b], top[b + 1], top[b + 2], tone)
        push(foot[a], foot[a + 1], foot[a + 2], tone)
        push(foot[a], foot[a + 1], foot[a + 2], tone)
        push(top[b], top[b + 1], top[b + 2], tone)
        push(foot[b], foot[b + 1], foot[b + 2], tone)
      }
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3))
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3))
  // Unindexed, so every face keeps its own normal, as the flat shading draws it.
  geometry.computeVertexNormals()
  const mesh = new Mesh(geometry, new MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }))
  mesh.receiveShadow = true
  return mesh
}
