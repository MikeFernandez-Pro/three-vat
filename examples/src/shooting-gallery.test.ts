// The shooting gallery's pure half: which robot a click hits, and which write
// a shot or the end of a clip makes on it. The writes are made here as the
// page makes them, on the library's own playback texture, so the states are
// asserted on what the shader would show rather than on what the page meant.
import { Box3, Matrix4, Quaternion, Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  createVATPlaybackTexture,
  endsAt,
  LoopMode,
  resolveVATFrame,
  setVATInstance,
  turnVATInstance,
  type VATInstance,
} from 'three-vat'
import { ended, endOf, LIE_FOR, pickInstance, shot, type Phase, type Step } from './shooting-gallery.js'

// ---------------------------------------------------------------- picking

/** A robot a metre wide and two tall, standing on its origin. */
const bounds = new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 2, 0.5))
const at = (x: number, z = 0, turn = 0, scale = 1) =>
  new Matrix4().compose(
    new Vector3(x, 0, z),
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), turn),
    new Vector3(scale, scale, scale),
  )
/** A ray from the camera's side of the line, level at `height`, aimed at `x`. */
const shotAt = (x: number, height = 1) => new Ray(new Vector3(x, height, 10), new Vector3(0, 0, -1))

describe('picking a robot', () => {
  const line = [at(-2), at(0), at(2)]

  it('hits the robot the ray passes through', () => {
    expect(pickInstance(shotAt(2), bounds, line)).toBe(2)
    expect(pickInstance(shotAt(-2.3), bounds, line)).toBe(0)
  })

  it('misses between robots, over their heads, and on the floor', () => {
    expect(pickInstance(shotAt(1), bounds, line)).toBeNull()
    expect(pickInstance(shotAt(0, 2.5), bounds, line)).toBeNull()
    const floor = new Ray(new Vector3(1, 5, 5), new Vector3(0, -1, -1).normalize())
    expect(pickInstance(floor, bounds, line)).toBeNull()
  })

  it('takes the nearest of two in line', () => {
    const file = [at(0, -3), at(0, 3), at(0, 0)]
    expect(pickInstance(shotAt(0), bounds, file)).toBe(1)
  })

  it("reads each robot's bounds through its own matrix", () => {
    // Twice the size, its box reaches 1 m out where the plain one stops at 0.5.
    expect(pickInstance(shotAt(0.8), bounds, [at(0)])).toBeNull()
    expect(pickInstance(shotAt(0.8), bounds, [at(0, 0, 0, 2)])).toBe(0)
    // Turned an eighth, its corner reaches out past the half metre.
    expect(pickInstance(shotAt(0.65), bounds, [at(0, 0, Math.PI / 4)])).toBe(0)
  })
})

// ---------------------------------------------------------------- states

const idle = { startFrame: 0, frames: 60, fps: 30 } // two seconds, looping
const death = { startFrame: 60, frames: 45, fps: 30, loopMode: LoopMode.Once } // a second and a half
const DEATH = 1.5

/** One robot in a texture of three, its neighbours idle, and the page's half of the loop, its death played at `deathSpeed`. */
function gallery(deathSpeed = 1) {
  const instances: VATInstance[] = [0, 1, 2].map(() => ({ clip: idle, startTime: -0.4 }))
  const playback = createVATPlaybackTexture(instances)
  let robot: { phase: Phase; next: number | null } = { phase: 'idle', next: null }
  let shown: VATInstance = instances[1]!
  const data = playback.texture.image.data as Float32Array
  const stride = data.length / playback.count

  /** Make the write a step asks for, as the page does, and schedule its end. */
  function apply({ phase, write }: Step, at: number) {
    if (write === 'turn') {
      shown = turnVATInstance(playback, 1, at)
    } else {
      shown = write === 'death' ? { clip: death, startTime: at, loopMode: LoopMode.Once, speed: deathSpeed } : { clip: idle, startTime: at }
      setVATInstance(playback, 1, shown)
    }
    robot = { phase, next: endOf(phase, endsAt(shown)) }
  }
  return {
    get robot() {
      return robot
    },
    pose: (time: number) => {
      const frame = resolveVATFrame(shown, time)
      return frame.row + frame.mix
    },
    shoot: (now: number) => {
      const step = shot(robot.phase)
      if (step) apply(step, now)
    },
    /** Everything due by `now`, each at the moment it was due. */
    run: (now: number) => {
      while (robot.phase !== 'idle' && robot.next !== null && robot.next <= now) apply(ended(robot.phase), robot.next)
    },
    texture: () => [...data],
    neighbours: () => [...data.subarray(0, stride), ...data.subarray(2 * stride)],
  }
}

