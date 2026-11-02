// What each thing the game draws costs on a phone, read on the phone: `?bench`
// stands the goose at each place, then takes each cost off and puts it back at
// the slowest, and posts every reading to the dev server (tools/phonelog-plugin.ts),
// so nothing is copied off a small screen.
//
// A phone can't be run uncapped, and a frame under its vsync reads the same
// however light it was. So before the costs the load is raised, by the pixel
// ratio, until the frames run over budget, where taking a cost off shows in
// their mean length. The queue's time to finish a frame is kept too, but it is
// no GPU time: on Chrome over an RTX 5080 (2026-11-02, dpr 2) it read a vsync
// under the cap, whatever was drawn, and the backlog over it, 19 ms on 5.4 ms
// frames. No renderer and no DOM, so it is tested in Node.

/** Somewhere the goose is stood: `go` puts him there. */
export interface BenchPlace {
  name: string
  go(): void
  /** How long it takes to be there, ms: a cost's own settling at the least. */
  settle?: number
}

/** A thing drawn that can be taken off and put back. */
export interface BenchCost {
  name: string
  off(): void
  on(): void
  /** The place it is read at, where it shows only there; else the slowest. */
  place?: string
}

export interface Spread {
  mean: number
  p50: number
  p90: number
}

/** A few seconds' frames at one place and one state of a cost. */
export interface Reading {
  place: string
  cost: string | null
  side: 'base' | 'off'
  frames: number
  /** Frames past GAP: each starts the reading again, and none is read. */
  gaps: number
  /** The share of the frames that missed a 30 fps target. */
  slow: number
  /** Whether the frames ran over budget, so that a cost shows in them. */
  saturated: boolean
  frameMs: Spread
  pageMs: Spread
  /** From a frame's submitting to the queue's finishing it: see above. */
  queueMs: Spread | null
}

export interface BenchOutput {
  report(reading: Reading): void
  /** Times the queue's finishing what was just submitted, and records it. */
  timeQueue?(record: (ms: number) => void): void
  /** Says where the bench is. */
  show?(line: string): void
  /** Raises the load a step: false with none left. */
  raise?(): boolean
  /** A vsync, ms. */
  budget?: number
}

/** How long a state of a cost settles, ms: its pipelines compile, and the first frames hitch. */
const SETTLE = 1500
/** How long a place settles, ms: the camera's follow, and the rats coming round. */
const PLACE_SETTLE = 3000
/** How long a reading lasts, ms. */
const SAMPLE = 3000
/** A frame longer than this is no frame, ms. */
const GAP = 250
/** A frame longer than this missed 30 fps, ms: 33.3 and a little for the clock. */
const SLOW_FRAME = 34
/** How many times each cost is read, each way round: drift, a phone warming, falls on both sides alike. */
const ROUNDS = 2
/** A vsync where none is said, ms. */
const VSYNC = 1000 / 60
/** Frames this far over a vsync on the mean are over budget, and stay there: at 1.1 a passing hitch on a PC stopped the load being raised, and the costs then read under the vsync (2026-11-02). */
const OVER_BUDGET = 1.3

interface Run {
  place: string
  cost: BenchCost | null
  side: 'base' | 'off'
}

const spread = (values: number[]): Spread => {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] ?? 0
  return { mean: mean(values), p50: at(0.5), p90: at(0.9) }
}

const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / Math.max(1, values.length)
const hundredths = (value: number) => Math.round(value * 100) / 100

export class PhoneBench {
  done = false
  private readonly runs: Run[]
  private readonly readings: Reading[] = []
  private phase: 'tour' | 'load' | 'costs' = 'tour'
  private k = -1
  private place: string | undefined
  /** The cost taken off now. */
  private off: BenchCost | null = null
  private sampleFrom = 0
  private frames: number[] = []
  private page: number[] = []
  private queue: number[] = []
  private gaps = 0

  constructor(
    private readonly places: BenchPlace[],
    private readonly costs: BenchCost[],
    private readonly out: BenchOutput,
  ) {
    this.runs = places.map((p) => ({ place: p.name, cost: null, side: 'base' }))
  }

