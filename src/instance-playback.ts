// The instance-playback contract: the per-instance playback pack, written once
// here for every decode path to read (ADR-0009). It lives in core — not in a
// renderer subpath — because it is the interface between the baker and the
// decoders, and a contract with two definitions drifts the first time a field
// is added. Nothing here is renderer-specific: it is `InstancedBufferAttribute`
// work on a `BufferGeometry`, so ADR-0005's bundle isolation is untouched.
import { InstancedBufferAttribute } from 'three'
import type { BufferAttribute, BufferGeometry } from 'three'
import type { VAT, VATClipDefaults } from './types.js'

/**
 * The attribute names of the contract — the one definition of them. Both decode
 * paths read this: `DECODE_PRELUDE` in `src/webgl.ts` declares them as GLSL
 * attributes, `vatNodes` in `src/tsl.ts` builds TSL attribute nodes from these
 * very strings. Not re-exported from the entry point: it is the contract's
 * spelling, not part of the public API.
 */
export const PLAYBACK_ATTRIBUTES = {
  clip: 'aVatClip',
  playback: 'aVatPlayback',
  fade: 'aVatFade',
} as const

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
 * The longest fade {@link setVATInstance} will honour, in seconds.
 *
 * The cap exists because of what this fade *is*: one frozen pose of the
 * outgoing clip, blended away — not a second playback running alongside the
 * first. Over a tenth of a second that is invisible; over half a second the
 * instance visibly skates, because whatever it was doing stopped dead the
 * moment the transition began. A longer fade would not be a better fade, it
 * would be a more visible bug, so the number is clamped rather than trusted.
 *
 * Provisional, like the fade itself: a real two-clip crossfade (#30) replaces
 * both, and nothing else should be built on top of them.
 */
export const MAX_FADE_DURATION = 0.25

/**
 * The frozen pose a fade blends away from: one phase of the clip an instance
 * was playing when its animation changed, and the band that phase indexes.
 *
 * Not a second playback state — there is no start time and no speed here,
 * because nothing about it moves. That is the whole of the freeze, and the
 * whole of its limit; see {@link MAX_FADE_DURATION}.
 */
export interface VATFadeFrom {
  /** First texture row of the outgoing clip's band. */
  startFrame: number
  /** Rows in that band. */
  frames: number
  /** The phase of that band the instance was at, in `[0, 1]`. */
  phase: number
}

/**
 * Per-instance playback state consumed by both decode paths.
 *
 * Every policy field is optional because the clip already answers it: a bake
 * handed a configured `AnimationAction` records the answer in the clip table
 * ({@link VATClipDefaults}), and an instance that says nothing inherits it. A
 * crowd of a thousand deaths says "once, clamped" once, at the bake.
 */
export interface VATInstance {
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
  /**
   * The frozen outgoing pose to fade away from. Normally you do not write this
   * yourself: {@link setVATInstance} freezes whatever the instance was playing
   * and fills it in when you ask for a {@link fadeDuration}.
   */
  from?: VATFadeFrom
  /**
   * Seconds to blend {@link from} away over, capped at {@link MAX_FADE_DURATION}.
   * Wall-clock seconds from {@link startTime}: the clip's `speed` does not
   * stretch a fade.
   *
   * Ignored without a `from` to fade away from — and at creation there is
   * nothing to fade away from, so this is `setVATInstance`'s field in practice.
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
 * {@link addVATInstanceAttributes} writes it into the pack and
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
function resolvedPlaybackOf(instance: VATInstance): ResolvedPlayback {
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
 * An instance's fade, resolved: the duration the cap allows, and the pose it
 * blends away from — or `null` for the overwhelmingly common case of an
 * instance that is not fading.
 *
 * Nothing is a fade without both halves. A duration with no frozen pose has
 * nothing to blend, which is what a crowd written by
 * {@link addVATInstanceAttributes} always is, and it reads here as not fading
 * rather than as a fade to an unwritten row.
 */
function fadeOf(instance: VATInstance): { from: VATFadeFrom; duration: number } | null {
  const duration = Math.min(instance.fadeDuration ?? 0, MAX_FADE_DURATION)
  const from = instance.from
  if (!from || duration <= 0 || from.frames <= 0) return null
  return { from, duration }
}

/**
 * The absolute texture row a frozen phase names — the one rule, transcribed
 * verbatim by `DECODE_PRELUDE` in src/webgl.ts and by `vatDecode` in
 * src/tsl.ts, clamp included. The lower clamp is not dead weight there: the TSL
 * path's zero-config fallback carries a fade band of no frames at all, and an
 * unclamped row would be `-1`.
 */
function fadeRowOf(from: VATFadeFrom): number {
  return from.startFrame + Math.max(Math.min(Math.floor(from.phase * from.frames), from.frames - 1), 0)
}

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
   * The frozen outgoing row a fade blends away from. Equal to {@link row} when
   * the instance is not fading, so a reader that ignores {@link fade} — the
   * demo's texture-panel cursors among them — never points at a row this
   * instance is not sampling.
   */
  fadeRow: number
  /**
   * How much of {@link fadeRow} is still showing: `1` at the moment of the
   * write, falling to `0` across `fadeDuration`, and `0` for an instance that
   * is not fading. The decode mixes the sampled clip toward the frozen pose by
   * exactly this weight — the weight of the fade, not the fade itself, which is
   * the pose-freeze fade `CONTEXT.md` names.
   */
  fadeWeight: number
}

/**
 * What the vertex shader computes, as a pure function of `(instance, time)` —
 * the **one definition** of the playback semantics. Both decode paths
 * transcribe it (`DECODE_PRELUDE` in src/webgl.ts, `vatDecode` in src/tsl.ts);
 * neither invents it.
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
    const m = loops % 2
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
  const f1 = wraps ? (f0 + 1) % frames : Math.min(f0 + 1, last)
  const row = clip.startFrame + f0

  // The pose-freeze fade, which is wall clock rather than clip time: an
  // instance switching to a half-speed clip does not get a fade twice as long.
  const fading = fadeOf(instance)
  const elapsed = fading ? (time - instance.startTime) / fading.duration : 0

  return {
    row,
    rowNext: clip.startFrame + f1,
    mix: f - f0,
    wraps,
    finished,
    phase,
    fadeRow: fading ? fadeRowOf(fading.from) : row,
    fadeWeight: fading ? 1 - Math.min(Math.max(elapsed, 0), 1) : 0,
  }
}

/**
 * Attach the instance-playback attributes to an instanced geometry. Call once
 * before rendering, on the geometry you hand to the `InstancedMesh`.
 *
 * The attribute names and layout below are the shared contract, spelled once in
 * {@link PLAYBACK_ATTRIBUTES}. Both decode paths read exactly these three —
 * `DECODE_PRELUDE` in `src/webgl.ts` as GLSL attributes, `vatNodes` in
 * `src/tsl.ts` as TSL attribute nodes, when it is handed this geometry.
 *
 * | Attribute      | x                   | y            | z             | w             |
 * | -------------- | ------------------- | ------------ | ------------- | ------------- |
 * | `aVatClip`     | clip start row      | clip frames  | clip fps      | speed         |
 * | `aVatPlayback` | start time          | loop mode    | repetitions   | end mode      |
 * | `aVatFade`     | from clip start row | from frames  | from phase    | fade duration |
 *
 * Every entry is a four-component `InstancedBufferAttribute` of `Float32Array`,
 * one `vec4` per instance, in instance order.
 *
 * **Three slots, not thirteen.** Written out one float per field the pack needs
 * thirteen attributes, and `position`, `normal`, `uv` and the four rows of
 * `instanceMatrix` have already taken seven of the sixteen WebGL2 guarantees —
 * a crowd past that budget does not render wrong, it fails to link. Packed this
 * way it is also exactly three RGBA texels, so carrying it in a `DataTexture`
 * for a future `BatchedMesh` is a change of carrier rather than of contract.
 *
 * `aVatPlayback`'s policy fields, and `aVatClip`'s speed, come from the
 * instance where it names them and from the clip's baked defaults where it does
 * not — resolved in the one place those tiers are spelled — and both decode
 * paths read them as {@link resolveVATFrame} defines them. `aVatFade` is
 * written as zeroes, which is what "not fading" is: a crowd being created has
 * no pose to fade away from. Fades belong to {@link setVATInstance}, where an
 * instance's animation changes and there is something to fade out of.
 */
export function addVATInstanceAttributes(geometry: BufferGeometry, instances: VATInstance[]): void {
  // Packed first, into arrays of its own: `writePack` refuses an instance a VAT
  // cannot play, and a crowd refused at index 700 must leave the caller's
  // geometry as it found it rather than stripped of its morph targets and
  // carrying no attributes.
  const n = instances.length
  const pack: Pack = {
    clip: new Float32Array(n * 4),
    playback: new Float32Array(n * 4),
    fade: new Float32Array(n * 4),
  }
  for (let i = 0; i < n; i++) writePack(pack, i, instances[i]!)

  // VAT supersedes native deformation. Drop any morph targets baked into the
  // VAT so three's renderer doesn't try to apply them — an InstancedMesh has no
  // morphTargetInfluences, so the morph path would crash — and doesn't upload
  // now-dead target buffers.
  geometry.morphAttributes = {}
  geometry.morphTargetsRelative = false

  geometry.setAttribute(PLAYBACK_ATTRIBUTES.clip, new InstancedBufferAttribute(pack.clip, 4))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.playback, new InstancedBufferAttribute(pack.playback, 4))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.fade, new InstancedBufferAttribute(pack.fade, 4))
}

