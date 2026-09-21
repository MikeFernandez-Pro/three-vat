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
import type { VAT } from './types.js'

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
 * That is also the sentence the docs make: a `BatchedMesh` crowd is one
 * character, and mixing characters in one draw is what a VAT cannot do (a
 * sampler is a uniform per draw call — ADR-0002), not something this refusal
 * takes away.
 */
export function assertVATCarrier(carrier: VATCarrier, vat: VAT): void {
  if (!isBatchedCarrier(carrier)) return

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
