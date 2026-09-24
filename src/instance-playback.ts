// The instance-playback contract: the per-instance playback pack, written once
// here for every decode path to read (ADR-0009). It lives in core — not in a
// renderer subpath — because it is the interface between the baker and the
// decoders, and a contract with two definitions drifts the first time a field
// is added. Nothing here is renderer-specific: it is a `DataTexture` and the
// arithmetic that fills it, so ADR-0005's bundle isolation is untouched.
import type { DataTexture } from 'three'
import { makeVATTexture, MAX_TEXTURE_SIZE } from './vat-texture.js'
import type { VAT, VATClipDefaults } from './types.js'

/**
 * Where each of the pack's five `vec4`s sits along the playback texture's x
 * axis — the one definition of the layout. Both decode paths read this:
 * `ROW_PRELUDE` in `src/webgl.ts` interpolates them into its `texelFetch`
 * coordinates, `texturePlayback` in `src/tsl.ts` into its `textureLoad`s. Not
 * re-exported from the entry point: it is the contract's spelling, not part of
 * the public API.
 *
 * The crossfade texel comes *third*, ahead of the outgoing pair, on purpose: a
 * decode reads texels 0, 1 and 2 unconditionally — three fetches, what an
 * instance that is not transitioning has always cost — and only reaches texels
 * 3 and 4 when that duration says there is a band to blend away.
 */
export const PACK_TEXELS = {
  clip: 0,
  playback: 1,
  crossfade: 2,
  outgoingClip: 3,
  outgoingPlayback: 4,
} as const

/** Texels one instance's pack occupies — the playback texture's width. */
export const PACK_WIDTH = 5

/** Floats one instance's pack occupies: {@link PACK_WIDTH} RGBA texels. */
const PACK_STRIDE = PACK_WIDTH * 4

/**
 * How an instance repeats its clip — the numbers `THREE.LoopRepeat`,
 * `THREE.LoopOnce` and `THREE.LoopPingPong` name, in three's own order, as
 * values a `Float32Array` can carry.
 *
 * What each one *means* is {@link resolveVATFrame}, in one place, transcribed
 * by both decode paths.
 */
export const LoopMode = {
  /** Play the clip end to end, forever (or `repetitions` times). */
  Repeat: 0,
  /** Play the clip through once. */
  Once: 1,
  /** Play forward, then backward, without baking the reversed frames. */
  PingPong: 2,
} as const
export type LoopMode = (typeof LoopMode)[keyof typeof LoopMode]

/**
 * What an instance does once it has finished — three's `clampWhenFinished`, as
 * a pair of numbers.
 *
 * `Clamp` is first because it is this library's default, where three's
 * `clampWhenFinished` defaults to `false`. A one-shot in a crowd — a death, an
 * impact — almost always has to *stay* in its final state, and a rewinding
 * corpse standing back up is the failure a crowd library should not ship by
 * default. The divergence is deliberate.
 */
export const EndMode = {
  /** Hold the last frame. */
  Clamp: 0,
  /** Return to the first frame. */
  Rewind: 1,
} as const
export type EndMode = (typeof EndMode)[keyof typeof EndMode]

/**
 * An endless repeat count, as the pack spells it. `Infinity` does not survive a
 * `Float32Array` usefully, so it is converted once, here, at the boundary.
 */
export const INFINITE_REPETITIONS = -1

/**
 * One clip playing: which band, from when, how fast and under what policy.
 *
 * The unit the pack carries twice — as the animation an instance is playing,
 * and as the one it is blending out of ({@link VATInstance.from}). Both are
 * resolved by {@link resolveVATFrame} through the very same arithmetic, which
 * is the whole difference between a crossfade and the pose freeze it replaced
 * (ADR-0025): the outgoing half is a clip still *playing*, not a photograph.
 *
 * Every policy field is optional because the clip already answers it: a bake
 * handed a configured `AnimationAction` records the answer in the clip table
 * ({@link VATClipDefaults}), and a state that says nothing inherits it. A
 * crowd of a thousand deaths says "once, clamped" once, at the bake.
 */