/**
 * The pack's three buffers, whichever side of a geometry they are on — the
 * arrays being filled by {@link addVATInstanceAttributes} before any attribute
 * exists, or the ones already uploaded and being rewritten one instance at a
 * time by {@link setVATInstance}. One writer serves both, so a crowd cannot be
 * created with one layout and updated with another.
 */
interface Pack {
  clip: Float32Array
  playback: Float32Array
  fade: Float32Array
}

/**
 * Why a negative playback rate is refused, spelled once for the two boundaries
 * it can enter through — {@link writePack} here, and `resolveAnimation`'s
 * `timeScale` check in the baker, which imports this tail.
 */
export const FORWARD_ONLY_REASON =
  'a baked band plays forward from its own first row, so a negative speed would freeze it on that row ' +
  'rather than run it backwards — bake a reversed clip instead. A speed of 0 is a held first row, and is fine'

/** One instance's vec4s, laid out as the table on {@link addVATInstanceAttributes}. */
function writePack(pack: Pack, index: number, instance: VATInstance): void {
  const o = index * 4
  const policy = resolvedPlaybackOf(instance)
  // The resolved speed, not the declared one: a negative inherited from the
  // clip's baked default plays exactly as wrong as one written on the instance.
  // The write is the boundary on purpose — {@link resolveVATFrame} and
  // {@link endsAt} are pure readers of a pack that got past here, and stay
  // free of a check nothing can reach them without.
  if (policy.speed < 0) {
    throw new Error(`three-vat: instance ${index} has speed ${policy.speed}; ${FORWARD_ONLY_REASON}.`)
  }
  pack.clip[o] = instance.clip.startFrame
  pack.clip[o + 1] = instance.clip.frames
  pack.clip[o + 2] = instance.clip.fps
  pack.clip[o + 3] = policy.speed
  pack.playback[o] = instance.startTime
  pack.playback[o + 1] = policy.loopMode
  pack.playback[o + 2] = policy.repetitions
  pack.playback[o + 3] = policy.endMode

  // Zeroes throughout when nothing is fading, and that is the whole of "not
  // fading": no outgoing band, no phase, and a fade duration of zero. Written
  // as a pair or not at all, so a decode only ever has to test the duration.
  const fading = fadeOf(instance)
  pack.fade[o] = fading ? fading.from.startFrame : 0
  pack.fade[o + 1] = fading ? fading.from.frames : 0
  pack.fade[o + 2] = fading ? fading.from.phase : 0
  pack.fade[o + 3] = fading ? fading.duration : 0
}

