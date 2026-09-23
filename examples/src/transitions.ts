// A crowd that switches clip on its own timers: where each instance stands,
// when it changes animation, what it changes to, and how many are blending
// between two clips at this moment.
//
// Kept free of three.js and the DOM, like `crowd.ts`, `spawning.ts` and
// `deforming.ts` beside it. The crossfade pages bring the wiring — the GLSL
// decode on one, the node graph on the other — and this file brings the
// schedule underneath both of them, so the two pages run one crowd rather than
// two similar ones.
//
// It does reach sideways once: {@link inFlight} counts the instances the
// texture panel is drawing two cursors for (`vat-facts.ts`), which underneath
// is the library's own resolver over the very pack the shader reads. So the
// HUD's number is measured off the crowd rather than predicted from the
// schedule that wrote it — which is what ADR-0020 asks of every figure a page
// shows — and it cannot disagree with the panel beside it.
import type { VATInstance } from "three-vat";
import { cursorsAt } from "./vat-facts.js";

/** The top of the count slider — the whole grid, filled. */
export const MAX_COUNT = 96;

/**
 * Instances across the grid. Wide enough that several transitions are visibly
 * running in different places at once, and no wider than the camera's opening
 * frame.
 */
export const COLUMNS = 12;

/**
 * Ranks into the grid. Not `DEPTH`: a **rank** is a line of a crowd, and depth
 * in this codebase is a depth material and a shadow pass (`FIELD_DEPTH` in
 * `spawning.ts` dodges the same collision with **row**).
 */
export const RANKS = MAX_COUNT / COLUMNS;

/**
 * Ground spacing as a multiple of an instance's real width, as `CLEARANCE` is
 * for the crowd pages. Roomier than shoulder to shoulder: a transition is a
 * change of gait, and a crowd packed tight hides one instance's legs in its
 * neighbour's.
 */
export const SPACING = 1.5;

/** The shortest an instance holds a clip before switching, in seconds. */
export const MIN_DWELL = 1.8;

/**
 * The longest. The band is what makes the field read as a crowd of individuals
 * rather than a metronome: at the top of the count roughly one instance in
 * three is inside a blend at any moment, which is what "several in flight at
 * once" has to mean to be watchable.
 */
export const MAX_DWELL = 5.4;

/**
 * How long the page runs before the first instance switches anything.
 *
 * Not zero, so the crowd is standing and desynced for a moment before it starts
 * changing its mind — a page whose first frame is already a transition has
 * shown the visitor the thing it is about before they have looked at it.
 */
export const OPENING = 0.6;

/**
 * Where instance `index` stands, centred on the origin.
 *
 * Row-major, so the count slider fills the grid a row at a time and the crowd a
 * visitor sees at any count is a block rather than a scatter — and from the
 * **front** row back, because the count draws a prefix of this layout and a
 * crowd that filled in from the horizon would put its first robots where they
 * are hardest to watch. Nothing here moves: what changes on this page is what
 * an instance is playing, never where it is.
 */
export function cellOf(index: number, pitch: number): { x: number; z: number } {
  const column = index % COLUMNS;
  const rank = Math.floor(index / COLUMNS);
  return {
    x: (column - (COLUMNS - 1) / 2) * pitch,
    z: ((RANKS - 1) / 2 - rank) * pitch,
  };
}

/**
 * How far into its clip instance `index` starts — a start time in the past,
 * which is the whole of what desyncs a crowd (CONTEXT.md, **Instance desync**).
 *
 * Here rather than on each page for the same reason the schedule is: the two
 * renderers have to desync *one* crowd the same way, or the pair stops being a
 * comparison of two decode paths and becomes a comparison of two crowds.
 */
export function desyncOf(index: number, duration: number): number {
  return -spread(index, STRIDE.desync) * duration;
}

/**
 * How long instance `index` holds a clip before switching — its own, and fixed.
 *
 * Keyed by the index rather than drawn at random, so the crowd a visitor
 * watches is the same crowd on a reload, and so the schedule can be asserted
 * rather than sampled.
 */
export function dwellOf(index: number): number {
  return MIN_DWELL + spread(index, STRIDE.dwell) * (MAX_DWELL - MIN_DWELL);
}

/**
 * The clock time of instance `index`'s `n`-th switch, counting from one.
 *
 * Its first lands a fraction of its own dwell after {@link OPENING} — a
 * different fraction per instance, on a stride of its own, so that two
 * instances with similar dwells do not switch together anyway. That spread is
 * the page's whole premise: every transition on screen began at its own moment,
 * and several are running at once inside one draw call.
 */