export interface VATPlaybackState {
  /**
   * The clip band to play, straight out of `vat.clips`. Its playback defaults
   * come along with it; a clip table assembled by hand may carry none, and then
   * the library defaults below apply.
   */
  clip: Pick<VAT['clips'][number], 'startFrame' | 'frames' | 'fps'> & Partial<VATClipDefaults>
  /**
   * Absolute clock time, in seconds, at which this animation began. May be in
   * the past — and **desync is exactly that**: give each instance of a crowd its
   * own start time a little way back and they stop moving in lockstep.
   *
   * The one field with no clip-level default: when an animation began is a fact
   * about the instance and nothing else.
   */
  startTime: number
  /**
   * Playback rate multiplier, `>= 0`. Defaults to the clip's speed, then to
   * `1`. A negative rate is refused when the instance is written: a VAT plays
   * forward, and a clip that must run backwards is baked as a reversed clip.
   * `0` is legal — the instance holds its clip's first row.
   */
  speed?: number
  /** How the clip repeats. Defaults to the clip's, then {@link LoopMode.Repeat}. */
  loopMode?: LoopMode
  /**
   * How many times to play the clip, or {@link INFINITE_REPETITIONS}. Defaults
   * to the clip's count, then to endless for {@link LoopMode.Repeat} and a
   * single play for anything else — the counts three's own `LoopRepeat` and
   * `LoopOnce` imply.
   *
   * A count belongs to the mode it was configured under: replace the clip's
   * `loopMode` and say nothing here, and the count comes from the new mode
   * rather than from the clip — a one-shot over a looping clip finishes.
   */
  repetitions?: number
  /**
   * What to do once the repetitions run out. Defaults to the clip's, then
   * {@link EndMode.Clamp} — where three's `clampWhenFinished` defaults to
   * `false`; see {@link EndMode}.
   */
  endMode?: EndMode
}

/**
 * Per-instance playback state consumed by both decode paths: the clip this
 * instance is playing, and — while it is transitioning — the one it is
 * crossfading out of.
 */
export interface VATInstance extends VATPlaybackState {
  /**
   * The outgoing playback state to blend away from: a clip *still playing*, in
   * every respect an instance except that it carries no transition of its own.
   *
   * Normally you do not write this yourself — {@link setVATInstance} reads the
   * instance's current pack back, whole, and fills it in when you ask for a
   * {@link fadeDuration}. Write it by hand when you are assembling a crowd the
   * library does not build for you; what you pass is what is written.
   */
  from?: VATPlaybackState
  /**
   * Seconds to blend {@link from} away over. Uncapped, and wall-clock seconds
   * from {@link startTime}: the incoming clip's `speed` does not stretch a
   * transition.
   *
   * Zero, or absent, is a cut: no outgoing band is written. A negative or
   * non-finite duration is refused when the instance is written.
   *
   * Ignored without a `from` to blend away from — and at creation there is
   * nothing to blend away from, so this is `setVATInstance`'s field in practice.
   */
  fadeDuration?: number
}

/**
 * The repetition count a loop mode implies when nothing names one — the counts
 * three's own `LoopRepeat` and `LoopOnce` carry. Spelled as a function because
 * it is the general rule, and {@link LIBRARY_PLAYBACK_DEFAULTS} is one case of
 * it rather than a second answer.
 */
export function defaultRepetitions(loopMode: LoopMode): number {
  return loopMode === LoopMode.Repeat ? INFINITE_REPETITIONS : 1
}

/**
 * What playback looks like when nothing has configured it: repeat, forever, at
 * speed 1, clamping when finished.
 *
 * The **one** spelling of the library defaults. `bakeVAT` gives these to a bare
 * `AnimationClip`, and {@link resolvedPlaybackOf} falls back to them for a clip
 * table assembled by hand — and a default with two definitions is a crowd that
 * bakes differently from the one it renders.
 *
 * `Clamp` where three's `clampWhenFinished` is `false`; see {@link EndMode}.
 */
export const LIBRARY_PLAYBACK_DEFAULTS: VATClipDefaults = {
  loopMode: LoopMode.Repeat,
  repetitions: defaultRepetitions(LoopMode.Repeat),
  endMode: EndMode.Clamp,
  speed: 1,
}

/**
 * An instance's playback with every tier resolved — the playback policy
 * `CONTEXT.md` names, plus the speed it plays at. Exactly the four fields a
 * clip declares defaults for, which is why it is that type and not a second
 * one.
 */
type ResolvedPlayback = VATClipDefaults

/**
 * An instance's playback, defaults and all — spelled once, because
 * {@link createVATPlaybackTexture} writes it into the pack and
 * {@link resolveVATFrame} reads it, and a default with two definitions is a
 * crowd that resolves differently from the one it renders.
 *
 * Three tiers, field by field: what the instance says, else what its clip was
 * baked with, else the library default.
 *
 * With one coupling, because the two fields are not independent: a repetition
 * count belongs to the loop mode it was configured under. An instance that
 * replaces the clip's loop mode and says nothing about the count takes the
 * count its *new* mode implies — otherwise a one-shot inherits "forever" from
 * the looping clip it overrode, and never finishes.
 */
