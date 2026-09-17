// The one thing the WebGPU page must get right before it does anything else:
// deciding whether this browser can run it, and saying why when it cannot.
//
// Pure enough to test in Node because the host it reads is passed in — a page
// that only discovered the answer by throwing inside `WebGPURenderer` would
// have nothing to show the reader but a blank canvas.
import { describe, expect, it } from 'vitest'
import { detectWebGPU } from './support.js'

const adapter = {} // whatever `requestAdapter` resolves to; only null matters

describe('detectWebGPU', () => {
  it('is available when an adapter starts', async () => {
    const result = await detectWebGPU({
      isSecureContext: true,
      navigator: { gpu: { requestAdapter: async () => adapter } },
    })

    expect(result).toEqual({ ok: true })
  })

  it('names the missing API when the browser has no WebGPU at all', async () => {
    const result = await detectWebGPU({ isSecureContext: true, navigator: {} })

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/WebGPU/)
  })

  it('blames the insecure origin, which is why `navigator.gpu` is missing there', async () => {
    // http:// on anything but localhost hides `navigator.gpu` entirely, so
    // "this browser has no WebGPU" would be a lie the reader cannot act on.
    const result = await detectWebGPU({ isSecureContext: false, navigator: {} })

    expect(result.ok === false && result.reason).toMatch(/secure|https/i)
  })

  it('reports a browser that has WebGPU but starts no adapter', async () => {
    const result = await detectWebGPU({
      isSecureContext: true,
      navigator: { gpu: { requestAdapter: async () => null } },
    })

    expect(result.ok === false && result.reason).toMatch(/adapter/i)
  })

  it('carries a failing adapter request through as the reason', async () => {
    const result = await detectWebGPU({
      isSecureContext: true,
      navigator: {
        gpu: {
          requestAdapter: async () => {
            throw new Error('device lost at startup')
          },
        },
      },
    })

    expect(result.ok === false && result.reason).toMatch(/device lost at startup/)
  })

  it('survives a host with no navigator, rather than throwing on the way to the notice', async () => {
    const result = await detectWebGPU({})

    expect(result.ok).toBe(false)
  })
})
