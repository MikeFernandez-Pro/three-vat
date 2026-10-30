// The goose's nest on the pond's island: a ring of dry pine needles round a
// hollow, all of it leaf cards, planes cut out by one of justASimpleTree's
// textures, painted here as the tree paints them, a 2 x 2 atlas of clusters,
// white on black: its pine needles, sprigs with needles in pairs, or the
// willow leaves its pine wears, long and narrow; their count and shape the
// needles folder's. The cards lie on a squashed ring, the rim, facing out of it the
// way justASimpleTree's cards face out of their clump, in layers, each spun
// and tipped a little off it so the needles bristle; a few lie flat in the
// hollow, and a few strays on the ground round it. Each card's shade is baked
// into its colour, darkest down in the hollow, lightest along the rim's top,
// and coloured by the dead trees' leaf material (createLeafMaterial) with a
// leaves folder of its own.
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Mesh, NoColorSpace, Vector3 } from 'three/webgpu'
import { texture, uv } from 'three/tsl'
import { createLeafMaterial, type LeafLook } from './deadtrees'
import { random } from './swarm'

/** What the nest folder edits. */
export interface NestLook {
  show: boolean
  /** Where its middle is off the island's, m. */
  x: number
  z: number
  /** How far its rim reaches out from its middle, m. */
  radius: number
  /** How high its rim stands, m. */
  rim: number
  /** How wide its rim is, as a share of the radius: the rest is the hollow. */
  thickness: number
  /** How many cards round the rim in each row, how many rows from its outside over its top into the hollow, and how many layers of them. */
  around: number
  rows: number
  layers: number
  /** How many cards lie in the hollow, and stray on the ground round it. */
  floor: number
  strays: number
  /** How wide each card is, m, and how much wider or narrower one may be, as a share. */
  card: number
  spread: number
  /** How far the cards tip off the rim, 0 lying on it. */
  bristle: number
  /** How far it sinks into the island's crown, m. */
  sink: number
  /** Which nest of the many it could be. */
  seed: number
}

/** justASimpleTree's textures the nest may wear. */
export const NEEDLE_TEXTURES = ['pine needles', 'willow leaves'] as const
export type NeedleTexture = (typeof NEEDLE_TEXTURES)[number]

/** The needles texture, as justASimpleTree paints it: what the needles folder edits. */
export interface NeedleLook {
  texture: NeedleTexture
  /** How many sprigs, or leaves, in each of the atlas's four cells. */
  count: number
  /** The shortest and longest of them, px from its middle to its tip, of the cell's 256. */
  shortest: number
  longest: number
  /** How wide one is, as a share of its half length: a sprig's needle at its base, a willow leaf at its widest. */
  width: number
  /** How far the willow leaves turn off one way, degrees each side: 180 any way. Sprigs turn any way. */
  turn: number
  /** How many pairs of needles along a sprig. */
  pairs: number
  /** How long a sprig's needle is, as a share of its half length, at its base: it shortens to the tip. */
  needle: number
  /** How far a sprig's needles lean off its twig, degrees. */
  angle: number
}

/** The nest to start, as set from the panel on 2026-10-29: wide and deep, four layers of big cards round its rim, none in the hollow or round it, off the island's middle by the tent. */
export function defaultNestLook(): NestLook {
  return { show: true, x: -0.45, z: -1.49, radius: 1.02, rim: 0.25, thickness: 0.8, around: 22, rows: 6, layers: 4, floor: 0, strays: 0, card: 0.54, spread: 1, bristle: 0.56, sink: 0.13, seed: 3 }
}

/** Each texture as justASimpleTree paints it. */
export const NEEDLE_DEFAULTS: Record<NeedleTexture, NeedleLook> = {
  'pine needles': { texture: 'pine needles', count: 16, shortest: 34, longest: 52, width: 0.07, turn: 180, pairs: 7, needle: 0.55, angle: 43 },
  'willow leaves': { texture: 'willow leaves', count: 18, shortest: 40, longest: 58, width: 0.26, turn: 20, pairs: 7, needle: 0.55, angle: 43 },
}

/** The needles to start: justASimpleTree's own pine needles. */
export function defaultNeedleLook(): NeedleLook {
  return { ...NEEDLE_DEFAULTS['pine needles'] }
}

/** The nest's needles to start: three dry pine browns, a little of their own colour unlit. */
export function defaultNestLeafLook(): LeafLook {
  return { show: true, textured: true, cutout: 0.5, shadow: 0x4a2f1a, mid: 0x8b5e34, light: 0xc49a5c, shadowTo: 0.5, lightFrom: 0.8, shading: 0.6, variation: 1, glow: 0.2 }
}