  /** A frame `frameMs` long with `pageMs` of the page's own, ending at `now` ms. */
  frame(frameMs: number, pageMs: number, now: number): void {
    if (this.done) return
    if (this.k < 0) this.begin(0, now, undefined)
    if (now < this.sampleFrom) return
    if (frameMs > GAP) {
      // A hitch: what was read may be what led to it, and a reading needs its seconds.
      this.gaps++
      this.frames = []
      this.page = []
      this.queue = []
      this.sampleFrom = now
      return
    }
    this.frames.push(frameMs)
    this.page.push(pageMs)
    const into = this.queue
    this.out.timeQueue?.((ms) => into.push(ms))
    if (now < this.sampleFrom + SAMPLE) return
    const raised = this.finishRun()
    if (this.k + 1 === this.runs.length) this.finish()
    else this.begin(this.k + 1, now, raised ? SETTLE : undefined)
  }

  /** The readings' costs, priced. */
  get priced(): PricedCost[] {
    return costsOf(this.readings)
  }

  private begin(k: number, now: number, atLeast: number | undefined): void {
    this.k = k
    const run = this.runs[k]!
    let settle = atLeast ?? 0
    const wanted = run.side === 'off' ? run.cost : null
    if (this.off !== wanted) {
      this.off?.on()
      wanted?.off()
      this.off = wanted
      settle = Math.max(settle, SETTLE)
    }
    if (this.place !== run.place) {
      const place = this.places.find((p) => p.name === run.place)!
      place.go()
      this.place = run.place
      settle = Math.max(settle, place.settle ?? PLACE_SETTLE)
    }
    this.sampleFrom = now + settle
    this.frames = []
    this.page = []
    this.queue = []
    this.gaps = 0
    this.out.show?.(`${k + 1}/${this.runs.length} ${run.place}${run.cost ? `: ${run.cost.name} ${run.side === 'off' ? 'off' : 'on'}` : ''}`)
  }

  /** Reports the run, and lays what comes after it: true when that is the same place under a raised load. */
  private finishRun(): boolean {
    const run = this.runs[this.k]!
    const frameMs = spread(this.frames)
    const reading: Reading = {
      place: run.place,
      cost: run.cost?.name ?? null,
      side: run.side,
      frames: this.frames.length,
      gaps: this.gaps,
      slow: this.frames.filter((ms) => ms > SLOW_FRAME).length / Math.max(1, this.frames.length),
      saturated: frameMs.mean > (this.out.budget ?? VSYNC) * OVER_BUDGET,
      frameMs,
      pageMs: spread(this.page),
      queueMs: this.queue.length > 0 ? spread(this.queue) : null,
    }
    this.readings.push(reading)
    this.out.report(reading)
    if (this.phase === 'tour') {
      if (this.k + 1 < this.places.length) return false
      this.phase = 'load'
      this.runs.push({ place: this.slowest(), cost: null, side: 'base' })
      return false
    }
    if (this.phase === 'load') {
      if (!reading.saturated && this.out.raise?.()) {
        this.runs.push({ ...run })
        return true
      }
      this.phase = 'costs'
      this.planCosts(run.place)
    }
    return false
  }

  /** The place the tour read slowest: by the frames, or where they stand at a vsync alike, by the queue. */
  private slowest(): string {
    const worse = (a: Reading, b: Reading) => a.frameMs.mean > b.frameMs.mean * 1.02 || (a.frameMs.mean > b.frameMs.mean / 1.02 && (a.queueMs?.p50 ?? 0) > (b.queueMs?.p50 ?? 0))
    return this.readings.reduce((worst, r) => (worse(r, worst) ? r : worst)).place
  }

  /** Each cost read off and on at its place, in turn each way round. */
  private planCosts(slowest: string): void {
    for (const cost of this.costs) {
      const place = cost.place ?? slowest
      for (let round = 0; round < ROUNDS; round++) {
        const sides: Run['side'][] = round % 2 === 0 ? ['base', 'off'] : ['off', 'base']
        for (const side of sides) this.runs.push({ place, cost, side })
      }
    }
  }

