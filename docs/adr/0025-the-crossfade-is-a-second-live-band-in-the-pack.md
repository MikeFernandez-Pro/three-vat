# The crossfade is a second live band in the pack, and the pose freeze is gone

Supersedes [ADR-0015](./0015-the-pose-freeze-fade-is-provisional-and-capped.md), which said it would.

`setVATInstance(playback, id, { clip, startTime, fadeDuration })` — the call a caller already writes — now produces a real crossfade: the clip the instance was playing **keeps playing**, carried in the instance's own pack as a full playback state, and the shader blends the two sampled poses by a weight it derives from the clock it already reads. One write at the moment of the transition, and nothing per frame afterwards, which is the property that makes a VAT a VAT.

The freeze is removed rather than kept alongside. `MAX_FADE_DURATION`, the frozen-pose type and every fade branch in both decodes are gone; `fadeDuration` keeps its name, loses its cap, and a caller asking for a 0.1 s blend into a death writes the same line they wrote in 2.0 and gets a better-looking result. The cap existed only because a frozen pose skates over anything longer than a tenth of a second, and there is no frozen pose any more.

## The pack widens to five texels, with the duration third

| Texel | r | g | b | a |
| --- | --- | --- | --- | --- |
| `x = 0` clip | clip start row | clip frames | clip fps | speed |
| `x = 1` playback | start time | loop mode | repetitions | end mode |
| `x = 2` crossfade | duration | 0 | 0 | 0 |
| `x = 3` outgoing clip | clip start row | clip frames | clip fps | speed |
| `x = 4` outgoing playback | start time | loop mode | repetitions | end mode |

The outgoing half is the **same two texels** the incoming half is, in the same order, with the same meaning, because that is the whole difference between a freeze and a crossfade. A frozen pose was three floats; a clip still playing needs its start time, its speed and its policy — so an outgoing one-shot that runs out mid-transition clamps exactly as it would have, and a crossfade out of a finished one-shot leaves from the end pose it was holding. Nothing about the outgoing half is invented: `resolveVATFrame` resolves it by calling itself, one level deep, and both decode paths call their band resolver ([#68](https://github.com/MikeFernandez-Pro/three-vat/issues/68)) a second time.

The crossfade texel comes **third**, ahead of the outgoing pair, so that an instance that is not transitioning reads texels 0, 1 and 2 — three fetches, exactly what it read before this decision.

The blend starts at the incoming clip's `startTime`; there is no separate blend-start field, because a transition that begins when the new clip begins is what `crossFadeTo` means. The weight is `1 - clamp((time - startTime) / duration, 0, 1)`, wall clock, so a half-speed incoming clip does not stretch it.

The playback texture stays `FloatType`, for the reason [ADR-0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md) gave: a start time in seconds does not survive half precision, and there are now two of them per row. A row is 80 bytes rather than 48.

## The branch: an `if` on one path, and not on the other

The outgoing fetches sit behind a condition that is **per instance**, so every vertex of an instance takes the same side of it.

- **GLSL takes a real branch.** `if ( vatCrossfade.x > 0.0 )` derives the weight, and `if ( rows.weight > 0.0 )` guards the two extra texel fetches and the second band resolution. A crowd that never crossfades pays nothing at all, and a transition that has run out stops paying the moment it ends.
- **TSL does not, and this is the accepted trade.** Three's `If` has to be built inside a `Fn` body, and a `Fn` body is opaque to graph traversal — burying the decode in one would erase every structural assertion CI can make about this path without a GPU, which is the only coverage it has. So the outgoing band is resolved unconditionally, as the freeze's third fetch already was. What is done instead is the next best thing: while the weight is zero the outgoing rows **are** the live rows, selected on the same comparison, so an idle crowd's extra fetches land on texels it has already read rather than on a second band. [#67](https://github.com/MikeFernandez-Pro/three-vat/issues/67) allowed exactly this, with the measurement as the tiebreak.

  It costs that path one divergence the parity gate cannot see: resolving a band from the zeroes "not transitioning" is written as would be a 0/0 duration and a NaN row, and NaN times a zero weight is still NaN — so the TSL decode clamps the *outgoing* pair's frames and fps to one before it divides, where the GLSL decode simply does not look. The clamp is unreachable for any pack that carries a real transition, which is why the gate cannot see it and why it is recorded here instead.

**The measurement is [#72](https://github.com/MikeFernandez-Pro/three-vat/issues/72)'s**, and it lands in this record: the crowd example's frame rate on both renderers, at the count the HUD reports, with no instance transitioning, against the same 5% bound ADR-0016 set for the playback texture. Until it is here, "free when unused" is a claim about the GLSL path and a shape argument about the TSL one.

## Two bands, and an interrupted transition drops the older one

A write over an instance that is mid-transition replaces the outgoing band with the band the instance was switching *to*, and drops the older one at whatever weight it still had. The pack holds two bands and they are the incoming clip and the one it replaced; a third would be a different contract, and smoothing the drop is a different feature. This is the same answer the freeze gave, and it is the one visible discontinuity a caller can produce: a pop proportional to how early the interruption came. `startTime + fadeDuration` is what a caller waits out instead.

## Consequences

- **`MAX_FADE_DURATION` is removed from the package rather than deprecated.** ADR-0015 said the constant was not a foundation and nothing should be built on it; this is that sentence being kept. A negative or non-finite `fadeDuration` is now **refused by name at the write**, as a negative speed is, because a bad duration left to the GPU is a crowd that quietly never finishes transitioning. Zero, and absent, stay a cut.
- **`VATInstance.from` changes shape**, from a frozen phase to a full playback state — the exported `VATPlaybackState`, which is an instance in every respect except that it carries no transition of its own. `setVATInstance` fills it by reading the row back whole, and honours a `from` a caller writes by hand, which is what keeps the primitives composable for a crowd the library does not build.
- **`resolveVATFrame` returns one field instead of two**: `outgoing`, a resolved frame with a weight, or `null`. Not a weight of zero, so a reader with no interest in transitions ignores one field rather than testing one. `endsAt` is untouched — it answers for the clip the instance is playing.
- **Row recycling changes in consequence, not in mechanism.** A spawn written with a `fadeDuration` into a recycled row now crossfades out of a *moving* corpse rather than a frozen one, which is why a spawn is a cut.
- **The rig encoding blends per slot**, before the skin matrix is composed, with the same hemisphere check the wrap needs — the outgoing row is no neighbour of this one. A componentwise blend of two composed matrices would shorten a limb as it turns, which is the reason ADR-0018 gave for the normalised quaternion lerp in the first place.
- **The WebGL shadow materials blend for free**, because they are built from the same patch; the TSL path's `positionNode` already feeds its depth pass.
- **This is a breaking change** — a removed export, a changed shape for `from`, a changed frame-resolution result, a wider playback texture — and ships under a major version.
