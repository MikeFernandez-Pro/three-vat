// The page's end of the swarm, through its own calls only: hand it the states
// a worker would post, over a stand-in for the worker, and read where it
// stands the rats at a moment between them.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemoteSwarm, STEP, type Input, type State, type SwarmPort, type ToWorker } from './swarm-remote'
import { defaultTuning, type FixedLight, type Light } from './swarm'

/** A worker that never answers: the test posts the states itself. */
class FakePort implements SwarmPort {
  onmessage: ((event: MessageEvent<State>) => void) | null = null
  readonly sent: ToWorker[] = []
  postMessage(message: ToWorker): void {
    this.sent.push(message)
  }
  /** As the worker's post arrives on the page, at `at` by the page's clock. */
  deliver(state: State, at: number): void {
    vi.spyOn(performance, 'now').mockReturnValue(at)
    this.onmessage?.({ data: state } as MessageEvent<State>)
  }
}

/** A state of `count` rats at swarm time `time`, every rat at (0, 0), heading 0, still; set the rest by `edit`. */
function stateAt(time: number, count: number, edit: (state: State) => void): State {
  const floats = () => new Float32Array(count)
  const state: State = {
    type: 'state',
    time,
    count,
    arena: 10,
    x: floats(),
    z: floats(),
    y: floats(),
    pitch: floats(),
    heading: floats(),
    gait: new Uint8Array(count),
    place: floats(),
    moved: new Uint8Array(count),
    ms: 0,
    inside: 0,
    reached: 0,
  }
  edit(state)
  return state
}

/** When the latest state arrives, by the page's clock, ms. */
const ARRIVED = 1000

/**
 * A remote with two states a step apart: rat 0 runs from (0, 0) to `ran`
 * along x, faster than any rat does, turning from heading 0 to 1; rat 1 was
 * moved from (0, 0) to `movedTo` along x by the worker, heading 2, and the
 * state says so.
 */
function between(ran: number, movedTo: number) {
  const port = new FakePort()
  const swarm = new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
  port.deliver(stateAt(STEP, 2, () => {}), ARRIVED - STEP * 1000)
  port.deliver(
    stateAt(2 * STEP, 2, (state) => {
      state.x[0] = ran
      state.heading[0] = 1
      state.x[1] = movedTo
      state.heading[1] = 2
      state.moved[1] = 1
    }),
    ARRIVED,
  )
  return swarm
}

/** Partway between the two states, by the page's clock. */
const PARTWAY = ARRIVED + (STEP / 2) * 1000

/** Rat 0 stands strictly between its two states, and is turned as far between as it stands. */
function ranBetween(swarm: RemoteSwarm, ran: number): void {
  swarm.orient(0)
  const alpha = swarm.x[0]! / ran
  expect(alpha).toBeGreaterThan(0.05)
  expect(alpha).toBeLessThan(0.95)
  expect(swarm.heading[0]).toBeCloseTo(alpha, 4)
}

afterEach(() => vi.restoreAllMocks())

describe('the remote swarm, between two states', () => {
  it('places a rat the worker moved at its new place, with no frame between, and runs the rest', () => {
    // 30 m/s, faster than any rat runs and past the speed the page once took for a move; 10 m, right across the dark.
    const swarm = between(30 * STEP, 10)
    swarm.sample(PARTWAY)
    ranBetween(swarm, 30 * STEP)
    swarm.orient(1)
    expect(swarm.x[1]).toBe(10)
    expect(swarm.heading[1]).toBe(2)
  })

  it('places a rat brought round by less than a rat length, rather than sliding it', () => {
    const swarm = between(30 * STEP, 0.2)
    swarm.sample(PARTWAY)
    swarm.orient(1)
    expect(swarm.x[1]).toBe(Math.fround(0.2))
    expect(swarm.heading[1]).toBe(2)
  })

  it('places a moved rat and runs the rest under the staggered hold too', () => {
    const swarm = between(30 * STEP, 0.2)
    swarm.sampleStaggered(PARTWAY, 0, 12)
    ranBetween(swarm, 30 * STEP)
    swarm.orient(1)
    expect(swarm.x[1]).toBe(Math.fround(0.2))
    expect(swarm.heading[1]).toBe(2)
  })

  it('hands the GPU the pair it stood the rats between, the moves in the latest', () => {
    const swarm = between(30 * STEP, 0.2)
    swarm.sample(PARTWAY)
    const pair = swarm.pair()!
    expect(pair.prev?.time).toBe(STEP)
    expect(pair.cur.time).toBe(2 * STEP)
    expect(Array.from(pair.cur.moved)).toEqual([0, 1])
    expect(pair.both).toBe(2)
    expect(pair.alpha).toBeCloseTo(swarm.x[0]! / (30 * STEP), 4)
  })

  it('sends a state it is done with back to the worker, its moves too', () => {
    const port = new FakePort()
    new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
    for (let k = 1; k <= 3; k++) port.deliver(stateAt(k * STEP, 2, () => {}), k * 16)
    const recycled = port.sent.filter((m) => m.type === 'recycle')
    expect(recycled).toHaveLength(1)
    expect(recycled[0]).toHaveProperty('moved')
  })
})

