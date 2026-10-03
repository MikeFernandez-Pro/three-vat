// What a crowd rides, and what each decode path has to know about it.
//
// A carrier is the mesh that draws N instances of one VAT. `InstancedMesh` is
// the one 2.0 started with; `BatchedMesh` is the second, and the reason the
// pack moved into a texture keyed by the logical index (ADR-0016) — a carrier
// that culls and sorts per instance permutes the drawn slot every frame, so the
// drawn slot stops being the instance.
//
// Lives in core rather than in either renderer subpath, for the reason ADR-0009
// gives about the instance-playback contract: the two paths must classify a
// carrier the same way and refuse the same batches, and a rule with two
// definitions drifts. It imports no `three` *value* — it reads the `isBatchedMesh`
// flag three's own class carries — so ADR-0005's bundle isolation is untouched.
import type { BatchedMesh, InstancedMesh } from 'three'
import { charactersOf } from './batch-geometry.js'
import type { VAT, VATCharacterRange } from './types.js'

/**
 * A mesh a VAT crowd can ride.
 *
 * `InstancedMesh` is what `createVATMesh` builds on either path.
 * `BatchedMesh` is reached through the primitives, and buys per-instance
 * frustum culling and depth sorting from three.js itself — see
 * docs/usage.md, which also says what it does *not* buy.
 */
export type VATCarrier = InstancedMesh | BatchedMesh

/**
 * Is this carrier drawn indirectly — one multi-draw over a permuted slot order?
 *
 * Takes the absent carrier too, and answers `false` for it, because both decode
 * paths ask this question of an option that may not have been given and the
 * `carrier && …` guard would otherwise be written twice.
 */
export function isBatchedCarrier(carrier: VATCarrier | undefined): carrier is BatchedMesh {
  return (carrier as BatchedMesh | undefined)?.isBatchedMesh === true
}

/**
 * The vertex range this batch gave a geometry id, or `null` when it holds no
 * such geometry.
 *
 * Both answers are the same question and three gives it two shapes — a `null`
 * return, per the typings, and a throw from `validateGeometryId`, per r186 —
 * so the probe is written here once rather than at each call. Nothing else on
 * `BatchedMesh` reports how many geometries it holds, and the alternative,
 * `_geometryCount`, is the private field ADR-0016's stop condition forbids.
 *
 * Asking after id 1 is therefore how "at most one" is asked: `addGeometry`
 * hands out ids from zero upwards and reuses deleted ones before extending, so
 * a batch holding two geometries always holds id 1.
 */
function rangeOf(batch: BatchedMesh, geometryId: number) {
  try {
    return batch.getGeometryRangeAt(geometryId)
  } catch {
    return null
  }
}

/**
 * Refuse a batch a VAT cannot be decoded on, before a frame renders it wrong.
 *
 * One VAT, **one geometry**, N instances. Both decode paths index the position
 * and normal textures by the vertex index, and on a `BatchedMesh` that index is
 * the batch's own — the geometry's `vertexStart` plus the vertex's place in it.
 * With a single geometry added first, `vertexStart` is 0 and the two numbers
 * coincide, which is the whole reason this carrier works at all. A second
 * geometry would put its instances' vertices at a non-zero offset and they
 * would sample another character's rows: silently, and only on this carrier.
 *
 * Several characters in one draw take one VAT that holds them all, because a
 * sampler is a uniform per draw call (ADR-0002): an **atlas**, from
 * `composeVATAtlas` (ADR-0040), and those are the two cases past the rule
 * above. A rig atlas's batch holds one geometry a character, in any order. A
 * vertex atlas's holds them where the atlas recorded them, id by id: the rule
 * above is that rule for a plain VAT, whose one recorded range
 * is `[0, vertexCount)`.
 */