  private finish(): void {
    this.off?.on()
    this.off = null
    this.done = true
    this.out.show?.('done')
  }
}

/** What taking a cost off saves, ms, the mean of its readings base less off. */
export interface PricedCost {
  cost: string
  frameMs: number
  queueMs: number | null
  /** Whether every one of its readings ran over budget: if not, its price may be hidden under the vsync. */
  saturated: boolean
}

/** Each cost's price over its readings, dearest first. */
export function costsOf(readings: Reading[]): PricedCost[] {
  const names = [...new Set(readings.flatMap((r) => (r.cost === null ? [] : [r.cost])))]
  const priced = names.map((cost): PricedCost => {
    const own = readings.filter((r) => r.cost === cost)
    const base = own.filter((r) => r.side === 'base')
    const off = own.filter((r) => r.side === 'off')
    const saved = (read: (r: Reading) => number) => hundredths(mean(base.map(read)) - mean(off.map(read)))
    return {
      cost,
      frameMs: saved((r) => r.frameMs.mean),
      queueMs: own.every((r) => r.queueMs !== null) ? saved((r) => r.queueMs!.p50) : null,
      saturated: own.every((r) => r.saturated),
    }
  })
  return priced.sort((a, b) => b.frameMs - a.frameMs)
}

/** What the page has fetched so far, as the log keeps it: by kind of file, how many, their kilobytes and when the last was in, ms; the largest ten; and whether it is the page's first look at them. */
export function logFetched(when: string): void {
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  const kinds = new Map<string, { files: number; kb: number; lastMs: number }>()
  for (const entry of entries) {
    const kind = /\.([a-z0-9]+)(?:$|\?)/i.exec(entry.name)?.[1] ?? 'other'
    const one = kinds.get(kind) ?? { files: 0, kb: 0, lastMs: 0 }
    one.files++
    one.kb += Math.round(entry.encodedBodySize / 1024)
    one.lastMs = Math.max(one.lastMs, Math.round(entry.responseEnd))
    kinds.set(kind, one)
  }
  const largest = [...entries]
    .sort((a, b) => b.encodedBodySize - a.encodedBodySize)
    .slice(0, 10)
    .map((entry) => ({ file: entry.name.split('/').pop(), kb: Math.round(entry.encodedBodySize / 1024), ms: Math.round(entry.duration) }))
  const page = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  logToServer({ kind: 'fetched', when, ms: Math.round(performance.now()), htmlMs: page && Math.round(page.responseEnd), kinds: Object.fromEntries(kinds), totalKb: [...kinds.values()].reduce((sum, one) => sum + one.kb, 0), transferredKb: Math.round(entries.reduce((sum, entry) => sum + entry.transferSize, 0) / 1024), largest })
}

/** How many warnings are logged: three can repeat one a frame. */
const WARNINGS = 40

/** From now on the page's errors and warnings go to the log too, so what stops a page loading, on a phone with no console, is read. */
export function logPageTrouble(): void {
  const log = (what: string, detail: unknown) => logToServer({ kind: 'error', what, ms: Math.round(performance.now()), detail: String(detail).slice(0, 2000) })
  let errored = 0
  // A lost GPU throws on every frame from then on.
  addEventListener('error', (event) => errored++ < WARNINGS && log('error', event.message))
  addEventListener('unhandledrejection', (event) => errored++ < WARNINGS && log('rejection', event.reason))
  const consoleError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    if (errored++ < WARNINGS) log('console', args.join(' '))
    consoleError(...args)
  }
  const consoleWarn = console.warn.bind(console)
  let warned = 0
  console.warn = (...args: unknown[]) => {
    if (warned++ < WARNINGS) log('warning', args.join(' '))
    consoleWarn(...args)
  }
}

/** Posts `row` to the dev server's log, one line of its file; a page with no such address loses it, and plays on. */
export function logToServer(row: unknown): void {
  void fetch('/phone-log', { method: 'POST', body: JSON.stringify(row), keepalive: true }).catch(() => {})
}
