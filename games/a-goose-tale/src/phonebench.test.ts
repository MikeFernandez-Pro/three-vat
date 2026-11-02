import { describe, expect, it } from 'vitest'
import { PhoneBench, costsOf, type BenchCost, type BenchPlace, type Reading } from './phonebench'

const place = (name: string, log: string[]): BenchPlace => ({ name, go: () => log.push(`go ${name}`) })
const cost = (name: string, log: string[], at?: string): BenchCost => ({ name, off: () => log.push(`off ${name}`), on: () => log.push(`on ${name}`), place: at })

/** Runs `bench` a frame every `ms` till it is done; returns the readings. */
function play(bench: PhoneBench, readings: Reading[], ms = 16, limit = 3_600_000): Reading[] {
  for (let now = ms; !bench.done && now < limit; now += ms) bench.frame(ms, 2, now)
  return readings
}

describe('PhoneBench', () => {
  it('reads every place, the slowest again for its load, then every cost off and on there, in turn each way round', () => {
    const log: string[] = []
    const readings: Reading[] = []
    const bench = new PhoneBench([place('a', log), place('b', log)], [cost('x', log)], { report: (r) => readings.push(r) })
    for (let now = 16; !bench.done && now < 3_600_000; now += 16) bench.frame(log.filter((line) => line.startsWith('go ')).at(-1) === 'go b' ? 40 : 16, 2, now)
    expect(readings.map((r) => [r.place, r.cost, r.side])).toEqual([
      ['a', null, 'base'],
      ['b', null, 'base'],
      ['b', null, 'base'],
      ['b', 'x', 'base'],
      ['b', 'x', 'off'],
      ['b', 'x', 'off'],
      ['b', 'x', 'base'],
    ])
    expect(log).toEqual(['go a', 'go b', 'off x', 'on x'])
  })

  it('takes the queue for the slowest where the frames stand at a vsync alike', () => {
    const log: string[] = []
    const readings: Reading[] = []
    const bench = new PhoneBench([place('a', log), place('b', log)], [cost('x', log)], {
      report: (r) => readings.push(r),
      timeQueue: (record) => record(log.at(-1) === 'go b' ? 9 : 3),
    })
    play(bench, readings)
    expect(readings.find((r) => r.cost === 'x')!.place).toBe('b')
  })

  it('raises the load till the frames run over budget, and reads the costs there', () => {
    const log: string[] = []
    const readings: Reading[] = []
    let load = 0
    const bench = new PhoneBench([place('a', log)], [cost('x', log)], {
      report: (r) => readings.push(r),
      budget: 16,
      raise: () => {
        load++
        return true
      },
    })
    for (let now = 16; !bench.done && now < 3_600_000; now += 16) bench.frame(load >= 2 ? 24 : 16, 2, now)
    expect(load).toBe(2)
    // The tour's reading, then the load's at each of its three heights.
    expect(readings.slice(0, 4).map((r) => r.saturated)).toEqual([false, false, false, true])
    expect(readings.filter((r) => r.cost === 'x').every((r) => r.saturated)).toBe(true)
  })

  it('goes on unsaturated once no load is left, and says so', () => {
    const readings: Reading[] = []
    const log: string[] = []
    const bench = new PhoneBench([place('a', log)], [cost('x', log)], { report: (r) => readings.push(r), raise: () => false })
    play(bench, readings)
    expect(readings.filter((r) => r.cost === 'x').every((r) => !r.saturated)).toBe(true)
    expect(bench.done).toBe(true)
  })

  it("goes to a cost's own place for it", () => {
    const log: string[] = []
    const readings: Reading[] = []
    const bench = new PhoneBench([place('a', log), place('pond', log)], [cost('water', log, 'pond'), cost('x', log)], {
      report: (r) => readings.push(r),
      timeQueue: (record) => record(log.filter((line) => line.startsWith('go ')).at(-1) === 'go a' ? 9 : 3),
    })
    for (let now = 16; !bench.done && now < 3_600_000; now += 16) bench.frame(log.filter((line) => line.startsWith('go ')).at(-1) === 'go a' ? 40 : 16, 2, now)
    expect(readings.filter((r) => r.cost === 'water').every((r) => r.place === 'pond')).toBe(true)
    expect(readings.filter((r) => r.cost === 'x').every((r) => r.place === 'a')).toBe(true)
  })

  it("reads none of a run's first frames", () => {
    const readings: Reading[] = []
    const bench = new PhoneBench([{ name: 'a', go: () => {} }], [], { report: (r) => readings.push(r) })
    let now = 0
    for (; now < 2000; now += 100) bench.frame(100, 2, now)
    for (; !bench.done && now < 60_000; now += 20) bench.frame(20, 2, now)
    expect(readings[0]!.frameMs.p50).toBe(20)
    expect(readings[0]!.frameMs.p90).toBe(20)
  })

  it('starts a reading again after a hitch, so that one never comes out empty or half read', () => {
    const readings: Reading[] = []
    const bench = new PhoneBench([{ name: 'a', go: () => {} }], [], { report: (r) => readings.push(r) })
    let now = 0
    for (; now < 4000; now += 20) bench.frame(20, 2, now)
    bench.frame(5000, 2, (now += 5000))
    for (; !bench.done && now < 60_000; now += 20) bench.frame(20, 2, now)
    expect(readings[0]!.gaps).toBe(1)
    expect(readings[0]!.frames).toBeGreaterThanOrEqual(149)
    expect(readings[0]!.frameMs.mean).toBe(20)
  })

  it('reports no queue without one to ask', () => {
    const readings: Reading[] = []
    play(new PhoneBench([{ name: 'a', go: () => {} }], [], { report: (r) => readings.push(r) }), readings)
    expect(readings[0]!.queueMs).toBeNull()
  })

  it('leaves every cost as it found it', () => {
    const log: string[] = []
    const readings: Reading[] = []
    const bench = new PhoneBench([place('a', log)], [cost('x', log), cost('y', log)], { report: (r) => readings.push(r) })
    play(bench, readings)
    for (const name of ['x', 'y']) {
      const offs = log.filter((line) => line === `off ${name}`).length
      expect(offs).toBeGreaterThan(0)
      expect(log.filter((line) => line === `on ${name}`).length).toBe(offs)
    }
  })

  it('tells the page where it is, with the count of runs', () => {
    const lines: string[] = []
    const readings: Reading[] = []
    const bench = new PhoneBench([{ name: 'a', go: () => {} }], [], { report: (r) => readings.push(r), show: (line) => lines.push(line) })
    play(bench, readings)
    expect(lines[0]).toBe('1/1 a')
    expect(lines.at(-1)).toBe('done')
  })
})

