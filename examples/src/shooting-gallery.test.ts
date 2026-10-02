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
import { ended, endOf, entered, FADE, isDown, LIE_FOR, pickInstance, shot, type Phase, type Step } from './shooting-gallery.js'

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
const no = { startFrame: 105, frames: 30, fps: 30 } // a second, looping as baked: the page plays it once
const NO = 1
const dance = { startFrame: 135, frames: 90, fps: 30 } // three seconds, likewise
const DANCE = 3

/** A state with no transition of its own: what a crossfade blends out of. */
const playing = ({ from: _from, fadeDuration: _duration, fadeStart: _start, ...state }: VATInstance) => state

/**
 * One robot in a texture of three, its neighbours idle, and the page's half of
 * the loop, its death played at `deathSpeed`. `shown` is what the page writes;
 * `blend` is that write with the band it fades out of spelled out, which is
 * what the row then carries, so a pose is the shader's, mid-fade included.
 */
function gallery(deathSpeed = 1) {
  const instances: VATInstance[] = [0, 1, 2].map(() => ({ clip: idle, startTime: -0.4 }))
  const playback = createVATPlaybackTexture(instances)
  let robot: { phase: Phase; next: number | null } = { phase: 'idle', next: null }
  let shown: VATInstance = instances[1]!
  let blend: VATInstance = shown
  const data = playback.texture.image.data as Float32Array
  const stride = data.length / playback.count

  /** Make the write a step asks for, as the page does, and schedule its end. */
  function apply({ phase, write, fade }: Step, at: number) {
    const leaving = blend
    if (write === 'turn') {
      shown = turnVATInstance(playback, 1, at)
    } else {
      const clip = { death, idle, no, dance }[write]
      shown =
        write === 'idle'
          ? { clip, startTime: at }
          : { clip, startTime: at, loopMode: LoopMode.Once, speed: write === 'death' ? deathSpeed : 1 }
      if (fade > 0) shown = { ...shown, fadeDuration: fade }
      setVATInstance(playback, 1, shown)
    }
    blend = write !== 'turn' && fade > 0 ? { ...shown, from: playing(leaving) } : shown
    robot = { phase, next: endOf(phase, endsAt(shown)) }
  }
  return {
    get robot() {
      return robot
    },
    get blend() {
      return blend
    },
    pose: (time: number) => {
      const frame = resolveVATFrame(blend, time)
      return frame.row + frame.mix
    },
    /** How much of the band it left still shows at `time`: 0 for a cut, and once a fade is over. */
    leaving: (time: number) => resolveVATFrame(blend, time).outgoing?.weight ?? 0,
    shoot: (now: number) => {
      const step = shot(robot.phase)
      if (step) apply(step, now)
    },
    enter: (now: number) => {
      const step = entered(robot.phase)
      if (step) apply(step, now)
    },
    /** Everything due by `now`, each at the moment it was due. */
    run: (now: number) => {
      while (robot.phase !== 'idle' && robot.next !== null && robot.next <= now) apply(ended(robot.phase), robot.next)
    },
    texture: () => [...data],
    /** Whether the row the page wrote is the one the blend, spelled out by hand, writes. */
    rowIsBlend: () => {
      const reference = createVATPlaybackTexture(instances)
      setVATInstance(reference, 1, blend)
      const theirs = reference.texture.image.data as Float32Array
      return data.subarray(stride, 2 * stride).every((v, i) => Object.is(v, theirs[stride + i]))
    },
    neighbours: () => [...data.subarray(0, stride), ...data.subarray(2 * stride)],
  }
}
type Gallery = ReturnType<typeof gallery>

/** When a robot shot at 3 stands again, and when the dance that follows ends. */
const UP = 3 + DEATH + LIE_FOR + DEATH
const DANCED = UP + DANCE

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

  it('revives by playing Death backwards to its first frame', () => {
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
    g.run(UP)
    expect(g.robot).toEqual({ phase: 'dancing', next: DANCED })
  })

  it('takes a shot again once back on Idle', () => {
    const g = gallery()
    g.shoot(3)
    g.run(DANCED)
    g.shoot(DANCED + 1)
    expect(g.robot).toEqual({ phase: 'dying', next: DANCED + 1 + DEATH + LIE_FOR })
    expect(g.pose(DANCED + 1)).toBeCloseTo(death.startFrame)
  })

  it('falls and gets up faster under a faster death, and lies as long', () => {
    const g = gallery(2)
    g.shoot(3)
    expect(g.robot).toEqual({ phase: 'dying', next: 3 + DEATH / 2 + LIE_FOR })
    const revive = 3 + DEATH / 2 + LIE_FOR
    g.run(revive)
    expect(g.robot).toEqual({ phase: 'reviving', next: revive + DEATH / 2 })
    g.run(revive + DEATH / 2)
    expect(g.robot).toEqual({ phase: 'dancing', next: revive + DEATH / 2 + DANCE })
  })
})

