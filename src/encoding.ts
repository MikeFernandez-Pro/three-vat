import type { DeltaVAT, VAT } from './types.js'

/**
 * The member the vertex decode samples, narrowed on `encoding`.
 *
 * Both decode paths and the normal assertion pass through here before they
 * touch a position or normal texture, so the second encoding (ADR-0018) lands
 * as a `case` in this switch and as a compile error at the `never` below —
 * never as a silent sample of a texture the VAT does not have. The demo and
 * the release gates cannot import this (they see only the public entry points),
 * so they narrow inline and refuse at runtime instead.
 */
export function vertexEncoded(vat: VAT, decoder: string): DeltaVAT {
  switch (vat.encoding) {
    case 'delta':
      return vat
    default: {
      // On the discriminant rather than the object: a one-member type is not
      // a union, so only `encoding` narrows to `never` here today.
      const unhandled: never = vat.encoding
      throw new Error(`three-vat: ${decoder} has no decode for encoding "${String(unhandled)}"`)
    }
  }
}
