// A crowd's shadows cast from a coarser level, on WebGL (ADR-0066): every
// instance finer than the shadow level is moved to it around each shadow draw,
// ahead of the batch's own `onBeforeShadow`, which builds the list the shadow
// draws, and put back after the draw on the id it had.
import { BatchedMesh, MeshStandardMaterial } from 'three'
import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { composeVATAtlas } from './atlas.js'
import { bakeVAT } from './bake.js'
import { createVATPlaybackTexture, setVATInstance } from './instance-playback.js'
import { createVATLODs } from './lod.js'
import { makeChainFixture, makeFixtureCrowd, makeMultiMaterialFixture, makeRigVATFixture } from './test-utils.js'
import type { RigVAT } from './types.js'
import { castVATShadowsFrom, createVATUniforms, patchVATMaterial } from './webgl.js'

/** Two triangles, then one: the levels below the full detail. */
const HALF = [0, 1, 2, 2, 1, 0]
const THIRD = [0, 1, 2]

/** A batch holding every level, ids as `addGeometry` gave them, and an instance on each geometry named. */
function crowdOf(levels: BufferGeometry[][], on: readonly [l: number, k: number][]) {
  const geometries = levels.flat()
  const crowd = new BatchedMesh(
    on.length,
    geometries.reduce((n, g) => n + g.getAttribute('position').count, 0),
    geometries.reduce((n, g) => n + g.getIndex()!.count, 0),
    new MeshStandardMaterial(),
  )
  let next = 0
  const ids = levels.map((level) => level.map(() => crowd.addGeometry(geometries[next++]!)))
  for (const [l, k] of on) crowd.addInstance(ids[l]![k]!)
  return { crowd, ids }
}
const rigCrowd = (on: readonly number[]) => {
  const vat = makeRigVATFixture()
  const lods = createVATLODs(vat, [HALF, THIRD])
  return { vat, lods, ...crowdOf(lods.levels, on.map((l) => [l, 0])) }
}
const idsOf = (crowd: BatchedMesh) => Array.from({ length: crowd.instanceCount }, (_, i) => crowd.getGeometryIdAt(i))

/** One shadow draw, as three's shadow map makes it: `onBeforeShadow`, the draw, `onAfterShadow`, the renderer first. */
function shadowDraw(crowd: BatchedMesh, renderer: object = {}) {
  const rest = [null, null, null, null, null, null] as never[]
  crowd.onBeforeShadow(renderer as never, ...(rest as [never, never, never, never, never, never]))
  crowd.onAfterShadow(renderer as never, ...(rest as [never, never, never, never, never, never]))
}
/** The crowd's own hooks, which a shadow draw with no camera cannot run: what each sees of the ids. */
function seenByOwnHooks(crowd: BatchedMesh) {
  const seen: { before: number[][]; after: number[][] } = { before: [], after: [] }
  crowd.onBeforeShadow = () => { seen.before.push(idsOf(crowd)) }
  crowd.onAfterShadow = () => { seen.after.push(idsOf(crowd)) }
  return seen
}

describe('castVATShadowsFrom on WebGL (ADR-0066)', () => {
  it('moves every instance finer than the shadow level to it for the shadow draw, and puts each back after', () => {
    const { crowd, ids } = rigCrowd([0, 1, 2])
    castVATShadowsFrom(crowd, { ids, level: 1 })
    const seen = seenByOwnHooks(crowd)

    shadowDraw(crowd)

    // The batch's own hook builds the shadow's list: it sees the swap. Its after hook still does.
    expect(seen.before).toEqual([[ids[1]![0], ids[1]![0], ids[2]![0]]])
    expect(seen.after).toEqual([[ids[1]![0], ids[1]![0], ids[2]![0]]])
    expect(idsOf(crowd)).toEqual([ids[0]![0], ids[1]![0], ids[2]![0]])
  })

  it('keeps each atlas instance on its own character', () => {
    const chain = makeChainFixture()
    const quad = makeMultiMaterialFixture({ skinned: true })
    const atlas = composeVATAtlas([
      bakeVAT(chain.root, chain.clips, { encoding: 'rig' }) as RigVAT,
      bakeVAT(quad.root, [quad.clip], { encoding: 'rig' }) as RigVAT,
    ])
    const { levels } = createVATLODs(atlas.vat, [[THIRD, null]])
    const { crowd, ids } = crowdOf(levels, [[0, 0], [0, 1]])
    castVATShadowsFrom(crowd, { ids, level: 1 })
    const seen = seenByOwnHooks(crowd)

    shadowDraw(crowd)

    expect(seen.before).toEqual([[ids[1]![0], ids[1]![1]]])
  })

  it('skips removed instances', () => {
    const { crowd, ids } = rigCrowd([0, 0, 0])
    crowd.deleteInstance(1)
    castVATShadowsFrom(crowd, { ids, level: 2 })
    const live = () => [0, 2].map((i) => crowd.getGeometryIdAt(i))
    const seen: number[][] = []
    crowd.onBeforeShadow = () => { seen.push(live()) }

    shadowDraw(crowd)

    expect(seen).toEqual([[ids[2]![0], ids[2]![0]]])
    expect(live()).toEqual([ids[0]![0], ids[0]![0]])
  })

  it('swaps ahead of the crowd’s own hook and the crossfade pass after it, which runs once', () => {
    const { lods, crowd, ids } = rigCrowd([0, 0])
    const uniforms = createVATUniforms()
    const playback = createVATPlaybackTexture(makeFixtureCrowd())
    patchVATMaterial(new MeshStandardMaterial(), lods.vat, uniforms, playback, crowd)
    setVATInstance(playback, 0, { clip: lods.vat.clips[1]!, startTime: 0, fadeDuration: 0.5 })
    uniforms.uVatTime.value = 0.2
    castVATShadowsFrom(crowd, { ids, level: 2 })
    const order: string[] = []
    crowd.onBeforeShadow = () => { order.push(`own sees ${idsOf(crowd).join(',')}`) }
    const renderer = {
      extensions: { has: (name: string) => name === 'EXT_color_buffer_float' },
      xr: { enabled: false },
      shadowMap: { autoUpdate: true },
      info: { autoReset: true },
      autoClear: true,
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      setRenderTarget() {},
      render() { order.push('pass') },
    }

    shadowDraw(crowd, renderer)

    expect(order).toEqual([`own sees ${ids[2]![0]},${ids[2]![0]}`, 'pass'])
    expect(idsOf(crowd)).toEqual([ids[0]![0], ids[0]![0]])
  })

  it('stops swapping once disposed, and leaves the crowd’s own hooks running', () => {
    const { crowd, ids } = rigCrowd([0])
    const shadows = castVATShadowsFrom(crowd, { ids, level: 2 })
    const seen = seenByOwnHooks(crowd)

    shadows.dispose()
    shadowDraw(crowd)

    expect(seen.before).toEqual([[ids[0]![0]]])
  })

  it('refuses a level the ids do not give', () => {
    const { crowd, ids } = rigCrowd([0])

    expect(() => castVATShadowsFrom(crowd, { ids, level: 3 })).toThrow(/shadow level.*3 levels.*3 is not/)
    expect(() => castVATShadowsFrom(crowd, { ids, level: 0.5 })).toThrow(/shadow level/)
  })
})
