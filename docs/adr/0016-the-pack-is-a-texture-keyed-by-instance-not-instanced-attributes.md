# The pack is a texture keyed by instance, not instanced attributes

Instance playback moves out of the three instanced `vec4`s — `aVatClip`, `aVatPlayback`, `aVatFade` — and into a `DataTexture` read by the instance's **logical index**: `x = field`, `y = instance`, RGBA float, three texels wide. `InstancedMesh` stays the only supported carrier; what changes is how the pack gets to the shader, not what is in it.

This is because a vertex attribute with divisor 1 is indexed by the **drawn slot**, and every carrier that would give a VAT crowd per-instance frustum culling draws indirectly — the drawn slot stops being the instance.

Measured, not reasoned (branch `prototype/three-ez-interop`, 340 robots, clip chosen by grid column so a correct crowd is vertical stripes):

- **`@three.ez/instanced-mesh`.** Culling on: 332 drawn, `instanceIndex` breaks at slot 2 — `[0, 1, 20, 21, 40, 41, 60, 61, 2, …]`. The stripes become mush. Culling off: identity, stripes clean. The decode itself is fine — `InstancedMesh2` chains the `onBeforeCompile` that `patchVATMaterial` installed, and `vatSample` indexes by `gl_VertexID`, so it is untouched by any reordering. Only the pack is wrong.
- **`BatchedMesh`** is worse, and it is core three.js. `perObjectFrustumCulled` and `sortObjects` are both `true` by default (`BatchedMesh.js:211`, `:221`), so the permutation is the normal case and changes every frame. And it is not instanced-drawn at all — it is multi-draw over one merged geometry, so an `InstancedBufferAttribute` binds with `vertexAttribDivisor(1)` against a non-instanced draw and **every vertex reads element 0**: the whole crowd would play instance 0's clip.

A texture keyed by the logical index is not an invention here. It is what three itself does for exactly this problem — `_matricesTexture` and `_colorsTexture`, dereferenced through `getIndirectIndex( gl_DrawID )`.

## What this corrects

[ADR-0009](./0009-both-decode-paths-read-one-instance-playback-contract.md) says the pack is "exactly three RGBA texels because that makes a future `BatchedMesh` carrier a change of carrier and not of contract". The *layout* half is right and is why this migration is cheap — the pack is already texel-shaped. The *carrier* half is wrong: instanced attributes cannot carry the pack onto `BatchedMesh` at all, so the change it promised would have been a change of contract.

[ADR-0014](./0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md) refuses an `InstancedMesh` subclass on the grounds that "a VAT crowd is not always an `InstancedMesh`: `@three.ez/instanced-mesh` … is the motivating case". That reasoning stands; its motivating case did not work. `setVATInstance(geometry, index, instance)` keeps its shape — 0014 already said a texture carrier "changes what this function writes into, not what it is" — and this ADR is what makes the sentence true.

