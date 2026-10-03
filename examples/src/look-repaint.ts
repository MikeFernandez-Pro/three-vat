// Repainting the characters in a running scene when the look changes. A part
// is painted one of two ways: a material named for it carries its colour, or a
// merge moved its colour into the vertices (ADR-0028) and the material is
// white. The first is found by name; the second by the colour the look it
// left painted it, once per geometry and kept, since after the first repaint
// the colour no longer says which part it was.
//
// A look can paint two parts alike — the dark one paints Soldier's body and
// the robot's alike — so a geometry's vertices are read as one character's:
// the one with the most parts, all of them present.
//
// No three.js: both renderers' floors call it, each with its own Color.
import { characters, partColour, partsOf, type Look } from "./palette.js";
import { paint, verticesOf, type Linear } from "./repaint.js";

interface PaintableMaterial {
  name: string;
  color?: { setHex(hex: number): unknown };
}

interface ColourAttribute {
  array: { [i: number]: number; length: number };
  needsUpdate: boolean;
}

interface SceneObject {
  isMesh?: boolean;
  material?: PaintableMaterial | PaintableMaterial[];
  geometry?: { getAttribute(name: string): unknown };
}

/** Each part's vertices, per colour attribute, found the first time it is repainted. */
const found = new WeakMap<ColourAttribute, Map<string, number[]>>();

/**
 * Repaint every character part under `root` from the look it left, `from`, to
 * the palette's present one. `linear` turns a hex colour into three's working
 * space, the space a vertex colour is stored in.
 */
export function repaintCharacters(
  root: { traverse(visit: (object: object) => void): void },
  from: Look,
  linear: (hex: number) => Linear,
): void {
  const before = partsOf(from);
  const done = new Set<ColourAttribute>();
  root.traverse((visited) => {
    const object = visited as SceneObject;
    if (!object.isMesh) return;
    for (const material of [object.material ?? []].flat()) {
      if (material.name in before) material.color?.setHex(partColour(material.name));
    }
    const colours = object.geometry?.getAttribute("color") as ColourAttribute | undefined;
    if (!colours || done.has(colours)) return;
    done.add(colours);
    let vertices = found.get(colours);
    if (!vertices) found.set(colours, (vertices = partVertices(colours.array, before, linear)));
    for (const [name, of] of vertices) paint(colours.array, of, linear(partColour(name)));
    if (vertices.size > 0) colours.needsUpdate = true;
  });
}

/** One character's parts in `colours`, as `before` painted them: the character with the most parts, all present. */
function partVertices(colours: ArrayLike<number>, before: Readonly<Record<string, number>>, linear: (hex: number) => Linear) {
  let best = new Map<string, number[]>();
  for (const names of characters) {
    const lists = new Map(names.map((name) => [name, verticesOf(colours, linear(before[name]!))] as const));
    if ([...lists.values()].some((list) => list.length === 0)) continue;
    if (lists.size > best.size) best = lists;
  }
  return best;
}