export function assertVATCarrier(carrier: VATCarrier, vat: VAT): void {
  if (!isBatchedCarrier(carrier)) return
  if (vat.lods) return assertLODCarrier(carrier, vat)
  if (vat.characters && vat.encoding === 'rig') return assertRigAtlasCarrier(carrier, vat.characters.length)
  if (vat.characters) return assertVertexAtlasCarrier(carrier, vat.characters)

  if (rangeOf(carrier, 1)) {
    throw new Error(
      'three-vat: a BatchedMesh carrier must hold exactly one geometry — the VAT’s own. ' +
        'Both decode paths index the VAT by the vertex index, which on a batch is the ' +
        'geometry’s vertexStart plus the vertex, so a second geometry’s instances read ' +
        'another character’s rows. One VAT, one geometry, N instances: mixing characters ' +
        'in one draw needs one VAT texture each, and a sampler is a uniform per draw call.',
    )
  }

  const range = rangeOf(carrier, 0)
  if (!range) {
    throw new Error(
      'three-vat: this BatchedMesh holds no geometry — add `vat.geometry` with ' +
        '`addGeometry` before patching a material for it.',
    )
  }

  if (range.vertexStart !== 0 || range.vertexCount !== vat.vertexCount) {
    throw new Error(
      `three-vat: this BatchedMesh’s geometry spans ${range.vertexCount} vertices from ` +
        `${range.vertexStart}, and the VAT has ${vat.vertexCount} from 0. The decode reads ` +
        'the VAT at the batch’s own vertex index, so the batch must hold `vat.geometry` ' +
        'and nothing before it.',
    )
  }
}

/**
 * The rule on a rig **atlas** (ADR-0040): one geometry a character, in any
 * order. A character's columns are its slots, and its geometry's rebased
 * `skinIndex` names them wherever the batch puts its vertices, so neither the
 * order the geometries went in nor an `optimize()` that moved them changes
 * what any vertex reads. What is left to check is that the batch holds as
 * many geometries as the atlas has characters.
 */
function assertRigAtlasCarrier(batch: BatchedMesh, characters: number): void {
  const held = assertHoldsAny(batch, characters)
  if (held !== characters) throw tooManyOrFew(held, characters, 'slots')
}

/**
 * The rule on a vertex **atlas** (ADR-0040): the batch's geometry ranges are
 * the atlas's recorded ones, id by id. A character's columns are where the
 * composer put them, and the decode reads them at the batch's own vertex
 * index, so its geometry has to start exactly there and span exactly its
 * vertices. Contiguity alone would pass two characters added in swapped
 * order; the record does not. Neither does it pass a gap that reserving room
 * leaves, a geometry that is not the character's, or a range that
 * `deleteGeometry` and `optimize()` moved.
 */
function assertVertexAtlasCarrier(batch: BatchedMesh, characters: readonly VATCharacterRange[]): void {
  const held = assertHoldsAny(batch, characters.length)
  characters.forEach(({ vertexStart, vertexCount }, k) => {
    const range = rangeOf(batch, k)
    const recorded = `the atlas’s character ${k} has ${vertexCount} vertices from ${vertexStart}`
    if (!range) {
      throw new Error(
        `three-vat: this BatchedMesh holds no geometry ${k}, and ${recorded}. Add each character’s geometry from ` +
          '`composeVATAtlas` in the order it gives, and do not delete one: the id is the character.',
      )
    }
    if (range.vertexStart === vertexStart && range.vertexCount === vertexCount) return
    throw new Error(
      `three-vat: this BatchedMesh’s geometry ${k} spans ${range.vertexCount} vertices from ${range.vertexStart}, ` +
        `and ${recorded}. The decode reads a vertex atlas at the batch’s own vertex index, so each character’s ` +
        'geometry must go in in the order `composeVATAtlas` gives, back to back, with no room reserved past it — ' +
        'and a batch that `deleteGeometry` and `optimize()` repacked has moved some of them off their columns.',
    )
  })
  if (held !== characters.length) throw tooManyOrFew(held, characters.length, 'columns')
}