describe('the remote swarm, told and telling', () => {
  it("sends the level's lights with the torch, copies the step reads and the page may change", () => {
    const port = new FakePort()
    const swarm = new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
    const light: Light = { x: 1, z: 2, strength: 0.5, on: true }
    const lights: FixedLight[] = [{ x: 3, z: 4, reach: 1.5, on: true }]
    swarm.send(2, light, defaultTuning(), false, undefined, lights)
    const input = port.sent.find((m): m is Input => m.type === 'input')!
    expect(input.lights).toEqual(lights)
    lights[0]!.on = false
    expect(input.lights[0]!.on).toBe(true)
  })

  it('reads the rats at the holder off the latest state', () => {
    const port = new FakePort()
    const swarm = new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
    expect(swarm.reached).toBe(0)
    port.deliver(stateAt(STEP, 2, (state) => (state.reached = 5)), 16)
    expect(swarm.reached).toBe(5)
  })

  it('counts no rats at the holder from the rats being placed again until the next state', () => {
    const port = new FakePort()
    const swarm = new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
    port.deliver(stateAt(STEP, 2, (state) => (state.reached = 5)), 16)
    swarm.restart([])
    expect(swarm.reached).toBe(0)
  })

  it('sends the walls as they now stand, and the rats to be placed again out of the lights given, copies of both', () => {
    const port = new FakePort()
    const swarm = new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
    const walls = [{ from: { x: 0, z: 0 }, to: { x: 1, z: 0 } }]
    const lights: FixedLight[] = [{ x: 3, z: 4, reach: 1.5, on: true }]
    swarm.setWalls(walls)
    swarm.restart(lights)
    const sent = port.sent.filter((m) => m.type === 'walls' || m.type === 'restart')
    expect(sent).toEqual([
      { type: 'walls', walls },
      { type: 'restart', lights },
    ])
    walls[0]!.to.x = 5
    lights[0]!.on = false
    expect(sent).toEqual([
      { type: 'walls', walls: [{ from: { x: 0, z: 0 }, to: { x: 1, z: 0 } }] },
      { type: 'restart', lights: [{ x: 3, z: 4, reach: 1.5, on: true }] },
    ])
  })
})

describe('RemoteSwarm in the play', () => {
  it("grows to the count asked at once, sends the worker every rat set down before the frame's input, and stands each where it was set down until the worker's states have it", () => {
    const port = new FakePort()
    const swarm = new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
    port.deliver(stateAt(STEP, 2, () => {}), ARRIVED)
    swarm.setCount(4)
    expect(swarm.count).toBe(4)
    swarm.setDown(3, 5, -1)
    expect([swarm.x[3], swarm.z[3]]).toEqual([5, -1])
    swarm.send(4, { x: 0, z: 0, strength: 1, on: true }, defaultTuning(), false)
    const kinds = port.sent.map((message) => message.type)
    expect(kinds.slice(1)).toEqual(['count', 'down', 'input'])
    expect(port.sent[2]).toMatchObject({ type: 'down', count: 4 })
    expect(Array.from((port.sent[2] as { downs: Float64Array }).downs)).toEqual([3, 5, -1])
    // States from before the worker had it, still at two rats, or with rat 3 elsewhere, leave it where it was set down.
    port.deliver(stateAt(2 * STEP, 2, () => {}), ARRIVED + 16)
    expect(swarm.count).toBe(4)
    port.deliver(stateAt(3 * STEP, 4, (state) => (state.x[3] = 9)), ARRIVED + 32)
    swarm.sample(ARRIVED + 32)
    expect(swarm.x[3]).toBe(5)
    for (const t of [4, 5]) port.deliver(stateAt(t * STEP, 4, (state) => (state.x[3] = 6)), ARRIVED + 16 * t)
    swarm.sample(ARRIVED + 80)
    expect(swarm.x[3]).toBe(6)
  })

  it('starts afresh with `count` rats, every one placed again, and tells the play how many the worker last found at the holder', () => {
    const port = new FakePort()
    const swarm = new RemoteSwarm(8, 1, 2, 1, { walls: [] }, port)
    swarm.reset(5)
    expect(port.sent.slice(1).map((message) => message.type)).toEqual(['count', 'restart'])
    port.deliver(stateAt(STEP, 5, (state) => (state.reached = 2)), ARRIVED)
    expect(swarm.advance().reached).toBe(2)
  })
})
