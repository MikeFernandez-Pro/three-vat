# A negative speed plays the band backwards, mirrored

A negative `speed` on an instance, or a negative `timeScale` on an action handed to the bake, plays the clip's band backwards at runtime. Nothing is baked for it. The pose a reversed instance shows at every moment is the pose forward playback would show at the mirrored phase, `1 − p`, and every other rule of the playback policy is applied to that mirrored phase. This replaces the refusal #45 shipped in 2.0.0.

The refusal was the fix for a bug, not a position. A negative speed froze an instance on its band's first row, and the fastest honest answer was to throw and to point at a reversed clip baked in. But a baked reversed clip is exactly what [ADR-0017](./0017-loop-mode-is-a-playback-policy-not-bake-data.md) rejects for ping-pong: texture rows, the library's scarcest resource, spent on poses the band already holds. Ping-pong already plays those rows backwards for free, so reverse is the same flip from the start.

## Considered options

- **A `reverse: true` field**, keeping `speed` a pure rate. Rejected: three already spells reverse as a negative `timeScale`, a mixer configured that way should bake without translation, and the sign fits in the float the pack already carries.
- **Three's literal semantics**: phase starts at 0 and runs down. For `LoopRepeat` this is the same as the mirror. For `LoopOnce` it is finished the instant it starts, which is why a three user sets `action.time = clip.duration` before playing a one-shot backwards. There is no `action.time` here, only `startTime`, so the literal reading would ship three's trap with no way round it. Rejected.
- **End modes pinned to frames** (Clamp always the last frame, Rewind always the first). Rejected: a reversed death would clamp standing up, the failure the Clamp default exists to prevent.

## Consequences

- **The end modes are relative to direction.** Clamp holds the pose playback stopped on, the first frame after whole repetitions. Rewind returns to the pose it started from, the last frame. Three disables a non-clamped action with a negative `timeScale` instead, and the parity tests compare against three with `action.time = duration` and `clampWhenFinished` set to the case under test, not against its disable.
- **A reversed ping-pong goes backward first**: last, first, last. One rule, no per-mode exception.
- **A scheduled instance waits on the pose it will start on.** A reversed one-shot or ping-pong waits on its last frame. A reversed repeat waits on its first, because the seam of a loop is where both directions start: the bake never samples `t = duration`.
- **The #88 hold mirrors.** A clip ending on Clamp holds its end row across its final interval forward; reversed, it holds its start row across its first interval, so the row timing does not jump between directions.
- **`endsAt` is the same moment either way**, from `|speed|`, and a crossfade's outgoing band keeps its own direction.
- **The decode pays for it on every instance, reversed or not**, so the flip is a select on the phase, never a branch, and an idle crowd must bench the same before and after on both renderers (the lesson of #72).
- **Turning around mid-clip is not this decision.** Continuing backward from the current pose needs a `startTime` solved for the mirrored phase, and has its own questions about a transition already running; it is a separate ticket.

## Amendment: the hold is any finite play's, not only Clamp's (#108)

Two lines above read narrower than the rest of this decision allows, and #108 found where they collide with it:

- **"A clip ending on Clamp … reversed, it holds its start row across its first interval."** A reversed one-shot starts on its last frame under `Rewind` too, and `Rewind` returns to the pose it started from, the last frame. Without the hold, a reversed one-shot under `Rewind` would start at the seam, on its first row, and blend up to its last. So a reversed play with a finite count holds its last row across its first interval whatever its end mode. Forward keeps #88 as it was, Clamp only, because forward `Rewind` runs into the first row anyway.
- **"A reversed repeat waits on its first."** That holds for an endless repeat, which starts at the seam. A reversed repeat with a finite count starts on its held last row, so under the rule above it ("waits on the pose it will start on") it waits there. The resolver says this by clamping local time at zero before its scheduled start, so a scheduled instance and one at its `startTime` read the same.

The mirrored-time property (reversed at `t` shows what forward shows at `T - t`) therefore holds for a whole count under `Clamp`. Under `Rewind` it breaks in the first interval, where forward wraps into the first row and reverse holds the last.