function resolvedPlaybackOf(instance: VATPlaybackState): ResolvedPlayback {
  const { clip } = instance
  const clipLoopMode = clip.loopMode ?? LIBRARY_PLAYBACK_DEFAULTS.loopMode
  const loopMode = instance.loopMode ?? clipLoopMode
  const clipRepetitions = loopMode === clipLoopMode ? clip.repetitions : undefined
  return {
    loopMode,
    repetitions: instance.repetitions ?? clipRepetitions ?? defaultRepetitions(loopMode),
    endMode: instance.endMode ?? clip.endMode ?? LIBRARY_PLAYBACK_DEFAULTS.endMode,
    speed: instance.speed ?? clip.speed ?? LIBRARY_PLAYBACK_DEFAULTS.speed,
  }
}

/**
 * An instance's transition, resolved: the band it is blending out of and how
 * long that takes — or `null` for the overwhelmingly common case of an instance
 * that is not transitioning.
 *
 * Nothing is a crossfade without both halves. A duration with no outgoing state
 * has nothing to blend, which is what a crowd written by
 * {@link createVATPlaybackTexture} always is, and it reads here as a cut rather
 * than as a blend out of an unwritten band.
 *
 * The outgoing band is otherwise trusted exactly as the incoming one is: this is
 * a pure reader of a pack that got past the write, and it no more checks that
 * `from` names a band of real frames than it checks that `clip` does.
 */
function crossfadeOf(instance: VATInstance): { from: VATPlaybackState; duration: number } | null {
  const from = instance.from
  if (!from || !asksToBlend(instance)) return null
  return { from, duration: instance.fadeDuration! }
}

/**
 * Whether this instance asks for a transition at all — spelled once, because
 * {@link setVATInstance} reads it to decide whether to fill the outgoing band in
 * and {@link crossfadeOf} reads it to decide whether there is one, and the two
 * have to agree about `0`, about absent, and about a duration that is neither.
 */
const asksToBlend = (instance: VATInstance): boolean => (instance.fadeDuration ?? 0) > 0

/**
 * Where in its VAT an instance is at a given moment: the two frame rows to
 * sample, the blend between them, and the two facts a decode cannot re-derive
 * from the rows alone.
 */
export interface VATFrame {
  /** The frame row to sample — an absolute texture row, clip band included. */
  row: number
  /** The row it interpolates toward. */
  rowNext: number
  /** Blend between {@link row} and {@link rowNext}, in `[0, 1)`. */
  mix: number
  /**
   * Whether {@link rowNext} crossed the clip's last row back into its first.
   * True only while a clip is genuinely looping: a ping-pong bounces rather
   * than wraps, and a finished one-shot must not wrap at all or the corpse
   * stands back up for a frame.
   */
  wraps: boolean
  /** Whether the repetitions have run out and the instance is holding an end pose. */
  finished: boolean
  /** How far through the clip this is, in `[0, 1]` — what {@link row} is derived from. */
  phase: number
  /**
   * The band this instance is blending out of, resolved at the same moment —
   * or `null` when it is not transitioning, which is almost always. Not a
   * weight of zero, so a reader with no interest in transitions ignores one
   * field rather than testing one.
   */
  outgoing: VATOutgoingFrame | null
}

/**
 * The outgoing half of a crossfade: the very frame the outgoing clip would be
 * showing if nothing had interrupted it, and how much of it is still showing.
 *
 * It is a {@link VATFrame} because it is one — resolved by
 * {@link resolveVATFrame} from the outgoing playback state, through the same
 * arithmetic, so an outgoing one-shot that runs out mid-transition clamps
 * exactly as it would have. Its own `outgoing` is always `null`: the pack holds
 * two bands, and the recursion is one level deep.
 */
export interface VATOutgoingFrame extends VATFrame {
  /**
   * How much of this band is still showing: `1` at the moment of the write,
   * falling to `0` across `fadeDuration`, and `0` once the transition is over.
   * Wall clock — `1 - clamp((time - startTime) / fadeDuration, 0, 1)` — so a
   * half-speed incoming clip does not stretch the transition.
   */
  weight: number
}

/**
 * What the vertex shader computes, as a pure function of `(instance, time)` —
 * the **one definition** of the playback semantics. Both decode paths
 * transcribe it — its band half in `vatBand` (src/webgl.ts) and `resolveBand`
 * (src/tsl.ts), one function of a clip and playback texel pair, *called twice*
 * where an instance is transitioning; its crossfade weight beside the call, in
 * `vatRows` and `vatDecode` — and neither invents it.
 *
 * It exists in TypeScript because the arithmetic is otherwise reachable only
 * inside a GLSL string and a TSL node graph, neither of which CI can evaluate
 * without a GPU — and because a caller scheduling what happens after a one-shot
 * needs to ask the same question the shader answers.
 *
 * There is no accumulated state anywhere in here: an instance is written once,
 * at the moment its animation changes, and every frame after that is this
 * function of the shared clock.
 */