describe('saying no', () => {
  it('fades from Idle into No when the pointer enters it, and plays No once', () => {
    const g = gallery()
    g.enter(2)
    expect(g.robot).toEqual({ phase: 'refusing', next: 2 + NO })
    expect(g.pose(2)).toBeCloseTo(no.startFrame)
    expect(g.leaving(2)).toBe(1)
    expect(g.leaving(2 + FADE / 2)).toBeCloseTo(0.5)
    expect(g.leaving(2 + FADE)).toBeCloseTo(0)
    expect(g.rowIsBlend()).toBe(true)
  })

  it('fades back into Idle when No ends', () => {
    const g = gallery()
    g.enter(2)
    g.run(2 + NO)
    expect(g.robot).toEqual({ phase: 'idle', next: null })
    expect(g.pose(2 + NO)).toBeCloseTo(idle.startFrame)
    expect(g.leaving(2 + NO)).toBe(1)
    expect(g.leaving(2 + NO + FADE)).toBeCloseTo(0)
    expect(g.rowIsBlend()).toBe(true)
  })

  it('says no again the next time the pointer enters, once it is idle', () => {
    const g = gallery()
    g.enter(2)
    g.run(2 + NO)
    g.enter(4)
    expect(g.robot).toEqual({ phase: 'refusing', next: 4 + NO })
  })

  it.each([
    ['saying no', (g: Gallery) => g.enter(2), 2.5],
    ['dying', (g: Gallery) => g.shoot(2), 2.5],
    ['reviving', (g: Gallery) => g.shoot(2), 2 + DEATH + LIE_FOR + 0.5],
    ['dancing', (g: Gallery) => g.shoot(2), 2 + DEATH + LIE_FOR + DEATH + 1],
  ] as const)('ignores the pointer entering it while %s: nothing written', (_, start, now) => {
    const g = gallery()
    start(g)
    g.run(now)
    const robot = g.robot
    const texture = g.texture()
    g.enter(now)
    expect(entered(robot.phase)).toBeNull()
    expect(g.robot).toEqual(robot)
    expect(g.texture()).toEqual(texture)
  })
})

describe('dancing', () => {
  it('fades into Dance the moment it stands again, and dances once', () => {
    const g = gallery()
    g.shoot(3)
    g.run(UP)
    expect(g.robot).toEqual({ phase: 'dancing', next: DANCED })
    expect(g.pose(UP)).toBeCloseTo(dance.startFrame)
    expect(g.leaving(UP)).toBe(1)
    expect(g.leaving(UP + FADE)).toBeCloseTo(0)
    expect(g.rowIsBlend()).toBe(true)
  })

  it('fades back into Idle when Dance ends', () => {
    const g = gallery()
    g.shoot(3)
    g.run(DANCED)
    expect(g.robot).toEqual({ phase: 'idle', next: null })
    expect(g.pose(DANCED)).toBeCloseTo(idle.startFrame)
    expect(g.leaving(DANCED)).toBe(1)
    expect(g.leaving(DANCED + FADE)).toBeCloseTo(0)
    expect(g.rowIsBlend()).toBe(true)
  })
})

describe('a shot cutting No or Dance short', () => {
  it.each([
    ['saying no', (g: Gallery) => g.enter(2), 2.4],
    ['dancing', (g: Gallery) => g.shoot(2), 2 + DEATH + LIE_FOR + DEATH + 1.2],
  ] as const)('fades into Death from the pose it was %s in, and that end never comes', (_, start, now) => {
    const g = gallery()
    start(g)
    g.run(now)
    const before = g.pose(now)
    g.shoot(now)
    expect(g.robot).toEqual({ phase: 'dying', next: now + DEATH + LIE_FOR })
    expect(g.pose(now)).toBeCloseTo(death.startFrame)
    // What it left shows whole at the shot, from the pose it was in, and is gone a fade later.
    const outgoing = resolveVATFrame(g.blend, now).outgoing!
    expect(outgoing.weight).toBe(1)
    expect(outgoing.row + outgoing.mix).toBeCloseTo(before)
    expect(g.leaving(now + FADE)).toBeCloseTo(0)
    expect(g.rowIsBlend()).toBe(true)
    // No's end, or Dance's, would have fallen by now: the robot is still dying.
    g.run(now + DEATH)
    expect(g.robot.phase).toBe('dying')
  })

  it('cuts into Death when shot idle, with nothing to fade out of', () => {
    const g = gallery()
    g.shoot(3)
    expect(g.leaving(3)).toBe(0)
  })
})

describe('robots down', () => {
  it('counts a robot from the shot until it stands, and never while it says no or dances', () => {
    expect((['idle', 'refusing', 'dying', 'reviving', 'dancing'] as const).filter(isDown)).toEqual(['dying', 'reviving'])
  })
})
