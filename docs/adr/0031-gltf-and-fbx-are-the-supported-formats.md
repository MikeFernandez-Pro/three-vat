# glTF and FBX are the supported formats; any subtree is accepted

`bakeVAT` takes an `Object3D` and never sees a file ([ADR-0008](./0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)), so which formats "work" is not a question about the baker. It is a question about what the project will stand behind. There are three tiers. A **supported format** is one the suite backs: a real asset in it is pinned by digest, and its bake is held to three's own skinning under an `AnimationMixer`. glTF and FBX are supported, and the README names both. Any other subtree is **accepted**: it bakes, whatever loaded it, and nothing claims more than that. Everything else **waits** until someone asks. Decided on [#97](https://github.com/MikeFernandez-Pro/three-vat/issues/97) on 2026-09-25, after the FBX probe reported there.

## Why FBX, and why now

The probe (branch `prototype/fbx-probe`, `d7494b2`) baked five of three.js's r186 FBX samples under both encodings and compared checked vertices with three's `getVertexPosition` in root space. The rig encoding matched to 2.6e-5 or better on every animated file, the non-Mixamo Warrior and the pre- and post-rotated RotationTest included. The vertex encoding came out at about 0.07% of the asset's radius on every file, the 36-vertex cube included, which reads as the half-float store's cost. FBX bakes today, with no library change. Mixamo, where most FBX characters come from, exports FBX first. So the gap was the claim, not the code.

## Why not OBJ, and not the others

- **OBJ carries no animation.** It already bakes as a rigid subtree, but a pinned OBJ asset would test `OBJLoader`, not anything the baker does with animation. Calling it supported would promise nothing, so it stays accepted and goes unnamed.
- **MD2** would bake under the vertex encoding, because its animation is morph targets. Nobody has asked for it.
- **VRM** is glTF underneath, and is supported as glTF.

## What the baker does not do for FBX

`FBXLoader` never builds an index. It writes one vertex per face corner, so a Mixamo character comes out at about 5× its merged vertex count (Samba Dancing: 165 960 vertices, 35 440 after `mergeVertices`). Every instance's vertex shader pays that. The baker does not merge the geometry itself: vertex order belongs to the caller, and the baker never changes geometry uninvited. The docs tell the caller to run `mergeVertices` first. Mixamo FBX exports also carry an empty `Take 001` clip. The caller filters it out, as with a rest-pose `TPose`.

## Consequences

- **A format moves up a tier when a pinned asset does**, not when a README names it. The README's "glTF input only" becomes "glTF and FBX" once the pinned FBX asset has landed, and not before.
- **Still untested from FBX:** morph animation (`morph_test.fbx` has no clip) and material arrays (no sample uses one, #92). Both reach code the glTF assets exercise, but no pinned FBX asset covers them.
- **Only the pinned FBX tests need a stub under Node.** `FBXLoader` cannot load textures there, so those tests stub `TextureLoader`. The browser is unaffected.