export function resolveVATFrame(instance: VATInstance, time: number): VATFrame {
  const { clip } = instance
  const frames = clip.frames
  const last = frames - 1
  const duration = frames / clip.fps

  const { loopMode, repetitions, endMode, speed } = resolvedPlaybackOf(instance)
  const local = (time - instance.startTime) * speed
  const loops = local / duration
  const started = local >= 0
  const finished = started && repetitions !== INFINITE_REPETITIONS && loops >= repetitions

  // One cascade, and the decode paths transcribe its branches in this order —
  // falling out of it into the shared phase-to-row arithmetic below rather than
  // returning early, so that all three land on the same two rows in every case.
  let phase: number
  let wraps: boolean
  if (!started) {
    // Scheduled for a moment still to come: sitting on its first row, which is
    // not the same thing as having finished on it.
    phase = 0
    wraps = false
  } else if (finished) {
    // Held at an end pose, and in neither case sampling past it.
    phase = endMode === EndMode.Clamp ? 1 : 0
    wraps = false
  } else if (loopMode === LoopMode.PingPong) {
    // Two units of loop, with no division by anything but two: halving is
    // exact, where a shader's `mod( loops, 2.0 )` divides and can land a hair
    // below zero, one row before the band.
    const m = loops - 2 * Math.floor(loops * 0.5)
    phase = m < 1 ? m : 2 - m
    wraps = false // a ping-pong bounces; it does not wrap
  } else {
    phase = loops % 1
    wraps = true // and here the interpolation crossing back is correct
  }

  // Phase to frame row. A wrapping clip spreads its phase over `frames`,
  // because its last row owns the interval that crosses back into the first; a
  // clip that does not wrap spreads it over `frames - 1`, so that phase 1 lands
  // exactly on the last row rather than one past it.
  const f = phase * (wraps ? frames : last)
  const f0 = Math.min(Math.floor(f), last)
  // The wrap is a compare, not a `mod`: shader division is not correctly
  // rounded, and `mod( frames, frames )` can come out a hair under a whole
  // quotient and leave `f1` at `frames` — one row past the band, into the next
  // clip (#79). A select rather than an `if`, because a branch costs what it
  // skips.
  const next = f0 + 1
  const f1 = wraps ? (next >= frames ? 0 : next) : Math.min(next, last)
  const row = clip.startFrame + f0

  // The crossfade: the same function, applied to the band this instance is
  // blending out of, at the same moment — so the outgoing clip keeps playing,
  // keeps its own speed, and obeys its own end policy. The weight is wall clock
  // rather than clip time: an instance switching to a half-speed clip does not
  // get a transition twice as long.
  const crossfade = crossfadeOf(instance)
  const elapsed = crossfade ? (time - instance.startTime) / crossfade.duration : 0

  return {
    row,
    rowNext: clip.startFrame + f1,
    mix: f - f0,
    wraps,
    finished,
    phase,
    outgoing: crossfade
      ? { ...resolveVATFrame(crossfade.from, time), weight: 1 - Math.min(Math.max(elapsed, 0), 1) }
      : null,
  }
}

/**
 * What carries the pack to the shader: one `DataTexture`, five texels wide,
 * one row per instance, read by the instance's *logical* index (ADR-0016).
 *
 * Held by the caller rather than hidden behind the geometry, because a
 * `BufferGeometry` has nowhere to put a texture and a side channel — a
 * `WeakMap`, or a `userData` the first `clone()` loses — would not say what
 * {@link setVATInstance} writes into. `createVATMesh` hands one back on either
 * decode path; build your own with {@link createVATPlaybackTexture} when you
 * are assembling a crowd by hand.
 */
export interface VATPlaybackTexture {
  /**
   * The texture both decode paths bind: `x = field`, `y = instance`, RGBA
   * float, {@link PACK_WIDTH} texels wide.
   */
  texture: DataTexture
  /**
   * Rows of {@link texture} — the crowd's **capacity**, which is what the
   * decode indexes and what {@link setVATInstance} bounds-checks against.
   *
   * Not a live population: for a crowd that spawns and dies, most of these
   * rows may be reserved and empty at any moment, and the library has no
   * notion of which (ADR-0022). The caller owns the indices, because the
   * carrier already hands that numbering out.
   */
  count: number
}

