# Changing an instance is a function over a geometry, not an `InstancedMesh` subclass

An instance's animation changes through `setVATInstance(geometry, index, instance)` — a plain function that writes one instance's pack and flags that instance's range for upload. There is no `VATInstancedMesh`, no controller object, and no per-instance state kept on the CPU.

The obvious alternative is a subclass: `new VATMesh(vat, instances)` with `mesh.play(i, 'death')`. It reads better in a snippet, and every crowd library eventually grows one. It is refused here because it would own the thing this library deliberately does not own — the mesh. A VAT crowd is not always an `InstancedMesh`: `@three.ez/instanced-mesh` (per-instance frustum culling, LOD, sorting) is the motivating case, and it is exactly the user who has most instances to change. A subclass makes them reimplement the write; a function over a `BufferGeometry` is something they already have. That escape hatch is what [ADR-0009](./0009-both-decode-paths-read-one-instance-playback-contract.md) committed to when it kept the primitives exported beside `createVATMesh`, and this is the same commitment applied to the write side.

Keeping it a function also keeps the property the feature exists for. A controller object invites per-frame bookkeeping — a list of active transitions, an `update(dt)` — and a VAT crowd that needs `update(dt)` has given back the thing that makes it a VAT. Here the CPU touches an instance when its animation changes and at no other moment: what happens *after* a write is `resolveVATFrame` of the shared clock, and what happens *next* is another write, scheduled at the time `endsAt` already knows. Chaining therefore stays caller-side, and the GPU never learns that a next clip exists.

## Consequences

- `setVATInstance` needs the geometry the crowd is rendering — `mesh.geometry`, which `createVATMesh` **clones** from the bake. Writing to `vat.geometry` changes nothing on screen, so the error for a geometry with no playback attributes says so.
- Scheduling is the caller's: a `setTimeout`, a timeline, a gameplay tick. The library offers `endsAt` and refuses to own a queue.
- Several instances changing between two frames stay several small uploads; update ranges accumulate until the renderer consumes them.
- A future `BatchedMesh` carrier (per-instance data in a `DataTexture`) changes what this function writes into, not what it is.

## Amendment ([ADR-0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md), 2026-09-20)

The last bullet came true one release early, and the first bullet goes with it. From 2.0 the pack is carried in a texture keyed by instance, and a `BufferGeometry` has nowhere to carry a `DataTexture` — so `setVATInstance` takes the **playback texture** as its first argument rather than the geometry, and the "write to `mesh.geometry`, not `vat.geometry`" trap disappears with the clone that caused it. What the function *is* — one write at the moment an animation changes, no controller, no per-frame state, chaining scheduled by `endsAt` — is untouched, which is what this record decided.
