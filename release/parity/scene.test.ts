// The scene the gate renders is spelled once as data, and imports nothing — not
// three.js, not three-vat. That is the property that makes it safe to share
// between the two frame modules: a difference in camera, light or clock between
// the two renders would be indistinguishable from a decode divergence, and a
// scene file that reached into either library would be a place for one to
// creep in. Read as text rather than imported, because the claim is about the
// file's imports and not its values.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { here } from '../paths.js'
import { RIG_CASE } from './scene.js'

const source = readFileSync(here('parity/scene.ts'), 'utf8')

describe('the gate’s scene data', () => {
  it('imports nothing at all, three.js and three-vat included', () => {
    expect(source).not.toMatch(/^\s*import\b/m)
    expect(source).not.toMatch(/\brequire\s*\(/)
  })

  it('names the rig case’s clips once each, so the three instances play three clips', () => {
    expect(new Set(RIG_CASE.clips).size).toBe(RIG_CASE.clips.length)
    expect(RIG_CASE.clips.length).toBeGreaterThanOrEqual(3)
  })
})
