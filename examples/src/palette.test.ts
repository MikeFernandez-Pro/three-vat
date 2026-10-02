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

  it("paints the characters its own way: a warm red body, a grey visor and eyes, sand details", async () => {
    const { palette, partColour } = await paletteOn('dark')
    expect(palette.body).toBe(0xff6666)
    expect(partColour('VanguardBodyMat')).toBe(0xff6666)
    expect(partColour('Main')).toBe(0xff6666)
    expect(partColour('Vanguard_VisorMat')).toBe(0x4f4f4f)
    expect(partColour('Black')).toBe(0x4f4f4f)
    expect(partColour('Grey')).toBe(0xeecaa0)
    expect(partColour('SomeOtherAsset')).toBe(palette.character)
  })
})

describe('the light look', () => {
  it("paints the characters warm cream, Soldier's visor pale, the robot's eyes the dark look's grey, its details terracotta", async () => {
    const { palette, partColour } = await paletteOn('light')
    expect(palette.body).toBe(0xffeecc)
    expect(partColour('VanguardBodyMat')).toBe(0xffeecc)
    expect(partColour('Main')).toBe(0xffeecc)
    expect(partColour('Vanguard_VisorMat')).toBe(0xfff8d6)
    expect(partColour('Black')).toBe(0x4f4f4f)
    expect(partColour('Grey')).toBe(0xdd9f7e)
  })
})
