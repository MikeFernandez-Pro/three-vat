import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AnimationMixer, Matrix4, Vector3 } from 'three'
import type { AnimationClip, Mesh, Object3D, SkinnedMesh } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { bakeVAT } from './bake.js'
import { resolveVATFrame } from './instance-playback.js'
import { assetMissing, makeChainFixture, skinFromRigFrame } from './test-utils.js'
import type { RigVAT } from './types.js'

// A rig-encoded instance mid-crossfade, held to three's own `AnimationMixer`
// running `crossFadeTo` between the same two clips at the same moments (#128).
// The at-row oracle in bake.integration.test.ts proves each band alone; a blend
// between two bands is a second claim, and the one that tore: the decode
// blended each slot's root-space transform, so a limb that turns far between
// the clips swung about the model's origin rather than its own pivot.
//
// Each moment lands both bands on a row — the live clip `fb` rows in, the
// outgoing one `fa` — so the check is the blend alone, not the bake's rows
// against the clip's keys between them, which the at-row oracle already holds.

const SOLDIER = 'test-assets/Soldier.glb'

// The skull (DecemberChallenge's skeleton minion, walk into death) is the
// game's (#127), and neither fetched nor committed yet: its licence is to
// arrive with the game's own copy (#130). Until then it is checked where it is
// present and skipped where it is not — on CI too, which `assetMissing` would
// refuse — and #130 points this at the committed copy.
const SKULL = 'test-assets/skull.glb'

async function loadGLTF(path: string) {
  ;(globalThis as { self?: unknown }).self = globalThis
  const buf = readFileSync(path)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return await new Promise<any>((res, rej) => new GLTFLoader().parse(ab, '', res, rej))
}

/** The outgoing clip's weight at each moment: the mixer's `1 - t / duration`. */
const WEIGHTS = [0.75, 0.5, 0.25]
/** Seconds the crossfade runs over, on both sides. */
const FADE = 0.4

interface Case {
  from: string
  to: string
  /** Rows into each band the moments land on. */
  rows: [from: number, to: number][]
}

/**
 * Every `stride`-th vertex of every skinned mesh in `root`, where the mixer
 * last left it, in root space, with its index in the bake's merged vertex set —
 * the meshes merge in traversal order, and every case here is one material a
 * mesh, so the merge keeps each mesh's vertices whole and in order.
 */
function posed(root: Object3D, stride: number, visit: (v: number, expected: Vector3) => void) {
  root.updateMatrixWorld(true)
  const rootInverse = root.matrixWorld.clone().invert()
  const toRoot = new Matrix4()
  const expected = new Vector3()
  let start = 0
  root.traverse((o) => {
    if (!(o as Mesh).isMesh) return
    const mesh = o as SkinnedMesh
    const count = mesh.geometry.attributes.position!.count
    toRoot.multiplyMatrices(rootInverse, mesh.matrixWorld)
    for (let v = 0; v < count; v += stride) {
      expected.fromBufferAttribute(mesh.geometry.attributes.position!, v)
      mesh.applyBoneTransform(v, expected)
      visit(start + v, expected.applyMatrix4(toRoot))
    }
    start += count
  })
}

/** A fresh copy of an asset, each call: one to bake, and one for the mixer to pose. */
type Asset = () => Promise<{ scene: Object3D; animations: AnimationClip[] }>

const gltfAt = (path: string): Asset => () => loadGLTF(path)