**This is not about the sixteen-attribute limit.** A crowd in `InstancedMesh` + `MeshStandardMaterial` uses 10 of the 16 slots today — `position`, `normal`, `uv`, `instanceMatrix` (4 by itself), `aVatClip`, `aVatPlayback` and `aVatFade`, the last declared by both decode paths since the pose-freeze fade landed (#36). Six `vec4`s remain free, five once crossfade (#30) is live. The ceiling is real but distant, and it is not the reason.

## Scope

**2.0 migrates the carrier and promises no new one.** `InstancedMesh` remains the only supported carrier. Shipping `BatchedMesh` on WebGL alone would reopen the split ADR-0009 closed — this time in the public documentation.

**The instance-id source is hard-coded**, `gl_InstanceID` in GLSL and `instanceIndex` in TSL. No pluggable seam: a seam with one implementation is the speculative architecture this project rejects elsewhere, and swapping the source is one line per path on the day a second carrier lands.

**`BatchedMesh` is deferred**, and it is blocked upstream rather than here. In GLSL the id is public and already in scope at the injection point — `batching_vertex` is included before `begin_vertex` in `meshphysical.glsl.js`, so `getIndirectIndex( gl_DrawID )` is available where the pack is read. In TSL there is no exported accessor: `batch()` yields the matrix, the id resolution is a local `Fn`, and reaching it means reading three's private `_indirectTexture`. The path forward is to get an index accessor exported from `three/tsl`, not to depend on an underscore.

**`@three.ez/instanced-mesh` is out of scope permanently** — no dependency, no test, no promise. If interop falls out, it is a README note. ADR-0014's prose should be read accordingly: it names a real user, not a supported target.

**Nothing else rides along.** A breaking 2.0 is nearly free right now — the package is six days old, 1.0.0 three days old, with no observable dependents — but a cheap break does not excuse a wide diff. The `tangent` attribute the bake's merge never copies (so a `normalMap` on a crowd never gets `USE_TANGENT`) is a bug with its own fix, not a 2.0 item.

## When to stop

Two conditions, written before the work starts:

- **No decode path may depend on a private three.js API.** If a carrier needs `_indirectTexture` or similar to find its instance id, that carrier does not ship.
- **The demo bench (340 robots) may not lose more than 5% of its frame rate.** The three pack fetches are per-vertex but read the same texel for every vertex of an instance, so the texture cache should absorb them; if it does not, the premise was wrong.

No time limit. This is a contract change: it lands or it is reverted, it is not left half-done.

## Consequences

- **`addVATInstanceAttributes` does not survive.** It is replaced by an explicit producer — a `DataTexture` the caller owns and the patch functions bind. The primitives stay exported beside `createVATMesh`, because they are what a non-`InstancedMesh` carrier will need, which is the escape hatch 0009 and 0014 both commit to.
- **The instance ceiling becomes `MAX_TEXTURE_SIZE`** — around 16 384 instances, asserted rather than worked around. `x = field, y = instance` extends the grammar ADR-0002 already uses (`x = vertexIndex, y = frame`) instead of introducing square packing and a second way to index.
- **One more texture unit**: three of the sixteen WebGL2 guarantees, with position and normal.
- **Ownership is unchanged.** Nothing in this library disposes anything today, and the new texture follows `positionTexture` and `normalTexture` rather than inventing a lifecycle.
- **`setVATInstance` keeps its signature.** An `addUpdateRange` on three attributes becomes a sub-upload of one row; the "minimal upload" property is preserved, not improved.
- **Order of work.** The decode for `LoopMode` / `EndMode` / the pose-freeze fade is **already written** in both paths (#35, #36). This ADR was first drafted on the belief that it was not, and that migrating now would mean writing it once instead of twice; that is not true, and the claim is withdrawn rather than quietly kept. What makes the migration cheap anyway is 0009's layout half: the pack is already three RGBA-shaped `vec4`s, so both decoders change *where a `vec4` comes from* and not one line of the arithmetic that follows. The migration therefore lands **after** the in-flight playback work is committed, over a finished decode, not racing it.

## Alternatives rejected

- **Keep attributes, add a fourth `vec4` when fields run out.** Six free slots say this works for a long time. It also permanently excludes `BatchedMesh` — not awkwardly, but completely, since the attribute would read element 0.
- **Carry both, attributes and texture, and pick per carrier.** Two carriers is the two-entry-point split [ADR-0008](./0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md) refused, applied to the read side: it makes callers classify their own renderer, and doubles the surface the parity gate must cover.
- **Do it later, when a carrier actually needs it.** Later is genuinely possible — the substitution is mechanical and stays mechanical. What does not stay constant is the price of the break: the package is days old with no dependents today, and every week of adoption makes a change to the instance-playback contract cost more. This is the cheapest this will ever be, and the reason to act is the break, not the refactor.
- **Adopt `@three.ez/instanced-mesh`'s `instanceIndex` as the id source.** That is a WebGL-only, single-maintainer dependency written into the core contract, and it fails 0009's parity requirement on its own.

## Amendment (2026-09-20, before #39 starts)

Two claims above were checked against three r186 and against the ticket that lands this, and both change.

- **`setVATInstance` does not keep its signature.** A `BufferGeometry` has nowhere to carry a `DataTexture`, so a function that takes the geometry can only find the texture through a side channel — a `WeakMap` keyed by geometry, or `userData`, which the first `clone()` loses. Neither is honest about what the function writes into. The producer that replaces `addVATInstanceAttributes` returns an explicit object, the **playback texture** (`CONTEXT.md`), which the patch functions bind and `setVATInstance` takes as its first argument in place of the geometry. [ADR-0014](./0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md)'s sentence — a texture carrier "changes what this function writes into, not what it is" — stands, and the parameter that names the thing written into changes with it. This is one more break in a release that is already breaking, and the escape-hatch user has the object in hand where they never had a `VATCrowd`.
- **"The minimal upload property is preserved" holds on one path.** `Texture.addUpdateRange` exists and `WebGLRenderer` honours it — one `texSubImage2D` per merged range. The WebGPU backend does not read `Texture.updateRanges` at all: it `writeTexture`s the whole image whenever `needsUpdate` is set. So on the TSL path a `setVATInstance` re-uploads the whole playback texture — 48 bytes per instance, 16 kB for the demo's 340 robots, 786 kB at the 16 384 ceiling — once per frame in which any instance changed. Accepted rather than made a stop condition: it is a per-change cost and never a per-frame one, the 5% bench bound already catches it if it turns out to matter, and an upstream `updateRanges` for WebGPU textures would close it without a change here. Documented where a caller meets it, in `docs/usage.md`.

Two smaller things the ticket now states rather than leaves to be discovered:

- **The playback texture stays `FloatType`.** A `startTime` in seconds does not survive half precision — one second of resolution at 2 048 s — so the narrowing #29 proposes for the VAT textures does not reach this one.
- **The geometry clone loses its reason.** With the pack off the geometry, `createCrowdGeometry` clones nothing a crowd needs of its own; two crowds over one bake may render `vat.geometry` itself. Whether they do is #39's call, and it should be made knowing the clone existed for the attributes and for nothing else.
