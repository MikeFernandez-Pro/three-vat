# The default encoding is the rig where the asset allows it

A bake that names no encoding now bakes the **rig encoding**, and falls back to the **vertex encoding** where the rig encoding refuses the asset. That is shape (b) of [ADR-0018](./0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md), which recorded it as the likelier shape for the flip. The option spells it `encoding: 'auto'`, and `vat.encoding` says which one a bake chose. `'delta'` and `'rig'` still ask for one encoding by name. This is a breaking change, shipped in 4.0.

## Why flip

The rig encoding is better wherever the difference matters, and cheap where it does not:

- **Memory.** Soldier's rig texture is 177 kB, where its vertex textures are 7.9 MB.
- **Bake time.** The rig bake takes milliseconds, where the vertex bake takes seconds in a browser. That is the difference between a load that stalls and one that does not.
- **Phones.** On the iPhone measured for ADR-0018, the rig decode is 0.6× the vertex decode's frame time, because its small texture stays in cache. *Amended by #77:* that was one phone. The Android phone measured since then goes the other way on an asset both encodings fit, and it refuses Soldier's vertex bake outright. See [Android, measured after the flip](#android-measured-after-the-flip).
- **Desktop.** The rig decode is 1.4× the vertex decode's frame time there, but that is 0.65 ms against 0.46 ms for 340 Soldiers.
- **No vertex ceiling.** A rig row is two texels a bone, not one texel a vertex.

## Why fall back rather than refuse

Shape (c) would refuse what the rig encoding cannot store and make the caller ask for vertices by name. It is rejected for the reason ADR-0008 gives for one entry point: the baker can inspect the asset, so the caller should not have to classify it. A clip that animates a face's morphs is an ordinary asset, not a mistake. Refusing it would break every caller whose asset worked in 3.x, for no gain.

The fallback catches only what the rig encoding refuses and the vertex encoding does not: an animated morph target, a non-uniform scale, parts sharing slots that move apart, and a rig too wide for the texture. Those are thrown as their own internal class. A refusal both encodings share, such as too many frames or an action that blends, still throws.

Two of those refusals are reached inside the sampling loop, at a row. Both sampling loops now restore the rest pose on any exit, so the vertex bake after a rig refusal measures its deltas from rest, not from where the rig bake stopped. That also fixes a second bake after any refusal, which used to start from a stranded pose.

## What the flip was taken without

ADR-0018 named three conditions for the flip. One is met: the rig encoding has run on both decode paths through two releases, 3.0 and 3.1. Soldier, the asset it was measured on, is textured. Two are not met. No normal-mapped asset has been measured, and neither has an Android device. The maintainer took the flip on 2026-09-24 with those open. The fallback means no asset that baked before fails to bake now, and the one cost a desktop pays is small in absolute terms. If Android turns out to disagree, `'delta'` is one option away.

*Amended by #77:* one Android device has now been measured, on the WebGL path. It disagrees on frame time, and on it `'delta'` is not one option away for either shipped asset. The next section has the figures. The flip stands.

## Android, measured after the flip

Measured for [#77](https://github.com/MikeFernandez-Pro/three-vat/issues/77) on a Xiaomi Mi 9: Snapdragon 855, Adreno 640, MIUI Global 12.5.1 (Android 11), Chrome 153. It uses the WebGL path only, because Chrome enables WebGPU on Android from Android 12, so **the WebGPU path on Android is still unmeasured**. The figures are 340 instances at pixel ratio 2, with shadows on. `EXT_disjoint_timer_query_webgl2` is not exposed, so each frame figure is the best of 12 wall-clock batches, ended on a readback, as ADR-0018's bench note requires. On the desktop the same method agrees with the timer query to within 4%.

| | vertex encoding | rig encoding |
| --- | --- | --- |
| Fox (1 728 vertices, 24 bones), texture | 1728 × 159 | 48 × 159 |
| Fox, bake | 0.95–1.06 s | 55–66 ms |
| Fox, frame | 12.9–13.0 ms | 16.4–16.5 ms (1.28×) |
| Soldier (7 434 vertices), bake | refused: past `maxTextureSize` 4096 | 140 ms |
| Soldier, frame at 96 / 340 | — | 70 / 166 ms |
| Robot (7 214 vertices), frame at 96 / 340 | — | 32 / 83 ms |

The Fox rows alternate vertex, rig, vertex, rig over three pairs, and the pairs agree within 1%. On the RTX 5080, by the same method, Fox is 0.09 ms against 0.17 ms (1.9×). Fox is Khronos's glTF sample (CC-BY 4.0). It was fetched for the bench and is not committed.

What it says, and what it does not:

- **This is the second phone, not the pattern.** The iPhone 15 Pro Max is several generations newer and far faster than the Mi 9. The two also measured different assets: the iPhone ran Soldier, whose vertex texture is 7.9 MB, and the Mi 9 ran Fox, whose vertex texture is about 2.7 MB. The Mi 9 could not bake Soldier's vertex texture at all. So the two ratios, 0.6× and 1.28×, are not one quantity measured twice. They are consistent with the cache reading ADR-0018 gave: the rig wins where the vertex texture misses the cache, and loses by its extra fetches where it does not. Two devices cannot show that, and one GPU vendor on Android cannot stand for the platform. Mali, and a current Adreno, are still unmeasured.
- **What decides it is the texture ceiling.** Chrome on this phone reports `maxTextureSize` 4096. The vertex encoding needs one texel per vertex in a row, and does not wrap rows, so both assets the examples ship are refused. The rig encoding is the only one that runs them there. Under 3.x's default, both crowds would have failed to bake on this phone.
- **A phone's crowd is not a desktop's.** 340 Soldiers is 6 fps here and 96 Soldiers is 14. The count the examples open on is a desktop figure.

So the flip stands, for the reason it was given least weight: the rig has no vertex ceiling. The cost it carries on an Adreno phone, where both encodings fit, is about a quarter of the frame. A caller who ships a small asset to phones, and measures, can pin `'delta'`. Whether the docs should say so, and whether the fallback should report its choice, is #81.

## Consequences

- **The default bake's type is the union.** `bakeVAT(root, clips)` returns `VAT`, not `DeltaVAT`, because the encoding is chosen at the bake. Code that read `vat.positionTexture` off a default bake narrows on `vat.encoding` first, or asks for `encoding: 'delta'`. This is the breaking half of the change. `bakeVATInWorker` follows the same overloads.
- **A caller's memory footprint and frame cost depend on the asset.** ADR-0018 named this as the case against the flip. `vat.encoding` is how a caller finds out, and asking for an encoding by name is how they pin it.
- **`bakeNormals: false` still applies when the bake falls back**, and is still ignored under the rig encoding.
- **The examples bake the default.** The robot pages now draw rig-encoded crowds. The Soldier pages name both encodings, because comparing them is their point. The worker pages name the vertex encoding, because a millisecond bake would leave them nothing to measure. The parity gate names the vertex encoding for its robot case, which is that encoding's case.
- **The hero image is of a rig-encoded crowd** once it is next re-captured, and its texture panel shows a rig texture.