/** How far round the rim's cross-section its cards run, radians from straight out: from low on its outside, over its top, down into the hollow. */
const RIM_FROM = -0.3 * Math.PI
const RIM_TO = 1.2 * Math.PI

/** A pine sprig, along x from -length to +length: a thin twig with needles in pairs along it, leaning to its tip and shortening there, as justASimpleTree draws it. */
function sprig(ctx: CanvasRenderingContext2D, length: number, look: NeedleLook) {
  const stem = Math.max(length * 0.04, 1.5)
  ctx.rect(-length, -stem, length * 2, stem * 2)
  const pairs = Math.max(1, Math.round(look.pairs))
  const lean = (look.angle * Math.PI) / 180
  for (let i = 0; i < pairs; i++) {
    const t = pairs > 1 ? i / (pairs - 1) : 0
    const x = -length * 0.85 + t * length * 1.7
    const needle = length * look.needle * (1 - 0.45 * t)
    const half = Math.max((length * look.width) / 2, 1.5)
    for (const side of [-1, 1]) {
      ctx.moveTo(x - half, 0)
      ctx.lineTo(x + needle * Math.cos(lean), side * needle * Math.sin(lean))
      ctx.lineTo(x + half, 0)
      ctx.closePath()
    }
  }
}

/** A willow leaf, along x from -length to +length: long and narrow, tapering to a point at both ends, as justASimpleTree draws it. */
function willow(ctx: CanvasRenderingContext2D, length: number, look: NeedleLook) {
  ctx.moveTo(-length, 0)
  ctx.quadraticCurveTo(-length * 0.2, -length * look.width, length, 0)
  ctx.quadraticCurveTo(-length * 0.2, length * look.width, -length, 0)
}

/** One of justASimpleTree's textures onto `canvas`: four cells of 256 px, each its sprigs or leaves, thicker toward its middle, white on black. */
export function paintNeedles(canvas: HTMLCanvasElement, look: NeedleLook): void {
  canvas.width = canvas.height = 512
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 512, 512)
  const next = random(42)
  const longest = Math.max(look.shortest, look.longest)
  ctx.fillStyle = '#fff'
  for (let v = 0; v < 4; v++) {
    ctx.save()
    ctx.translate((v % 2) * 256 + 128, Math.floor(v / 2) * 256 + 128)
    for (let i = 0; i < Math.round(look.count); i++) {
      const d = Math.sqrt(next()) * Math.max(0, 118 - longest)
      const t = next() * Math.PI * 2
      ctx.save()
      ctx.translate(Math.cos(t) * d, Math.sin(t) * d)
      const shape = look.texture === 'willow leaves' ? willow : sprig
      ctx.rotate(shape === willow ? (next() - 0.5) * 2 * ((look.turn * Math.PI) / 180) : next() * Math.PI * 2)
      ctx.beginPath()
      shape(ctx, look.shortest + next() * (longest - look.shortest), look)
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
  }
}

