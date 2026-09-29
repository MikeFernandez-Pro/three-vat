import { describe, expect, it } from 'vitest'
import { rendererFrom, withRenderer } from './renderer-choice'

describe('the renderer choice', () => {
  it('is WebGPU by default', () => {
    expect(rendererFrom('')).toBe('webgpu')
    expect(rendererFrom('?level=1')).toBe('webgpu')
  })

  it('is WebGL with ?renderer=webgl', () => {
    expect(rendererFrom('?renderer=webgl')).toBe('webgl')
  })

  it('is WebGPU with ?renderer=webgpu', () => {
    expect(rendererFrom('?renderer=webgpu')).toBe('webgpu')
  })

  it('falls back to the default on a value it does not know', () => {
    expect(rendererFrom('?renderer=canvas')).toBe('webgpu')
  })

  it('is written into a URL, keeping the rest of it', () => {
    expect(withRenderer('https://x.test/games/ho-ho-no/?a=1#top', 'webgl')).toBe(
      'https://x.test/games/ho-ho-no/?a=1&renderer=webgl#top',
    )
    expect(withRenderer('https://x.test/games/ho-ho-no/?renderer=webgl', 'webgpu')).toBe(
      'https://x.test/games/ho-ho-no/?renderer=webgpu',
    )
  })
})
