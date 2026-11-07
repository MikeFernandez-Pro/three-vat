// A crowd's shadows cast from a coarser level, on WebGPU (ADR-0066): a caster
// batch over the same VAT, playback and clock, a child of the crowd on a layer
// only the lights' shadow cameras see, which copies the crowd's instances
// before its shadow draw.
import { BatchedMesh, DirectionalLight, Matrix4, MeshStandardMaterial } from 'three'
import type { BufferGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { createVATPlaybackTexture } from './instance-playback.js'
import { createVATLODs } from './lod.js'
import { makeFixtureCrowd, makeRigVATFixture } from './test-utils.js'
import { castVATShadowsFrom, vatNodes } from './tsl.js'

/** Two triangles, then one: the levels below the full detail, told apart by their index counts. */
const HALF = [0, 1, 2, 2, 1, 0]
const THIRD = [0, 1, 2]

function rigCrowd(on: readonly number[], capacity = on.length) {
  const vat = makeRigVATFixture()
  const lods = createVATLODs(vat, [HALF, THIRD])
  const geometries: BufferGeometry[] = lods.levels.flat()
  const crowd = new BatchedMesh(
    capacity,
    geometries.reduce((n, g) => n + g.getAttribute('position').count, 0),
    geometries.reduce((n, g) => n + g.getIndex()!.count, 0),
    new MeshStandardMaterial(),
  )
  const ids = lods.levels.map((level) => level.map((g) => crowd.addGeometry(g)))
  on.forEach((l, i) => crowd.setMatrixAt(crowd.addInstance(ids[l]![0]!), new Matrix4().makeTranslation(i, 0, 0)))
  const playback = createVATPlaybackTexture(makeFixtureCrowd())
  const { time } = vatNodes(lods.vat, { playback, carrier: crowd })
  const light = new DirectionalLight()
  light.castShadow = true
  crowd.castShadow = true
  return { lods, crowd, ids, playback, time, light }
}
const casterOf = (crowd: BatchedMesh) => crowd.children[0] as BatchedMesh
/** The caster's shadow draw, as WebGPURenderer starts one: its `onBeforeRender`, the renderer first. */
const shadowDraw = (caster: BatchedMesh) =>
  caster.onBeforeRender({ isWebGPURenderer: true } as never, null as never, null as never, null as never, null as never, null as never)
/** How many indices the geometry an instance of the caster draws holds: which level it is on. */
const indicesAt = (caster: BatchedMesh, instance: number) => caster.getGeometryRangeAt(caster.getGeometryIdAt(instance))!.count

describe('castVATShadowsFrom on WebGPU (ADR-0066)', () => {
  it('casts from a child of the crowd that only the lights’ shadow cameras see, and the crowd stops casting', () => {
    const { lods, crowd, ids, playback, time, light } = rigCrowd([0, 1])

    castVATShadowsFrom(crowd, { lods, ids, level: 1, playback, time, lights: [light] })
    const caster = casterOf(crowd)

    expect(caster).toBeInstanceOf(BatchedMesh)
    expect(caster.castShadow).toBe(true)
    expect(crowd.castShadow).toBe(false)
    expect([caster.layers.isEnabled(31), caster.layers.isEnabled(0)]).toEqual([true, false])
    expect(light.shadow.camera.layers.isEnabled(31)).toBe(true)
    expect(caster.perObjectFrustumCulled).toBe(false)
    expect(caster.frustumCulled).toBe(false)
    expect((caster.material as { positionNode?: unknown }).positionNode).toBeDefined()
  })

  it('copies each instance’s matrix, visibility and level before its shadow draw, never finer than the shadow level', () => {
    const { lods, crowd, ids, playback, time, light } = rigCrowd([0, 1, 2, 0])
    castVATShadowsFrom(crowd, { lods, ids, level: 1, playback, time, lights: [light] })
    const caster = casterOf(crowd)
    crowd.setMatrixAt(0, new Matrix4().makeTranslation(7, 8, 9))
    crowd.setVisibleAt(1, false)
    crowd.deleteInstance(3)

    shadowDraw(caster)

    expect(caster.getMatrixAt(0, new Matrix4()).elements.slice(12, 15)).toEqual([7, 8, 9])
    expect([0, 1, 2, 3].map((i) => caster.getVisibleAt(i))).toEqual([true, false, true, false])
    expect([0, 2].map((i) => indicesAt(caster, i))).toEqual([HALF.length, THIRD.length])

    crowd.setVisibleAt(1, true)
    crowd.setGeometryIdAt(0, ids[2]![0]!)
    shadowDraw(caster)
    expect(caster.getVisibleAt(1)).toBe(true)
    expect(indicesAt(caster, 0)).toBe(THIRD.length)
  })

  it('follows a crowd that grows', () => {
    const { lods, crowd, ids, playback, time, light } = rigCrowd([0])
    castVATShadowsFrom(crowd, { lods, ids, level: 1, playback, time, lights: [light] })
    const caster = casterOf(crowd)

    crowd.setInstanceCount(3)
    crowd.addInstance(ids[0]![0]!)
    crowd.setMatrixAt(1, new Matrix4().makeTranslation(4, 0, 0))
    shadowDraw(caster)

    expect(caster.maxInstanceCount).toBeGreaterThanOrEqual(3)
    expect(caster.getVisibleAt(1)).toBe(true)
    expect(caster.getMatrixAt(1, new Matrix4()).elements[12]).toBe(4)
  })

  it('puts the crowd back once disposed', () => {
    const { lods, crowd, ids, playback, time, light } = rigCrowd([0])
    const shadows = castVATShadowsFrom(crowd, { lods, ids, level: 1, playback, time, lights: [light] })

    shadows.dispose()

    expect(crowd.children).toHaveLength(0)
    expect(crowd.castShadow).toBe(true)
  })

  it('refuses a level the ids do not give', () => {
    const { lods, crowd, ids, playback, time, light } = rigCrowd([0])

    expect(() => castVATShadowsFrom(crowd, { lods, ids, level: 3, playback, time, lights: [light] })).toThrow(/shadow level/)
  })
})
