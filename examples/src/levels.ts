// How many vertices a level draws: the levels page's readout, shared by its
// two renderers. Which level an instance draws is the library's
// `updateVATLevels` (ADR-0065).

/**
 * How many vertices a level's index draws: each one it names, once. A level
 * keeps every vertex of the bake (ADR-0043), and the GPU shades only these,
 * so this, not the vertex buffer, is what a level costs the decode.
 */
export function verticesDrawn(index: ArrayLike<number>): number {
  return new Set(Array.from(index)).size;
}