/** How many geometries the batch holds, refusing it when that is none. */
function assertHoldsAny(batch: BatchedMesh, characters: number): number {
  const held = geometryCount(batch, characters)
  if (held === 0) {
    throw new Error(
      'three-vat: this BatchedMesh holds no geometry — add each of the atlas’s `characters[k].geometry` ' +
        'with `addGeometry` before patching a material for it.',
    )
  }
  return held
}

function tooManyOrFew(held: number, characters: number, theirs: 'slots' | 'columns'): Error {
  return new Error(
    `three-vat: this BatchedMesh holds ${held} ${held === 1 ? 'geometry' : 'geometries'}, and the atlas has ${characters} characters. ` +
      `Add each character’s geometry from \`composeVATAtlas\` once: the atlas’s ${theirs} are theirs, and a ` +
      `geometry from anywhere else reads ${theirs} that belong to another character.`,
  )
}

/**
 * How many geometries a batch holds. Ids are probed rather than counted off
 * `_geometryCount` (see {@link rangeOf}), at least up to `expected`, and past
 * it until the ranges found cover every vertex the batch has handed out: a
 * deleted id leaves a hole until `addGeometry` reuses it, so the first absent
 * id is not the end. Every id ever issued took a range of its own, so there
 * are never more ids than vertices handed out, which bounds the probe; a batch
 * nothing was deleted from is covered at its last geometry, and stops there.
 */
function geometryCount(batch: BatchedMesh, expected: number): number {
  // three builds the batch's buffers at its first geometry: an empty batch has none to count.
  const position = batch.geometry.getAttribute('position')
  const handedOut = position ? position.count - batch.unusedVertexCount : 0
  let held = 0
  let covered = 0
  for (let id = 0; id <= expected || (covered < handedOut && id < handedOut); id++) {
    const range = rangeOf(batch, id)
    if (!range) continue
    held++
    covered += range.reservedVertexCount
  }
  return held
}

/**
 * The rule on a VAT with **levels of detail** (ADR-0043). Under the rig encoding,
 * any of its geometries in any order, as many or as few as the caller draws:
 * each names its slots by `skinIndex` wherever the batch puts it. Under the
 * vertex encoding a vertex reads its column at its batch vertex index modulo
 * the VAT's width, so every geometry has to start a whole number of widths
 * past one character's first column and span exactly that character's
 * vertices — which adding `createVATLODs`'s geometries in its order, with no
 * room reserved, does. That is checked range by range, so the order itself is
 * free; a gap, a stranger, or a range `optimize()` moved is refused.
 */
function assertLODCarrier(batch: BatchedMesh, vat: VAT): void {
  const held = geometryCount(batch, 0)
  if (held === 0) {
    throw new Error(
      'three-vat: this BatchedMesh holds no geometry — add the geometries `createVATLODs` returned ' +
        'with `addGeometry` before patching a material for it.',
    )
  }
  if (vat.encoding === 'rig') return

  const width = vat.vertexCount
  const characters = charactersOf(vat)
  for (let id = 0, seen = 0; seen < held; id++) {
    const range = rangeOf(batch, id)
    if (!range) continue
    seen++
    const at = range.vertexStart % width
    const character = characters.find(({ vertexStart }) => vertexStart === at)
    if (!character) {
      const starts = characters.length === 1 ? `a multiple of ${width}` : `a multiple of ${width} past a character’s first column (${characters.map((c) => c.vertexStart).join(', ')})`
      throw new Error(
        `three-vat: this BatchedMesh’s geometry ${id} starts at vertex ${range.vertexStart}, and a VAT with levels needs ${starts}. ` +
          'The vertex encoding reads a level’s column at its batch vertex index modulo the width, so add every geometry ' +
          '`createVATLODs` returned in its order, `levels.flat()`, with no room reserved past any.',
      )
    }
    if (range.vertexCount !== character.vertexCount) {
      throw new Error(
        `three-vat: this BatchedMesh’s geometry ${id} spans ${range.vertexCount} vertices, and the character whose columns it starts on has ${character.vertexCount}. ` +
          'A level keeps every vertex of its character; add the geometries `createVATLODs` returned, and no other.',
      )
    }
  }
}
