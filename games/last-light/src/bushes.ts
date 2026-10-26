// The goose game's bushes: scattered as the dead trees are (deadtrees.ts),
// either side of the old road, behind its walls where by one, out of the
// lights, off the scenes' pieces and the arches, in groves thinning into the
// dark; low enough to stand a little nearer the road than the trees, and never
// on a tree's trunk. Leaf cards from justASimpleTree's bush, four seeds of it,
// drawn a stretch at a time, coloured as the dead trees' leaves are, by a leaves
// folder of their own (createLeafMaterial); each with a copy of
// itself inside it, a little smaller and turned, filling the gaps between its
// cards, so it has more shape and less emptiness.
import { Vector3, type BufferGeometry, type Material, type Mesh, type MeshStandardMaterial, type Texture } from 'three/webgpu'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { float, texture, uv } from 'three/tsl'
import { createLeafMaterial, createStretches, deadTrees, type DeadTree, type DeadTreeShape, type LeafLook, type Stretches } from './deadtrees'
import type { Plain, Point } from './plain'
import type { StoneBlock } from './roadwalls'
import type { PaintLook, ShellLook } from './shell'
import type { ToonLook } from './toon'

/** The bushes as set from the panel on 2026-10-25: as near the road as the trees, in small, thick groves; on 2026-10-26 1 to 1.2 m tall, twice as wide, 3 m apart. */
export function defaultBushShape(): DeadTreeShape {
  return { clear: 3, band: 18, thin: 0.6, light: 1, piece: 2, spacing: 3, shortest: 1, tallest: 1.2, width: 2, groves: 22, grove: 4, between: 0.3, byWall: 4, behindWall: 0.3, seed: 2 }
}

/**
 * The bushes' leaves to start, as set from the panel on 2026-10-26: a dark, a mid and a bright green, darkened by
 * nearly all of each card's baked shade and tinted as its clump, a touch of their own colour unlit, cut out at half.
 */
export function defaultBushLeafLook(): LeafLook {
  return { show: true, textured: true, cutout: 0.5, shadow: 0x40732b, mid: 0x5ba040, light: 0x8fcf4f, shadowTo: 0.55, lightFrom: 0.8, shading: 0.96, variation: 1, glow: 0.04 }
}

/** How close to a dead tree's trunk a bush may stand, m. */
const OFF_TRUNK = 1.2

/** The bushes along `road`, as `shape` scatters them, `variants` kinds of bush, none on a trunk of `trees`; the rest as `deadTrees` takes it. */
export function bushes(
  plain: Plain,
  road: readonly Point[],
  variants: number,
  trees: readonly Point[],
  shape = defaultBushShape(),
  walls: readonly StoneBlock[] = [],
  pieces: readonly Point[] = [],
  clear: (x: number, z: number) => boolean = () => true,
): DeadTree[] {
  const offTrunks = (x: number, z: number) => trees.every((t) => Math.hypot(t.x - x, t.z - z) >= OFF_TRUNK)
  return deadTrees(plain, road, variants, shape, walls, pieces, (x, z) => clear(x, z) && offTrunks(x, z))
}

/** The bushes' files: four seeds of the one bush, leaf cards cut out of one leaf texture. */
const MODELS = [1, 2, 3, 4].map((k) => `./models/bushes/bush${k}.glb`)
/** How tall each bush is laid in its geometry, m, before it is sized: about as tall as they stand. */
const LAID = 0.7
/** How far a bush is sunk into the ground, of its height: its lowest cards hang below its middle, so none float. */
const SUNK = 0.1
/** The copy inside each bush: how big, of the bush, round its middle, and how far it is turned about its upright, rad. */
const INNER = { size: 0.85, turn: 1.9 }

/** `bush` with a copy of itself inside it, INNER's size round the bush's middle and turned INNER's turn. */
function filled(bush: BufferGeometry): BufferGeometry {
  bush.computeBoundingBox()
  const middle = bush.boundingBox!.getCenter(new Vector3())
  const inner = bush.clone().translate(-middle.x, -middle.y, -middle.z).rotateY(INNER.turn).scale(INNER.size, INNER.size, INNER.size).translate(middle.x, middle.y, middle.z)
  return mergeGeometries([bush, inner])
}

/** The bushes drawn: laid where `lay` has them, in the leaves `setLeaves` paints them, in the shell `setShell` has. */
export interface BushesMesh extends Stretches {
  /** How many kinds of bush there are to pick from. */
  variants: number
  /** Take the bushes' leaves folder's values, but `show`: the bushes folder shows them or not. */
  setLeaves(look: LeafLook): void
  setShell(look: ShellLook & { paint: PaintLook; toon: ToonLook }): void
}

/** The bushes, none laid yet, each file's bush drawn by stretches, in one shell coloured as `leaves` has it, standing on the ground `groundAt` has under it. */
export async function createBushes(leaves: LeafLook, groundAt: (x: number, z: number) => number = () => 0): Promise<BushesMesh> {
  const loader = new GLTFLoader()
  const files = await Promise.all(MODELS.map((url) => loader.loadAsync(url)))
  // Each bush on its own foot, LAID m tall, a little sunk; the leaf texture the files share.
  const kinds: BufferGeometry[] = []
  let map: Texture | null = null
  for (const file of files) {
    file.scene.updateMatrixWorld(true)
    file.scene.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      map ??= (mesh.material as MeshStandardMaterial).map
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      geometry.computeBoundingBox()
      const { min, max } = geometry.boundingBox!
      const size = LAID / (max.y - min.y)
      geometry.translate(0, -min.y, 0).scale(size, size, size).translate(0, -SUNK * LAID, 0)
      kinds.push(filled(geometry))
    })
  }
  // Cut out by the files' leaf texture, white leaves cut out by its alpha.
  const leafy = createLeafMaterial(map ? texture(map, uv()).a : float(1))
  leafy.set(leaves)
  const shell = leafy.material
  const stretches = createStretches(kinds, shell as Material, LAID, groundAt)
  return {
    ...stretches,
    variants: kinds.length,
    setLeaves(look) {
      leafy.set(look)
    },
    setShell(look) {
      shell.set(look)
      shell.setPaint(look.paint)
      shell.setToon(look.toon)
    },
  }
}
