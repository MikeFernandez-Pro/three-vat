# Drop the offline format: the runtime bake is the library

`serializeVAT` and `loadVAT` are removed from the public surface. A VAT is
produced one way: `bakeVAT(root, clips, options)` at runtime, from a loaded
glTF. This supersedes ADR-0003 and closes the item ADR-0008 left deferred.

The offline path did not survive contact with ADR-0008. Once a bake merges the
whole subtree into a new geometry with its own vertex ordering, the textures are
addressed by *that* ordering — texel column `v` means "vertex `v` of the merged
geometry". Serializing the textures without the geometry therefore produces a
file that cannot be rendered: you would have to reload the source glTF and re-run
the merge to use it, which is the work the file was meant to save. ADR-0008
recorded this as unresolved; the README meanwhile told users a loaded VAT was
"interchangeable with a freshly-baked one", which was not true for any merged
bake — that is, for anything but a single-mesh asset.

## The measurement that settled it

The only thing an offline format buys is bake time at load. Measured on
three@0.185.1 (Node, Apple Silicon, mean of 3 runs after warm-up):

| Asset | Clips | fps | Rows | Bake |
|---|---|---|---|---|
| RobotExpressive (rigid, 7 214 v) | 3 (the demo) | 30 | 158 | 97 ms |
| RobotExpressive | 5 | 30 | 313 | 178 ms |
| RobotExpressive | 14 (all) | 30 | 585 | 330 ms |
| RobotExpressive | 14 (all) | 60 | 1 168 | 659 ms |
| Soldier (skinned, 7 434 v) | 4 (all) | 30 | 113 | 250 ms |
| Soldier (skinned) | 4 (all) | 60 | 224 | 492 ms |

Cost is linear in `vertices × frames`, and **skinning costs ~4× per frame row
what rigid parts do** (Soldier 2.2 ms/row vs Robot 0.56 ms/row) — the four-weight
bone blend is the hot loop. ADR-0001's "50–200 ms" estimate holds for realistic
clip counts and understates the tail: a 20k-vertex skinned character with 6 clips
at 30 fps extrapolates to ~1.8 s here, and 5–9 s on a mid-range phone, blocking
the main thread.

So the problem is real but narrow, and it has a remedy that is not a file format:
**the baker is pure CPU and touches no renderer, so it runs in a Web Worker**,
with the texel buffers transferred back. 1.0 documents that recipe. A
`bakeVATInWorker` helper is deferred to 1.1 — adding an async second way to bake
while stabilizing the API is the two-entry-point split ADR-0008 refused, and
demand should decide it.

## Alternatives rejected

- **Ship the geometry alongside** (raw attribute `.bin`s, or a single `.glb`
  carrying geometry + texel buffers + clip table in `extras`). This works and is
  the right shape if the format ever returns — one file, loadable as a real
  glTF, and it makes the deferred CLI a thin `model.glb → model.vat.glb` wrapper.
  Rejected for 1.0 because it adds a second versioned representation of a VAT to
  maintain forever, in service of a cost most users do not pay.
- **Keep the texture-only format, documented as single-mesh-only.** Worst of the
  three: an API whose correctness depends on whether the user's asset happened to
  be one mesh, which is exactly the classification burden ADR-0008 removed.

## Consequences

- `serializeVAT`, `loadVAT`, `SerializedVAT`, `SerializeOptions`, `VATManifest`
  and `VATPrecision` leave the public API; `src/offline.ts` and its tests go with
  them. Breaking versus `0.3.0`, noted in `CHANGELOG.md`, and pre-1.0.
- ADR-0003 is superseded but retained: if the format returns, the single-`.glb`
  answer and the KTX2 rejection are already reasoned out there and above.
- ADR-0007's "four library surfaces" becomes three: core baker, WebGL decode,
  TSL decode.
- `BakedVAT` and `VAT` can collapse into one type — the split existed only
  because `loadVAT` returned a VAT without geometry.
- The per-vertex bone loop re-reads skeleton matrices per vertex; optimizing it
  is not a 1.0 blocker but would shrink the tail case that motivated offline in
  the first place.
