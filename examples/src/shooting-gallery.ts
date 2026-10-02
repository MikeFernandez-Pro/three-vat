// What the shooting gallery decides that is not rendering: which robot a click
// hits, and which write a shot, the pointer or the end of a clip makes on it.
//
// A robot is idle, saying no, dying, reviving or dancing. The pointer coming
// onto an idle robot plays No, once; a shot on an idle robot switches it to
// Death. A robot's Death ends, it lies a while, and it turns and plays its
// death back; its revive ends, and it dances, once. No and Dance end back on
// Idle. A shot cuts No or Dance short, into Death; a shot on a robot dying or
// reviving is ignored, so every death plays out in full. (Turning a robot round
// mid-fall is Reverse mid-stride's page, not this one's.)
//
// Every change in or out of No and Dance is a short crossfade, so a robot never
// snaps from one pose to another; into Death from Idle, and into the revive,
// are cuts, as they always were, because each starts from the pose it meets.
//
// The page makes the writes, and asks `endsAt` when each one ends, because
// those are the recipe. This module only says which write comes next, so
// shooting-gallery.test.ts can run every state through the library's own
// playback texture with no renderer.
import { Matrix4, Ray, Vector3, type Box3 } from "three";

// ---------------------------------------------------------------- picking

const local = new Ray();
const inverse = new Matrix4();
const hit = new Vector3();

/**
 * The instance the ray hits first, or `null` for a miss. Each instance is its
 * `bounds`, placed by its matrix: the ray is taken into the instance's own
 * space, so a turned or scaled instance is hit where it stands rather than
 * through the box round its box.
 */
export function pickInstance(ray: Ray, bounds: Box3, matrices: readonly Matrix4[]): number | null {
  let nearest: number | null = null;
  let distance = Infinity;
  for (const [i, matrix] of matrices.entries()) {
    local.copy(ray).applyMatrix4(inverse.copy(matrix).invert());
    if (!local.intersectBox(bounds, hit)) continue;
    const d = hit.applyMatrix4(matrix).distanceTo(ray.origin);
    if (d < distance) [nearest, distance] = [i, d];
  }
  return nearest;
}

// ---------------------------------------------------------------- states

/** Seconds a robot lies where Death left it before it gets back up. */
export const LIE_FOR = 0.8;

/** Seconds a robot crossfades over, into No or Dance, out of them, or shot out of them into Death. */
export const FADE = 0.2;

/**
 * What a robot is doing. Dying runs from the shot until the robot gets up, the
 * time it lies included; refusing is No, from the pointer coming onto it.
 */
export type Phase = "idle" | "refusing" | "dying" | "reviving" | "dancing";

/**
 * A change of phase and the one write it takes: a clip set from its start
 * with `setVATInstance`, crossfading over `fade` seconds out of whatever the
 * robot was showing (0 is a cut), or a turn with `turnVATInstance`.
 */
export interface Step {
  phase: Phase;
  write: "death" | "idle" | "no" | "dance" | "turn";
  fade: number;
}

/** A shot. Idle, the robot dies; saying no or dancing, it fades into Death; dying or reviving, it ignores the shot, and nothing is written. */
export function shot(phase: Phase): Step | null {
  if (phase === "idle") return { phase: "dying", write: "death", fade: 0 };
  if (phase === "refusing" || phase === "dancing") return { phase: "dying", write: "death", fade: FADE };
  return null;
}

/** The pointer coming onto a robot. Idle, it says no; doing anything else, it carries on, and nothing is written. */
export function entered(phase: Phase): Step | null {
  return phase === "idle" ? { phase: "refusing", write: "no", fade: FADE } : null;
}

/** The end of a phase. Dead, the robot turns and plays Death back; up again, it dances; No or Dance over, it idles. */
export function ended(phase: Exclude<Phase, "idle">): Step {
  if (phase === "dying") return { phase: "reviving", write: "turn", fade: 0 };
  if (phase === "reviving") return { phase: "dancing", write: "dance", fade: FADE };
  return { phase: "idle", write: "idle", fade: FADE };
}

/** When a phase entered at a write ends, given when that write's clip ends (`endsAt`). */
export function endOf(phase: Phase, clipEnd: number | null): number | null {
  if (phase === "idle" || clipEnd === null) return null;
  return phase === "dying" ? clipEnd + LIE_FOR : clipEnd;
}

/** Whether a robot counts as down: from the shot until it stands, never while it says no or dances. */
export function isDown(phase: Phase): boolean {
  return phase === "dying" || phase === "reviving";
}
