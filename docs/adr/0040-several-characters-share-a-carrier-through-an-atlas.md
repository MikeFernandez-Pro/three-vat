# Several characters share a carrier through an atlas, and the decode does not change

The capstone page the examples review asked for is a crowd of several models (Soldier,
Robot, Horse, Michelle), each playing its own clips in its own colour, in one
`BatchedMesh` and one draw. Under the glossary's **carrier** as it stood, that
could not be built. A batch carrying a VAT held one geometry, because a second
character is a second VAT texture and a sampler is a uniform per draw call
(ADR-0002). `assertVATCarrier` refused a second geometry by name.

#139 asked whether that holds. It does not have to. Several VATs pack into one
texture, the **atlas**, which one material samples, and a multi-geometry batch
draws it. The prototype on branch `prototype/showcase` showed the result
**pixel-identical** to one batch per character over its own VAT. That held on
WebGL and on WebGPU, under both encodings, with instances mid-crossfade and
shadows on. The reference rendered one frame later differs on 3.6 to 4.2% of
pixels, so the comparison is sensitive to the pose.

## The shape: side by side, in the batch's own order

An atlas puts its characters **side by side**, in the order the batch adds
their geometries. Every character's bands start at row 0.

- **Vertex encoding.** Character *k*'s columns start at its geometry's
  `vertexStart` in the batch, which is the sum of the vertex counts before it.
  three writes each index as `vertexStart + local` (`BatchedMesh.setGeometryAt`),
  so `gl_VertexID` and TSL's `vertexIndex` are already the atlas column. The
  decode reads `( vertexIndex, row )` as it always has.
- **Rig encoding.** Character *k*'s slots start after the slots of the
  characters before it. Its geometry's `skinIndex` is rebased by that offset,
  and so is each parent in the **hierarchy row**, which stays the texture's last
  row. The decode reads the slot its `skinIndex` names and finds the hierarchy
  row from the texture's height, so it does not change either.
- **Rows are shared, so no clip table is rebased.** Each character keeps its
  own `startFrame`s. The atlas is as tall as its tallest character, and the
  rows below a shorter character's bands are padding.

## Which character an instance is: nothing new

The ticket asked how the decode learns an instance's character: an atlas
offset, a vertex range, a clip table. It needs none of them, and ADR-0016's
keying is untouched.

- The **geometry** says which columns, by the vertex index (or `skinIndex`)
  above. The batch chooses an instance's geometry at `addInstance`, and nothing
  per instance has to repeat it.
- The **band** says which rows. The pack's clip texel already carries
  `startFrame`, `frames` and `fps` per instance, so the clip table was per
  instance all along. A caller writes one character's clip into one
  character's instance with `setVATInstance`, as it does today.

This costs an invariant, and how much of one depends on the encoding:

- **Vertex encoding: the columns are the batch's vertex ranges.** Each geometry
  goes in at its exact size and in the atlas's order, and no range may move
  afterwards, which a `deleteGeometry` followed by `optimize()` would do.
  Contiguity alone cannot hold this. Two characters added in swapped order
  still sit end to end and still sum to the atlas's width. So the composed VAT
  records each character's vertex range, and the carrier rule compares the
  batch's ranges with those, range by range. A mismatch would make one
  character silently sample another's columns, so it is refused by name, as
  the one-geometry rule was.
- **Rig encoding: the columns are slots.** Each geometry's rebased `skinIndex`
  carries its slots wherever the batch puts its vertices, so order and
  compaction do not matter. The rule checks only that the batch holds the
  composer's geometries.

The prototype's rule (on its branch) checked contiguity only. The recorded
ranges are the build's (#141). For a plain one-geometry VAT, the recorded
range is `[0, vertexCount)`, which is the rule as it stands today.

## Colour: three's own, per instance

