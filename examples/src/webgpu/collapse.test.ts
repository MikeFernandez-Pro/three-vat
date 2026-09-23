// Guards the WebGPU batched page's draw-call collapse (#65, ADR-0023) against a
// fake of three r186's backend loop — the thing it wraps — so what a reader of
// the HUD is told holds without a GPU in the room: one geometry folds to one
// draw and one counted call, a mixed batch is left to three, and a backend this
// file does not recognise is left alone and says so.
import { describe, expect, it } from 'vitest'
import { coalescingEncoder, coalescingInfo, collapseUniformBatches, uniformDrawCount } from './collapse.js'

type Call = [name: string, ...args: unknown[]]

/** A stand-in for a `GPURenderPassEncoder`: records what it is sent, and by whom. */
function encoder() {
  const calls: Call[] = []
  const pass = {
    calls,
    receivers: [] as unknown[],
    drawIndexed(...args: number[]) {
      calls.push(['drawIndexed', ...args])
    },
    draw(...args: number[]) {
      calls.push(['draw', ...args])
    },
    setPipeline(this: unknown, pipeline: unknown) {
      pass.receivers.push(this)
      calls.push(['setPipeline', pipeline])
    },
  }
  return pass
}

/** A stand-in for `renderer.info`: the per-frame counter `_draw` updates. */
function info() {
  const updates: [object: unknown, count: number, instances: number][] = []
  return {
    updates,
    update(object: unknown, count: number, instances: number) {
      updates.push([object, count, instances])
    },
  }
}

/** A `BatchedMesh` as the backend sees it, after three's culling and sorting have filled the multi-draw arrays. */
function batch(counts: number[], starts: number[]) {
  return {
    isBatchedMesh: true,
    _multiDrawCount: counts.length,
    _multiDrawCounts: Int32Array.from(counts),
    _multiDrawStarts: Int32Array.from(starts),
    _multiDrawBytesPerElement: 2,
  }
}

/**
 * The loop `WebGPUBackend._draw` runs for a batch in r186, and nothing else of
 * it: the pieces the collapse replaces are the two it touches. Positions and
 * arity are the real ones — they are what the guard checks.
 */
function r186Draw(
  renderObject: { object: ReturnType<typeof batch>; hasIndex: boolean },
  counter: ReturnType<typeof info>,
  _renderContextData: unknown,
  _pipelineGPU: unknown,
  _bindings: unknown,
  _vertexBuffers: unknown,
  _drawParams: unknown,
  pass: ReturnType<typeof encoder>,
  _currentSets: unknown,
  _cameraIndexSlot = -1,
) {
  const { object, hasIndex } = renderObject
  pass.setPipeline('pipeline')
  const starts = object._multiDrawStarts
  const counts = object._multiDrawCounts
  const bpe = object._multiDrawBytesPerElement
  for (let i = 0; i < object._multiDrawCount; i++) {
    if (hasIndex) pass.drawIndexed(counts[i]!, 1, starts[i]! / bpe, 0, i)
    else pass.draw(counts[i]!, 1, starts[i]!, i)
    counter.update(object, counts[i]!, 1)
  }
}

/** A renderer over a fake WebGPU backend whose `_draw` is the loop above. */
function renderer(draw: (...args: never[]) => unknown = r186Draw as never) {
  const backend = { isWebGPUBackend: true, _draw: draw as (...args: unknown[]) => unknown }
  return { backend, renderer: { backend } as never }
}

function drawn(r: ReturnType<typeof renderer>, object: ReturnType<typeof batch>, hasIndex = true) {
  const pass = encoder()
  const counter = info()
  r.backend._draw({ object, hasIndex }, counter, {}, {}, [], [], {}, pass, {}, -1)
  return { pass, counter }
}

