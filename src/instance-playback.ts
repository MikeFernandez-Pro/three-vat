// The instance-playback contract: the per-instance playback pack, written once
// here for every decode path to read (ADR-0009). It lives in core — not in a
// renderer subpath — because it is the interface between the baker and the
// decoders, and a contract with two definitions drifts the first time a field
// is added. Nothing here is renderer-specific: it is `InstancedBufferAttribute`
// work on a `BufferGeometry`, so ADR-0005's bundle isolation is untouched.
import { InstancedBufferAttribute } from 'three'
import type { BufferGeometry } from 'three'
import type { VAT } from './types.js'

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

/** Per-instance playback state consumed by both decode paths. */
export interface VATInstance {
  clip: Pick<VAT['clips'][number], 'startFrame' | 'frames' | 'fps'>
  /**
   * Absolute clock time, in seconds, at which this animation began. May be in
   * the past — and **desync is exactly that**: give each instance of a crowd its
   * own start time a little way back and they stop moving in lockstep.
   */
  startTime: number
  /** Playback rate multiplier. */
  speed: number
  /** How the clip repeats. Default {@link LoopMode.Repeat}. */
  loopMode?: LoopMode
  /**
   * How many times to play the clip, or {@link INFINITE_REPETITIONS}. Defaults
   * to endless for {@link LoopMode.Repeat} and to a single play for anything
   * else — the counts three's own `LoopRepeat` and `LoopOnce` imply.
   */
  repetitions?: number
  /**
   * What to do once the repetitions run out. Default {@link EndMode.Clamp},
   * where three's `clampWhenFinished` defaults to `false`; see {@link EndMode}.
   */
  endMode?: EndMode
}

/** The playback policy of an instance, with every default filled in. */
interface PlaybackPolicy {
  loopMode: LoopMode
  repetitions: number
  endMode: EndMode
}

/**
 * An instance's policy, defaults and all — spelled once, because
 * {@link addVATInstanceAttributes} writes it into the pack and
 * {@link resolveVATFrame} reads it, and a default with two definitions is a
 * crowd that resolves differently from the one it renders.
 */
function playbackPolicyOf(instance: VATInstance): PlaybackPolicy {
  const loopMode = instance.loopMode ?? LoopMode.Repeat
  return {
    loopMode,
    repetitions: instance.repetitions ?? (loopMode === LoopMode.Repeat ? INFINITE_REPETITIONS : 1),
    endMode: instance.endMode ?? EndMode.Clamp,
  }
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
  const local = (time - instance.startTime) * instance.speed

  const { loopMode, repetitions, endMode } = playbackPolicyOf(instance)
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

  return {
    row: clip.startFrame + f0,
    rowNext: clip.startFrame + f1,
    mix: f - f0,
    wraps,
    finished,
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
 * `aVatPlayback`'s policy fields come from the instance — its {@link
 * VATInstance.loop}, {@link VATInstance.repetitions} and {@link
 * VATInstance.endMode}, defaults filled in the one place they are spelled — and
 * both decode paths read them as {@link resolveVATFrame} defines them. The
 * whole of `aVatFade` is still written as zeroes: no instance fades yet, and
 * that is what "not fading" is.
 */
export function addVATInstanceAttributes(geometry: BufferGeometry, instances: VATInstance[]): void {
  // VAT supersedes native deformation. Drop any morph targets baked into the
  // VAT so three's renderer doesn't try to apply them — an InstancedMesh has no
  // morphTargetInfluences, so the morph path would crash — and doesn't upload
  // now-dead target buffers.
  geometry.morphAttributes = {}
  geometry.morphTargetsRelative = false

  const n = instances.length
  const clip = new Float32Array(n * 4)
  const playback = new Float32Array(n * 4)
  // Zeroes throughout, and that is the whole of "not fading": no outgoing clip,
  // no phase, and a fade duration of zero.
  const fade = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const inst = instances[i]!
    const o = i * 4
    clip[o] = inst.clip.startFrame
    clip[o + 1] = inst.clip.frames
    clip[o + 2] = inst.clip.fps
    clip[o + 3] = inst.speed
    const policy = playbackPolicyOf(inst)
    playback[o] = inst.startTime
    playback[o + 1] = policy.loopMode
    playback[o + 2] = policy.repetitions
    playback[o + 3] = policy.endMode
  }
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.clip, new InstancedBufferAttribute(clip, 4))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.playback, new InstancedBufferAttribute(playback, 4))
  geometry.setAttribute(PLAYBACK_ATTRIBUTES.fade, new InstancedBufferAttribute(fade, 4))
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