async function expectCrossfadesAsMixer(asset: Asset, cases: Case[], stride: number) {
  const baked = await asset()
  const names = [...new Set(cases.flatMap((c) => [c.from, c.to]))]
  const clips = baked.animations.filter((c: AnimationClip) => names.includes(c.name))
  const vat = bakeVAT(baked.scene, clips, { fps: 30, encoding: 'rig' }) as RigVAT
  expect(vat.encoding).toBe('rig')

  const oracle = await asset()
  const mixer = new AnimationMixer(oracle.scene)
  const clipNamed = (name: string) => oracle.animations.find((c: AnimationClip) => c.name === name)!
  const bandNamed = (name: string) => vat.clips.find((c) => c.name === name)!

  for (const { from, to, rows } of cases) {
    const a = bandNamed(from)
    const b = bandNamed(to)
    for (const [fa, fb] of rows) {
      for (const weight of WEIGHTS) {
        // The VAT: an instance `fb` rows into `to`, blending out of `from`
        // `fa` rows in, `1 - weight` of the way through its crossfade.
        // A microsecond past each row, so rounding in the clock cannot land a
        // row short, at a blend of rows too small to measure.
        const time = 10 + 1e-6
        const frame = resolveVATFrame(
          {
            clip: b,
            startTime: 10 - fb / b.fps,
            from: { clip: a, startTime: 10 - fa / a.fps },
            fadeDuration: FADE,
            fadeStart: 10 - (1 - weight) * FADE,
          },
          time,
        )
        expect(frame.row).toBe(b.startFrame + fb)
        expect(frame.mix).toBeCloseTo(0, 4)
        expect(frame.outgoing!.row).toBe(a.startFrame + fa)
        expect(frame.outgoing!.mix).toBeCloseTo(0, 4)
        expect(frame.outgoing!.weight).toBeCloseTo(weight, 4)

        // The mixer: both actions playing, `crossFadeTo` run that far, then
        // each set to the moment its row was baked at (the at-row oracle's
        // `f / frames × duration`) and applied again at the same weights.
        mixer.stopAllAction()
        const leaving = mixer.clipAction(clipNamed(from)).reset().play()
        const arriving = mixer.clipAction(clipNamed(to)).reset().play()
        leaving.crossFadeTo(arriving, FADE, false)
        mixer.update((1 - weight) * FADE)
        leaving.time = (fa / a.frames) * clipNamed(from).duration
        arriving.time = (fb / b.frames) * clipNamed(to).duration
        mixer.update(0)
        expect(leaving.getEffectiveWeight()).toBeCloseTo(weight, 6)
        expect(arriving.getEffectiveWeight()).toBeCloseTo(1 - weight, 6)

        // To the four decimals each band alone is held to: the blend adds
        // float32 texels composed down a chain up to a dozen slots deep, and still
        // lands within 2e-5 of the mixer on either asset.
        posed(oracle.scene, stride, (v, expected) => {
          const actual = skinFromRigFrame(vat, v, frame).position
          const at = `${from} row ${fa} into ${to} row ${fb}, outgoing weight ${weight}, vertex ${v}`
          expect(actual.x, at).toBeCloseTo(expected.x, 4)
          expect(actual.y, at).toBeCloseTo(expected.y, 4)
          expect(actual.z, at).toBeCloseTo(expected.z, 4)
        })
      }
    }
  }
}

describe('a three-bone chain crossfading under the rig encoding', () => {
  it('poses as the mixer crossfading the same two clips, at every weight', async () => {
    // The fixture every checkout has: a leg under a turned carrier, kicking
    // into a sweep, every vertex split between two bones.
    const chain: Asset = async () => {
      const { root, clips } = makeChainFixture()
      return { scene: root, animations: clips }
    }
    await expectCrossfadesAsMixer(chain, [{ from: 'kick', to: 'sweep', rows: [[4, 20], [27, 9]] }], 1)
  })
})

describe.skipIf(assetMissing(SOLDIER))('Soldier crossfading under the rig encoding', () => {
  it('poses as the mixer crossfading the same two clips, at every weight', async () => {
    // Idle into Run turns the arms furthest; Walk into Run is the page's own.
    await expectCrossfadesAsMixer(
      gltfAt(SOLDIER),
      [
        { from: 'Idle', to: 'Run', rows: [[17, 9], [40, 3]] },
        { from: 'Walk', to: 'Run', rows: [[5, 14], [22, 0]] },
      ],
      97,
    )
  })
})

describe.skipIf(!existsSync(SKULL))('the skull crossfading under the rig encoding', () => {
  it('poses as the mixer crossfading from walk into death, at every weight', async () => {
    // The game's kill: a death that tips the whole body over as it begins.
    await expectCrossfadesAsMixer(gltfAt(SKULL), [{ from: 'walk', to: 'death', rows: [[8, 4], [30, 12], [44, 1]] }], 53)
  })
})
