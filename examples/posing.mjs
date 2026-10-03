// Posing a rig by world directions, for the script that authors clips for the
// examples' characters (author-samba.mjs). An arm is aimed at a line, not set
// to a rotation, so nothing here depends on how each bone's local axes happen
// to lie.
//
// Every turn is made in the bone's parent space, through the parent's world
// matrix: the characters sit under armatures scaled a hundredfold, or down to
// a hundredth, and a turn worked out in the parent's own space is right
// whatever its scale.
import * as THREE from "three";

/** A world vector in `bone`'s parent space, by the parent's linear map alone. */
export function inParent(bone, vector) {
  return vector.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(bone.parent.matrixWorld).invert());
}

/** The world line from `a` to `b`. */
export const line = (a, b) => b.getWorldPosition(new THREE.Vector3()).sub(a.getWorldPosition(new THREE.Vector3()));

/** Turn `bone` in its parent space by `delta`, keeping everything below it attached. */
export function turn(bone, delta) {
  bone.quaternion.premultiply(delta);
  bone.updateMatrixWorld(true);
}

/** Aim `bone` so the line from it to `child` points along `direction`, a world direction. */
export function aim(bone, child, direction) {
  const from = inParent(bone, line(bone, child)).normalize();
  turn(bone, new THREE.Quaternion().setFromUnitVectors(from, inParent(bone, direction).normalize()));
}

/**
 * Twist `bone` about its own line to `child` until `turning`, a world line
 * that turns with it, seen across that axis, points along `toward`, a world
 * direction.
 */
export function twist(bone, child, turning, toward) {
  const axis = inParent(bone, line(bone, child)).normalize();
  const across = (vector) => inParent(bone, vector).projectOnPlane(axis).normalize();
  const now = across(turning);
  const want = across(toward);
  const angle = Math.atan2(new THREE.Vector3().crossVectors(now, want).dot(axis), now.dot(want));
  turn(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle));
}

/** Turn `bone` by `angle` about a world axis: tilt it, as seen from outside. */
export function tilt(bone, worldAxis, angle) {
  const mirrored = bone.parent.matrixWorld.determinant() < 0;
  turn(bone, new THREE.Quaternion().setFromAxisAngle(inParent(bone, worldAxis).normalize(), mirrored ? -angle : angle));
}

/** Give `bone` the world rotation `rotation`, under a parent scaled evenly. */
export function orient(bone, rotation) {
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parent.invert().multiply(rotation));
  bone.updateMatrixWorld(true);
}

/** Move `bone` to the world point `point`. */
export function moveTo(bone, point) {
  bone.position.copy(bone.parent.worldToLocal(point.clone()));
  bone.updateMatrixWorld(true);
}
