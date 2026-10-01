// The forge's markup and its start/stop are a contract, not a look: a page
// calls them around every bake it runs in the browser, and the icon has to be
// gone when the bake is, however it ended. Pinned here in Node, off the pure
// half the mounted forge is built from — the fill is checked by eye.
import { describe, expect, it } from 'vitest'
import { forgeControl, forgeMarkup } from './forge.js'

describe('the forge markup', () => {
  it('is one addressable root, hidden as built', () => {
    const html = forgeMarkup()

    expect(html).toMatch(/^<div id="forge" class="forge"[^>]* hidden>/)
  })

  it('announces itself to assistive technology while it shows', () => {
    expect(forgeMarkup()).toMatch(/role="status"/)
    expect(forgeMarkup()).toMatch(/aria-live="polite"/)
  })

  it('carries a texture of sixteen texels the stylesheet fills', () => {
    expect(forgeMarkup().match(/class="forge-texel"/g)).toHaveLength(16)
  })

  it('says what it is doing', () => {
    expect(forgeMarkup()).toContain('<span class="forge-label">baking<')
  })
})

describe('starting and stopping the forge', () => {
  /** A view that records what it was told. */
  function view() {
    const calls: string[] = []
    return { calls, show: () => void calls.push('show'), hide: () => void calls.push('hide') }
  }

  it('shows on start and hides on stop', () => {
    const v = view()
    const forge = forgeControl(v)

    forge.start()
    forge.stop()

    expect(v.calls).toEqual(['show', 'hide'])
  })

  it('stays up until the last of two overlapping bakes has stopped', () => {
    // A re-bake picked from the panel while another is under the forge must
    // not take the icon down when the first one ends.
    const v = view()
    const forge = forgeControl(v)

    forge.start()
    forge.start()
    forge.stop()
    expect(v.calls).toEqual(['show'])

    forge.stop()
    expect(v.calls).toEqual(['show', 'hide'])
  })

  it('ignores a stop with nothing running', () => {
    // A failed bake's cleanup may stop a forge it never started; the next bake
    // must still show it.
    const v = view()
    const forge = forgeControl(v)

    forge.stop()
    forge.start()

    expect(v.calls).toEqual(['show'])
  })
})
