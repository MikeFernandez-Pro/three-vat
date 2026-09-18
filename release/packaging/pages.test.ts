// The landing page's list, which is derived from the demo HTML files rather
// than maintained by hand — adding a page must never mean editing a list.
import { describe, expect, it } from 'vitest'
import { listPages } from '../../examples/src/pages.js'

const WEBGL = `<!doctype html><html><head>
  <title>three-vat — WebGL robot crowd</title>
  <meta name="description" content="340 robots, one draw call per material, on the GLSL decode path." />
</head></html>`

const WEBGPU = `<!doctype html><html><head>
  <title>three-vat — WebGPU robot crowd</title>
  <meta name="description" content="The same crowd on the TSL decode path." />
</head></html>`

const LANDING = `<!doctype html><html><head><title>three-vat — examples</title></head></html>`

describe('listPages', () => {
  it('turns globbed HTML files into linkable demos', () => {
    const pages = listPages({ '/webgl_crowd.html': WEBGL })

    expect(pages).toEqual([
      {
        href: 'webgl_crowd.html',
        renderer: 'WebGL',
        title: 'robot crowd',
        summary: '340 robots, one draw call per material, on the GLSL decode path.',
      },
    ])
  })

  it('leaves the landing page itself out of its own list', () => {
    const pages = listPages({ '/index.html': LANDING, '/webgl_crowd.html': WEBGL })

    expect(pages.map((p) => p.href)).toEqual(['webgl_crowd.html'])
  })

  it('orders pages by filename, so a renderer keeps its place as demos are added', () => {
    const pages = listPages({ '/webgpu_crowd.html': WEBGPU, '/webgl_crowd.html': WEBGL })

    expect(pages.map((p) => p.href)).toEqual(['webgl_crowd.html', 'webgpu_crowd.html'])
  })

  it('reads the renderer from the filename prefix, the way three.js keys its gallery', () => {
    const pages = listPages({ '/webgpu_crowd.html': WEBGPU })

    expect(pages[0]).toMatchObject({ renderer: 'WebGPU', title: 'robot crowd' })
  })

  it('falls back to the filename when a page has no title of its own', () => {
    const pages = listPages({ '/webgl_shadows.html': '<!doctype html><html></html>' })

    expect(pages[0]).toMatchObject({ renderer: 'WebGL', title: 'shadows', summary: '' })
  })
})
