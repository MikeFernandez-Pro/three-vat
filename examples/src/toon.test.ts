// The twisted crowd's toon material takes three.js's own gradient maps, three
// tones or five, and has to sample them texel by texel: a filtered or
// mipmapped gradient blurs its bands back into a smooth ramp. The choice, the
// files and the settings are held here, against a real three.js texture.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { LinearFilter, LinearMipmapLinearFilter, NearestFilter, Texture } from 'three'
import { describe, expect, it } from 'vitest'
import { GRADIENTS, crispGradient, gradientFile } from './toon.js'

describe('the gradient choice', () => {
  it('offers three tones and five, three first', () => {
    expect(GRADIENTS.map(([tones]) => tones)).toEqual(['three', 'five'])
  })

  it("names three.js's own gradient maps, copied into the public assets", () => {
    expect(gradientFile('three')).toBe('threeTone.jpg')
    expect(gradientFile('five')).toBe('fiveTone.jpg')
    for (const [tones] of GRADIENTS) {
      expect(existsSync(fileURLToPath(new URL(`../public/${gradientFile(tones)}`, import.meta.url))), tones).toBe(true)
    }
  })
})

describe('crispGradient', () => {
  it('samples the nearest texel both ways, with no mipmaps, so the bands stay bands', () => {
    const texture = new Texture()
    // What three gives a texture by default, and what blurs a gradient.
    expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
    expect(texture.magFilter).toBe(LinearFilter)
    expect(texture.generateMipmaps).toBe(true)

    const crisp = crispGradient(texture, NearestFilter)

    expect(crisp).toBe(texture)
    expect(crisp.minFilter).toBe(NearestFilter)
    expect(crisp.magFilter).toBe(NearestFilter)
    expect(crisp.generateMipmaps).toBe(false)
  })
})
