// Which renderer the game runs on (ADR-0038): WebGPURenderer by default — which
// falls back to its own WebGL 2 backend where there is no WebGPU — and
// WebGLRenderer when the URL asks for it. The start screen's toggle writes the
// same parameter, so a link carries the choice either way.

export type RendererKind = 'webgpu' | 'webgl'

const PARAMETER = 'renderer'
const DEFAULT: RendererKind = 'webgpu'

/** The renderer a URL's query string asks for. */
export function rendererFrom(search: string): RendererKind {
  const asked = new URLSearchParams(search).get(PARAMETER)
  return asked === 'webgl' || asked === 'webgpu' ? asked : DEFAULT
}

/** `url`, asking for `kind`. */
export function withRenderer(url: string, kind: RendererKind): string {
  const next = new URL(url)
  next.searchParams.set(PARAMETER, kind)
  return next.href
}