export function switchTimeOf(index: number, n: number): number {
  return OPENING + spread(index, STRIDE.phase) * dwellOf(index) + (n - 1) * dwellOf(index);
}

/**
 * How many switches instance `index` has made by `time` — what the page
 * compares against what it has already written, once a frame.
 *
 * A count rather than a "due now?" test on purpose: a frame that took longer
 * than a dwell, or a tab that was in the background, then costs one write and
 * lands on the schedule instead of drifting behind it by however long the page
 * was not being drawn.
 */
export function switchesBy(index: number, time: number): number {
  const first = switchTimeOf(index, 1);
  if (time < first) return 0;
  // Nudged before the floor, so that the moment {@link switchTimeOf} names is
  // the moment this counts — `first + n * dwell` and `first` plus `n` dwells
  // added one at a time are not the same float, and without the nudge a switch
  // would be owed a frame late every time the division landed a hair short.
  return Math.floor((time - first) / dwellOf(index) + 1e-9) + 1;
}

/**
 * The clip instance `index` is playing after its `n`-th switch, as an index
 * into the clip table. `n = 0` is what it opened on.
 *
 * Every switch steps to the next clip, so an instance never crossfades into the
 * clip it is already playing — a transition nobody can see is not evidence of
 * one. Keyed off the instance as well as the count, so the crowd opens on all
 * of the bake's clips rather than on one.
 */
export function clipOfSwitch(index: number, n: number, clipCount: number): number {
  return (((index + n) % clipCount) + clipCount) % clipCount;
}

/**
 * How many of the first `count` instances are blending between two clips at
 * `time`.
 *
 * An instance is mid-transition exactly when it is drawing **two cursors** —
 * so the HUD's number and the texture panel's evidence are one read rather than
 * two that could disagree, and {@link cursorsAt} is the single place the
 * question "is this band still showing?" is asked. That read is the library's
 * own answer underneath: `resolveVATFrame` over the very pack the shader is
 * reading, and its outgoing band's weight.
 */
export function inFlight(instances: readonly VATInstance[], count: number, time: number): number {
  let flying = 0;
  for (let index = 0; index < count; index++) {
    const instance = instances[index];
    if (instance && cursorsAt(instance, time).length > 1) flying++;
  }
  return flying;
}

/**
 * The three irrational strides this page's crowd is scattered on, and the one
 * offset each is taken from so that instance 0 is not handed a flat zero three
 * times.
 *
 * Three strides rather than one because the three answers have to be
 * independent: an instance whose phase was a function of its dwell would put
 * every long-dwelling instance at the same point of its cycle, and the crowd
 * would switch in waves. The first is the golden-ratio stride `crowd.ts`'s own
 * hash is built on, kept for the desync so this crowd desyncs like the others.
 */
const STRIDE = {
  desync: { step: 0.6180339887, from: 0 },
  dwell: { step: 0.7548776662, from: 1 },
  phase: { step: 0.3819660113, from: 0.5 },
} as const;

/**
 * A deterministic 0..1 spread, keyed by an instance's place in the grid: an
 * even scatter with no run a neighbouring pair could fall into, and the same
 * number every reload.
 */
function spread(index: number, { step, from }: { step: number; from: number }): number {
  return ((index + from) * step) % 1;
}

// ------------------------------------------------------------- the readouts
// The two HUD lines the crossfade pages carry. Here, and not written out on
// each page, for the reason `spawning.ts` keeps its two: the release suite
// holds the two pages of a pair to the same readouts (ADR-0011), and a sentence
// copied twice is a sentence that drifts on one page and not the other.

/** The seconds a blend lasts, as the HUD prints them. */
const formatSeconds = (seconds: number): string => `${seconds.toFixed(2)} s`;

/**
 * What the transition count is a count of, and how long a transition lasts
 * right now — the control's own value, read back as the crowd is using it.
 *
 * A duration of zero is named as the cut it is rather than printed as `0.00 s`:
 * that is the state the page opens in, and the sentence is the invitation to
 * drag the control up (ADR-0012 — the reader produces the evidence).
 */
export function transitionsLine(count: number, duration: number): string {
  const crowd = `of ${count} ${count === 1 ? "robot" : "robots"}, each switching clip on its own timer`;
  return duration > 0
    ? `${crowd} — a ${formatSeconds(duration)} blend, both clips still playing`
    : `${crowd} — a cut: drag the blend up and the pop becomes a transition`;
}

/**
 * The frame's draw calls, as the HUD says them — measured off the renderer, so
 * the claim that a transitioning crowd is still one draw call per material is
 * read rather than asserted.
 */
export function drawsLine(calls: number): string {
  return `${calls} draw calls this frame — one per material, however many of the crowd are mid-transition`;
}
