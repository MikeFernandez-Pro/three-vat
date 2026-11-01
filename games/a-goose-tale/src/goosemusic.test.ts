import { describe, expect, it } from 'vitest'
import { ALL_LAYERS, layersFor, makeTune } from './goosemusic'

describe('the music', () => {
  it('has the pad alone with no gosling and every layer with all of them', () => {
    expect(layersFor(0, 5)).toBe(0)
    expect(layersFor(5, 5)).toBe(ALL_LAYERS)
    expect(layersFor(0, 0)).toBe(0)
  })

  it('brings a layer in for each gosling found while there are layers enough, never one back out', () => {
    for (const of of [3, 4, 5, 6, 7]) {
      let was = -1
      for (let found = 0; found <= of; found++) {
        if (of <= ALL_LAYERS) expect(layersFor(found, of)).toBeGreaterThan(was)
        else expect(layersFor(found, of)).toBeGreaterThanOrEqual(was)
        was = layersFor(found, of)
      }
    }
  })

  it('makes a tune in range, a bar for each bar round the chords', () => {
    let seed = 1
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const tune = makeTune(random)
    expect(tune).toHaveLength(16)
    for (const note of tune.flat()) {
      expect(note.midi).toBeGreaterThanOrEqual(64)
      expect(note.midi).toBeLessThanOrEqual(81)
      expect(note.at).toBeGreaterThanOrEqual(0)
      expect(note.at).toBeLessThan(8)
    }
  })
})