/**
 * How a playback texture is sized when the instances it is handed are not the
 * whole story.
 */
export interface VATPlaybackTextureOptions {
  /**
   * Rows to reserve — the crowd's ceiling, rather than its current population.
   * Defaults to the number of instances given, which is a crowd placed once.
   *
   * At least that many, and at most {@link maxTextureSize}; both are refused
   * by name. Fixed once the texture is made (ADR-0022): a texture does not grow
   * in place, and growing one means rebuilding it and rebinding it on every
   * patched material — `docs/usage.md` carries that recipe.
   */
  capacity?: number
  /**
   * The GPU's real texture ceiling, and so the crowd's: the playback texture
   * is one row per instance. Pass `getMaxTextureSize(renderer)` from
   * `three-vat/webgl` or `three-vat/tsl`. Defaults to `MAX_TEXTURE_SIZE`, a
   * desktop figure: a phone reporting 4096 refuses a crowd of 5000 at upload,
   * with nothing naming the cause, unless the limit is given here (ADR-0022).
   */
  maxTextureSize?: number
}

/**
 * What a reserved row holds: one frame of nothing, held.
 *
 * Deliberately not zeroes. In practice such a row is never sampled — three
 * skips inactive instances of a `BatchedMesh` entirely, and nothing past
 * `InstancedMesh.count` is drawn — but "never" is a property of the carrier's
 * behaviour rather than of this data, and a band of no frames divides by zero
 * the day a caller raises their count past their live instances.
 */
const RESERVED_ROW: VATInstance = {
  clip: { startFrame: 0, frames: 1, fps: 1 },
  startTime: 0,
  speed: 0,
}

/**
 * Write a crowd's instance playback into a new playback texture. Call once,
 * before rendering, and bind the result into the decode — `createVATMesh` does
 * both for you.
 *
 * The layout below is the shared contract, spelled once in {@link PACK_TEXELS}.
 * Both decode paths read exactly these texels of row `instanceIndex` —
 * `ROW_PRELUDE` in `src/webgl.ts` with `texelFetch`, `texturePlayback` in
 * `src/tsl.ts` with `textureLoad` — the first three always, the last two only
 * while a transition is running.
 *
 * | Texel                     | r              | g           | b           | a        |
 * | ------------------------- | -------------- | ----------- | ----------- | -------- |
 * | `x = 0` clip              | clip start row | clip frames | clip fps    | speed    |
 * | `x = 1` playback          | start time     | loop mode   | repetitions | end mode |
 * | `x = 2` crossfade         | fade duration  | 0           | 0           | 0        |
 * | `x = 3` outgoing clip     | clip start row | clip frames | clip fps    | speed    |
 * | `x = 4` outgoing playback | start time     | loop mode   | repetitions | end mode |
 *
 * The outgoing pair is a full playback state — the same two texels, in the same
 * order, with the same meaning — because that is the whole difference between a
 * freeze and a crossfade (ADR-0025). The crossfade texel's three spare
 * components are written as zero and read by nothing.
 *
 * **A texture, not three instanced attributes.** An attribute with divisor 1 is
 * indexed by the *drawn slot*, and the drawn slot stops being the instance the
 * moment a renderer culls or sorts per instance — on a `BatchedMesh` every
 * vertex would read element 0 and the whole crowd would play instance 0's clip
 * (ADR-0016). A row keyed by the logical index is what three itself does for
 * the same problem, in `_matricesTexture`.
 *
 * **RGBA-shaped texels, not loose floats.** The move to a texture touched no
 * decode arithmetic, because the layout did not change with it: the pack was
 * already RGBA-shaped `vec4`s (ADR-0009). Published 1.x is the other story —
 * five one-float attributes there, so a 1.x caller meets both changes at once.
 *
 * **`FloatType`, and it stays that way.** A `startTime` in seconds does not
 * survive half precision — one second of resolution at 2 048 s — and there are
 * now two of them per row, so a narrower encoding for the VAT textures does not
 * reach this one.
 *
 * The policy fields, and the clip texel's speed, come from the instance where
 * it names them and from the clip's baked defaults where it does not — resolved
 * in the one place those tiers are spelled — and both decode paths read them as
 * {@link resolveVATFrame} defines them. The crossfade texel and the outgoing
 * pair are written as zeroes, which is what "not transitioning" is: a crowd
 * being created has no animation to blend away from. Transitions belong to
 * {@link setVATInstance}, where an instance's animation changes and there is
 * something to blend out of.
 *
 * **A crowd that spawns and dies gives a capacity** instead of a census
 * ({@link VATPlaybackTextureOptions}, ADR-0022): the rows are reserved once,
 * from the ceiling, and filled with {@link setVATInstance} as instances appear.
 * The list may then be empty — a level that starts with nothing alive in it —
 * and the reserved rows hold a first frame, held. The library allocates no
 * indices and follows no `setInstanceCount`: the carrier already numbers the
 * instances, and a texture does not grow in place. `docs/usage.md` carries both,
 * with **row recycling** — the hazard of reusing a row an instance has died on.
 */
