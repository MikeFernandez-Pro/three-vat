// The comparison the baking pages hand over after a bake is a contract, not a
// look: each figure's difference, and whether the judged column wins it, are
// read off the numbers here in Node. Lower is better for every figure the two
// pages compare: bytes downloaded, milliseconds waited, draws a frame.
import { describe, expect, it } from 'vitest'
import { bakeButtonMarkup, compareFigure, comparisonMarkup } from './bake-compare.js'

describe('a figure, compared', () => {
  it('is better where the judged column is lower', () => {
    const row = compareFigure({ label: 'bake time', unit: 'ms', values: [0, 912.4] })

    expect(row.cells).toEqual(['0 ms', '912 ms'])
    expect(row.difference).toBe('−912 ms')
    expect(row.verdict).toBe('better')
  })

  it('rounds a difference the way it rounds the cells, whichever its sign', () => {
    // Half a millisecond off a 54.5 ms bake: written 55 ms, so the file saves 55.
    const row = compareFigure({ label: 'bake time', unit: 'ms', values: [0, 54.5] })

    expect(row.cells).toEqual(['0 ms', '55 ms'])
    expect(row.difference).toBe('−55 ms')
  })

  it('is worse where the judged column is higher', () => {
    // A worker bake pays for the copy it is handed: a little slower, honestly red.
    const row = compareFigure({ label: 'bake time', unit: 'ms', values: [1310, 1180] })

    expect(row.difference).toBe('+130 ms')
    expect(row.verdict).toBe('worse')
  })

  it('is a tie where the two read the same, whatever the digits behind them', () => {
    const row = compareFigure({ label: 'load time', unit: 'ms', values: [41.2, 40.9] })

    expect(row.cells).toEqual(['41 ms', '41 ms'])
    expect(row.difference).toBe('0 ms')
    expect(row.verdict).toBe('same')
  })

  it('writes bytes as a download is read, and judges them as written', () => {
    const row = compareFigure({ label: 'download', unit: 'bytes', values: [2_430_000, 2_160_000] })

    expect(row.cells).toEqual(['2.4 MB', '2.2 MB'])
    expect(row.difference).toBe('+270 kB')
    expect(row.verdict).toBe('worse')
  })

  it('writes counts bare', () => {
    const row = compareFigure({ label: 'draw calls', unit: 'count', values: [2, 240] })

    expect(row.cells).toEqual(['2', '240'])
    expect(row.difference).toBe('−238')
    expect(row.verdict).toBe('better')
  })

  it('has no difference and no verdict while either column has not run', () => {
    const row = compareFigure({ label: 'longest frame', unit: 'ms', values: [null, 2650] })

    expect(row.cells).toEqual(['—', '2650 ms'])
    expect(row.difference).toBeNull()
    expect(row.verdict).toBeNull()
  })
})

describe('the comparison table', () => {
  const html = comparisonMarkup(['file', 'glTF'], [
    { label: 'download', unit: 'bytes', values: [2_430_000, 2_160_000] },
    { label: 'bake time', unit: 'ms', values: [0, 912] },
    { label: 'load time', unit: 'ms', values: [null, 80] },
  ])
  const rows = [...html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!)

  it('heads its columns with the two paths, then the difference', () => {
    expect(rows[0]).toBe('<th></th><th scope="col">file</th><th scope="col">glTF</th><th scope="col">difference</th>')
  })

  it('carries one row per figure, named by its label', () => {
    expect(rows.slice(1).map((row) => /<th scope="row">([^<]*)</.exec(row)?.[1])).toEqual(['download', 'bake time', 'load time'])
  })

  it('marks each difference with its verdict, for the stylesheet to colour', () => {
    expect(rows[1]).toContain('<td class="compare-diff" data-verdict="worse">+270 kB</td>')
    expect(rows[2]).toContain('<td class="compare-diff" data-verdict="better">−912 ms</td>')
  })

  it('leaves a difference blank, and uncoloured, until both columns have run', () => {
    expect(rows[3]).toContain('<td class="compare-diff"></td>')
  })

  it('escapes what it is handed', () => {
    expect(comparisonMarkup(['a & b', 'c'], [])).toContain('<th scope="col">a &amp; b</th>')
  })
})

describe('the bake button', () => {
  it('is one addressable root, a button per choice carrying its value', () => {
    const html = bakeButtonMarkup('bake the soldier', [
      ['main', 'on the main thread'],
      ['worker', 'in a worker'],
    ])

    expect(html).toMatch(/^<div id="bake-button" class="bake-button" role="group" aria-label="bake the soldier">/)
    expect(html).toContain('<button type="button" class="bake-choice" data-choice="main">on the main thread</button>')
    expect(html).toContain('<button type="button" class="bake-choice" data-choice="worker">in a worker</button>')
    expect(html.indexOf('data-choice="main"')).toBeLessThan(html.indexOf('data-choice="worker"'))
  })

  it('says what it does above its choices', () => {
    const html = bakeButtonMarkup('bake the soldier', [['main', 'on the main thread']])

    expect(html).toContain('<p class="bake-prompt">bake the soldier</p>')
    expect(html.indexOf('bake-prompt')).toBeLessThan(html.indexOf('bake-choice'))
  })
})
