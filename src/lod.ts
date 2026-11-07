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
//
// Which level an instance draws is chosen by distance when the caller asks,
// once a frame or less (ADR-0065); choosing by hand with `setGeometryIdAt`
// stays open.
import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from 'three'
import type { BatchedMesh, Object3D } from 'three'
import { boundedBy, charactersOf, indexOf } from './batch-geometry.js'
import type { VAT } from './types.js'

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
  const characters = charactersOf(vat)
  // A bake's full geometry is its own, groups and all — given an index in
  // vertex order where it had none, because a batch holds indexed geometries
  // or none, and every level has one. An atlas character's is its range of
  // the atlas's end-to-end geometry.
  const bakeGeometry = vat.geometry.getIndex() ? vat.geometry : withIndex(vat.geometry, indexOf(vat.geometry))
  const full = (atlas ? characters.map(({ vertexStart, vertexCount }) => slice(vat.geometry, vertexStart, vertexCount)) : [bakeGeometry]).map(
    // Each character culls by its own box, never the atlas's, which is every character's.
    (geometry, k) => boundedBy(geometry, characters[k]!.bounds),
  )

  const made = levels.map((level, l) => {
    const indices = indicesOf(level, atlas, characters.length, l + 1)
    return full.map((source, k) => {
      const index = indices[k]
      const levelIndex = index ? assertIndex(index, characters[k]!.vertexCount, l + 1, atlas ? k : null) : indexOf(source)
      return boundedBy(withIndex(source, levelIndex), characters[k]!.bounds)
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


/** What {@link updateVATLevels} reads. */
export interface VATLevelOptions {
  /**
   * The ids `addGeometry` gave the levels, in the shape of `createVATLODs`'s
   * `levels`: `ids[l][k]` is level `l` of character `k`, one character for a bake.
   */
  ids: readonly (readonly number[])[]
  /**
   * The distances, in world units and increasing, where each level gives way
   * to the next: level 0 nearer than `bands[0]`, level 1 nearer than
   * `bands[1]`, and so on. At most one fewer than the levels: the levels
   * past the last band go unused, so `[]` draws the full detail everywhere.
   */
  bands: readonly number[]
  /**
   * How far past a band an instance has to be before it leaves its level, as
   * a fraction of that band, outward or inward, so one standing on a boundary
   * does not change level every frame. 0.1 by default.
   */
  slack?: number
  /** Called for each instance whose level this call changed, after the write. */
  onChange?: (instance: number, level: number) => void
}

const _camera = /* @__PURE__ */ new Vector3()
const _at = /* @__PURE__ */ new Vector3()
const _matrix = /* @__PURE__ */ new Matrix4()

/**
 * Move each instance of a crowd with levels to the level its distance from the
 * camera asks for, and return how many instances each level holds (ADR-0065).
 * Call it once a frame, or less often; nothing runs between calls.
 *
 * An instance leaves its level only once it is `slack` past the band it
 * crosses, and crosses every band it is past in one call. Its level now is
 * read off the crowd, and an atlas instance keeps its character, so the caller
 * keeps no state. Only an instance whose level changes is written.
 *
 * Reads every instance's matrix: 0.15-0.21 ms for 4,096 on a desktop.
 */
export function updateVATLevels(crowd: BatchedMesh, camera: Object3D, options: VATLevelOptions): number[] {
  const { ids, bands, slack = 0.1, onChange } = options
  if (bands.length > ids.length - 1) {
    throw new Error(
      `three-vat: ${ids.length} levels take at most ${ids.length - 1} ${ids.length === 2 ? 'band' : 'bands'} between them, and ` +
        `${bands.length} ${bands.length === 1 ? 'band was' : 'bands were'} given`,
    )
  }
  for (let b = 1; b < bands.length; b++) {
    if (!(bands[b]! > bands[b - 1]!)) throw new Error(`three-vat: the bands must be increasing, and ${bands.join(', ')} are not`)
  }
  if (!(slack >= 0 && slack < 1)) throw new Error(`three-vat: slack is a fraction of a band, from 0 up to 1, and ${slack} is not`)

  // Where each geometry sits in `ids`, read once a call.
  const placeOf = new Map<number, [level: number, character: number]>()
  ids.forEach((level, l) => level.forEach((id, k) => placeOf.set(id, [l, k])))

  // As a render would bring them up to date, so a camera moved this frame is measured where it is.
  camera.updateWorldMatrix(true, false)
  crowd.updateWorldMatrix(true, false)
  _camera.setFromMatrixPosition(camera.matrixWorld)

  const counts: number[] = ids.map(() => 0)
  // three has no public way to ask whether an id is live, and these throw for
  // one that is not: probe until every live instance is found (src/carrier.ts).
  for (let instance = 0, found = 0; found < crowd.instanceCount; instance++) {
    let geometry: number
    try {
      geometry = crowd.getGeometryIdAt(instance)
    } catch {
      continue
    }
    found++
    const place = placeOf.get(geometry)
    if (!place) {
      throw new Error(`three-vat: instance ${instance} draws geometry ${geometry}, which the ids do not name — give every level's ids, as addGeometry returned them`)
    }
    const [current, character] = place

    crowd.getMatrixAt(instance, _matrix)
    const distance = _at.setFromMatrixPosition(_matrix).applyMatrix4(crowd.matrixWorld).distanceTo(_camera)
    let level = Math.min(current, bands.length)
    while (level < bands.length && distance >= bands[level]! * (1 + slack)) level++
    while (level > 0 && distance < bands[level - 1]! * (1 - slack)) level--
    counts[level]!++

    if (level === current) continue
    const id = ids[level]![character]
    if (id === undefined) throw new Error(`three-vat: level ${level} has no id for character ${character}`)
    crowd.setGeometryIdAt(instance, id)
    onChange?.(instance, level)
  }
  return counts
}
