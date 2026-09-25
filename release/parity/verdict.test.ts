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
import { flipRows, type PathFrames, type RigCaseFrames } from './compare.js'
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
 * Both paths healthy: same room, same crowd, and three faults that genuinely
 * show. `slipped` moves the block — the geometric fault. `wrongNormals` leaves
 * it exactly where it is and changes only how bright it is — the shading-only
 * fault, which is the one a loose tolerance loses first. `wrongWeight` is the
 * crossfade's own: two right bands mixed at the wrong weight, which here is a
 * block that has neither moved nor changed brightness by as much as either of
 * the others.
 */
function healthy(): { webgl: PathFrames; tsl: PathFrames } {
  const room = robot(2)
  // `batched` is the same crowd through a different carrier and under one
  // material, so it is its own block rather than a copy of `clean` — and
  // `batchedReordered` is that block again, unmoved, because permuting the
  // draw order must not show.
  const batch = robot(5, 210)
  // The rig case is a second bake of a second asset (ADR-0018), so it is its
  // own block too, with its own slip — the one fault a rig can be handed,
  // having no normal texture to bend.
  const rig = (): RigCaseFrames => ({ clean: robot(3, 190), slipped: robot(7, 190) })
  // The spanned bake is the same crowd from the same texels in other places
  // (ADR-0030), so a healthy path draws `clean` again, pixel for pixel.
  const path = (): PathFrames => ({ calibration: room, clean: robot(5), spanned: robot(5), slipped: robot(9), wrongNormals: robot(5, 90), wrongWeight: robot(5, 160), probe: robot(5, 140), sampleProbe: robot(5, 170), batched: batch, batchedReordered: batch, rig: rig() })
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
    ['wrong crossfade weight', 'webgl', 'wrongWeight'],
    ['wrong crossfade weight', 'tsl', 'wrongWeight'],
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

  it('names the crossfade’s own fault apart from the other two, on the path it happened on', () => {
    // The check the mid-transition comparison rests on: a wrong blend weight is
    // neither a slip nor a bent normal, so it is named for itself — and named on
    // the path it was injected into, measured against that path's clean frame.
    const frames = healthy()
    frames.webgl.wrongWeight = frames.webgl.clean

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'wrong crossfade weight on the GLSL path').pass).toBe(false)
    expect(check(verdict, 'wrong crossfade weight on the TSL path').pass).toBe(true)
    // And the gate's own comparison is untouched, and says so.
    expect(check(verdict, 'same pixels').pass).toBe(true)
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
    const empty = (): PathFrames => ({ calibration: blank(), clean: blank(), spanned: blank(), slipped: blank(), wrongNormals: blank(), wrongWeight: blank(), probe: blank(), sampleProbe: blank(), batched: blank(), batchedReordered: blank(), rig: { clean: blank(), slipped: blank() } })
    const verdict = judge({ webgl: empty(), tsl: empty() }, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'drew something').pass).toBe(false)
  })

  it('fails when the rig-encoded crowd drew nothing on one path, however well the robot drew', () => {
    // The failure the console capture exists beside: a WGSL compile error draws
    // nothing, and two paths that agree about the robot say nothing about it.
    const frames = healthy()
    frames.tsl.rig.clean = blank()

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'drew something').pass).toBe(false)
    expect(check(verdict, 'drew something').detail).toContain('TSL rig')
  })

  it('fails when the two paths decode the rig-encoded crowd differently, and names the rig case', () => {
    // A second encoding is a second decode on each path (ADR-0018), so the two
    // agreeing on the robot's vertex bake says nothing about the rig bake.
    const frames = healthy()
    frames.tsl.rig.clean = robot(6, 190)

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'agree on a rig-encoded crowd').pass).toBe(false)
    // The robot's own comparison is untouched, and says so.
    expect(check(verdict, 'same pixels').pass).toBe(true)
  })

  it.each([
    ['webgl', 'rig-encoded GLSL crowd'],
    ['tsl', 'rig-encoded TSL crowd'],
  ] as const)('fails when a deliberate slip on the %s path’s rig-encoded crowd goes unnoticed', (path, name) => {
    // The rig case's own proof that the gate is armed for it: the slip is the
    // one fault a rig can be handed, and it is measured within the path.
    const frames = healthy()
    frames[path].rig.slipped = frames[path].rig.clean

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    const failed = verdict.checks.filter((c) => !c.pass)
    expect(failed).toHaveLength(1)
    expect(failed[0]!.name).toContain(name)
  })

  it('fails when a spanned bake drew nothing on one path', () => {
    const frames = healthy()
    frames.webgl.spanned = blank()

    const verdict = judge(frames, SIZE)

    expect(check(verdict, 'drew something').pass).toBe(false)
    expect(check(verdict, 'drew something').detail).toContain('GLSL spanned')
  })

  it.each([
    ['webgl', 'GLSL'],
    ['tsl', 'TSL'],
  ] as const)('fails when the %s path draws a spanned bake apart from its one-row twin, and names that path', (path, name) => {
    // The span's own fault: a column or a row read off the wrong stride moves
    // vertices, and it is measured within the path, against the frame the same
    // path drew from the one-row bake — so it is caught even where both paths
    // make the same mistake and agree with each other about it.
    const frames = healthy()
    frames.webgl.spanned = robot(8)
    if (path === 'tsl') [frames.webgl.spanned, frames.tsl.spanned] = [robot(5), robot(8)]

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, `the ${name} path draws a spanned bake as it draws the one-row bake`).pass).toBe(false)
    const other = name === 'GLSL' ? 'TSL' : 'GLSL'
    expect(check(verdict, `the ${other} path draws a spanned bake as it draws the one-row bake`).pass).toBe(true)
  })

  it('catches both paths misreading a spanned bake the same way, which cross-path parity cannot', () => {
    const frames = healthy()
    frames.webgl.spanned = robot(8)
    frames.tsl.spanned = robot(8)

    const verdict = judge(frames, SIZE)

    expect(check(verdict, 'agree on a crowd whose frames span rows').pass).toBe(true)
    expect(verdict.pass).toBe(false)
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

  it('fails when the two paths decode a batched crowd differently', () => {
    // The second carrier reaches the pack by a different route on each path, so
    // agreement on an `InstancedMesh` says nothing about agreement here.
    const frames = healthy()
    frames.tsl.batched = robot(7, 210)

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, 'agree on a BatchedMesh').pass).toBe(false)
    // The instanced comparison is untouched, and says so.
    expect(check(verdict, 'same pixels').pass).toBe(true)
  })

  it('fails when permuting a batch’s draw order changes what it draws', () => {
    // The stripe test: three instances, three clips, and a decode reading the
    // pack by the drawn slot rather than by the logical index shuffles them.
    // Named on the path it happened on, and never across paths — the two
    // frames compared differ in the permutation and in nothing else.
    const frames = healthy()
    frames.webgl.batchedReordered = robot(9, 210)

    const verdict = judge(frames, SIZE)

    expect(verdict.pass).toBe(false)
    expect(check(verdict, "GLSL path's batched crowd survives").pass).toBe(false)
    expect(check(verdict, "TSL path's batched crowd survives").pass).toBe(true)
  })

  it('reports every check on every run, so a pass is readable as evidence', () => {
    expect(judge(healthy(), SIZE).checks).toHaveLength(21)
  })
})
