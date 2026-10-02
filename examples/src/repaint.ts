// Repainting one part of a merged character. With `mergeFlatMaterials` the
// bake folds the parts' flat materials into one white material and moves each
// part's colour into the merged geometry's `color` attribute (ADR-0028), so a
// part is no longer a material to recolour: it is the vertices that carry its
// colour. Found once, by the colour the bake wrote, and painted from then on —
// after the first paint the colour no longer says which part it was.
//
// No three.js: the attribute's array and linear colours are all it reads.

/** A colour in three's linear working space, as the bake writes it into `color`. */
export interface Linear {
  r: number;
  g: number;
  b: number;
}

/** The vertices whose colour is `colour`: one part of a merged character. */
export function verticesOf(colours: ArrayLike<number>, colour: Linear): number[] {
  // The attribute is 32-bit and a colour is not: compared as the bake stored it.
  const [r, g, b] = [Math.fround(colour.r), Math.fround(colour.g), Math.fround(colour.b)];
  const found: number[] = [];
  for (let v = 0; v * 3 < colours.length; v++) {
    const o = v * 3;
    if (colours[o] === r && colours[o + 1] === g && colours[o + 2] === b) found.push(v);
  }
  return found;
}

/**
 * A part's vertices, split into the pieces it is made of: the vertices a run
 * of triangles joins, or that stand at the same place (a box's corners are
 * three vertices, one per face). The robot's eyes and brows are one part, in
 * one colour; as pieces they are two balls and two boxes. Largest first.
 */
export function piecesOf(index: ArrayLike<number>, positions: ArrayLike<number>, vertices: readonly number[]): number[][] {
  const parent = new Map<number, number>(vertices.map((v) => [v, v]));
  const root = (v: number): number => {
    let r = v;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(v, r);
    return r;
  };
  const join = (a: number, b: number) => parent.set(root(a), root(b));
  for (let t = 0; t + 2 < index.length; t += 3) {
    const [a, b, c] = [index[t]!, index[t + 1]!, index[t + 2]!];
    if (parent.has(a) && parent.has(b) && parent.has(c)) {
      join(a, b);
      join(a, c);
    }
  }
  const at = new Map<string, number>();
  for (const v of vertices) {
    const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`;
    const first = at.get(key);
    if (first === undefined) at.set(key, v);
    else join(v, first);
  }
  const pieces = new Map<number, number[]>();
  for (const v of vertices) {
    const r = root(v);
    if (!pieces.has(r)) pieces.set(r, []);
    pieces.get(r)!.push(v);
  }
  return [...pieces.values()].sort((a, b) => b.length - a.length);
}

/** Paint `vertices` in `colour`. The attribute still needs its `needsUpdate`. */
export function paint(colours: { [i: number]: number }, vertices: readonly number[], colour: Linear): void {
  for (const v of vertices) {
    colours[v * 3] = colour.r;
    colours[v * 3 + 1] = colour.g;
    colours[v * 3 + 2] = colour.b;
  }
}
