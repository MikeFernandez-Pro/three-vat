// Where an instance stands: a position and a heading about +y, as one matrix.
import { Matrix4, Quaternion, Vector3 } from 'three'

const UP = new Vector3(0, 1, 0)
const ONE = new Vector3(1, 1, 1)
const turn = new Quaternion()

/** `target`, set to stand at `position` facing `yaw` about +y, unscaled. */
export function placeAt(target: Matrix4, position: Vector3, yaw: number): Matrix4 {
  return target.compose(position, turn.setFromAxisAngle(UP, yaw), ONE)
}
