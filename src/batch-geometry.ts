// What every geometry a VAT draws needs, whoever made it — a bake, a load, a
// worker's rebuild, and the geometries a `BatchedMesh` carrying one holds: the
// atlas's characters (ADR-0040) and the levels of detail (ADR-0043) alike —
// written once. And where each character sits in such a batch, recorded the
// same way whether an atlas holds several or a bake is the one.
import { Sphere, type Box3, type BufferGeometry } from 'three'
import type { VAT, VATCharacterRange } from './types.js'

/**
 * The geometry's index, or one in vertex order where it has none, which moves
 * nothing: a batch holds indexed geometries or none.
 */
export function indexOf(geometry: BufferGeometry): ArrayLike<number> {
  return geometry.getIndex()?.array ?? [...Array(geometry.getAttribute('position').count).keys()]
}

/**
 * Bound the geometry by `bounds`, the union of every frame it is drawn at, which
 * a crowd or a batch culls it by, so that no frame is culled mid-animation.
 */
export function boundedBy<G extends BufferGeometry>(geometry: G, bounds: Box3): G {
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())
  return geometry
}

/** A character's place in a batch, from its own bake: its first vertex and slot there, its counts, and its own boxes. */
export function characterRange(vat: VAT, vertexStart: number, slotStart: number): VATCharacterRange {
  return {
    vertexStart,
    vertexCount: vat.vertexCount,
    slotStart,
    slotCount: vat.encoding === 'rig' ? vat.slotCount : 0,
    bounds: vat.bounds.clone(),
    frameBounds: vat.frameBounds,
  }
}

/** Where each character of the VAT sits: an atlas's record, or a bake's one character from the first vertex. */
export function charactersOf(vat: VAT): readonly VATCharacterRange[] {
  return vat.characters ?? [characterRange(vat, 0, 0)]
}
