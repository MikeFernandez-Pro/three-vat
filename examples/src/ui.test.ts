// The ui panel's markup is a contract, not a look: the hero capture finds the
// crowd page's count control by its label and drags the range input inside it
// (release/hero/capture.mjs), and the source panel has to open on the scene
// rather than on the code. Both are pinned here, off the pure functions the
// panel builds its DOM from — the look is checked by eye.
import { describe, expect, it } from 'vitest'
import { GITHUB_BLOB, controlMarkup, groupMarkup, panelMarkup, sourcePanelMarkup } from './ui.js'

/** The one `<label class="ui-control">` a control renders as, with what is inside it. */
function parts(html: string) {
  return {
    root: /^<(\w+) class="ui-control" data-kind="([^"]+)">/.exec(html),
    label: /<span class="ui-label">([^<]*)<\/span>/.exec(html)?.[1],
  }
}

describe('a control is its label, then the input it names', () => {
  it('renders a slider as a label wrapping a range input and its value', () => {
    const html = controlMarkup({ kind: 'slider', label: 'count', min: 1, max: 500, step: 1, value: 1 })
    const { root, label } = parts(html)

    expect(root?.[1]).toBe('label')
    expect(root?.[2]).toBe('slider')
    expect(label).toBe('count')
    expect(html).toMatch(/<input type="range" min="1" max="500" step="1" value="1"/)
    expect(html).toMatch(/<output class="ui-value">1<\/output>/)
    // The label comes first: it is what a visitor reads, and what the capture
    // finds the control by.
    expect(html.indexOf('ui-label')).toBeLessThan(html.indexOf('type="range"'))
  })

  it('renders a toggle as a label wrapping a switch', () => {
    const on = controlMarkup({ kind: 'toggle', label: 'move', value: true })
    const off = controlMarkup({ kind: 'toggle', label: 'move', value: false })

    expect(parts(on).root?.[2]).toBe('toggle')
    expect(parts(on).label).toBe('move')
    expect(on).toMatch(/<input type="checkbox" role="switch" checked/)
    expect(off).not.toContain('checked')
  })

  it('renders a select with its options, the current one selected', () => {
    const html = controlMarkup({
      kind: 'select',
      label: 'encoding',
      options: [
        ['rig', 'rig'],
        ['delta', 'vertex'],
      ],
      value: 'delta',
    })

    expect(parts(html).root?.[2]).toBe('select')
    expect(parts(html).label).toBe('encoding')
    expect(html).toContain('<option value="rig">rig</option>')
    expect(html).toContain('<option value="delta" selected>vertex</option>')
  })

  it('renders a colour as a label wrapping a colour input, as six hex digits', () => {
    const html = controlMarkup({ kind: 'color', label: 'sky', value: 0x0a7f3c })

    expect(parts(html).root?.[1]).toBe('label')
    expect(parts(html).root?.[2]).toBe('color')
    expect(parts(html).label).toBe('sky')
    // Padded: an input of type colour takes `#rrggbb` and nothing shorter.
    expect(html).toContain('<input type="color" value="#0a7f3c" />')
    expect(controlMarkup({ kind: 'color', label: 'ink', value: 0 })).toContain('value="#000000"')
  })

  it('renders a button as a button carrying its label', () => {
    const html = controlMarkup({ kind: 'button', label: 'spawn' })

    expect(/^<div class="ui-control" data-kind="button">/.test(html)).toBe(true)
    expect(html).toContain('<button type="button" class="ui-button">spawn</button>')
  })

  it('escapes what it is handed', () => {
    const html = controlMarkup({ kind: 'toggle', label: '<b>&', value: false })

    expect(parts(html).label).toBe('&lt;b&gt;&amp;')
  })
})

describe('the panel', () => {
  it('is one addressable root, with a collapse button for narrow screens', () => {
    const html = panelMarkup()

    expect(html).toMatch(/^<div id="ui-panel" class="ui-panel"/)
    expect(html).toMatch(/<button type="button" class="ui-collapse" aria-expanded="false" aria-controls="ui-body">/)
    expect(html).toContain('id="ui-body"')
  })
})

describe('a group', () => {
  it('is a fieldset named by its legend, with a body its controls go in', () => {
    // The drop page's clip boxes: rebuilt for every asset, found by the clip's
    // name as any other control is (release/drop/check.mjs).
    const html = groupMarkup('clips')

    expect(html).toMatch(/^<fieldset class="ui-group"><legend class="ui-label">clips<\/legend>/)
    expect(html).toContain('<div class="ui-group-body"></div>')
  })

  it('escapes its legend', () => {
    expect(groupMarkup('a & b')).toContain('<legend class="ui-label">a &amp; b</legend>')
  })
})

describe('the source panel', () => {
  const html = sourcePanelMarkup({ code: 'const a = 1 < 2 && "b";\n', path: 'examples/src/webgl_crowd.ts' })

  it('starts hidden, so the scene is what a visitor meets first', () => {
    expect(html).toMatch(/^<aside id="source" class="ui-source" hidden /)
  })

  it('shows the code it is handed, verbatim and escaped', () => {
    expect(html).toContain('<code>const a = 1 &lt; 2 &amp;&amp; &quot;b&quot;;\n</code>')
  })

  it('links to the file on GitHub in its header', () => {
    const header = /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? ''

    expect(header).toContain(`href="${GITHUB_BLOB}examples/src/webgl_crowd.ts"`)
    expect(header).toContain('examples/src/webgl_crowd.ts')
  })
})
