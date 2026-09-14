import { DataUtils, FloatType, HalfFloatType } from 'three'
import { describe, expect, it } from 'vitest'
import { bakeVAT } from './bake.js'
import { loadVAT, serializeVAT } from './offline.js'
import { makeSkinnedFixture } from './test-utils.js'

function bakeFixture() {
  const { root, mesh, clip } = makeSkinnedFixture()
  return bakeVAT(root, mesh, [clip], { fps: 30 })
}

describe('serializeVAT / loadVAT', () => {
  it('float32 round-trips the texel data bit-for-bit (baker identity property)', () => {
    const vat = bakeFixture()
    const loaded = loadVAT(serializeVAT(vat, { precision: 'float32' }))

    expect(loaded.positionTexture.image.data).toEqual(vat.positionTexture.image.data)
    expect(loaded.normalTexture.image.data).toEqual(vat.normalTexture.image.data)
  })

  it('float16 round-trips within half-float precision', () => {
    const vat = bakeFixture()
    const loaded = loadVAT(serializeVAT(vat, { precision: 'float16' }))

    const src = vat.positionTexture.image.data as Float32Array
    const out = loaded.positionTexture.image.data as Uint16Array
    expect(out).toBeInstanceOf(Uint16Array)
    for (let i = 0; i < src.length; i++) {
      expect(DataUtils.fromHalfFloat(out[i]!)).toBeCloseTo(src[i]!, 2)
    }
  })

  it('preserves the clip table, bounds, and dimensions in the manifest', () => {
    const vat = bakeFixture()
    const serialized = serializeVAT(vat, { precision: 'float16' })

    expect(serialized.manifest.version).toBe(1)
    expect(serialized.manifest.encoding).toBe('delta')
    expect(serialized.manifest.precision).toBe('float16')
    expect(serialized.manifest.clips).toEqual(vat.clips)

    const loaded = loadVAT(serialized)
    expect(loaded.vertexCount).toBe(vat.vertexCount)
    expect(loaded.totalFrames).toBe(vat.totalFrames)
    expect(loaded.bounds.min.toArray()).toEqual(vat.bounds.min.toArray())
    expect(loaded.bounds.max.toArray()).toEqual(vat.bounds.max.toArray())
  })

  it('uploads float16 as HalfFloatType and float32 as FloatType, keeping nearest filtering', () => {
    const vat = bakeFixture()

    const half = loadVAT(serializeVAT(vat, { precision: 'float16' }))
    expect(half.positionTexture.type).toBe(HalfFloatType)
    expect(half.positionTexture.magFilter).toBe(vat.positionTexture.magFilter)
    expect(half.positionTexture.generateMipmaps).toBe(false)

    const full = loadVAT(serializeVAT(vat, { precision: 'float32' }))
    expect(full.positionTexture.type).toBe(FloatType)
  })
})