describe("a robot's states", () => {
  it('idles until shot, and has nothing scheduled', () => {
    const g = gallery()
    g.run(100)
    expect(g.robot).toEqual({ phase: 'idle', next: null })
  })

  it('dies when shot idle, from the first frame of Death, until Death ends and it has lain a while', () => {
    const g = gallery()
    g.shoot(3)
    expect(g.robot).toEqual({ phase: 'dying', next: 3 + DEATH + LIE_FOR })
    expect(g.pose(3)).toBeCloseTo(death.startFrame)
  })

  it('touches no other robot', () => {
    const g = gallery()
    const before = g.neighbours()
    g.shoot(3)
    g.run(3 + DEATH + LIE_FOR + DEATH)
    g.shoot(20)
    g.shoot(20.5)
    expect(g.neighbours()).toEqual(before)
  })

  it('revives by playing Death backwards to its first frame, then idles', () => {
    const g = gallery()
    g.shoot(3)
    const falling = g.pose(3 + DEATH - 0.5)
    const lying = g.pose(3 + DEATH)
    const revive = 3 + DEATH + LIE_FOR
    g.run(revive)
    expect(g.robot).toEqual({ phase: 'reviving', next: revive + DEATH })
    // Lying where Death left it, then rising the way it fell.
    expect(g.pose(revive)).toBeCloseTo(lying)
    expect(g.pose(revive + 0.5)).toBeCloseTo(falling)

    g.run(revive + DEATH)
    expect(g.robot).toEqual({ phase: 'idle', next: null })
    expect(g.pose(revive + DEATH)).toBeCloseTo(idle.startFrame)
  })

  it.each([
    ['the moment it was shot', 3],
    ['just after it was shot', 3.05],
    ['dying', 3.6],
    ['lying dead', 3 + DEATH + LIE_FOR / 2],
    ['reviving', 3 + DEATH + LIE_FOR + 0.4],
    ['a moment from standing', 3 + DEATH + LIE_FOR + DEATH - 0.01],
  ] as const)('ignores a shot while %s: nothing written, and it comes back on time', (_, now) => {
    const g = gallery()
    g.shoot(3)
    g.run(now)
    const robot = g.robot
    const before = g.pose(now)
    const texture = g.texture()
    g.shoot(now)
    expect(shot(robot.phase)).toBeNull()
    expect(g.robot).toEqual(robot)
    expect(g.pose(now)).toBe(before)
    expect(g.texture()).toEqual(texture)
    g.run(3 + DEATH + LIE_FOR + DEATH)
    expect(g.robot).toEqual({ phase: 'idle', next: null })
  })

  it('takes a shot again once back on Idle', () => {
    const g = gallery()
    g.shoot(3)
    const up = 3 + DEATH + LIE_FOR + DEATH
    g.run(up)
    g.shoot(up)
    expect(g.robot).toEqual({ phase: 'dying', next: up + DEATH + LIE_FOR })
    expect(g.pose(up)).toBeCloseTo(death.startFrame)
  })

  it('falls and gets up faster under a faster death, and lies as long', () => {
    const g = gallery(2)
    g.shoot(3)
    expect(g.robot).toEqual({ phase: 'dying', next: 3 + DEATH / 2 + LIE_FOR })
    const revive = 3 + DEATH / 2 + LIE_FOR
    g.run(revive)
    expect(g.robot).toEqual({ phase: 'reviving', next: revive + DEATH / 2 })
    g.run(revive + DEATH / 2)
    expect(g.robot).toEqual({ phase: 'idle', next: null })
  })
})