describe('a uniform batch is one draw', () => {
  it('folds N one-instance draws of the same range into one draw of N instances', () => {
    const r = renderer()
    expect(collapseUniformBatches(r.renderer)).toBe(true)

    const { pass, counter } = drawn(r, batch([300, 300, 300, 300], [0, 0, 0, 0]))

    expect(pass.calls.filter(([name]) => name === 'drawIndexed')).toEqual([['drawIndexed', 300, 4, 0, 0, 0]])
    expect(counter.updates).toEqual([[expect.anything(), 300, 4]])
  })

  it('folds the non-indexed draw the same way', () => {
    const r = renderer()
    collapseUniformBatches(r.renderer)

    const { pass, counter } = drawn(r, batch([90, 90, 90], [12, 12, 12]), false)

    expect(pass.calls.filter(([name]) => name === 'draw')).toEqual([['draw', 90, 3, 12, 0]])
    expect(counter.updates).toHaveLength(1)
  })

  it('keeps the range three chose, so a culled crowd is a smaller instance count and nothing else', () => {
    const r = renderer()
    collapseUniformBatches(r.renderer)

    const { pass } = drawn(r, batch([300, 300], [600, 600]))

    // start / bytesPerElement, as three computes the first index
    expect(pass.calls.filter(([name]) => name === 'drawIndexed')).toEqual([['drawIndexed', 300, 2, 300, 0, 0]])
  })

  it('sends everything else on the encoder through to the real one, as its own method', () => {
    const r = renderer()
    collapseUniformBatches(r.renderer)

    const { pass } = drawn(r, batch([300, 300], [0, 0]))

    expect(pass.calls[0]).toEqual(['setPipeline', 'pipeline'])
    // a platform object's methods check their receiver, so the proxy must not be it
    expect(pass.receivers).toEqual([pass])
  })
})

describe('what is left to three', () => {
  it('a batch of more than one geometry: three draws each range itself', () => {
    const r = renderer()
    collapseUniformBatches(r.renderer)

    const { pass, counter } = drawn(r, batch([300, 120, 300], [0, 600, 0]))

    expect(pass.calls.filter(([name]) => name === 'drawIndexed')).toHaveLength(3)
    expect(counter.updates).toHaveLength(3)
  })

  it('a batch drawing one instance: one draw is already one draw', () => {
    const r = renderer()
    collapseUniformBatches(r.renderer)

    const { pass } = drawn(r, batch([300], [0]))

    expect(pass.calls.filter(([name]) => name === 'drawIndexed')).toEqual([['drawIndexed', 300, 1, 0, 0, 0]])
  })

  it('an object that is not a batch: untouched', () => {
    expect(uniformDrawCount({ isMesh: true })).toBeNull()
    expect(uniformDrawCount(null)).toBeNull()
    expect(uniformDrawCount(undefined)).toBeNull()
  })

  it('a batch drawing nothing: nothing to fold', () => {
    expect(uniformDrawCount(batch([], []))).toBeNull()
  })
})

describe('the collapse fails soft', () => {
  it('is not installed on a backend that is not WebGPU’s, and says so', () => {
    const backend = { isWebGPUBackend: false, _draw: r186Draw }
    expect(collapseUniformBatches({ backend } as never)).toBe(false)
    expect(backend._draw).toBe(r186Draw)
  })

  it('is not installed on a renderer with no backend yet', () => {
    expect(collapseUniformBatches({} as never)).toBe(false)
  })

  it('is not installed over a `_draw` of another arity — three moved the arguments this file positions', () => {
    const moved = function (_a: unknown, _b: unknown, _c: unknown, _d: unknown, _e: unknown, _f: unknown, _g: unknown, _h: unknown) {}
    const r = renderer(moved as never)
    expect(collapseUniformBatches(r.renderer)).toBe(false)
    expect(r.backend._draw).toBe(moved)
  })

  it('is not installed where there is no `_draw` at all', () => {
    const backend = { isWebGPUBackend: true }
    expect(collapseUniformBatches({ backend } as never)).toBe(false)
  })

  it('installs once: a second call reports success and does not fold twice', () => {
    const r = renderer()
    expect(collapseUniformBatches(r.renderer)).toBe(true)
    const once = r.backend._draw
    expect(collapseUniformBatches(r.renderer)).toBe(true)
    expect(r.backend._draw).toBe(once)

    const { pass } = drawn(r, batch([300, 300], [0, 0]))
    expect(pass.calls.filter(([name]) => name === 'drawIndexed')).toEqual([['drawIndexed', 300, 2, 0, 0, 0]])
  })
})

describe('the pieces, on their own', () => {
  it('the encoder answers the first draw for all of them and swallows the rest', () => {
    const pass = encoder()
    const folded = coalescingEncoder(pass, 5)
    folded.drawIndexed(10, 1, 3, 0, 0)
    folded.drawIndexed(10, 1, 3, 0, 1)
    folded.drawIndexed(10, 1, 3, 0, 2)
    expect(pass.calls).toEqual([['drawIndexed', 10, 5, 3, 0, 0]])
  })

  it('the counter reports one draw of all the instances', () => {
    const counter = info()
    const folded = coalescingInfo(counter, 7)
    folded.update('o', 30, 1)
    folded.update('o', 30, 1)
    expect(counter.updates).toEqual([['o', 30, 7]])
  })
})
