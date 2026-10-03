# A level of detail repeats the vertices, and the decode wraps the column

The usage guide said **No LOD**: every instance sampled the VAT at full vertex
count, whatever its distance. #91 asked whether that has to hold, and where LOD
would live in a library about baked animation: at the VAT, at the model, or
both.

## At the model, not at the animation

A VAT crowd's cost per frame is roughly the vertices drawn times the texture
reads per vertex. A level of detail on the **animation** side has three forms,
and only one of them saves anything:

- **A lower-rate or shorter bake for far instances.** It saves no GPU time,
  because each vertex makes the same reads however many frames the texture
  holds. It saves no memory either, because near instances still need the full
  bake, so the copy is extra texture on top of it.
- **Updating far instances less often.** This is the classic LOD of a
  `SkinnedMesh` crowd, whose cost is the CPU posing skeletons. A VAT crowd has
  no per-frame CPU cost to cut.
- **A cheaper decode far away** (one row instead of two, no crossfade band, one
  bone influence instead of four). It is real, and the library could offer it,
  but it needs a branch or a second material, and #72 measured what a branch in
  this decode costs. It stays open; nothing here prevents it.

A level on the **model** side cuts the first factor, which multiplies every
cost the decode has. So a level of detail is a geometry, and the carrier picks
one per instance: `BatchedMesh.setGeometryIdAt` changes an instance's geometry
and keeps its id, and the id is the instance's row in the playback texture
(ADR-0016), so a level change never touches the pack.

## What a level is: every vertex, fewer triangles

A level keeps **every vertex** of its character and draws fewer of them: the
caller's simplified index over the source's own vertices. `createVATLODs`
shares the source's attributes and gives each level its own index; the
simplifier is the caller's (meshoptimizer's `simplify` returns exactly such an
index), so the library depends on none. The GPU shades only the vertices an
index names, so the ones a level keeps but never draws cost the batch their
bytes and the frame nothing.

Keeping them is what makes a level free under the **vertex encoding**, whose
decode reads a vertex's column at its batch vertex index. Added in the order
`createVATLODs` gives, each level sits a whole VAT width after the one before
it, so the decode reads the column at that index **modulo the width** and every
level's vertex lands on its source's column. The modulo is a literal, as the
span's divisors are (ADR-0030), and a VAT without levels compiles the program
it always did. The **rig encoding** names slots by `skinIndex` wherever a
vertex sits, and its decode does not change at all.

An atlas (ADR-0040) is levelled as a whole. A level is the atlas at a lower
detail: one index a character, `null` for a character kept whole, and the
batch repeats the atlas's width once a level. A VAT with levels is refused by
`composeVATAtlas` and by `createVATLODs` again, so the two compose in one
order: the atlas, then its levels.

## Measured

The prototype on branch `prototype/rig-lod` baked Soldier once, simplified it
to 50% and 25% of its 11 376 triangles, and put the three geometries in one
batch over one VAT, on WebGL and WebGPU, under both encodings, with instances
mid-crossfade and shadows on. Two checks came out **pixel-identical** on all
four runs: the 25% level against the full vertices drawn under the simplified
index over the plain bake, which cannot decode wrong; and instances moved to
the level with `setGeometryIdAt` against instances added there. A frame later,
the reference differs on 10.7 to 11% of pixels, so both checks are sensitive
to the pose.

Best GPU frame, 4 096 Soldiers far from the camera, shadows off:

| run | full | 50% | 25% | no levels |
|---|---|---|---|---|
| WebGL rig | 6.9 ms | 4.2 ms | 2.6 ms | 6.8 ms |
| WebGL vertex | 4.1 ms | 2.6 ms | 1.7 ms | 4.1 ms |
| WebGPU rig | 5.9 ms | 3.9 ms | 3.0 ms | 5.4 ms |
| WebGPU vertex | 6.3 ms | 3.9 ms | 3.3 ms | 6.1 ms |

WebGPU's 25% sits on the ~3 ms floor of the measurement's own round trip. The
full geometry decoded with levels on, alone in its batch, measured the same as
no levels on every run (WebGPU rig: 5.3 against 5.4 ms); what the WebGPU full
column adds is the batch's three geometries, not the decode.

## Considered and not taken

- **Copying a level's columns into an atlas of the bake and its levels.** It
  needs no decode change, and it is what the prototype tried first. It cost
  Soldier's two levels 88% more texture (8.3 to 15.5 MB) on the encoding that
  is already the heavy one.
- **A compacted level that carries each vertex's column as an attribute.**
  Order-free and without a texture copy, but reading the attribute cost a
  full-detail crowd a fifth of its frame on WebGL (4.1 to 5.0 ms) and a tenth
  on WebGPU, whichever type it took (`float` or `uint`). The modulo cost
  nothing measurable, and its price is the batch's vertex buffer: every level
  holds every vertex, about 240 KB a level for Soldier.

## Consequences

- **The order is the rule, and the carrier checks it.** Under the vertex
  encoding every geometry has to start a whole number of widths past one
  character's first column and span exactly that character's vertices. Adding
  `levels.flat()` with no room reserved does that, and `assertVATCarrier`
  checks it range by range, so a gap, a stranger or a range `optimize()` moved
  is refused before a frame renders it. Under the rig encoding any of the
  geometries, in any order, is accepted.
- **The carrier is a `BatchedMesh`.** #91 asked about two `InstancedMesh`es
  sharing one VAT's textures as well. They decode correctly — on an
  `InstancedMesh` the vertex index is below the width, so the modulo changes
  nothing — but an instanced mesh holds one geometry, so each level is its own
  crowd with its own playback rows, and moving an instance between levels
  means moving its pack. The batch's `setGeometryIdAt` keeps the row, which is
  why the recipe is the batch.
- **Choosing a level is the caller's.** A distance, a screen size, a budget:
  each is a CPU decision per instance, and the write is three's own
  `setGeometryIdAt`. The library adds no per-frame pass to make it.
- **A baked file holds no levels.** The writer writes the bake; levels are made
  after loading, from the same indices.
- **The usage guide's "No LOD" is reversed.**
