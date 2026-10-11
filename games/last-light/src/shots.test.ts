// The scripted camera shots (#185): the high, wide view while the child
// crosses the pine, and the view of the door at the end, each blended in over
// the orbit and handed back to it. What is checked is what the player sees:
// the child always in view, the ravine below at the start of the crossing, the
// manor at its end, and the orbit exactly as it was once a shot is over.
import { describe, expect, it } from 'vitest'
import { ShotBlend, blendPoses, endShot, pineShare, pineShot, type Pose, type Vec3 } from './shots'
import { standingAt } from './heights'
import { woods } from './woods'

const map = woods()
/** The camera's vertical field of view, degrees, as the page has it; the half of it a thing must sit inside to be seen, with a margin. */
const FOV = 42
const IN_VIEW = ((FOV / 2 - 2) * Math.PI) / 180

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z)
/** The angle between where `pose` looks and the way to `p`, radians. */
const off = (pose: Pose, p: Vec3) => {
  const look = sub(pose.target, pose.position)
  const to = sub(p, pose.position)
  return Math.acos((look.x * to.x + look.y * to.y + look.z * to.z) / (length(look) * length(to)))
}
/** How far down `pose` looks, radians: 0 level. */
const pitch = (pose: Pose) => {
  const look = sub(pose.target, pose.position)
  return Math.atan2(-look.y, Math.hypot(look.x, look.z))
}
/** The child at `share` of the way along the pine, as the page stands him on its trunk, near enough. */
const childAt = (share: number): Vec3 => {
  const { from, to } = map.pine
  const x = from.x + (to.x - from.x) * share
  const z = from.z + (to.z - from.z) * share
  return { x, y: standingAt(map, x, z) + 0.7, z }
}
const exit = map.level.exit!
const door: Vec3 = { x: exit.x, y: 1.5, z: map.front.maxZ }

describe('the pine shot', () => {
  it('measures the way along the pine, 0 at its roots and 1 at its crown', () => {
    expect(pineShare(map, map.pine.from)).toBeCloseTo(0, 9)
    expect(pineShare(map, map.pine.to)).toBeCloseTo(1, 9)
  })

  it('stands high over the ravine, on the side away from the manor, a few metres off the child', () => {
    for (const share of [0, 0.5, 1]) {
      const child = childAt(share)
      const shot = pineShot(map, share, child.y)
      expect(shot.position.y).toBeGreaterThan(child.y + 3.5)
      const across = Math.hypot(shot.position.x - child.x, shot.position.z - child.z)
      expect(across).toBeGreaterThan(4)
      expect(across).toBeLessThan(12)
      expect(Math.hypot(shot.position.x - door.x, shot.position.z - door.z)).toBeGreaterThan(Math.hypot(child.x - door.x, child.z - door.z))
    }
  })

  it('keeps the child in view all the way across', () => {
    for (let share = 0; share <= 1; share += 0.05) {
      const child = childAt(share)
      expect(off(pineShot(map, share, child.y), child)).toBeLessThan(IN_VIEW)
    }
  })

  it('starts looking down into the ravine and ends looking out to the manor, its door in view', () => {
    const start = pineShot(map, 0, childAt(0).y)
    const end = pineShot(map, 1, childAt(1).y)
    expect(pitch(start)).toBeGreaterThan(pitch(end) + 0.15)
    // The ravine's floor on the near side of the pine, where its rats wait, in view at the start.
    const near = map.waiting.filter((group) => group.beat === 4.5).sort((a, b) => b.spot.z - a.spot.z)[0]!.spot
    expect(off(start, { x: near.x, y: -map.ravineFloor, z: near.z })).toBeLessThan(IN_VIEW)
    expect(off(end, door)).toBeLessThan(IN_VIEW)
  })
})

describe('a shot blended over the orbit', () => {
  it('comes in while it is on, goes out once it is off, and comes in again the next time', () => {
    const shot = new ShotBlend(1.2)
    expect(shot.weight).toBe(0)
    for (let t = 0; t < 3; t += 1 / 60) shot.update(1 / 60, true)
    expect(shot.weight).toBe(1)
    for (let t = 0; t < 3; t += 1 / 60) shot.update(1 / 60, false)
    expect(shot.weight).toBe(0)
    for (let t = 0; t < 1; t += 1 / 60) shot.update(1 / 60, true)
    expect(shot.weight).toBeGreaterThan(0.5)
  })

  it('is the orbit itself with the shot out, and the shot itself with it in, gliding between', () => {
    const orbit: Pose = { position: { x: 0, y: 2, z: 5 }, target: { x: 0, y: 1, z: 0 } }
    const high: Pose = { position: { x: 4, y: 10, z: 8 }, target: { x: -2, y: 0, z: -3 } }
    const out: Pose = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } }
    expect(blendPoses(orbit, high, 0, out)).toEqual(orbit)
    expect(blendPoses(orbit, high, 1, out)).toEqual(high)
    const half = blendPoses(orbit, high, 0.5, out)
    expect(half.position.y).toBeGreaterThan(2)
    expect(half.position.y).toBeLessThan(10)
  })
})

describe('the end shot', () => {
  it('looks at the door from the lawn, over the steps, the door at the middle of the view', () => {
    const shot = endShot(map)
    expect(shot.position.z).toBeGreaterThan(map.steps.maxZ)
    expect(shot.position.y).toBeGreaterThan(1)
    expect(off(shot, door)).toBeLessThan(0.05)
  })
})
