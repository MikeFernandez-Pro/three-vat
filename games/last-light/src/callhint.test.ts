import { describe, expect, it } from 'vitest'
import { callAt, callWord } from './callhint'

const box = { left: 0, top: 0, width: 800, height: 600 }

describe('callAt', () => {
  it('shows a call in view where the camera sees it', () => {
    expect(callAt({ x: 0.5, y: -0.5, z: 0.9 }, box, 50)).toEqual({ x: 600, y: 450 })
  })

  it('puts a call out of view on the edge on its side, margin in', () => {
    const at = callAt({ x: 4, y: 0, z: 0.9 }, box, 50)
    expect(at).toEqual({ x: 750, y: 300, out: { x: 1, y: -0 } })
  })

  it('keeps the direction to a call out past a corner', () => {
    const at = callAt({ x: -3, y: 3, z: 0.9 }, box, 50)
    // Toward (-1200, -900) px from the middle, 4:3, it meets the top edge first: 250 px up, so 333 px left.
    expect(at.y).toBeCloseTo(50)
    expect(at.x).toBeCloseTo(400 - (250 * 4) / 3)
    // The way to it, up and to the left on the page.
    expect(at.out!.x).toBeCloseTo(-0.8)
    expect(at.out!.y).toBeCloseTo(-0.6)
  })

  it('turns a call behind the camera round, onto the edge', () => {
    const at = callAt({ x: 0.1, y: 0, z: 1.2 }, box, 50)
    expect(at).toEqual({ x: 50, y: 300, out: { x: -1, y: 0 } })
  })
})

describe('callWord', () => {
  it('honks, louder far off', () => {
    expect(callWord(0)).toBe('honk!')
    expect(callWord(0.2)).toBe('honk!')
    expect(callWord(0.45)).toBe('honk!')
    expect(callWord(0.72)).toBe('honk!!')
    expect(callWord(1)).toBe('honk!!')
  })
})
