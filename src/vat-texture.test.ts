import { FloatType, HalfFloatType } from 'three'
import { describe, expect, it } from 'vitest'
import { HALF_FLOAT_MAX, makeVATTexture } from './vat-texture.js'

// The one thing the builder's types cannot say. Its `data` parameter is
// narrowed to the two arrays a VAT layer is ever made of, so the normal
// texture's `Uint8Array` is a compile error (#29) — but the two it does accept
// are interchangeable to TypeScript, and pairing one with the other's `type`
// uploads a buffer read at the wrong width: four half-floats taken as two
// floats, or the reverse. That is a crowd rendering garbage rather than a call
// that failed, which is the failure this module exists to convert.
describe('makeVATTexture', () => {
  it('builds the position layer from half-floats', () => {
    const texture = makeVATTexture(new Uint16Array(4), 1, 1, HalfFloatType)

    expect(texture.type).toBe(HalfFloatType)
    expect(texture.image.data).toBeInstanceOf(Uint16Array)
  })

  it('builds the rig and playback layers from floats, which is the default', () => {
    const texture = makeVATTexture(new Float32Array(4), 1, 1)

    expect(texture.type).toBe(FloatType)
    expect(texture.image.data).toBeInstanceOf(Float32Array)
  })

  it('refuses a half-float buffer offered as floats — the stale-recipe case', () => {
    // A worker recipe written before #73 hands back the position buffer and
    // names no type, so the default applies. Half the rows would be read as
    // one, and the driver would upload it without complaint.
    expect(() => makeVATTexture(new Uint16Array(4), 1, 1)).toThrow(
      /FloatType texture is built from a Float32Array, not a Uint16Array/,
    )
  })

  it('refuses a float buffer offered as half-floats', () => {
    expect(() => makeVATTexture(new Float32Array(4), 1, 1, HalfFloatType)).toThrow(
      /HalfFloatType texture is built from a Uint16Array, not a Float32Array/,
    )
  })

  it('states half-float’s ceiling, which is the bake’s to enforce', () => {
    // Pinned here rather than left inline in the baker's check: it is a fact
    // about the format, and the error message quotes it (#73).
    expect(HALF_FLOAT_MAX).toBe(65504)
  })
})
