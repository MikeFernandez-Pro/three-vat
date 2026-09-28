// The canvas and the page around it are one off-white only while the scene's
// backdrop and the theme's agree, and they are two files kept in step by hand.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { palette } from './palette.js'

describe('the studio', () => {
  it("paints the scene's backdrop in the theme's --studio", () => {
    const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8')
    const studio = /--studio:\s*#([0-9a-f]{6})\s*;/i.exec(css)?.[1]

    expect(studio, 'theme.css declares no --studio').toBeDefined()
    expect(palette.studio.toString(16).padStart(6, '0')).toBe(studio!.toLowerCase())
  })
})