/** One instance's pack, read back out — the animation it is playing right now. */
function readPack(pack: Pack, index: number): VATInstance {
  const o = index * 4
  return {
    clip: { startFrame: pack.clip[o]!, frames: pack.clip[o + 1]!, fps: pack.clip[o + 2]! },
    startTime: pack.playback[o]!,
    speed: pack.clip[o + 3]!,
    loopMode: pack.playback[o + 1]! as LoopMode,
    repetitions: pack.playback[o + 2]!,
    endMode: pack.playback[o + 3]! as EndMode,
  }
}

/**
 * A geometry's instance-playback attributes, as the three arrays behind them —
 * with the two ways of getting it wrong named rather than left to read as a
 * crowd that quietly stops animating.
 */
function writablePackAt(geometry: BufferGeometry, index: number): { pack: Pack; attributes: BufferAttribute[] } {
  const attributes = Object.values(PLAYBACK_ATTRIBUTES).map((name) => geometry.getAttribute(name))
  if (attributes.some((attribute) => attribute === undefined)) {
    throw new Error(
      'three-vat: this geometry carries no instance playback — write it with `addVATInstanceAttributes` ' +
        'before changing an instance (and note that `createVATMesh` clones the bake\'s geometry, so the ' +
        'one to write to is `mesh.geometry`)',
    )
  }
  const [clip, playback, fade] = attributes as BufferAttribute[]
  if (!Number.isInteger(index) || index < 0 || index >= clip!.count) {
    throw new Error(`three-vat: instance ${index} is outside this crowd of ${clip!.count}`)
  }
  return {
    pack: {
      clip: clip!.array as Float32Array,
      playback: playback!.array as Float32Array,
      fade: fade!.array as Float32Array,
    },
    attributes: attributes as BufferAttribute[],
  }
}

