// three ships meshoptimizer's simplifier as an addon without typings. The one
// call the levels pages make, typed as the module defines it (r186).
declare module "three/addons/libs/meshopt_simplifier.module.js" {
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    /** A smaller index over the same vertices, and the error it reached. */
    simplify(
      indices: Uint32Array,
      positions: Float32Array,
      stride: number,
      targetIndexCount: number,
      targetError: number,
      flags?: ("LockBorder" | "Sparse" | "ErrorAbsolute" | "Prune" | "Regularize" | "Permissive")[],
    ): [Uint32Array, number];
  };
}
