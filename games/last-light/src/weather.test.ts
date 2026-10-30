// The flash a lightning strike throws over the scene.
import { describe, expect, it } from 'vitest'
import { FLASH, flashAt } from './weather'

describe('the flash', () => {
  it('is nothing before a strike, full on it, flickers once more, and is gone after a moment', () => {
    expect(flashAt(-0.01)).toBe(0)
    expect(flashAt(0)).toBeCloseTo(1, 5)
    expect(flashAt(FLASH)).toBe(0)
    expect(flashAt(FLASH + 1)).toBe(0)
    // The second flicker: down, then up again.
    const samples = Array.from({ length: 40 }, (_, k) => flashAt((k / 40) * FLASH))
    const rises = samples.filter((f, k) => k > 0 && f > samples[k - 1]! + 1e-6)
    expect(rises.length).toBeGreaterThan(0)
    for (const f of samples) expect(f).toBeLessThanOrEqual(1)
  })
})
