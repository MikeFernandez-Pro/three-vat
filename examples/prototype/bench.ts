// PROTOTYPE — throwaway. See ./README.md and issue #47.
//
// The measurement, which is the actual deliverable — the page is only how you
// start it. A number read off a frame counter while dragging a slider is a
// vibe; ADR-0016 exists because this project does not decide on vibes.
//
// Two ways to time a frame, in order of preference:
//
// 1. `EXT_disjoint_timer_query_webgl2` — real GPU time for the draw, immune to
//    vsync and to whatever the compositor is doing. What we want.
// 2. Wall clock around N renders plus a `finish()` — vsync would cap a single
//    render at the refresh interval and report every variant as 16.7 ms, so the
//    fallback renders repeatedly and forces completion before stopping the
//    clock. Absolute values are inflated by the repeat; the *ratio* between
//    variants, which is the number that decides this, survives.
//
// Whichever ran is reported with the results, because a reader comparing these
// numbers to someone else's needs to know which clock produced them.

/** How a run was timed. Printed with the results; never inferred by the reader. */
export type TimingMethod = 'gpu-query' | 'wall-clock'

export interface GpuTimer {
  readonly method: TimingMethod
  begin(): void
  end(): void
  /** Milliseconds resolved since the last call. May lag several frames. */
  collect(): number[]
  dispose(): void
}

/**
 * A GPU timer if this browser grants one, and an honest fallback if not.
 *
 * Chrome exposes the extension on most desktop GPUs and withholds it on many
 * mobile ones, which is exactly the platform split the issue wants measured —
 * so the fallback is not a nicety.
 */
export function createGpuTimer(gl: WebGL2RenderingContext, fallbackRenders: number): GpuTimer {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    | null

  if (!ext) {
    let started = 0
    const samples: number[] = []
    return {
      method: 'wall-clock',
      begin() {
        started = performance.now()
      },
      end() {
        // Without this the clock stops when the commands are *queued*, not when
        // they are done, and every variant times identically at nearly zero.
        gl.finish()
        samples.push((performance.now() - started) / fallbackRenders)
      },
      collect() {
        return samples.splice(0, samples.length)
      },
      dispose() {},
    }
  }

  const pending: WebGLQuery[] = []
  let active: WebGLQuery | null = null
  return {
    method: 'gpu-query',
    begin() {
      active = gl.createQuery()
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active)
    },
    end() {
      if (!active) return
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      pending.push(active)
      active = null
    },
    collect() {
      const out: number[] = []
      // A disjoint means the GPU was interrupted (power state, another
      // context) and every outstanding result is garbage. Throw them away
      // rather than average a lie into the table.
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
      while (pending.length > 0) {
        const query = pending[0]!
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break
        pending.shift()
        if (!disjoint) out.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6)
        gl.deleteQuery(query)
      }
      return out
    },
    dispose() {
      for (const query of pending) gl.deleteQuery(query)
      pending.length = 0
    },
  }
}

/**
 * Beyond this, a frame is competing with the display's cadence and the timings
 * stop separating. Half of a 60 Hz budget: comfortably above any honest
 * measurement, comfortably below the ~11-14 ms plateau that every variant
 * collapses onto once it stops fitting.
 */
export const SATURATION_MS = 8

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

export interface SweepStep {
  variant: string
  count: number
}

export interface SweepResult extends SweepStep {
  /**
   * The headline: the **fastest** frame measured.
   *
   * Not the median, which is what the first draft of this used and what
   * produced two runs that disagreed by a factor of five. Once a step's work
   * stops fitting in a display frame the queue backs up, and every statistic
   * that averages over contaminated frames inherits the contamination — the
   * minimum is the one that does not, because it is the frame that happened to
   * run alone. Standard practice for a GPU microbenchmark, and the reason the
   * spread is reported beside it rather than hidden.
   */
  min: number
  median: number
  max: number
  samples: number
  method: TimingMethod
  /**
   * True when this step's frames were long enough to be fighting the display's
   * own cadence, which makes every number in the row an upper bound rather
   * than a measurement. Read the ratio between two saturated rows as nothing
   * at all: both are pinned against the same ceiling.
   */
  saturated: boolean
}

export interface SweepOptions {
  steps: SweepStep[]
  /** Put the scene into this step's state. Called once per step. */
  apply: (step: SweepStep) => void
  /** Draw one frame. Called `fallbackRenders` times per tick under wall clock. */
  render: () => void
  timer: GpuTimer
  /** Frames drawn and thrown away, to get past shader compile and upload. */
  warmup: number
  /** Frames measured per step. */
  frames: number
  fallbackRenders: number
  onProgress: (line: string) => void
}

/**
 * Run every step and hand back the table.
 *
 * The first frame of a variant compiles its program and the second or third
 * still pays for texture residency, so `warmup` frames are drawn and dropped —
 * without it the first variant in the list always looks the worst, whichever
 * one it is.
 */
export async function runSweep({
  steps,
  apply,
  render,
  timer,
  warmup,
  frames,
  fallbackRenders,
  onProgress,
}: SweepOptions): Promise<SweepResult[]> {
  const results: SweepResult[] = []
  const repeats = timer.method === 'wall-clock' ? fallbackRenders : 1

  for (const [index, step] of steps.entries()) {
    apply(step)
    onProgress(`${index + 1}/${steps.length} — ${step.variant} @ ${step.count}: warming up`)
    for (let f = 0; f < warmup; f++) {
      await nextFrame()
      render()
    }
    timer.collect() // discard anything the warm-up left outstanding

    const samples: number[] = []
    let drawn = 0
    // Drain rather than count frames: a GPU query resolves a frame or two after
    // the frame it timed, so stopping at `frames` ticks would drop the tail.
    while (samples.length < frames && drawn < frames * 4 + 60) {
      await nextFrame()
      timer.begin()
      for (let r = 0; r < repeats; r++) render()
      timer.end()
      drawn++
      samples.push(...timer.collect())
      if (drawn % 20 === 0) {
        onProgress(`${index + 1}/${steps.length} — ${step.variant} @ ${step.count}: ${samples.length}/${frames}`)
      }
    }
    // One more pass to pick up queries still in flight.
    for (let f = 0; f < 4 && samples.length < frames; f++) {
      await nextFrame()
      render()
      samples.push(...timer.collect())
    }

    samples.sort((a, b) => a - b)
    const median = samples[Math.floor(samples.length / 2)] ?? Number.NaN
    results.push({
      ...step,
      min: samples[0] ?? Number.NaN,
      median,
      max: samples[samples.length - 1] ?? Number.NaN,
      samples: samples.length,
      method: timer.method,
      saturated: median > SATURATION_MS,
    })
  }

  onProgress('done')
  return results
}
