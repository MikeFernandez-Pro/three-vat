// The forge's markup and its start/stop are a contract, not a look: a page
// calls them around every load and bake it runs in the browser, and the icon
// has to be gone when the work is, however it ended. Pinned here in Node, off
// the pure half the mounted forge is built from — the motion is checked by eye.
import { describe, expect, it } from 'vitest'
import { forgeControl, forgeMarkup, type ForgeKind } from './forge.js'

describe('the forge markup', () => {
  it('is one addressable root, hidden as built', () => {
    const html = forgeMarkup()

    expect(html).toMatch(/^<div id="forge" class="forge"[^>]* hidden>/)
  })

  it('announces itself to assistive technology while it shows', () => {
    expect(forgeMarkup()).toMatch(/role="status"/)
    expect(forgeMarkup()).toMatch(/aria-live="polite"/)
  })

  it('carries a row of four texels for a load and a texture of sixteen for a bake', () => {
    const html = forgeMarkup()
    const texels = (state: string) =>
      html.match(new RegExp(`class="forge-state forge-${state}">(.*?)</div>`))![1].match(/class="forge-texel"/g)

    expect(texels('loading')).toHaveLength(4)
    expect(texels('baking')).toHaveLength(16)
  })

  it('says what it is doing in each state', () => {
    expect(forgeMarkup()).toContain('<span class="forge-label">loading<')
    expect(forgeMarkup()).toContain('<span class="forge-label">baking<')
  })
})

describe('starting and stopping the forge', () => {
  /** A view that records what it was told. */
  function view() {
    const calls: string[] = []
    return {
      calls,
      show: (kind: ForgeKind) => void calls.push(`show ${kind}`),
      hide: () => void calls.push('hide'),
    }
  }

  it('shows on start and hides on stop', () => {
    const v = view()
    const forge = forgeControl(v)

    forge.start('baking')
    forge.stop('baking')

    expect(v.calls).toEqual(['show baking', 'hide'])
  })

  it('stays up until the last of two overlapping bakes has stopped', () => {
    // A re-bake picked from the panel while another is under the forge must
    // not take the icon down when the first one ends.
    const v = view()
    const forge = forgeControl(v)

    forge.start('baking')
    forge.start('baking')
    forge.stop('baking')
    expect(v.calls).toEqual(['show baking'])

    forge.stop('baking')
    expect(v.calls).toEqual(['show baking', 'hide'])
  })

  it('goes from loading to baking as a page hands its model to the bake', () => {
    const v = view()
    const forge = forgeControl(v)

    forge.start('loading')
    forge.stop('loading')
    forge.start('baking')

    expect(v.calls).toEqual(['show loading', 'hide', 'show baking'])
  })

  it('says baking while a bake runs, whatever is loading beside it', () => {
    const v = view()
    const forge = forgeControl(v)

    forge.start('baking')
    forge.start('loading')
    forge.stop('baking')
    forge.stop('loading')

    expect(v.calls).toEqual(['show baking', 'show loading', 'hide'])
  })

  it('ignores a stop with nothing running', () => {
    // A failed bake's cleanup may stop a forge it never started; the next bake
    // must still show it.
    const v = view()
    const forge = forgeControl(v)

    forge.stop('baking')
    forge.start('baking')

    expect(v.calls).toEqual(['show baking'])
  })
})
