// The studio's two looks, as the scene sees them: the palette a page reads is
// the one its look names, settled once as the module loads, from the mark the
// look script leaves on <html> before any module runs (examples/look.mjs).
import { afterEach, describe, expect, it, vi } from 'vitest'

/** The palette module, loaded fresh on a page whose <html> carries `look`, or with no document at all. */
async function paletteOn(look?: string) {
  vi.resetModules()
  if (look !== undefined) vi.stubGlobal('document', { documentElement: { dataset: { look } } })
  return import('./palette.js')
}

afterEach(() => vi.unstubAllGlobals())

describe('the look a page opens in', () => {
  it('is light with no document, so a test or a bake under Node reads the light palette', async () => {
    const { look, palette } = await paletteOn()
    expect(look).toBe('light')
    expect(palette.floor).toBe(0xebe8e1)
  })

  it('is light on a page marked light, or marked with anything else', async () => {
    expect((await paletteOn('light')).look).toBe('light')
    expect((await paletteOn('sepia')).look).toBe('light')
  })

  it('is dark on a page marked dark', async () => {
    expect((await paletteOn('dark')).look).toBe('dark')
  })
})

describe('the dark look', () => {
  it('lifts the floor and keeps the lights, so the lit floor still reads against a dark backdrop', async () => {
    const light = (await paletteOn('light')).palette
    const dark = (await paletteOn('dark')).palette
    expect(dark.floor).toBe(0x303030)
    expect(dark.key).toBe(light.key)
    expect(dark.fill).toBe(light.fill)
    expect(dark.accent).toBe(light.accent)
  })

  it('sets a prop out in each look its own colour: coral in the light, warm cream in the dark', async () => {
    expect((await paletteOn('light')).palette.prop).toBe(0xff6352)
    expect((await paletteOn('dark')).palette.prop).toBe(0xffeccc)
  })

  it('keeps the Horse its own warm red', async () => {
    expect((await paletteOn('dark')).palette.body).toBe(0xff6666)
  })
})

describe('the characters', () => {
  it("in the light look: a blue Soldier with a grey visor, a yellow robot with brown details and grey eyes, a lilac Michelle", async () => {
    const { palette, partColour } = await paletteOn('light')
    expect(partColour('VanguardBodyMat')).toBe(0x67a5e0)
    expect(partColour('Vanguard_VisorMat')).toBe(0x595959)
    expect(partColour('Main')).toBe(0xfbc965)
    expect(partColour('Grey')).toBe(0x866a5b)
    expect(partColour('Black')).toBe(0x636363)
    expect(palette.michelle).toBe(0xd4a9fe)
    expect(partColour('SomeOtherAsset')).toBe(palette.character)
  })

  it('in the dark look: red bodies, a grey visor and eyes, sand details', async () => {
    const { palette, partColour } = await paletteOn('dark')
    expect(partColour('VanguardBodyMat')).toBe(0xff6666)
    expect(partColour('Main')).toBe(0xff6666)
    expect(palette.michelle).toBe(0xff6666)
    expect(partColour('Vanguard_VisorMat')).toBe(0x4f4f4f)
    expect(partColour('Black')).toBe(0x4f4f4f)
    expect(partColour('Grey')).toBe(0xeecaa0)
    expect(partColour('SomeOtherAsset')).toBe(palette.character)
  })
})

describe('a change of look on a running page', () => {
  it('takes the other set in place, repaints every part worn, and calls every repaint, once the mark moves', async () => {
    let observed: () => void = () => {}
    vi.stubGlobal('MutationObserver', class {
      constructor(callback: () => void) { observed = callback }
      observe() {}
    })
    const dataset = { look: 'light' }
    vi.stubGlobal('document', { documentElement: { dataset } })
    vi.resetModules()
    const module = await import('./palette.js')
    const { palette, onLook, wearPart, partColour } = module
    const seen: [number, string][] = []
    onLook((from) => seen.push([palette.floor, from]))
    let worn = 0
    wearPart({ name: 'Main', color: { setHex: (hex: number) => (worn = hex) } })
    expect(worn).toBe(0xfbc965)

    observed()
    expect(seen).toEqual([])

    dataset.look = 'dark'
    observed()
    expect(module.look).toBe('dark')
    expect(palette.floor).toBe(0x303030)
    expect(palette.body).toBe(0xff6666)
    expect(partColour('Main')).toBe(0xff6666)
    expect(worn).toBe(0xff6666)
    expect(seen).toEqual([[0x303030, 'light']])
  })
})
