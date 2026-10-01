// The twisted crowd's freak show: what makes each soldier its own.
//
// Kept free of three.js and the DOM so it runs in Node, where freaks.test.ts
// holds it. Two things per soldier:
//
// - a **seed**, which the page writes into its own per-instance texture and
//   the post-decode hook reads back through the instance index. The hook turns
//   it into a shape by the rule `shapeOf` states, in GLSL on WebGL and in TSL
//   on WebGPU: the seed's third says which shape, and where it falls inside
//   that third says how much.
// - a **scale**, which goes in the instance's matrix and is no shader's
//   business.
//
// The shapes are dealt, not drawn: the crowd's seeds are spaced evenly over
// the three shapes and every amount of each, then shuffled across the crowd, so
// no two soldiers share a shape by chance. The shuffle and the sizes are
// hashed rather than drawn from `Math.random`, so the crowd is the same crowd
// on every visit and on both renderers.

/** A soldier's own seed, for the hook, and its size, for its matrix. */
export interface Freak {
  /** In [0, 1), and exactly what a float texture holds. */
  seed: number;
  scale: number;
}

/** The one shape a seed makes, with the other two left at their neutral values. */
export interface FreakShape {
  kind: "bulge" | "stretch" | "wring";
  /** How far the belly swells past the body's own width: 0 is none. */
  bulge: number;
  /** Height over the body's own, with the width traded for it: 1 is none. */
  stretch: number;
  /** Radians the body wrings round, hips to head: 0 is none. */
  wring: number;
}

const KINDS = ["bulge", "stretch", "wring"] as const;

/**
 * How far each shape goes, from its mildest soldier to its wildest, and how
 * far the sizes run. The hook reads these too, interpolated into its GLSL on
 * WebGL and into its graph on WebGPU, so there is one set of numbers. Wide on
 * purpose: the mildest of each is already plain from across the crowd.
 */
export const FREAKS = {
  bulge: [0.5, 1.4],
  stretch: [0.45, 2.0],
  /** Radians. */
  wring: [0.8, 2.6],
  scale: [0.6, 1.5],
} as const satisfies Record<string, readonly [number, number]>;

/** `amount` of the way from a range's start to its end. */
const along = ([min, max]: readonly [number, number], amount: number) => min + (max - min) * amount;

/** Each soldier's seed and size, for a crowd `count` strong, by instance index. */
export function freaksOf(count: number): Freak[] {
  // Slot `s` is shape `s % 3`, at the `s / 3`-th of that shape's evenly
  // spaced amounts; the shuffle decides which soldier gets which slot.
  const slots = Array.from({ length: count }, (_, s) => s);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(hash(i) * (i + 1));
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  const perKind = Math.ceil(count / 3);
  return slots.map((slot, instance) => {
    // Inside its third, never on the edge: there, the GPU's float and the
    // CPU's double could read two different shapes.
    const amount = 0.02 + (0.96 * (Math.floor(slot / 3) + 0.5)) / perKind;
    return {
      seed: Math.fround(((slot % 3) + amount) / 3),
      scale: along(FREAKS.scale, hash(count + instance)),
    };
  });
}

/** The shape a seed makes: the rule the hook runs on the GPU, written out for the CPU. */
export function shapeOf(seed: number): FreakShape {
  const third = seed * 3;
  const kind = KINDS[Math.floor(third)]!;
  const amount = third - Math.floor(third);
  return {
    kind,
    bulge: kind === "bulge" ? along(FREAKS.bulge, amount) : 0,
    stretch: kind === "stretch" ? along(FREAKS.stretch, amount) : 1,
    wring: kind === "wring" ? along(FREAKS.wring, amount) : 0,
  };
}

/** An integer to [0, 1), well mixed: the finalizer of MurmurHash3. */
function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 2 ** 32;
}