/**
 * Change one instance's animation, after the crowd is built. The single write
 * the whole event-driven half of this library is made of: an enemy hit at
 * `t = 12.3s` becomes a dying enemy here, and the CPU does not touch it again.
 *
 * ```ts
 * // the moment it is hit — and nothing per frame afterwards
 * setVATInstance(mesh.geometry, enemyId, {
 *   clip: vat.clips[2],      // "once, clamped" came with the bake
 *   startTime: time.value,
 *   fadeDuration: 0.1,       // blend out of whatever it was doing
 * })
 * ```
 *
 * `geometry` is the one being rendered — `mesh.geometry`, which
 * `createVATMesh` cloned from the bake — and `index` the instance's index in
 * the array the crowd was built from, the same one `setMatrixAt` takes.
 *
 * Only that instance's four floats per attribute are marked for upload, so a
 * crowd of a thousand costs one small write rather than a full re-upload.
 * Everything else about the instance — its matrix, its clip's defaults —
 * is untouched.
 *
 * Ask for a `fadeDuration` and the pose the instance is in *at `startTime`* is
 * frozen and blended away over that many wall-clock seconds, so the change does
 * not pop. It is a frozen pose and not a second playback: see
 * {@link MAX_FADE_DURATION} for what that costs and how far it can be pushed.
 * One pose, too — writing an instance that is *already* fading freezes the clip
 * it had switched to and drops the older pose, because the pack holds one.
 *
 * A written instance is a pure function of the clock from here on, so what
 * happens *after* it is a matter of scheduling one more of these writes —
 * {@link endsAt} says exactly when. Chaining stays yours: the GPU never learns
 * about a next clip.
 *
 * This is deliberately a function over a geometry rather than an
 * `InstancedMesh` method. The primitives stay composable for a crowd rendered
 * onto something else — `@three.ez/instanced-mesh` being the motivating case —
 * which is the escape hatch ADR-0009 commits to.
 */
export function setVATInstance(geometry: BufferGeometry, index: number, instance: VATInstance): void {
  const { pack, attributes } = writablePackAt(geometry, index)

  // The pose to fade away from is the one this instance is already playing, so
  // a caller asking for a fade never has to describe the animation it is
  // leaving — it is in the pack, and `resolveVATFrame` is what reads it.
  const fading =
    instance.from === undefined && (instance.fadeDuration ?? 0) > 0
      ? { ...instance, from: freezeOf(pack, index, instance.startTime) }
      : instance

  writePack(pack, index, fading)

  // The minimal upload: this instance's vec4 in each attribute, and nothing
  // else. Ranges accumulate until the renderer consumes them, so several
  // instances changing between two frames stay several small uploads.
  for (const attribute of attributes) {
    attribute.addUpdateRange(index * 4, 4)
    attribute.needsUpdate = true
  }
}

/**
 * The frozen pose of whatever instance `index` is playing at `time` — one
 * phase of its current band, which is all a fade keeps of it.
 */
function freezeOf(pack: Pack, index: number, time: number): VATFadeFrom {
  const outgoing = readPack(pack, index)
  const { row } = resolveVATFrame(outgoing, time)
  return {
    startFrame: outgoing.clip.startFrame,
    frames: outgoing.clip.frames,
    // The row the instance is actually displaying at that moment — so a fade
    // out of a finished one-shot freezes the end pose it was holding, not the
    // first row of a clip it stopped playing seconds ago.
    //
    // Named as the phase at the *centre* of that row rather than the playback
    // phase itself, because {@link fadeRowOf} is what reads it back and the two
    // do not spread a phase the same way: a bouncing ping-pong is up to a row
    // apart between them, and rounding in a shader could cost another. Half a
    // row of slack costs nothing and lands all three decodes on this row.
    phase: (row - outgoing.clip.startFrame + 0.5) / outgoing.clip.frames,
  }
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
 * setVATInstance(mesh.geometry, id, hit)
 *
 * const at = endsAt(hit)
 * if (at !== null) schedule(at, () => setVATInstance(mesh.geometry, id, { clip: walk, startTime: at }))
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

/**
 * The geometry a crowd renders: the bake's own, cloned, carrying this crowd's
 * instance playback.
 *
 * Spelled once for both decode paths, because the reasoning is the same on
 * either renderer. The geometry comes from the VAT because the baker owns the
 * vertex ordering and the textures are indexed by it; it is cloned because the
 * playback attributes are per-crowd and two crowds may share one bake; and the
 * clone carries the all-frames bounding volume with it, which is what stops a
 * deformed crowd culling mid-animation.
 *
 * Like {@link PLAYBACK_ATTRIBUTES}, this is shared internals rather than public
 * API: it is not re-exported from the entry point. A caller assembling a crowd
 * by hand writes these two lines themselves.
 */
export function createCrowdGeometry(vat: VAT, instances: VATInstance[]): BufferGeometry {
  const geometry = vat.geometry.clone()
  addVATInstanceAttributes(geometry, instances)
  return geometry
}
