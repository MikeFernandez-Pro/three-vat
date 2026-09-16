# A VAT bakes a posed subtree, not a `SkinnedMesh`

The unit of a bake is **a subtree posed by the mixer, merged into one vertex set, recorded in root space** — not a single `SkinnedMesh` in its own local space. `bakeVAT` walks every `Mesh` under `root`, merges them once into a single geometry, and for each frame records where each vertex ended up after `root.updateMatrixWorld(true)`.

This is because what a VAT physically stores is only *"where did vertex `v` end up on frame `f`"*. It has no stake in how the vertex got there — skinning, morph targets, node-hierarchy transforms, or anything else the mixer can drive. Requiring a `SkinnedMesh` discards that source-agnosticism, which is precisely VAT's advantage over bone-texture instancing, and it rejects assets that are perfectly bakeable. `RobotExpressive.glb` is the motivating case: 14 rigid meshes moved by 14 rotation + 5 translation node channels, with only `Hand.L`/`Hand.R` skinned and morph weights on `Head`. Under the old unit every part bakes to all-zero deltas and trips the library's own "frozen pose" diagnostic (`maxDelta ≈ 0`), despite being a fully animated character.

Skinning and morphs do not become special cases — they become the one-part instance of the general case, and their existing code paths are retained and applied per part.

**There is one entry point.** `bakeVAT(root, clips, options)` handles every shape: a subtree of rigid node-animated parts, a single `SkinnedMesh`, a morph-target mesh, or any mix of them in one hierarchy. A single mesh is simply a subtree of one. We deliberately do not ship a separate `bakeSubtreeVAT` alongside a single-mesh fast path — two entry points would make callers classify their own asset, which is exactly the judgement that was wrong in the `RobotExpressive` case and exactly what the baker can determine for itself by inspecting the geometry it is handed.

## Materials are the draw-call boundary; merging never collapses them

A merged VAT keeps **geometry groups plus a material array**, yielding one draw call per material. Materials are never silently merged.

This is because merging is bounded by materials, not by parts, and we must not design around the luck of one asset. `RobotExpressive` happens to use three flat `baseColorFactor` colours with zero textures and identical roughness/metalness, so it *could* collapse to a single `vertexColors` material — but a textured character cannot, and that is the common case. Architecture follows the general case; the flat-colour collapse is an opt-in helper (`mergeFlatMaterials`), never a precondition for baking.

The cost of keeping materials separate is smaller than it looks, because the split is only in the draw call:

- **One VAT, one texture pair, one upload** covering the whole merged vertex set. Texel count is unchanged by material count — the groups partition the same vertex range.
- **One geometry, one set of instanced attributes**, so per-instance clip/offset/speed is shared across groups for free.
- **The decode path is untouched.** For indexed draws `gl_VertexID` is the value fetched from the index buffer, so it remains a true global vertex index inside a group. `texelFetch(tex, ivec2(gl_VertexID, row))` in `src/webgl.ts` needs no per-group offset and no edit.

So the honest claim is **VAT collapses instance count, not material count**: a 500-robot crowd is 3 draw calls, not 1 and not 500.

## Consequences

- **`bakeVAT` must return the merged geometry.** The vertex ordering is now the baker's invention and the texture is indexed by it, so the caller can no longer supply its own geometry by cloning the source mesh. The result gains the merged `BufferGeometry` (with groups) and the ordered material list.
- **The base/delta reference is the merged rest pose in root space**, captured before any action plays. `transformed = position + delta` therefore still holds unchanged, which is what keeps the shader and the on-disk format stable.
- **Normals** are transformed per part by that part's normal matrix, then stored absolute, as today.
- **The `maxTextureSize` guard now applies to the merged total** (`RobotExpressive`: 7 214 verts), not to one part.
- **Resolved — the offline format (ADR-0003), by [ADR-0010](./0010-drop-the-offline-format-runtime-bake-is-the-library.md): the format is cut rather than fixed.** The original note follows.

  **Deferred — the offline format (ADR-0003):** a serialized VAT ships textures + manifest and assumes the consumer holds the source mesh. Merging breaks that assumption: the merged geometry would have to ship alongside, or be reproducible from a documented deterministic merge order. We are knowingly leaving this unresolved for now — the runtime bake path is where the value is, and the format question is separable. `loadVAT` keeps working for VATs baked from a single mesh; a merged VAT should not be serialized until this is decided.
- **Encoding efficiency is unchanged, not worsened.** Rigid node-animated parts store every vertex to express what is really one matrix per frame, but the ratio (~7 200 verts to ~19 animated nodes) is the same order as a skinned character's (Soldier: 7 434 verts to 49 bones). This is the normal VAT trade, not a new penalty.
