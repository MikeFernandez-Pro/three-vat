import type { DeltaVAT, VAT } from './types.js'

/**
 * The member a vertex-encoding reader needs, narrowed on `encoding`.
 *
 * Every consumer that reads a position or normal texture passes through here
 * first, so the second encoding (ADR-0018) lands as a `case` in this switch
 * and as a compile error at each reader that has not yet learnt it — never as
 * a silent read of a texture the VAT does not have.
 */
export function vertexEncoded(vat: VAT, reader: string): DeltaVAT {
  switch (vat.encoding) {
    case 'delta':
      return vat
    default: {
      // On the discriminant rather than the object: a one-member type is not
      // a union, so only `encoding` narrows to `never` here today.
      const unhandled: never = vat.encoding
      throw new Error(`three-vat: ${reader} has no decode for encoding "${String(unhandled)}"`)
    }
  }
}
