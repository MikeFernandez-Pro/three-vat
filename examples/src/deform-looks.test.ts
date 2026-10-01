// The twisted crowd's colour presets: three for the crowd and three for the
// hemisphere light, the current look first, so the page opens as it did.
import { describe, expect, it } from 'vitest'
import { CROWD_COLOURS, SKY_COLOURS, pickerValue, presetChoices } from './deform-looks.js'
import { palette } from './palette.js'

describe('the crowd colours', () => {
  it('offers three, the studio character first', () => {
    expect(CROWD_COLOURS.map((p) => p.value)).toEqual(['clay', 'teal', 'sage'])
    expect(CROWD_COLOURS[0]!.colour).toBe(palette.character)
  })

  it('never offers the accent, which is the cube', () => {
    for (const preset of CROWD_COLOURS) expect(preset.colour, preset.value).not.toBe(palette.accent)
  })
})

describe('the hemisphere colours', () => {
  it('offers three, the studio sky and ground first', () => {
    expect(SKY_COLOURS.map((p) => p.value)).toEqual(['studio', 'golden', 'dusk'])
    expect(SKY_COLOURS[0]).toMatchObject({ sky: palette.fill, ground: palette.floor })
  })
})

describe('a preset on the panel', () => {
  it('is a [value, text] pair, in order', () => {
    expect(presetChoices(CROWD_COLOURS)).toEqual([
      ['clay', 'clay'],
      ['teal', 'deep teal'],
      ['sage', 'sage'],
    ])
  })

  it('sets a picker in the picker\'s own spelling, leading zeros kept', () => {
    expect(pickerValue(0x2f6f73)).toBe('#2f6f73')
    expect(pickerValue(0x00000a)).toBe('#00000a')
  })
})
