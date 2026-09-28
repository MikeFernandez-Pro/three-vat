// The smoke run's verdict on one page: pure, so it is held here in CI while the
// run itself needs a browser on a GPU (docs/releasing.md).
import { describe, expect, it } from 'vitest'
import { judgePage } from './verdict.mjs'

const passing = { page: 'webgl_crowd', lines: [{ level: 'log', text: 'hello' }], draws: 12, waitedMs: 800 }

describe('a page passes the smoke run', () => {
  it('when it drew and its console reported no error', () => {
    const checks = judgePage(passing)

    expect(checks.map((check) => check.pass)).toEqual([true, true])
    expect(checks.every((check) => check.name.startsWith('webgl_crowd: '))).toBe(true)
  })

  it('fails on any console error, even over a page that drew', () => {
    const [console, drew] = judgePage({ ...passing, lines: [{ level: 'error', text: 'WGSL: bad' }] })

    expect(console!.pass).toBe(false)
    expect(console!.detail).toContain('WGSL: bad')
    expect(drew!.pass).toBe(true)
  })

  it('fails on an uncaught exception', () => {
    const [console] = judgePage({ ...passing, lines: [{ level: 'pageerror', text: 'boom' }] })

    expect(console!.pass).toBe(false)
  })

  it('passes a warning, as the parity gate does', () => {
    const [console] = judgePage({ ...passing, lines: [{ level: 'warning', text: 'deprecated' }] })

    expect(console!.pass).toBe(true)
  })

  it('fails a page that never drew, with how long it was given', () => {
    const [, drew] = judgePage({ ...passing, draws: 0, waitedMs: 60_000 })

    expect(drew!.pass).toBe(false)
    expect(drew!.detail).toContain('60 s')
  })
})