Per-character colour comes from **`BatchedMesh.setColorAt`**: three's own
per-instance colour texture, read through the same logical index. It works
unchanged on both decode paths (on TSL through `batch()`'s `vBatchColor`). It
does not come from the atlas or the playback texture:

- **The atlas** holds animation. An albedo atlas would need a UV atlas, so it
  is a texturing project and not a VAT one.
- **The playback texture** holds the pack, and the pack is playback (ADR-0016,
  glossary). A colour there would put scene data in the animation contract.

A batch takes one material, so the characters' own materials do not survive.
The prototype used one matte material and an instance colour per character. A
character's parts can keep their own tones through `mergeFlatMaterials`'s
vertex colours (ADR-0028), but a batch needs the same attributes on every
geometry, so `color` must then be filled in white wherever a bake has none.
That route is reasoned, not measured: the prototype dropped `color` from every
geometry, and #141 tests it.

## One encoding per atlas

An atlas holds one encoding. The two decodes are different programs over
different attributes, and a material compiles one of them. A character the rig
refuses (Horse, whose gallop is morph targets) therefore puts the **whole**
atlas on the vertex encoding, and the two encodings cost very different
amounts:

| atlas | characters | size | as separate VATs |
|---|---|---|---|
| rig | Soldier, Robot, Michelle | 344 × 548, **3.0 MB** | 1.8 MB |
| vertex | Soldier, Robot, Horse | 15 444 × 284, **43.9 MB** | 29.1 MB |

The vertex atlas is as wide as all of its vertices together, and the texture
ceiling bounds that width: 15 444 fits 16 384, and Michelle's 16 340 vertices
will not fit beside anyone. On WebGPU it also needs
`requiredLimits.maxTextureDimension2D` raised past the default 8 192. The
padding is the cost of shared rows: every character pays for the tallest
character's frames. A layout that stacks characters vertically would not pay
it, but it would need a per-vertex column offset that the decode does not
have. That would be a decode change, and the padding does not yet justify one.

## On WebGPU, one draw per character

On WebGL the batch is one `multiDrawElements`: **1** draw in the main pass.
The prototype counted the main pass alone, with shadows off. The shadow pass
draws the same list the same way, so the build measures it rather than this
record assuming it. WebGPU has no
multi-draw, and ADR-0023's fold relies on every draw naming the same range,
which a multi-geometry batch breaks. The fold generalises to **runs**: one
`drawIndexed` per run of consecutive draws over the same range, its
`firstInstance` the run's first slot, so `instance_index` is still the slot.
The run boundaries depend on the batch's order:

- **Depth-sorted (three's default):** characters interleave and runs stay
  short. The prototype's 18 instances took 18 draws from three, and the fold
  took them only to 18 (rig) and 17 (vertex).
- **Grouped by character** (`sortObjects = false`, instances added character by
  character, or a custom sort keyed by geometry first): **one draw per
  character**: 3 in the prototype, pixel-identical to the reference. Every
  count here is the batch's own. The scene took one draw on WebGPU with the
  batch hidden, and that draw is subtracted.

So the WebGPU page of the pair draws once per character, and its HUD says so,
as ADR-0023's soft failure already does. The pair still behaves the same
(ADR-0011), but the count differs between the two renderers, for a reason the
page states. The generalised fold stays in the example, for every reason
ADR-0023 gives. It is not about VAT, it reaches `_draw`, and three should do
it itself.

## Decision: a library feature

The atlas belongs in the **library**, not in an example's wiring:

- **The refusal is the library's.** `assertVATCarrier` refuses a second
  geometry, and both decode paths call it. An example cannot get past it
  without lying to it about the batch. Only the library can say when a
  multi-geometry batch is safe.
- **Composing reads texels the contract keeps opaque.** `VAT`'s typings tell a
  caller not to read numbers out of a texture's array, because a minor release
  may change the arrays. The composer has to copy texels: half-floats,
  octahedral pairs, the rig's slots and the hierarchy row's parents. So it can
  only live beside the code that writes them.
- **The decode stays as it is.** The feature is a composer in core that returns
  one VAT with one geometry per character, plus a carrier rule that accepts
  what the composer made. ADR-0002's argument stands. A sampler is still one
  per draw, and the atlas turns "which character" into the column offset the
  batch already supplies, as stacking turned "which clip" into a row offset.

What stays out: the generalised fold (the example's, per ADR-0023), albedo
atlases, and mixing encodings in one atlas.

## Consequences

- The glossary gains **atlas**. The **carrier** entry stops saying "one
  character" and says a batch carries one VAT, which an atlas lets hold
  several characters.
- `assertVATCarrier`'s one-geometry rule becomes the per-encoding rule above.
- The page is an **example** like any other, the atlas example. Its feature is
  the atlas, and it is a pair.
- The build is specified as #141, the follow-up to #139.
