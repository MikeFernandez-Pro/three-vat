// A merged bake's parts, by colour, and a way to repaint one. Under
// `mergeFlatMaterials` a robot's flat materials collapse into one white
// material and each part's colour moves into the merged geometry's `color`
// attribute (ADR-0028), so a part is no longer a material to recolour: it is
// the vertices that carry its colour. This finds them once, and repaints them.
//
// No three.js: a WebGPU page's bundle is three/webgpu's alone, and a vertex
// colour attribute is an array either way. `vertex-paint.test.ts` holds it
// against a real merged bake in Node.

/** A vertex colour attribute, seen only as this reads and writes it. three's `BufferAttribute` is this. */
export interface ColourAttribute {
  array: { [index: number]: number; length: number };
  itemSize: number;
}

/** A colour as the attribute holds it: linear, as three keeps colours in its working space. */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** The parts a geometry's vertex colours make: each distinct colour, and which of them every vertex carries. */
export interface ColourParts {
  /** In the order the vertices first meet them. */
  colours: RGB[];
  /** By vertex: the index into `colours` of the colour it carries. */
  partOf: Uint16Array;
}

/**
 * The distinct colours `color` carries, and each vertex's part. Exact
 * equality, on purpose: a merge copies each material's colour into its
 * vertices unchanged, so a part's vertices agree to the bit.
 */
export function partsByColour(color: ColourAttribute): ColourParts {
  const { array, itemSize } = color;
  const count = array.length / itemSize;
  const colours: RGB[] = [];
  const index = new Map<string, number>();
  const partOf = new Uint16Array(count);
  for (let v = 0; v < count; v++) {
    const o = v * itemSize;
    const key = `${array[o]},${array[o + 1]},${array[o + 2]}`;
    let part = index.get(key);
    if (part === undefined) {
      part = colours.length;
      index.set(key, part);
      colours.push({ r: array[o]!, g: array[o + 1]!, b: array[o + 2]! });
    }
    partOf[v] = part;
  }
  return { colours, partOf };
}

/** Paint every vertex of `part` in `rgb`. The caller flags the attribute for upload. */
export function paintPart(color: ColourAttribute, partOf: Uint16Array, part: number, rgb: RGB): void {
  const { array, itemSize } = color;
  for (let v = 0; v < partOf.length; v++) {
    if (partOf[v] !== part) continue;
    const o = v * itemSize;
    array[o] = rgb.r;
    array[o + 1] = rgb.g;
    array[o + 2] = rgb.b;
  }
}
