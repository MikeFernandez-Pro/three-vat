// What the shooting gallery decides that is not rendering: which robot a click
// hits, and which write a shot or the end of a clip makes on the robot.
//
// A robot is idle, dying or reviving. A shot on an idle robot switches it to
// Death; a shot on one dying or reviving is ignored, so every death plays out
// in full. A robot's Death ends, it lies a while, and it turns and plays its
// death back; its revive ends, and it idles, and takes a shot again. (Turning
// a robot round mid-fall is Reverse mid-stride's page, not this one's.)
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

/** Dying runs from the shot until the robot gets up, the time it lies included. */
export type Phase = "idle" | "dying" | "reviving";

/**
 * A change of phase and the one write it takes: Death or Idle set from its
 * start with `setVATInstance`, or a turn with `turnVATInstance`.
 */
export interface Step {
  phase: Phase;
  write: "death" | "idle" | "turn";
}

/** A shot. Idle, the robot dies; dying or reviving, it ignores the shot, and nothing is written. */
export function shot(phase: Phase): Step | null {
  return phase === "idle" ? { phase: "dying", write: "death" } : null;
}

/** The end of a phase. Dead, the robot turns and plays Death back; up again, it idles. */
export function ended(phase: Exclude<Phase, "idle">): Step {
  return phase === "dying" ? { phase: "reviving", write: "turn" } : { phase: "idle", write: "idle" };
}

/** When a phase entered at a write ends, given when that write's clip ends (`endsAt`). */
export function endOf(phase: Phase, clipEnd: number | null): number | null {
  if (phase === "idle" || clipEnd === null) return null;
  return phase === "dying" ? clipEnd + LIE_FOR : clipEnd;
}