export function createVATPlaybackTexture(
  instances: VATInstance[],
  options: VATPlaybackTextureOptions = {},
): VATPlaybackTexture {
  const live = instances.length
  const count = options.capacity ?? live
  if (count < live) {
    throw new Error(
      `three-vat: a capacity of ${count} cannot hold the ${live} instances it was given — capacity is the ` +
        'crowd ceiling, so it is at least the crowd you start with.',
    )
  }
  if (count < 1) {
    throw new Error(
      'three-vat: a crowd needs at least one instance — a playback texture is one row per instance, ' +
        'and there is no zero-row texture to carry none. Pass a capacity to reserve rows for a crowd ' +
        'that has not spawned yet',
    )
  }
  // One row per instance, so the crowd ceiling is the texture ceiling. Said
  // rather than worked around: square packing would buy two more orders of
  // magnitude and a second way to index a pack, and nothing is asking for it.
  // The error names the number and where it came from, because the fallback
  // is a desktop figure and the fix for a phone is to pass the real one.
  const ceiling = options.maxTextureSize ?? MAX_TEXTURE_SIZE
  if (count > ceiling) {
    const [source, hint] =
      options.maxTextureSize === undefined
        ? [
            'MAX_TEXTURE_SIZE, the default when no maxTextureSize option is given',
            " Pass getMaxTextureSize(renderer) as maxTextureSize to check against this GPU's own limit.",
          ]
        : ['the maxTextureSize option', '']
    throw new Error(
      `three-vat: ${count} rows of playback texture is past the ${ceiling}-row ceiling of ${source} — the ` +
        'playback texture holds one row per instance, so the texture ceiling is the instance ceiling.' +
        hint,
    )
  }

  // Packed before the texture exists: `writePack` refuses an instance a VAT
  // cannot play, and a crowd refused at index 700 must leave nothing behind.
  //
  // The given instances take the first rows and the rest are reserved, which
  // is the whole of what a capacity does: rows past `live` are inert until
  // `setVATInstance` fills them, and the library never learns which ones are.
  const data = new Float32Array(count * PACK_STRIDE)
  for (let i = 0; i < count; i++) writePack(data, i, instances[i] ?? RESERVED_ROW)

  return { texture: makeVATTexture(data, PACK_WIDTH, count), count }
}

/**
 * Why a negative playback rate is refused, spelled once for the two boundaries
 * it can enter through — {@link writePack} here, and `resolveAnimation`'s
 * `timeScale` check in the baker, which imports this tail.
 */
export const FORWARD_ONLY_REASON =
  'a baked band plays forward from its own first row, so a negative speed would freeze it on that row ' +
  'rather than run it backwards — bake a reversed clip instead. A speed of 0 is a held first row, and is fine'

/** The first float of one instance's row — the pack's five texels, flat. */
const rowStart = (index: number) => index * PACK_STRIDE

/** The first float of one texel of one instance's row. */
const texelStart = (index: number, field: number) => rowStart(index) + field * 4

/**
 * One playback state's policy, resolved and refused — for the band an instance
 * is playing and for the band it is leaving alike, since a pack carries two and
 * a check on one of them is a check on half the crowd.
 *
 * The resolved speed, not the declared one: a negative inherited from the clip's
 * baked default plays exactly as wrong as one written by hand. The write is the
 * boundary on purpose — {@link resolveVATFrame} and {@link endsAt} are pure
 * readers of a pack that got past here, and stay free of a check nothing can
 * reach them without.
 */
function checkedPolicyOf(state: VATPlaybackState, index: number, what: string): ResolvedPlayback {
  const policy = resolvedPlaybackOf(state)
  if (policy.speed < 0) {
    throw new Error(`three-vat: ${what} ${index} has speed ${policy.speed}; ${FORWARD_ONLY_REASON}.`)
  }
  return policy
}

/**
 * One playback state into its (clip texel, playback texel) pair — the unit the
 * pack carries twice, written by one function so the outgoing half cannot drift
 * from the incoming one. Every refusal is already made by here, so the row is
 * written whole or not at all.
 *
 * Both texels are named by the caller out of {@link PACK_TEXELS} rather than
 * one being derived from the other: the layout has one definition, and a pair
 * that found its second texel by adjacency would be a second, silent one.
 */
