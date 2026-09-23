import { describe, expect, it } from 'vitest'
import { decodeOctahedral, encodeOctahedral } from './octahedral.js'

// The one seam CI can hold on its own (#29). Two shader decodes and one CPU
// encoder have to agree about what two bytes mean, and the only proof the two
// *shaders* agree is the parity gate — manual, and GPU-only. So the arithmetic
// itself is pinned here, in the language both shaders are transcribed from,
// and the gate is left catching transcription slips rather than design errors.

/**
 * A sphere sampled evenly, deterministically: the Fibonacci lattice, which
 * spaces points by the golden angle and so lands nothing on the axes or the
 * fold and nothing twice. Random directions would move the worst case from run
 * to run, which is the one property a bound on the worst case must not have.
 */
function sphere(count: number): [number, number, number][] {
  const points: [number, number, number][] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const z = 1 - (2 * i + 1) / count
    const r = Math.sqrt(Math.max(0, 1 - z * z))
    const theta = golden * i
    points.push([Math.cos(theta) * r, Math.sin(theta) * r, z])
  }
  return points
}

/** Degrees between two unit vectors. */
function angleBetween(a: [number, number, number], b: { x: number; y: number; z: number }): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b.x + a[1] * b.y + a[2] * b.z))
  return (Math.acos(dot) * 180) / Math.PI
}

/** Round-trip one direction through the two bytes a texel would hold. */
function roundTrip(n: [number, number, number]) {
  const texel = new Uint8Array(2)
  encodeOctahedral(n[0], n[1], n[2], texel, 0)
  return decodeOctahedral(texel[0]!, texel[1]!)
}

describe('octahedral normals in two unsigned bytes', () => {
  it('round-trips every direction to under a degree', () => {
    // The bound the format was chosen against (#29, measured over both real
    // assets): ~0.95° worst case, ~0.32° mean. Stated as the *angular* error,
    // because that is what the encoding costs — a normal has no magnitude to
    // lose, and a tolerance in metres would mean nothing here.
    const directions = sphere(20000)

    let worst = 0
    let total = 0
    for (const n of directions) {
      const angle = angleBetween(n, roundTrip(n))
      worst = Math.max(worst, angle)
      total += angle
    }

    // Written as a literal here and as `NORMAL_DEGREES` in test-utils, and the
    // two are not the same statement: this is the *pin* on what the encoding
    // costs, and that is the tolerance every other normal assertion inherits
    // from it. A pin that imported its own tolerance would pin nothing.
    expect(worst).toBeLessThan(1)
    expect(total / directions.length).toBeLessThan(0.4)
  })

  it('decodes to a unit vector, whatever the two bytes hold', () => {
    // The shader mixes two decoded normals and renormalises the result, so a
    // single decode is the only place unit length is the decode's own job.
    // Every byte pair is reachable — the encoder does not produce all of them,
    // but a texture upload is not the only thing that can fill a texel.
    for (let u = 0; u <= 255; u += 17) {
      for (let v = 0; v <= 255; v += 17) {
        const n = decodeOctahedral(u, v)
        expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 6)
      }
    }
  })

  it('folds the far hemisphere rather than losing it', () => {
    // The whole of what octahedral buys over "store x and y, recover z": both
    // hemispheres are represented, so a normal facing away from +Z survives.
    //
    // Not asserted on the equator itself, and that is the encoding rather than
    // the test being lenient: a normal within the quantisation step of z = 0
    // can round to the other side of it, which is the same sub-degree error
    // the bound above already covers and is not a lost hemisphere.
    for (const n of sphere(2001)) {
      if (Math.abs(n[2]) < 0.02) continue
      expect(Math.sign(roundTrip(n).z)).toBe(Math.sign(n[2]))
    }
  })

  it('reads a direction, not a length — the encode divides its scale out', () => {
    // The baker normalises every normal it writes, so this is not relied on.
    // It is asserted because it is free: the encode's first step is a division
    // by the L1 norm, which makes the mapping scale-invariant, and a caller
    // who hands it an unnormalised direction gets the right answer rather than
    // a quietly wrong one.
    const n: [number, number, number] = [0.3, -0.5, 0.81]
    const scaled: [number, number, number] = [n[0] * 7.5, n[1] * 7.5, n[2] * 7.5]

    expect(roundTrip(scaled)).toEqual(roundTrip(n))
  })

  it('writes a degenerate normal as one that decodes, rather than as NaN', () => {
    // A zero-length normal has no direction to encode and the L1 division
    // cannot be taken. It is written as the texel +Z lands on, so a degenerate
    // vertex shades like a flat one instead of turning the mesh black.
    const texel = new Uint8Array(2)
    encodeOctahedral(0, 0, 0, texel, 0)

    const n = decodeOctahedral(texel[0]!, texel[1]!)
    expect(Number.isNaN(n.x + n.y + n.z)).toBe(false)
    expect(n.z).toBeGreaterThan(0.99)
  })

  it('writes two bytes at the offset it is given and touches nothing else', () => {
    // The baker writes straight into the texture's own buffer at
    // `(row * vertexCount + vertex) * 2`, so the offset is load-bearing.
    const data = new Uint8Array(6).fill(9)
    encodeOctahedral(0, 0, 1, data, 2)

    expect([...data.slice(0, 2)]).toEqual([9, 9])
    expect([...data.slice(4)]).toEqual([9, 9])
    expect(decodeOctahedral(data[2]!, data[3]!).z).toBeGreaterThan(0.99)
  })

  it('decodes into a caller’s vector when given one', () => {
    // The demo's texture panel decodes a whole layer to draw it; allocating a
    // vector per texel there is 800 000 objects for one strip.
    const out = { x: 0, y: 0, z: 0 }

    expect(decodeOctahedral(128, 128, out)).toBe(out)
    expect(out.z).toBeGreaterThan(0.99)
  })
})
