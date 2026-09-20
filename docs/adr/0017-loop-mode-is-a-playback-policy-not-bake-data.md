# Loop mode is a playback policy, not bake data

> **Amended by [#43](https://github.com/MikeFernandez-Pro/three-vat/issues/43):**
> the decision below stands, but the last consequence does not — an action's
> `clampWhenFinished` is no longer read at the bake, and both inputs clamp.
> See [the amendment](#amendment-43-2026-09-20-the-end-mode-is-not-read-off-the-action).

How a clip repeats — `LoopOnce` / `LoopRepeat` / `LoopPingPong`, the repetition count, and what happens at the end — is carried per instance and resolved per frame by `resolveVATFrame`. Nothing about it reaches the texels. A death clip and an idle clip are baked the same way; the difference between "once, then hold" and "forever" is the three numbers of the playback policy in an instance's pack.

This was a real fork, because the bake is where it would be cheapest to decide. The alternative is to bake the policy in: a one-shot baked as a band the decode simply runs off the end of, a ping-pong baked with its reversed frames appended, a repeat count fixed into the table. It is rejected on three grounds, in order of how much they cost:

- **The texels are identical.** A bake samples the posed mesh frame by frame; nothing in a vertex position changes because the animation will be played once. Baking the policy in spends texture rows — the library's scarcest resource, and the one thing `maxTextureSize` puts a hard ceiling on — to record a fact that is not about geometry. Ping-pong is the clearest case: appending the reversed frames doubles a clip's rows to store poses that are already there, which is exactly what `phase = m < 1 ? m : 2 - m` gets for free.
- **It would freeze the policy at bake time.** The same baked death has to be able to clamp for the crowd and rewind for the one instance that is being previewed in an editor; the same walk has to loop forever for the crowd and play twice for a scripted moment. Policy in the texels makes each of those a second bake of identical poses.
- **It would put the same decision in two places.** Both decode paths already transcribe `resolveVATFrame`. A policy half-baked and half-resolved is a semantic with two homes, which is the drift [ADR-0009](./0009-both-decode-paths-read-one-instance-playback-contract.md) exists to prevent.

## The compromise: defaults at the bake, overrides at the instance

Keeping policy out of the texels does not mean repeating it at every instance. A crowd of a thousand corpses should not spell "once, clamped" a thousand times, and a caller who has to should eventually get one of them wrong.

So the **clip table** carries the policy as *defaults*: `bakeVAT` takes an `AnimationClip` **or** a configured `AnimationAction`, and reads the action's `loop`, `repetitions` and `timeScale` into `VATClipDefaults` (and `clampWhenFinished`, until the amendment below). An instance inherits them and overrides, field by field, anything it names. The bake records the policy; it never encodes it.

That keeps the vocabulary three's, which is the other half of the point: a user who knows `AnimationAction` configures the animation the way they already know, and the VAT is what changes.

## Consequences

- One bake serves crowds that play it differently. The clip table is data about poses plus a default, never a behaviour the texels are locked into.
- Both decode paths must transcribe the policy, which is the cost this decision pays: the branch cascade in `resolveVATFrame` exists in GLSL and in TSL as well as in TypeScript, and CI can only evaluate the third.
- A repetition count belongs to the loop mode it was configured under. An instance that overrides the clip's `loopMode` and says nothing about the count takes the count its *new* mode implies — otherwise a one-shot inherits "forever" from the looping clip it overrode and never finishes.
- ~~The two inputs are deliberately not symmetric, and it shows at exactly one field — the end mode, which only a clip that stops playing ever reaches. A bare `AnimationClip` carries no configuration and takes the library defaults, which **clamp**; an `AnimationAction` is read literally, and three's `clampWhenFinished` defaults to `false`, so a one-shot action left alone **rewinds** to its first frame. Configuring an action is the user saying what they want; handing over a clip is the user saying nothing, and a crowd's answer to nothing is to hold the last frame.~~ **Amended: both inputs clamp** — see below.

## Amendment (#43, 2026-09-20): the end mode is not read off the action

The consequence struck through above was caught before 2.0 shipped, and it was wrong in the direction that matters. Reading `clampWhenFinished` literally put the failure on the *more* careful caller: `bakeVAT(scene, [deathClip])` clamped, while the caller who built an action and wrote `death.loop = THREE.LoopOnce` — and nothing else, because nothing else looked needed — got a corpse that stands back up. The clamp-by-default promise this library makes is met exactly where a user is least likely to be looking for it.

The premise that failed is "configuring an action is the user saying what they want". It is true of `loop`, `repetitions` and `timeScale`, which are inert until somebody sets them. It is not true of `clampWhenFinished`: `false` is what the field already holds on every action three hands out, so a `false` at the bake is a decision and a silence wearing the same face, and `resolveAnimation` cannot tell them apart. Believing it is believing a statement nobody made.

So `resolveAnimation` gives every action `EndMode.Clamp`, the same answer a bare clip gets, uniformly across loop modes — not only the ones that finish. An instance may override a repeating clip's `loopMode` to `Once` while inheriting the end mode, so there is no mode whose end mode is safely unreachable, and a table whose answer depended on the mode it was baked under would be a second rule to carry. With no branch left, the field is simply `LIBRARY_PLAYBACK_DEFAULTS.endMode`.

The cost, accepted: an action can no longer ask for three's rewind at the bake. The escape hatch is per instance — `{ clip: vat.clips[1], startTime: hitAt, endMode: EndMode.Rewind }` — which is the finer grain anyway, and is the same grain the "one bake serves crowds that play it differently" consequence above already depends on. Warning at the bake and keeping the rewind was considered and rejected: it puts the fix in the user's console rather than in their crowd, and the default a warning defends is still the wrong one.