function putBand(
  data: Float32Array,
  index: number,
  at: { clip: number; playback: number },
  state: VATPlaybackState,
  policy: ResolvedPlayback,
): void {
  const clip = texelStart(index, at.clip)
  const playback = texelStart(index, at.playback)
  data[clip] = state.clip.startFrame
  data[clip + 1] = state.clip.frames
  data[clip + 2] = state.clip.fps
  data[clip + 3] = policy.speed
  data[playback] = state.startTime
  data[playback + 1] = policy.loopMode
  data[playback + 2] = policy.repetitions
  data[playback + 3] = policy.endMode
}

/** Where each of the pack's two (clip, playback) pairs sits, from the one layout. */
const LIVE_PAIR = { clip: PACK_TEXELS.clip, playback: PACK_TEXELS.playback } as const
const OUTGOING_PAIR = { clip: PACK_TEXELS.outgoingClip, playback: PACK_TEXELS.outgoingPlayback } as const

/**
 * The transition an instance asks for, or `null` — refusing a duration no
 * transition can be made of, by name, at the boundary the resolver trusts.
 *
 * Zero and absent are a cut and are not errors: spawning into a recycled row
 * writes one deliberately. A negative or non-finite duration is a mistake in
 * the caller's code, and left to the GPU it is a crowd that quietly never
 * finishes transitioning.
 */
function checkedCrossfadeOf(instance: VATInstance, index: number): { from: VATPlaybackState; duration: number } | null {
  const duration = instance.fadeDuration
  if (duration !== undefined && !(Number.isFinite(duration) && duration >= 0)) {
    throw new Error(
      `three-vat: instance ${index} has fadeDuration ${duration}; a transition lasts a finite number of ` +
        'seconds, and 0 (or no fadeDuration at all) is the cut.',
    )
  }
  return crossfadeOf(instance)
}

/** One instance's five texels, laid out as the table on {@link createVATPlaybackTexture}. */
function writePack(data: Float32Array, index: number, instance: VATInstance): void {
  // Both bands resolved and every refusal made *before* a float is written, so
  // a refused write leaves the row exactly as it was rather than half replaced.
  const crossfade = checkedCrossfadeOf(instance, index)
  const live = checkedPolicyOf(instance, index, 'instance')
  const outgoing = crossfade
    ? { state: crossfade.from, policy: checkedPolicyOf(crossfade.from, index, 'the outgoing band of instance') }
    : null
  const crossfadeTexel = texelStart(index, PACK_TEXELS.crossfade)

  putBand(data, index, LIVE_PAIR, instance, live)
  if (outgoing) putBand(data, index, OUTGOING_PAIR, outgoing.state, outgoing.policy)
  else clearTexels(data, index, OUTGOING_PAIR)

  // A duration of zero, and an outgoing pair of zeroes, is the whole of "not
  // transitioning" — written as a set or not at all, so a decode only ever has
  // to test the duration. The GLSL decode never reads the pair it wrote zeroes
  // into; the TSL decode has no branch to skip it behind, so it resolves a band
  // from those zeroes and clamps their frames and fps to one first — the
  // reserved row's rule (see {@link RESERVED_ROW}), applied to a texel pair.
  data[crossfadeTexel] = crossfade ? crossfade.duration : 0
  data[crossfadeTexel + 1] = 0
  data[crossfadeTexel + 2] = 0
  data[crossfadeTexel + 3] = 0
}

/** One pair of texels, zeroed — which is what an instance with no transition carries. */
function clearTexels(data: Float32Array, index: number, at: { clip: number; playback: number }): void {
  data.fill(0, texelStart(index, at.clip), texelStart(index, at.clip) + 4)
  data.fill(0, texelStart(index, at.playback), texelStart(index, at.playback) + 4)
}

/**
 * One instance's live band, read back out — the animation it is playing right
 * now, in the shape a crossfade blends away from. Its own outgoing band is not
 * read: the pack holds two, and the one being replaced is dropped.
 */
function readPack(data: Float32Array, index: number): VATPlaybackState {
  const clip = texelStart(index, PACK_TEXELS.clip)
  const playback = texelStart(index, PACK_TEXELS.playback)
  return {
    clip: { startFrame: data[clip]!, frames: data[clip + 1]!, fps: data[clip + 2]! },
    startTime: data[playback]!,
    speed: data[clip + 3]!,
    loopMode: data[playback + 1]! as LoopMode,
    repetitions: data[playback + 2]!,
    endMode: data[playback + 3]! as EndMode,
  }
}

