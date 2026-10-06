// A point track: where chosen vertices' centre is at every baked frame, held
// to the decode's own answer — the test suite's CPU decodes of either encoding,
// `decodeDeltaPosition` and `skinFromRig` — on fixtures that move.
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { bakeVAT } from './bake.js'
import {
  decodeDeltaPosition,
  makeChainFixture,
  makeManyVertexFixture,
  makeMorphFixture,
  makeSkinnedFixture,
  skinFromRig,
} from './test-utils.js'
import { trackVATPoints } from './track.js'
import type { VAT } from './types.js'

/** Point `p` of `points` at row `f`, read off the track as a caller would. */
const pointAt = (track: Float32Array, points: number, f: number, p: number) => new Vector3().fromArray(track, (f * points + p) * 3)

/** The centre of `vertices` at row `f`, from the decode the shader transcribes. */
function decodedCentre(vat: VAT, vertices: readonly number[], f: number): Vector3 {
  const sum = new Vector3()
  for (const v of vertices) sum.add(vat.encoding === 'rig' ? skinFromRig(vat, v, f).position : decodeDeltaPosition(vat, f, v))
  return sum.divideScalar(vertices.length)
}

function expectCloseTo(actual: Vector3, expected: Vector3): void {
  expect(actual.distanceTo(expected), `${actual.toArray()} against ${expected.toArray()}`).toBeLessThan(1e-5)
}

describe('trackVATPoints', () => {
  const bakes = {
    'a skinned vertex, vertex encoding': () => bakeVAT(makeSkinnedFixture().root, [makeSkinnedFixture().clip], { encoding: 'delta', fps: 30 }),
    'a skinned vertex, rig encoding': () => bakeVAT(makeSkinnedFixture().root, [makeSkinnedFixture().clip], { encoding: 'rig', fps: 30 }),
    'a morphed vertex, vertex encoding': () => bakeVAT(makeMorphFixture().root, [makeMorphFixture().clip], { encoding: 'delta', fps: 30 }),
  }
  for (const [name, bake] of Object.entries(bakes)) {
    it(`follows the decode at every frame: ${name}`, () => {
      const vat = bake()
      const track = trackVATPoints(vat, [[0]])
      expect(track.length).toBe(vat.totalFrames * 3)
      for (let f = 0; f < vat.totalFrames; f++) expectCloseTo(pointAt(track, 1, f, 0), decodedCentre(vat, [0], f))
      // It moves: a track of the rest pose would pass the rows where nothing has yet.
      expect(pointAt(track, 1, vat.totalFrames - 1, 0).distanceTo(pointAt(track, 1, 0, 0))).toBeGreaterThan(0.1)
    })
  }

  it('takes each point as the centre of its vertices, several points a frame, on either encoding', () => {
    const { root, clip } = makeManyVertexFixture()
    // The vertex encoding twice: a frame on one row, and spanning two rows of four (ADR-0030).
    for (const options of [{ encoding: 'delta', fps: 30 }, { encoding: 'delta', fps: 1, maxTextureSize: 4 }, { encoding: 'rig', fps: 30 }] as const) {
      const vat = bakeVAT(root, [clip], options)
      const count = vat.geometry.getAttribute('position').count
      const points = [[0, 1], [count - 1], [...Array(count).keys()]]
      const track = trackVATPoints(vat, points)
      for (let f = 0; f < vat.totalFrames; f++) {
        points.forEach((vertices, p) => expectCloseTo(pointAt(track, points.length, f, p), decodedCentre(vat, vertices, f)))
      }
    }
  })

  it('counts its rows as the clip table does, every clip a band', () => {
    const { root, clips } = makeChainFixture()
    for (const encoding of ['delta', 'rig'] as const) {
      const vat = bakeVAT(root, clips, { encoding, fps: 30 })
      expect(vat.clips.length).toBeGreaterThan(1)
      const track = trackVATPoints(vat, [[0], [3]])
      expect(track.length).toBe(vat.totalFrames * 2 * 3)
      for (const clip of vat.clips) {
        for (const row of [clip.startFrame, clip.startFrame + clip.frames - 1]) {
          expectCloseTo(pointAt(track, 2, row, 1), decodedCentre(vat, [3], row))
        }
      }
    }
  })

  it('refuses a point with no vertices, and a vertex the geometry does not have', () => {
    const { root, clip } = makeManyVertexFixture()
    const vat = bakeVAT(root, [clip], { encoding: 'delta', fps: 30 })
    const count = vat.geometry.getAttribute('position').count
    expect(() => trackVATPoints(vat, [[]])).toThrow(/no vertices/)
    expect(() => trackVATPoints(vat, [[count]])).toThrow(new RegExp(`vertex ${count}`))
    expect(() => trackVATPoints(vat, [[-1]])).toThrow(/vertex -1/)
  })
})
