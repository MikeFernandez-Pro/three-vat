# A fallen-back bake says why on the VAT, not in the console

An `'auto'` bake that falls back from the rig encoding to the vertex encoding ([ADR-0027](./0027-the-default-encoding-is-the-rig-where-the-asset-allows-it.md)) records why on the VAT it returns. It prints nothing. The field is `vat.fallback`: the message of the rig refusal that caused the fallback, and `null` on a vertex-encoded VAT that was asked for by name. A bake where the vertex encoding refuses as well throws its own error, with the rig refusal as its `cause`, so the first reason the asset could not bake is not lost. The usage guide tells a caller shipping to phones to measure before pinning `'delta'`, and gives no rule for when to do it. Decided for [#81](https://github.com/MikeFernandez-Pro/three-vat/issues/81) on 2026-09-24, after #77 and #78 had reported.

## What the measurements changed

#81 was held until the Android and normal-mapped figures were in, because either could change what the fallback is for. The normal-mapped one did not: Michelle bakes under the rig encoding and shades right, so the fallback is still for what a rig cannot express. The Android one did change it:

- **On a phone, a fallback can fail.** The Mi 9 reports a `maxTextureSize` of 4096, and the vertex encoding refuses both shipped assets there. An asset the rig refuses for an animated morph, and that has more than 4096 vertices, has no encoding on that phone. Until now the caller saw only the vertex error ("vertexCount … exceeds maxTextureSize; row wrapping is not implemented"). That points at row wrapping, when the fix is the morph. The rig refusal names the morph, the clip and the part, and it was swallowed.
- **A fallback also costs frame time, not only memory.** Where both encodings fit, the Mi 9 draws the vertex encoding faster (the rig is 1.28×). So a fallback is not always a loss at draw time. On the iPhone, and wherever the vertex texture misses the cache, it is. Neither case warrants alarming the console.

## The options

- **A warning on every fallback**, like the one the bake gives once for a bone scaled differently per axis. Rejected. An asset that animates a face's morphs is an ordinary asset, and the vertex encoding is the right one for it. The warning would fire on every load of a working page, for a condition the caller cannot change without re-authoring the asset. [ADR-0017](./0017-loop-mode-is-a-playback-policy-not-bake-data.md) turned down a bake-time warning for the same reason: it puts the fix in the caller's console rather than in their crowd. The bone-scale warning is different in kind. It reports that the output is approximate, not that a supported path was taken.
- **Silence, as shipped.** `vat.encoding` already says which encoding the bake chose. Rejected as incomplete, because it says *which* and not *why*. A caller who sees `'delta'` and 45× the memory they expected has to re-bake with `encoding: 'rig'` to read the reason. The swallowed refusal on a phone is a defect under any option.
- **An `onFallback` option.** Rejected. It adds API surface for a fact that fits in a field. A function also cannot cross to the worker, because the worker's options are posted as data ([ADR-0026](./0026-a-worker-bake-copies-the-subtree-and-calls-bakevat.md)). The worker would need a second mechanism to reach the same place.
- **A reason on the VAT.** Chosen. It costs nothing at the console, it is where a caller already looks (`vat.encoding`), it is data and so crosses the worker as one more field of the record, and a test or a HUD can read it.

## What the field holds

`fallback` is on `DeltaVAT` only. A rig-encoded VAT never fell back, and the discriminant already narrows to it. The field holds the rig refusal's message as thrown. That message ends by telling the caller to bake with `encoding: 'delta'`, which, on a fallen-back VAT, is what already happened. Rewording the refusals so that the advice reads right in both places is part of building this, not a separate decision. The field is a string, not a code, because the refusals are prose written for a person and nothing in the library branches on which one fired.

## Pinning `'delta'` on phones

The usage guide gives the Mi 9's figures and no rule. On the Mi 9, a small asset that both encodings fit draws about a quarter slower under the rig. At a 4096 ceiling, the vertex encoding refuses a typical character. The iPhone went the other way. Two phones from two vendors, measured on different assets, are not a pattern. A rule of thumb drawn from them would be advice about one Adreno part. The guide says to measure on the target device, pass the renderer's own `maxTextureSize` to the bake, and pin `'delta'` only where it both fits and is measured faster.

## Consequences

- **`DeltaVAT` gains `fallback: string | null`.** It is additive, and a 3.x caller that pins `'delta'` sees `null`.
- **The worker's record carries it**, so a worker bake and a page bake of one asset report the same reason.
- **The error when both encodings refuse carries the rig refusal as `cause`.** Its message names both refusals, because a console prints a `cause` inconsistently.
- **The building is its own ticket** in the 4.0 milestone, #87, and it blocks the 4.0 docs ticket, #82.
