# The rig encoding is a second encoding, opt-in for now

A bake can store the **posed rig** per frame instead of the posed vertices: one
**slot** per bone — rotation, translation, uniform scale, two texels — and the
vertex shader skins the rest-pose geometry from that **rig texture**. It is
chosen per bake, explicitly, `bakeVAT(root, clips, { encoding: 'rig' })`, and
the default stays the **vertex encoding** (`'delta'`). Everything above the
sampling — the clip table, the pack, the playback texture, `resolveVATFrame`,
the pose-freeze fade, `setVATInstance` — is untouched: a rig-encoded VAT plays
under the same contract, on both decode paths, in the same release.

The library was built on the vertex encoding's source-agnosticism
([ADR-0008](./0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)): a VAT
records where a vertex ended up and does not care how it got there. That is
still the reason the vertex encoding exists and stays the default. The rig
encoding gives it up on purpose, for what a rig-shaped row buys, and the size
of that was measured rather than argued (branch `prototype/bone-encoding`,
[#47](https://github.com/MikeFernandez-Pro/three-vat/issues/47), Soldier,
7 434 vertices, 49 bones, three clips at 30 fps):

| | vertex encoding | rig encoding |
| --- | --- | --- |
| texture | 25.2 MB | 177 kB |
| bake | 1.4 s | 5 ms |
| frame, 340 instances, RTX 5080 | 0.46 ms | 0.65 ms (1.4×) |
| frame, 340 instances, iPhone 15 Pro Max | 7.3 ms | 4.4 ms (0.6×) |

Two things in that table decided the shape of this record.

**The cost is platform-dependent, in the direction that matters.** On a
discrete GPU the rig decode is ~1.4× the frame time, because its four fetches
are *dependent* — addressed from an attribute — and the blend and matrix
reconstruction sit behind them; the fetch count itself is not the driver (8
fetches and 32 landed within 15%). On a phone the same decode is ~0.6×: the
25 MB vertex texture is a stream of cache misses on a bandwidth-starved GPU,
the 177 kB rig texture is cache-resident, and the dependent fetches come back
nearly free. `docs/landscape.md` had predicted the cache would absorb the
fetches; that premise is wrong on the desktop, where the cost does not matter,
and right on the phone, where it does. Nobody should read the desktop ratio as
the encoding's cost.

**It is not universally applicable, and the demo asset is the proof.** A rig
cannot express a morph target whose influence a clip animates, and *every one*
of `RobotExpressive`'s fourteen clips animates its head's morphs — Idle and
Walking included. The library's own demo asset can never take this encoding.
A source-agnostic default therefore cannot simply become a rig default; the
baker would have to inspect the asset and choose, and a caller's memory
footprint and frame cost would change with the asset they loaded.

## Considered: default, or option

Three shapes were on the table. **(a)** An explicit option, vertex by default.
**(b)** Rig wherever the asset allows it, falling back to vertices otherwise.
**(c)** Rig wherever the asset allows it, refusing otherwise so a caller asks
for vertices by name.

(a) is chosen for this release, and it is a *deferral* rather than a verdict:
the intent recorded here is to flip the default to (b) or (c) in 3.0, once the
rig encoding has run on both decode paths through a release, met a textured
and normal-mapped asset, and been measured on Android. The case for the flip is
already strong — on a phone it is faster *and* two orders of magnitude smaller,
the bake stops being a page freeze, the vertex ceiling (`vertexCount ≤
maxTextureSize`) disappears, and a real crossfade
([#30](https://github.com/MikeFernandez-Pro/three-vat/issues/30)) is cheap
only here, where blending two poses is blending two quaternions per slot
rather than two vertex sets. The case for waiting is that 2.0 shipped a week
before this was written, the encoding has never met the TSL path, and a
default flip is a major bump whichever way it goes. Opt-in is the reversible
move; the memory win is available today to anyone who asks for it.

(b) and (c) are recorded so nobody reopens them as new ideas: (b) is what
ADR-0008's "the baker can determine that for itself" argues for, and it is the
likelier 3.0 shape; (c) is the stricter one and punishes the robot's own
users.

## What the rig encoding refuses, and folds

The encoding is chosen **per bake, for the whole subtree** — not per part. A
subtree mixing a rig-encoded body and a vertex-encoded head is two textures
and two decodes behind a per-vertex discriminator in one shader, for one asset
shape; it is not built, and the type does not carry the discriminator so that
it *could* be added without a breaking change.

So a bake asked for the rig encoding **refuses, naming the part and the
clip**, when a baked clip animates a morph target's influence — the same
posture as a negative `timeScale`, a non-unit `weight`, and a normal-less VAT
under a lit material today: loud, at the bake, before any frame is sampled. A
morph influence that is *static* across every baked clip is not animation; it
is folded into the rest pose once and the part skins normally. A bone scaled
differently per axis is refused too, naming the bone: quaternion + uniform
scale cannot store it, the vertex encoding already only approximates its
normals, and neither test asset has one — a `mat4` format would double the
texture to serve a rig nobody has shown. Rigid node-animated parts are one
slot of weight one each; that is Houdini's *rigid VAT*, and it is why the word
is *slot* and not *bone*.

`bakeNormals: false` is accepted and ignored under the rig encoding: there is
no normal texture to drop, because normals and tangents come out of the skin
matrix, as in three's own skinning. Refusing a no-op would punish the caller
who switched encodings and left their options alone.

## Shape

- `VAT` becomes a **discriminated union on `encoding`**. The `'delta'` member
  is today's type, field for field; the `'rig'` member carries `rigTexture`
  and geometry that keeps `skinIndex`/`skinWeight` in part-local space rather
  than dropping them. `bakeVAT` is overloaded on the option, so an existing
  call still returns the narrow `'delta'` type and no caller changes.
- **Slots are keyed by skeleton and bind matrix, not by part**, so the meshes
  of one character sharing a rig share its slots — and so a second geometry on
  the same rig could read the same texture. That is the door to LOD and to a
  mixed crowd in one `BatchedMesh`, which
  [ADR-0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)
  and #42 declare impossible for a vertex-encoded crowd. It is deliberately
  **not in this decision** — the carrier API for several geometries does not
  exist and is its own design — but nothing here may preclude it.
- The frozen-clip diagnostic keeps its purpose: `maxDelta` on a rig-encoded
  clip is the largest displacement of any slot's origin across the clip.
- Both decode paths land together, including the depth material, so a rig
  crowd casts shadows from the first release
  ([ADR-0004](./0004-ship-both-glsl-and-tsl-decode-paths.md),
  [ADR-0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)).
- **Interpolation is two rows, blended as rotations** — normalised lerp of the
  quaternions, lerp of the translations — at the bake's ordinary frame rate.
  The prototype timed componentwise `mat4` interpolation as both the slowest
  variant and the one that shortens a limb as it turns, and nearest-row at a
  doubled frame rate as no cheaper than blending. Neither is carried forward.

## Consequences

- A minor release: additive API, unchanged default.
- The glossary gains **Encoding**, **Slot** and **Rig texture**, and the
  **VAT**, **Frame** and **Decode** entries now acknowledge both encodings.
  "Bone texture" stays the name of what the neighbouring packages upload from
  the CPU each frame, so the dividing line `docs/landscape.md` draws survives.
- `docs/usage.md`'s trade-offs — "vs bone-texture instancing: smaller textures
  … but more fetches per vertex" — is rewritten: the comparison is now inside
  the library, and the fetch-count framing was measuring the wrong axis.
- The demo cannot show this encoding. Its asset is a vertex-encoding asset by
  nature, and it stays one; the rig encoding is shown by an **example** instead
  ([ADR-0019](./0019-examples-beside-the-demo.md)).
- Benchmarking the real implementation on a phone needs the bench fix the
  prototype found: Safari rounds `performance.now` to 1 ms and its `gl.finish`
  returns before the GPU is done, so a wall-clock fallback has to end on a
  readback and calibrate its batch to swamp the clock.
- Android is unmeasured. Non-uniform bone scale is unexercised, so the refusal
  is untested against a real rig. Both are noted for the default decision, not
  for this one.
