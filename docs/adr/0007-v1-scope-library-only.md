# v1 scope: library-only; CLI, drei hook, and crossfade deferred

v1 ships four library surfaces only — the core baker, the WebGL decode path, the TSL decode path, and the offline format (writer + loader).

Deliberately out of scope for v1: the `npx vat-bake` CLI, a React/drei `useVAT` hook or `<VATInstances>` component, and animation crossfade. Reasons: the pure library is the prerequisite "cake" that the CLI and hook merely wrap; the drei hook is a downstream contribution (own package → propose to drei) that shouldn't gate v1; and crossfade doubles per-vertex texel fetches (2→4) plus per-instance transition state, which is unjustified before the single-clip baker is proven.

The shader and instance-attribute layout reserves room for a second clip index so crossfade stays a non-breaking v1.1 addition.
