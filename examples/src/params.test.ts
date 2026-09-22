// What the Soldier example's toggle offers, and where the page opens (ADR-0019).
// The swap itself is a mesh made visible and a HUD line rewritten, which is the
// browser's to show; what can be held here is that the choices the toggle
// hands `bakeVAT` are the two encodings there are, named as the glossary names
// them, and that the page opens as the demo does — on one character — on the
// encoding it exists to show.
import { describe, expect, it } from 'vitest'
import { ENCODING_CHOICES, ENCODING_NAMES, createDemoParams, createSoldierParams } from './params.js'

describe('the encoding toggle', () => {
  it('offers exactly the two encodings `bakeVAT` takes, under the glossary names', () => {
    expect(ENCODING_CHOICES).toEqual({ vertex: 'delta', rig: 'rig' })
  })

  it('names every encoding the HUD can print, and no third', () => {
    expect(Object.keys(ENCODING_NAMES).sort()).toEqual(['delta', 'rig'])
  })
})

describe('the Soldier example opens', () => {
  it('on the rig encoding — the feature the page is for', () => {
    expect(createSoldierParams().encoding).toBe('rig')
  })

  it('on one soldier, with the demo defaults otherwise, so the two pages compare', () => {
    const { encoding: _encoding, ...rest } = createSoldierParams()
    expect(rest.count).toBe(1)
    expect(rest).toEqual(createDemoParams())
  })
})
