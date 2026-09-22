// The console verdict, pinned without a browser. The driver that captures the
// lines cannot run in CI; what it decides about them can, and the one decision
// that matters — an error printed by the browser fails the gate — is the whole
// reason the gate drives a browser at all (docs/releasing.md).
import { describe, expect, it } from 'vitest'
import { describeMessage, judgeConsole } from './console.mjs'

const WGSL_ERROR =
  'THREE.WebGPURenderer: Uncaptured WebGPU GPUValidationError: Error while parsing WGSL: :22:42 error: unable to parse right side of + expression'

describe('judgeConsole', () => {
  it('passes a console with nothing but noise in it', () => {
    const check = judgeConsole([
      { level: 'debug', text: '[vite] connected.' },
      { level: 'warning', text: 'THREE.Renderer: "renderAsync()" has been deprecated.' },
      { level: 'log', text: 'hello' },
    ])

    expect(check.pass).toBe(true)
    expect(check.detail).toContain('3 console lines')
  })

  it('fails on a WGSL compile error, and quotes it', () => {
    // The failure the check exists for: three reports it, the pipeline never
    // builds, and no pixel check can see it.
    const check = judgeConsole([{ level: 'debug', text: '[vite] connected.' }, { level: 'error', text: WGSL_ERROR }])

    expect(check.pass).toBe(false)
    expect(check.detail).toContain('unable to parse right side')
    expect(check.detail).not.toContain('[vite]')
  })

  it('fails on an uncaught page error, which reaches the driver by another event', () => {
    expect(judgeConsole([{ level: 'pageerror', text: 'TypeError: x is not a function' }]).pass).toBe(false)
  })

  it('does not fail on a warning', () => {
    expect(judgeConsole([{ level: 'warning', text: 'something deprecated' }]).pass).toBe(true)
  })
})

describe('describeMessage', () => {
  it('names the resource behind a failed load, which the browser’s text does not', () => {
    const line = describeMessage({
      type: 'error',
      text: 'Failed to load resource: the server responded with a status of 404 (Not Found)',
      location: { url: 'http://localhost:5174/test-assets/Soldier.glb', lineNumber: 0 },
    })

    expect(line.level).toBe('error')
    expect(line.text).toContain('Soldier.glb')
  })

  it('leaves a script’s own message alone, since it names its cause itself', () => {
    const line = describeMessage({
      type: 'error',
      text: WGSL_ERROR,
      location: { url: 'http://localhost:5174/@fs/node_modules/.vite/deps/chunk.js', lineNumber: 85944 },
    })

    expect(line.text).toBe(WGSL_ERROR)
  })
})
