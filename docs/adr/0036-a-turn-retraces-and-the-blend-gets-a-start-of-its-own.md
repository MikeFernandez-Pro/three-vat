# A turn retraces the path, and the blend gets a start of its own

`turnVATInstance(playback, index, time)` turns an instance round at the pose it is showing (#107). From `time` on, the instance shows at each moment the pose it showed that long before the turn: a mirror in time about the turn, which is [ADR-0033](./0033-a-negative-speed-plays-the-band-backwards-mirrored.md)'s mirrored-time property taken about *now* instead of about the start. The helper reads the row back, as `setVATInstance` does to fill `from`, writes the turned pack, and returns the instance it wrote so `endsAt` can schedule what comes next.

A turn retraces motion, never waiting. A play with a count runs back to where it began and holds there. An endless play has no beginning, only a desync start time, so it retraces endlessly. A finished play turns from the moment it finished, not from the end of its hold. A play still waiting to start, or rewound to its starting pose, has nothing to retrace and stays where it is.

## Considered options

- **Flip the sign of `speed` and keep the remaining count.** This is the reading #106 left open. Rejected: a ping-pong with an even count, reversed by sign, goes last, first, last, where its path retraced goes first, last, first. It also needs a count rule of its own for every loop mode, and a second turn would not give back the first play. A retrace has one rule. The sign the helper writes is whatever reproduces the retraced path, so for a ping-pong it is chosen, not flipped.
- **A documented `startTime` formula instead of a helper.** Rejected for the same ping-pong reason: an even count needs a sign, a count and a start time solved together, which is not one formula a caller can copy.
- **Refuse a turn while a crossfade is running**, or cut the outgoing band. Rejected: either one keeps the jump the ticket exists to remove, in exactly the case a caller cannot schedule around.

## The blend gets a start of its own

A retrace runs a running crossfade backwards too. The weight rises back toward the clip that was being left, and the instance ends up playing that clip, retraced. ADR-0025 tied the weight to the live band's `startTime`, but after a turn the live band's `startTime` is fixed by pose continuity, so the weight cannot also be placed. The pack therefore gains a **blend start**: `VATInstance.fadeStart`, carried in the crossfade texel's spare `g` channel and defaulting to `startTime`. Every write that was valid before still means the same thing. This amends ADR-0025's "there is no separate blend-start field". That sentence was true of every write ADR-0025 knew about, and the turn is the first write it is not true of.

## Consequences

- **Both decodes pay one subtraction per instance** and no extra fetch. It is held to ADR-0016's 5% idle-crowd bound, measured as best frame with before and after interleaved, on both renderers.
- **A turned play is written with `Clamp`**, because a retrace stops where it began and a `Rewind` would snap back to the pose it turned at. A second turn gives back the original path but not a `Rewind` end mode, which the pack does not remember.
- **A turn does not ease.** It is continuous in pose, and velocity reverses instantly, as three's `timeScale = -timeScale` does. A turn with its own `fadeDuration` would need a third band mid-transition. That is a follow-up ticket if a page shows it is needed.
- **Additive, so it ships as a minor version.** There is a new export, a new optional field, and a pack channel that was always zero now carries a value every existing write fills with its own `startTime`. The parity scene gains a turned band. No example page is added: tests against `resolveVATFrame` are the evidence (pose continuous at the turn, path retraced after it).