/** The nest's cards as `look` has them, round its middle on the ground at 0. */
export function nestGeometry(look: NestLook): BufferGeometry {
  const next = random(look.seed)
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const colours: number[] = []
  const index: number[] = []
  const side = new Vector3()
  const along = new Vector3()
  const facing = new Vector3()
  const up = new Vector3(0, 1, 0)
  const across = new Vector3(1, 0, 0)
  /** A card at `c`, its surface's normal `n`, about `size` m across, spun any way round it and tipped up to `tip` off it, its shade `shade`. */
  const card = (c: Vector3, n: Vector3, size: number, tip: number, shade: number) => {
    facing.copy(n)
    facing.x += (next() - 0.5) * tip
    facing.y += (next() - 0.5) * tip
    facing.z += (next() - 0.5) * tip
    facing.normalize()
    side.crossVectors(Math.abs(facing.y) > 0.9 ? across : up, facing).normalize()
    along.crossVectors(facing, side)
    const spin = next() * Math.PI * 2
    const h = (size * (1 + (next() - 0.5) * look.spread)) / 2
    const sx = side.x * Math.cos(spin) + along.x * Math.sin(spin)
    const sy = side.y * Math.cos(spin) + along.y * Math.sin(spin)
    const sz = side.z * Math.cos(spin) + along.z * Math.sin(spin)
    const ax = along.x * Math.cos(spin) - side.x * Math.sin(spin)
    const ay = along.y * Math.cos(spin) - side.y * Math.sin(spin)
    const az = along.z * Math.cos(spin) - side.z * Math.sin(spin)
    const cell = Math.floor(next() * 4)
    const u0 = (cell % 2) * 0.5
    const v0 = Math.floor(cell / 2) * 0.5
    // A touch warmer or cooler than the rest, its tint as the leaf material reads it.
    const warm = (next() - 0.5) * 0.16
    const lit = shade * (0.9 + next() * 0.2)
    const first = positions.length / 3
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      positions.push(c.x + (sx * i + ax * j) * h, c.y + (sy * i + ay * j) * h, c.z + (sz * i + az * j) * h)
      normals.push(n.x, n.y, n.z)
      uvs.push(u0 + (i + 1) * 0.25, v0 + (j + 1) * 0.25)
      colours.push(lit * (1 + warm), lit, lit * (1 - warm), 1)
    }
    index.push(first, first + 1, first + 2, first, first + 2, first + 3)
  }

  // The rim: a ring `ring` m out, its cross-section half `tube` m wide and half the rim high, standing on the ground.
  const tube = (look.radius * look.thickness) / 2
  const ring = look.radius - tube
  const half = look.rim / 2
  const around = Math.max(1, Math.round(look.around))
  const rows = Math.max(1, Math.round(look.rows))
  const layers = Math.max(1, Math.round(look.layers))
  const c = new Vector3()
  const n = new Vector3()
  for (let layer = 0; layer < layers; layer++) {
    // Each layer half a card on from the one under it, and a little proud of it.
    const shift = layer / layers
    const out = 1 + layer * 0.12
    for (let k = 0; k < around; k++) {
      for (let j = 0; j < rows; j++) {
        const turn = ((k + next() * 0.8 + shift) / around) * Math.PI * 2
        const phi = RIM_FROM + ((j + next() * 0.8 + shift) / rows) * (RIM_TO - RIM_FROM)
        const r = ring + Math.cos(phi) * tube * out
        const y = half + Math.sin(phi) * half * out
        const nr = Math.cos(phi) / tube
        const ny = Math.sin(phi) / half
        n.set(Math.cos(turn) * nr, ny, Math.sin(turn) * nr).normalize()
        c.set(Math.cos(turn) * r, Math.max(0.005, y), Math.sin(turn) * r)
        // Lighter up the rim and on its outside, dark down in the hollow.
        const height = Math.max(0, y) / Math.max(0.01, look.rim)
        const shade = Math.min(1, Math.max(0.25, 0.3 + 0.6 * height + 0.15 * Math.cos(phi)))
        card(c, n, look.card, look.bristle, shade)
      }
    }
  }
  // The hollow's floor: cards lying flat, a little cupped.
  for (let k = 0; k < Math.round(look.floor); k++) {
    const t = next() * Math.PI * 2
    const d = Math.sqrt(next()) * ring * 0.8
    c.set(Math.cos(t) * d, 0.01 + (d / ring) ** 2 * half * 0.5, Math.sin(t) * d)
    card(c, n.set(0, 1, 0), look.card, look.bristle * 0.3, 0.3)
  }
  // Strays on the ground round it.
  for (let k = 0; k < Math.round(look.strays); k++) {
    const t = next() * Math.PI * 2
    const d = look.radius * (1 + next() * 0.6)
    c.set(Math.cos(t) * d, 0.008, Math.sin(t) * d)
    card(c, n.set(0, 1, 0), look.card * 0.8, look.bristle * 0.15, 0.7)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('color', new Float32BufferAttribute(colours, 4))
  geometry.setIndex(index)
  geometry.computeBoundingSphere()
  return geometry
}

export interface NestMesh {
  object: Mesh
  /** Lay its cards again to `look`, its middle at (x, z) on ground `y` m high. */
  set(look: NestLook, x: number, y: number, z: number): void
  /** Paint its needles again to `look`. */
  setNeedles(look: NeedleLook): void
  /** Take a leaves folder's values, but `show`: the nest's own decides. */
  setLeaves(leaves: LeafLook): void
}

/** The nest, its needles painted as `needles` has them and coloured as `leaves` has them. */
export function createNest(leaves: LeafLook, needles: NeedleLook): NestMesh {
  const canvas = document.createElement('canvas')
  paintNeedles(canvas, needles)
  const map = new CanvasTexture(canvas)
  map.colorSpace = NoColorSpace
  const leafy = createLeafMaterial(texture(map, uv()).r)
  const mesh = new Mesh(new BufferGeometry(), leafy.material)
  mesh.castShadow = mesh.receiveShadow = true
  leafy.set(leaves)
  return {
    object: mesh,
    set(look, x, y, z) {
      mesh.geometry.dispose()
      mesh.geometry = nestGeometry(look)
      mesh.position.set(x, y - look.sink, z)
      mesh.visible = look.show
    },
    setNeedles(look) {
      paintNeedles(canvas, look)
      map.needsUpdate = true
    },
    setLeaves: leafy.set,
  }
}
