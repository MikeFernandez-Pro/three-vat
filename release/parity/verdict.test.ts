// The gate's verdict, on frames made of arithmetic rather than of pixels from a
// GPU. Running the real gate needs a browser, a WebGPU adapter and a robot;
// deciding what a set of frames *means* needs none of that, so it is decided
// here and pinned in CI.
//
// The cases below are the ones that would otherwise be discovered during a
// release: a harness that drew nothing, a readback that came back upside down,
// two backends that disagree about shading before any VAT is involved, and the
// one the gate is actually for.
import { describe, expect, it } from 'vitest'
import { flipRows, type PathFrames } from './compare.js'
import { judge } from './verdict.js'

const SIZE = { width: 16, height: 16 }
const PIXELS = SIZE.width * SIZE.height

/** A frame painted by `paint(x, y)` → grey level. */
function frame(paint: (x: number, y: number) => number): Uint8Array {
  const data = new Uint8Array(PIXELS * 4)
  for (let y = 0; y < SIZE.height; y++) {
    for (let x = 0; x < SIZE.width; x++) {
      const i = (y * SIZE.width + x) * 4
      data[i] = data[i + 1] = data[i + 2] = paint(x, y)
      data[i + 3] = 255
    }
  }
  return data
}

const BACKGROUND = 20
/** A "robot": a bright block whose left edge stands at `x0`. Moving it is a decode divergence. */
const robot = (x0: number, level = 200) => frame((x, y) => (x >= x0 && x < x0 + 6 && y >= 4 ? level : BACKGROUND))
const blank = () => frame(() => BACKGROUND)

/**
 * Both paths healthy: same room, same crowd, and two faults that genuinely show.
 * `slipped` moves the block — the geometric fault. `wrongNormals` leaves it
 * exactly where it is and changes only how bright it is — the shading-only
 * fault, which is the one a loose tolerance loses first.
 */
function healthy(): { webgl: PathFrames; tsl: PathFrames } {
  const room = robot(2)
  const path = (): PathFrames => ({ calibration: room, clean: robot(5), slipped: robot(9), wrongNormals: robot(5, 90), probe: robot(5, 140), sampleProbe: robot(5, 170) })
  return { webgl: path(), tsl: path() }
}

const check = (verdict: ReturnType<typeof judge>, name: string) => verdict.checks.find((c) => c.name.includes(name))!

describe('judge', () => {
  it('passes when both paths draw the same crowd and the deliberate bug is caught', () => {
    const verdict = judge(healthy(), SIZE)

    expect(verdict.checks.every((c) => c.pass)).toBe(true)
    expect(verdict.pass).toBe(true)
  })

  it('fails when the two paths decode to different pixels', () => {
    const frames = healthy()
    frames.tsl.clean = robot(7)

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'same pixels').pass).toBe(false)
  })

  it.each([
    ['slip', 'webgl', 'slipped'],
    ['slip', 'tsl', 'slipped'],
    ['wrong-normal decode', 'webgl', 'wrongNormals'],
    ['wrong-normal decode', 'tsl', 'wrongNormals'],
  ] as const)('fails when a deliberate %s on the %s path goes unnoticed', (_fault, path, frameName) => {
    // The proof the gate is armed: if a deliberate divergence does *not* fail
    // the comparison, the tolerance is too loose and a real one would pass too.
    const frames = healthy()
    frames[path][frameName] = frames[path].clean

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(verdict.checks.filter((c) => !c.pass)).toHaveLength(1)
  })

  it('measures each fault against its own path, so a failing parity check cannot prop it up', () => {
    // The trap this replaced: compare a fault on one path against the other
    // path's clean frame, and once the two paths disagree every self-test
    // reports that disagreement back as proof of its own sharpness. Here the
    // paths diverge wildly *and* the GLSL path decodes nothing — and the GLSL
    // self-tests say so anyway.
    const frames = healthy()
    frames.webgl.slipped = frames.webgl.clean
    frames.webgl.wrongNormals = frames.webgl.clean
    frames.tsl.clean = robot(12)

    const verdict = judge(frames, SIZE)

    expect(check(verdict, 'same pixels').pass).toBe(false)
    expect(check(verdict, 'slip on the GLSL path').pass).toBe(false)
    expect(check(verdict, 'wrong-normal decode on the GLSL path').pass).toBe(false)
    // The other path is still decoding, and is still judged on its own frames.
    expect(check(verdict, 'slip on the TSL path').pass).toBe(true)
  })

  it('catches a shading-only fault, which leaves the silhouette pixel-exact', () => {
    // The fault that matters: the block has not moved at all, only its shading
    // is wrong. A gate that only ever proves itself against moved geometry has
    // not proved it can see this.
    const frames = healthy()

    const shading = check(judge(frames, SIZE), 'wrong-normal decode on the GLSL path')

    expect(shading.pass).toBe(true)
    expect(shading.diff!.drawn).toBe(shading.diff!.differing)
  })

  it('fails on two blank frames rather than calling them a perfect match', () => {
    const empty = (): PathFrames => ({ calibration: blank(), clean: blank(), slipped: blank(), wrongNormals: blank(), probe: blank(), sampleProbe: blank() })
    const verdict = judge({ webgl: empty(), tsl: empty() }, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'drew something').pass).toBe(false)
  })

  it('names an upside-down readback as its own failure, not as a decode divergence', () => {
    const frames = healthy()
    frames.tsl.clean = flipRows(frames.tsl.clean, SIZE)

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'same way up').pass).toBe(false)
  })

  it('names an addressing divergence as its own failure, before the sampling is blamed', () => {
    // The probe carries the decode's inputs. If those differ, the two paths are
    // reading different texels and comparing what they made of them is premature.
    const frames = healthy()
    frames.tsl.probe = robot(11, 140)

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'same texel').pass).toBe(false)
    // The decode comparison is untouched and still reports for itself.
    expect(check(verdict, 'same pixels').pass).toBe(true)
  })

  it('separates a wrong texture row from a wrong texture column', () => {
    // The two probes carry the two halves of the texel coordinate. Each names
    // its own half, so a failure points at the arithmetic that produced it.
    const frames = healthy()
    frames.tsl.sampleProbe = robot(11, 170)

    const verdict = judge(frames, SIZE)

    expect(check(verdict, 'same texture row').pass).toBe(false)
    expect(check(verdict, 'same texel').pass).toBe(true)
  })

  it('names a backend shading difference as its own failure, before the decode is blamed', () => {
    const frames = healthy()
    frames.tsl.calibration = robot(8)

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'same room').pass).toBe(false)
    // The decode comparison itself is untouched, and says so.
    expect(check(verdict, 'same pixels').pass).toBe(true)
  })

  it('reports every check on every run, so a pass is readable as evidence', () => {
    expect(judge(healthy(), SIZE).checks).toHaveLength(10)
  })
})
