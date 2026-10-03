// What every geometry a `BatchedMesh` carrying a VAT holds needs, whoever made
// it — the atlas's characters (ADR-0040) and the levels of detail (ADR-0043)
// alike — written once.
import { Sphere, type Box3, type BufferGeometry } from 'three'

/**
 * The geometry's index, or one in vertex order where it has none, which moves
 * nothing: a batch holds indexed geometries or none.
 */
export function indexOf(geometry: BufferGeometry): ArrayLike<number> {
  return geometry.getIndex()?.array ?? [...Array(geometry.getAttribute('position').count).keys()]
}

/**
 * Bound the geometry by `bounds`, the union of every frame it is drawn at, which
 * the batch culls it by so that no frame is culled mid-animation.
 */
export function boundedBy<G extends BufferGeometry>(geometry: G, bounds: Box3): G {
  geometry.boundingBox = bounds.clone()
  geometry.boundingSphere = bounds.getBoundingSphere(new Sphere())
  return geometry
}
