// The encodings as the pages name them: the two `bakeVAT` stores, under the
// glossary's words, with `bakeVAT`'s literals behind them.
import { describe, expect, it } from 'vitest'
import { ENCODING_CHOICES, ENCODING_NAMES } from './params.js'

describe('the encoding toggle', () => {
  it('offers exactly the two encodings `bakeVAT` takes, under the glossary names', () => {
    expect(ENCODING_CHOICES).toEqual({ vertex: 'delta', rig: 'rig' })
  })

  it('names every encoding the HUD can print, and no third', () => {
    expect(Object.keys(ENCODING_NAMES).sort()).toEqual(['delta', 'rig'])
  })
})