describe('costsOf', () => {
  const reading = (name: string | null, side: 'base' | 'off', frame: number, queue: number | null, saturated = true): Reading => ({
    place: 'a',
    cost: name,
    side,
    frames: 100,
    gaps: 0,
    slow: 0,
    saturated,
    frameMs: { mean: frame, p50: frame, p90: frame },
    pageMs: { mean: 1, p50: 1, p90: 1 },
    queueMs: queue === null ? null : { mean: queue, p50: queue, p90: queue },
  })

  it('prices a cost by what taking it off saves of the mean frame, base less off, over its rounds, dearest first', () => {
    const priced = costsOf([
      reading(null, 'base', 30, 10),
      reading('x', 'base', 30, 10),
      reading('x', 'off', 28, 8),
      reading('x', 'off', 27, 7),
      reading('x', 'base', 29, 9),
      reading('y', 'base', 33, 10),
      reading('y', 'off', 17, 4),
    ])
    expect(priced).toEqual([
      { cost: 'y', frameMs: 16, queueMs: 6, saturated: true },
      { cost: 'x', frameMs: 2, queueMs: 2, saturated: true },
    ])
  })

  it('says when a price may be hidden under the vsync, and has none from a queue it never read', () => {
    expect(costsOf([reading('x', 'base', 17, null, false), reading('x', 'off', 17, null)])).toEqual([{ cost: 'x', frameMs: 0, queueMs: null, saturated: false }])
  })
})
