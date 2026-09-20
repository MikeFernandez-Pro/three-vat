# The pose-freeze fade is provisional, and capped rather than trusted

Switching an instance's clip mid-animation pops. The fix that ships with `setVATInstance` is deliberately the small one: freeze **one phase** of the clip the instance was playing, and blend away from that frozen pose over `fadeDuration`. Three floats and a duration, in the `aVatFade` slot the pack already reserved, and one extra texel fetch per texture.

It is not a crossfade, and the difference is visible. A crossfade keeps both clips *playing*; this keeps one of them as a photograph. Over the case it exists for — a death, an impact, a hit reaction, ~0.1s — nobody can see it. Over half a second the instance skates: its walk stopped dead the instant the transition began, so it slides out of a motionless pose while the ground moves under it. The honest response is not to document the limit and hope, but to make the API unable to reach it: `fadeDuration` is clamped to `MAX_FADE_DURATION` (0.25s), and the constant carries its own reason.

A real crossfade is a second live playback state and four fetches per vertex — the cost [ADR-0007](./0007-v1-scope-library-only.md) deferred, tracked as [#30](https://github.com/MikeFernandez-Pro/three-vat/issues/30). #30 **replaces** this fade; it does not sit beside it. So the freeze ships now, under a cap, as the short-lived half of the contract, and `aVatFade` is not a foundation: nothing else should be built on top of it.

## Consequences

- `MAX_FADE_DURATION` clamps rather than throws. A too-long fade is a worse-looking fade, not an unrepresentable one, and a death that renders slightly wrong is better than a death that throws mid-battle.
- Both decode paths pay one extra `texelFetch` per texture whether or not anything is fading: a TSL node graph has no branch to skip it behind, and the weight is zero when there is nothing to blend. That cost disappears with #30, which re-spends it.
- A fade out of an instance that is *itself* fading keeps only the incoming clip's pose; the older one is dropped. Two frozen poses would be two more floats and the beginning of the state #30 is for.
- The fade is wall clock, measured from the instance's `startTime`. A clip's `speed` does not stretch it.
