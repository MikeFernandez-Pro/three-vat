import { describe, expect, it } from 'vitest'
import { assetMissing } from './test-utils.js'

describe('assetMissing', () => {
  const present = 'package.json'
  const absent = 'test-assets/definitely-not-here.glb'

  it('is false for an asset that is there, CI or not', () => {
    expect(assetMissing(present, {})).toBe(false)
    expect(assetMissing(present, { CI: 'true' })).toBe(false)
  })

  it('skips a missing asset off CI', () => {
    expect(assetMissing(absent, {})).toBe(true)
  })

  it('throws for a missing asset on CI, naming the fetch script', () => {
    expect(() => assetMissing(absent, { CI: 'true' })).toThrow(/fetch:test-assets/)
    expect(() => assetMissing(absent, { CI: 'true' })).toThrow(/definitely-not-here/)
  })
})
