import type { DeltaVAT, VAT } from './types.js'

/**
 * The member the vertex decode samples, narrowed on `encoding`.
 *
 * A decode that reads only the vertex encoding's two layers passes through here
 * before it touches a position or normal texture, so a VAT of another encoding
 * is refused by name — never sampled as a texture it does not have. The TSL
 * path is that decode until its rig decode lands (#52); the WebGL path switches
 * on the encoding itself, with a `never` check of its own. A third encoding is
 * a compile error at the `never` below. The demo and the release gates cannot
 * import this (they see only the public entry points), so they narrow inline
 * and refuse at runtime instead.
 */
export function vertexEncoded(vat: VAT, decoder: string): DeltaVAT {
  switch (vat.encoding) {
    case 'delta':
      return vat
    case 'rig':
      throw new Error(
        `three-vat: ${decoder} has no decode for the rig encoding yet (three-vat#52) — ` +
          'render this VAT on the WebGL path, or bake it with the vertex encoding (the default)',
      )
    default: {
      const unhandled: never = vat
      throw new Error(`three-vat: ${decoder} has no decode for encoding "${String((unhandled as VAT).encoding)}"`)
    }
  }
}
