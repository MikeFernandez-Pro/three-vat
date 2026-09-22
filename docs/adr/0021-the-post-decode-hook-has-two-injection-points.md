# The post-decode hook has two injection points

`patchVATMaterial` takes `onBeforeCompile` and `customProgramCacheKey` for
itself, so a caller who needs one line of their own GLSL after the decode has
nothing to do but fork the library. The TSL path has no such problem —
`positionNode` is a value it hands back, and a caller composes with it. The
**post-decode hook** closes that asymmetry on the WebGL path, and it has **two**
injection points, `position` and `normal`, rather than one.

Two because of the order three expands its own chunks in. `beginnormal_vertex`
comes *before* `begin_vertex`, and `transformedNormal` is derived from
`objectNormal` between them. A chunk that runs only at the position point
therefore cannot repair a normal that was already taken: a crowd twisted by the
hook would shade as though it had never twisted. One point is a hook that looks
right in the viewport and is wrong in the light.

[ADR-0006](./0006-shader-injection-must-be-self-contained.md) already requires
each of the library's own injection points to be self-contained, because
`MeshDepthMaterial` carries `beginnormal_vertex` inside a block that can be
dead and anything injected there can silently vanish. A caller's chunk inherits
that rule rather than being exempted from it — and it is the same rule that
makes two points correct rather than redundant.

## Shape

- A **required key**, folded into the library's own (`three-vat:rig:batch+<key>`)
  and never replacing it. Without it two crowds with different hooks share a
  compiled program and one gets the other's GLSL.
- Optional `uniforms`, and an optional `prelude` that sits ahead of three's
  shader — so the prelude is not an injection point and ADR-0006 does not
  govern it.
- `vatInstanceIndex` declared at both points, spelled for the carrier the
  material was patched for. It is the one thing a chunk cannot write for itself,
  and it is what lets a chunk read its own per-instance data without knowing
  what draws the crowd.
- The fifth parameter of `patchVATMaterial` widens to
  `VATCarrier | VATPatchOptions`. A carrier is an `Object3D` and an options
  object is not, so the two are told apart at runtime and every existing call
  keeps compiling — a widening, not a major version.
- `createVATDepthMaterial` takes the same options and `createVATMesh` threads
  them to the render, depth and distance materials. Otherwise a deformed crowd
  casts an undeformed shadow, which is exactly the class of mistake this library
  exists to take off the caller.
- A caller's own `onBeforeCompile` is chained rather than overwritten. The hook
  is the supported seam; the chaining is a net, not an invitation.

## Considered and rejected

**Export the chunks and let the caller assemble their own `onBeforeCompile`** —
the literal mirror of what TSL does, since `positionNode` is not a hook either.
Rejected because ADR-0006 exists precisely *because* this injection is
treacherous: the dead block, the reversed expansion order, the program cache
key. Handing a caller the pieces hands them the traps as their own fault. The
symmetry that matters between the two paths is equal power — a caller can
deform after the decode on either — not an equal mechanism.
