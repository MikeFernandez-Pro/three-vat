// **Levels of detail** (ADR-0043): the VAT at a lower detail, drawn from the same
// textures, so a far instance draws fewer vertices off one bake and changes
// level with `BatchedMesh.setGeometryIdAt`, keeping its row in the playback
// texture.
//
// A level keeps every vertex and draws fewer of them: the caller's simplified
// index over the source's own vertices. The simplifier is the caller's —
// meshoptimizer's `simplify` hands back exactly such an index — so the
// library depends on none. The GPU shades only the vertices an index names,
// so the vertices a level keeps but never draws cost the batch their bytes
// and the frame nothing.
//
// Keeping them is what makes a level free under the vertex encoding, which
// reads a vertex's column at its batch vertex index. Added in the order given
// here, each level sits a whole VAT width after the one before it, so the
// decode reads the column at that index modulo the width and every level's
// vertex lands on its source's column. A compacted level would need its
// column carried in an attribute, and reading one cost a full-detail crowd a
// fifth of its frame where the modulo cost nothing measurable. The rig
// encoding names slots by `skinIndex` wherever a vertex sits, and needs none
// of it.
import { BufferAttribute, BufferGeometry, Sphere } from 'three'
import type { VAT, VATCharacterRange } from './types.js'

/** What {@link createVATLODs} returns. */
export interface VATLODs<V extends VAT = VAT> {
  /**
   * The VAT, as the decode sees one with levels: the same textures, recorded
   * as having levels. Hand it to `patchVATMaterial` or `vatNodes` with the
   * batch that holds them.
   */
  vat: V
  /**
   * The geometries, level by level, the full detail first: `levels[l][k]` is
   * character `k` at level `l` — one character, `k = 0`, for a bake. Add them
   * to the batch in this order, `levels.flat()`, every one of them, and
   * reserve no room past any: the vertex encoding reads each vertex's column
   * by where that puts it.
   */
  levels: BufferGeometry[][]
}

/** A level's indices: one for a bake, one a character for an atlas, `null` keeping that character whole. */
export type VATLODLevel = ArrayLike<number> | readonly (ArrayLike<number> | null)[]

/**
 * Make levels of detail from simplified indices, the full detail first and
 * then one level per entry. Each index is over a character's own vertices,
 * numbered from 0, as a simplifier run on its full geometry hands it back. A
 * level of a bake is one index; a level of an atlas is one a character, in
 * the atlas's order, `null` for a character kept whole at that level.
 *
 * A level shares the source's attributes and carries only its index. It has
 * no groups: a batch draws it with one material.
 *
 * Make every level in one call. A VAT that already has levels is refused, and
 * so is an atlas of VATs that have them: compose the atlas, then make its levels.
 */
export function createVATLODs<V extends VAT>(vat: V, levels: readonly VATLODLevel[]): VATLODs<V> {
  if (vat.lods) {
    throw new Error('three-vat: this VAT already has levels — make every level in one call to createVATLODs, from the VAT it was given')
  }
  const atlas = vat.characters !== undefined
  const characters: readonly VATCharacterRange[] = vat.characters ?? [
    { vertexStart: 0, vertexCount: vat.vertexCount, slotStart: 0, slotCount: 0 },
  ]
  // A bake's full geometry is its own, groups and all — given an index in
  // vertex order where it had none, because a batch holds indexed geometries
  // or none, and every level has one. An atlas character's is its range of
  // the atlas's end-to-end geometry.
  const bakeGeometry = vat.geometry.getIndex() ? vat.geometry : withIndex(vat.geometry, fullIndexOf(vat.geometry))
  const full = (atlas ? characters.map(({ vertexStart, vertexCount }) => slice(vat.geometry, vertexStart, vertexCount)) : [bakeGeometry]).map(
    (geometry) => bounded(geometry, vat),
  )

  const made = levels.map((level, l) => {
    const indices = indicesOf(level, atlas, characters.length, l + 1)
    return full.map((source, k) => {
      const index = indices[k]
      const levelIndex = index ? assertIndex(index, characters[k]!.vertexCount, l + 1, atlas ? k : null) : fullIndexOf(source)
      return bounded(withIndex(source, levelIndex), vat)
    })
  })

  return { vat: { ...vat, lods: levels.length + 1 }, levels: [full, ...made] }
}

/** A level's indices, one a character, or its shape refused by name. */
function indicesOf(level: VATLODLevel, atlas: boolean, characterCount: number, l: number): readonly (ArrayLike<number> | null)[] {
  const nested = Array.isArray(level) && level.length > 0 && typeof level[0] !== 'number'
  if (!atlas) {
    if (nested) throw new Error(`three-vat: level ${l} of this bake is a list of indices, and a bake's level is one index — a list a level is an atlas's`)
    return [level as ArrayLike<number>]
  }
  if (!nested) {
    throw new Error(`three-vat: level ${l} of this atlas is one index, and an atlas level is one index a character, null for one kept whole`)
  }
  if (level.length !== characterCount) {
    throw new Error(`three-vat: level ${l} gives ${level.length} ${level.length === 1 ? 'index' : 'indices'}, and the atlas has ${characterCount} characters`)
  }
  return level as readonly (ArrayLike<number> | null)[]
}

/** The source's attributes, shared, under another index. */
function withIndex(source: BufferGeometry, index: ArrayLike<number>): BufferGeometry {
  const out = new BufferGeometry()
  for (const [name, attribute] of Object.entries(source.attributes)) out.setAttribute(name, attribute)
  out.setIndex(Array.from(index))
  return out
}

function fullIndexOf(geometry: BufferGeometry): ArrayLike<number> {
  return geometry.getIndex()?.array ?? [...Array(geometry.getAttribute('position').count).keys()]
}

/** One character's vertices of an atlas's geometry, and its index, renumbered from 0. */
function slice(geometry: BufferGeometry, start: number, count: number): BufferGeometry {
  const index = geometry.getIndex()!
  const own: number[] = []
  // Each character's entries are contiguous in the atlas's index, and only its own.
  for (let i = 0; i < index.count; i++) {
    const v = index.getX(i)
    if (v >= start && v < start + count) own.push(v - start)
  }
  const out = new BufferGeometry()
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const { array, itemSize, normalized } = attribute as BufferAttribute
    out.setAttribute(name, new BufferAttribute(array.slice(start * itemSize, (start + count) * itemSize), itemSize, normalized))
  }
  out.setIndex(own)
  return out
}

function assertIndex(index: ArrayLike<number>, vertexCount: number, level: number, character: number | null): ArrayLike<number> {
  const which = character === null ? `level ${level}` : `level ${level}, character ${character},`
  if (index.length === 0) throw new Error(`three-vat: ${which} has no triangles`)
  if (index.length % 3 !== 0) throw new Error(`three-vat: ${which} has ${index.length} indices, which is not whole triangles`)
  for (let i = 0; i < index.length; i++) {
    const v = index[i]!
    if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
      throw new Error(`three-vat: ${which} names vertex ${v}, and the character has ${vertexCount} vertices, numbered from 0`)
    }
  }
  return index
}

/** The VAT's all-frames bounds, which the batch culls every level by, so that no frame is culled mid-animation. */
function bounded(geometry: BufferGeometry, vat: VAT): BufferGeometry {
  geometry.boundingBox = vat.bounds.clone()
  geometry.boundingSphere = vat.bounds.getBoundingSphere(new Sphere())
  return geometry
}