/**
 * The one way of getting an instance write wrong, named rather than left to
 * read as a crowd that quietly stops animating: a row past the end writes
 * nothing anyone is drawing.
 */
function assertInstance(playback: VATPlaybackTexture, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= playback.count) {
    throw new Error(`three-vat: instance ${index} is outside this crowd's ${playback.count} rows`)
  }
}

/**
 * Change one instance's animation, after the crowd is built. The single write
 * the whole event-driven half of this library is made of: an enemy hit at
 * `t = 12.3s` becomes a dying enemy here, and the CPU does not touch it again.
 *
 * ```ts
 * // the moment it is hit — and nothing per frame afterwards
 * setVATInstance(playback, enemyId, {
 *   clip: vat.clips[2],      // "once, clamped" came with the bake
 *   startTime: time.value,
 *   fadeDuration: 0.1,       // blend out of whatever it was doing
 * })
 * ```
 *
 * `playback` is the crowd's playback texture — `createVATMesh` hands it back
 * beside the mesh and the clock — and `index` the instance's index in the array
 * the crowd was built from, the same one `setMatrixAt` takes.
 *
 * Only that instance's row is marked for upload, so a crowd of a thousand costs
 * one small write rather than a full re-upload. Everything else about the
 * instance — its matrix, its clip's defaults — is untouched. On the TSL path
 * the range is recorded and ignored: three's WebGPU backend re-uploads the
 * whole image on `needsUpdate`, which is 80 bytes per instance once per frame
 * in which anything changed (docs/usage.md says what that costs).
 *
 * Ask for a `fadeDuration` and the animation the instance was playing **keeps
 * playing**, blended away over that many wall-clock seconds from `startTime`,
 * so the change is a transition rather than a pop (ADR-0025). Uncapped: a tenth
 * of a second for a death, half a second for a walk into a run, and both clips
 * move throughout. Zero, or none at all, is a cut.
 *
 * Two bands, and no more. Writing an instance that is *already* mid-transition
 * replaces the outgoing band with the one it was switching to and drops the
 * older band at whatever weight it still had — a pop proportional to how early
 * the interruption came, and the one visible discontinuity a caller can
 * produce. `startTime + fadeDuration` is when the transition ends, for a caller
 * who would rather wait it out.
 *
 * A written instance is a pure function of the clock from here on, so what
 * happens *after* it is a matter of scheduling one more of these writes —
 * {@link endsAt} says exactly when. Chaining stays yours: the GPU never learns
 * about a next clip.
 *
 * This is deliberately a function over a playback texture rather than an
 * `InstancedMesh` method. The primitives stay composable for a crowd rendered
 * onto something else, which is the escape hatch ADR-0009 and ADR-0014 commit
 * to — and the playback texture is the object such a caller holds (ADR-0016).
 */
export function setVATInstance(playback: VATPlaybackTexture, index: number, instance: VATInstance): void {
  assertInstance(playback, index)
  const data = playback.texture.image.data as Float32Array

  // The band to blend away from is the one this instance is already playing,
  // read back whole, so a caller asking for a transition never has to describe
  // the animation it is leaving — it is in the pack, and it keeps playing.
  const transitioning =
    instance.from === undefined && asksToBlend(instance)
      ? { ...instance, from: readPack(data, index) }
      : instance

  writePack(data, index, transitioning)

  // The minimal upload: this instance's row, and nothing else. Ranges
  // accumulate until the renderer consumes them, so several instances changing
  // between two frames stay several small uploads.
  playback.texture.addUpdateRange(rowStart(index), PACK_STRIDE)
  playback.texture.needsUpdate = true
}

/**
 * The exact clock time this instance stops animating — when
 * {@link resolveVATFrame} first reports `finished` — or `null` for an animation
 * that never gets there: an endless loop, or a speed of zero.
 *
 * This is what makes chaining one clip to the next a single scheduled write
 * rather than a per-frame poll:
 *
 * ```ts
 * const hit = { clip: vat.clips[1], startTime: now, loopMode: LoopMode.Once }
 * setVATInstance(playback, id, hit)
 *
 * const at = endsAt(hit)
 * if (at !== null) schedule(at, () => setVATInstance(playback, id, { clip: walk, startTime: at }))
 * ```
 *
 * Nothing about the chain reaches the GPU: it reads one pack, and the next clip
 * does not exist to it until that write happens.
 */
export function endsAt(instance: VATInstance): number | null {
  const { repetitions, speed } = resolvedPlaybackOf(instance)
  if (repetitions === INFINITE_REPETITIONS || speed <= 0) return null
  const duration = instance.clip.frames / instance.clip.fps
  return instance.startTime + (duration * repetitions) / speed
}
