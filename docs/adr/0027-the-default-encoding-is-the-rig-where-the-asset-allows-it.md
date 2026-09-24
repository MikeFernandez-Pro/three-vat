# The default encoding is the rig where the asset allows it

A bake that names no encoding now bakes the **rig encoding**, and falls back to the **vertex encoding** where the rig encoding refuses the asset. That is shape (b) of [ADR-0018](./0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md), which recorded it as the likelier shape for the flip. The option spells it `encoding: 'auto'`, and `vat.encoding` says which one a bake chose. `'delta'` and `'rig'` still ask for one encoding by name. This is a breaking change, shipped in 4.0.

## Why flip

The rig encoding is better wherever the difference matters, and cheap where it does not:

- **Memory.** Soldier's rig texture is 177 kB, where its vertex textures are 7.9 MB.
- **Bake time.** The rig bake takes milliseconds, where the vertex bake takes seconds in a browser. That is the difference between a load that stalls and one that does not.
- **Phones.** On the iPhone measured for ADR-0018, the rig decode is 0.6× the vertex decode's frame time, because its small texture stays in cache.
- **Desktop.** The rig decode is 1.4× the vertex decode's frame time there, but that is 0.65 ms against 0.46 ms for 340 Soldiers.
- **No vertex ceiling.** A rig row is two texels a bone, not one texel a vertex.

## Why fall back rather than refuse

Shape (c) would refuse what the rig encoding cannot store and make the caller ask for vertices by name. It is rejected for the reason ADR-0008 gives for one entry point: the baker can inspect the asset, so the caller should not have to classify it. A clip that animates a face's morphs is an ordinary asset, not a mistake. Refusing it would break every caller whose asset worked in 3.x, for no gain.

The fallback catches only what the rig encoding refuses and the vertex encoding does not: an animated morph target, a non-uniform scale, parts sharing slots that move apart, and a rig too wide for the texture. Those are thrown as their own internal class. A refusal both encodings share, such as too many frames or an action that blends, still throws.

Two of those refusals are reached inside the sampling loop, at a row. Both sampling loops now restore the rest pose on any exit, so the vertex bake after a rig refusal measures its deltas from rest, not from where the rig bake stopped. That also fixes a second bake after any refusal, which used to start from a stranded pose.

## What the flip was taken without

ADR-0018 named three conditions for the flip. One is met: the rig encoding has run on both decode paths through two releases, 3.0 and 3.1. Soldier, the asset it was measured on, is textured. Two are not met. No normal-mapped asset has been measured, and neither has an Android device. The maintainer took the flip on 2026-09-24 with those open. The fallback means no asset that baked before fails to bake now, and the one cost a desktop pays is small in absolute terms. If Android turns out to disagree, `'delta'` is one option away.

## Consequences

- **The default bake's type is the union.** `bakeVAT(root, clips)` returns `VAT`, not `DeltaVAT`, because the encoding is chosen at the bake. Code that read `vat.positionTexture` off a default bake narrows on `vat.encoding` first, or asks for `encoding: 'delta'`. This is the breaking half of the change. `bakeVATInWorker` follows the same overloads.
- **A caller's memory footprint and frame cost depend on the asset.** ADR-0018 named this as the case against the flip. `vat.encoding` is how a caller finds out, and asking for an encoding by name is how they pin it.
- **`bakeNormals: false` still applies when the bake falls back**, and is still ignored under the rig encoding.
- **The examples bake the default.** The robot pages now draw rig-encoded crowds. The Soldier pages name both encodings, because comparing them is their point. The worker pages name the vertex encoding, because a millisecond bake would leave them nothing to measure. The parity gate names the vertex encoding for its robot case, which is that encoding's case.
- **The hero image is of a rig-encoded crowd** once it is next re-captured, and its texture panel shows a rig texture.
