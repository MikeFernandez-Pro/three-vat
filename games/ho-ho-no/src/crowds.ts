// The horde and the elves, drawn: above the renderer seam, which dresses them
// in the toon look on the decode path it has. The skeletons ride a
// `BatchedMesh`, for three's per-instance frustum culling across the camp, at a
// fixed capacity; the elves ride the library's `createVATMesh`. What each
// instance plays the simulation writes; where each one stands is copied off
// its state here, once a frame.
import { BatchedMesh, Matrix4, type InstancedMesh, type Scene } from 'three'
import { createVATPlaybackTexture, type VAT } from 'three-vat'
import type { Assets } from './assets'
import { placeAt } from './placement'
import type { RendererSeam, Toon } from './seam'
import { SKELETON_CAPACITY, skeletonClipsOf, type Simulation, type SkeletonCrowd } from './simulation/simulation'

/** The toon look, out of the assets: what every model in the camp is drawn in. */
export const toonOf = (assets: Assets): Toon => ({ map: assets.gradient, gradientMap: assets.fiveTone })

/** The horde's carrier, and what the simulation needs of it: its clips, its rows, their playback. */
export function createHorde(seam: RendererSeam, vat: VAT, toon: Toon) {
  const geometry = vat.geometry
  const batch = new BatchedMesh(
    SKELETON_CAPACITY,
    geometry.getAttribute('position').count,
    geometry.getIndex()?.count ?? 0,
  )
  // The bake's geometry carries its bounds over every frame, which the batch
  // culls each instance by: a corpse lying down is not culled standing up.
  const geometryId = batch.addGeometry(geometry)
  const playback = createVATPlaybackTexture([], { capacity: SKELETON_CAPACITY, maxTextureSize: seam.maxTextureSize })
  seam.dressBatch(batch, vat, playback, toon)
  batch.castShadow = true
  // Its bounds as a whole change with every spawn; each instance is still culled.
  batch.frustumCulled = false

  const crowd: SkeletonCrowd = {
    clips: skeletonClipsOf(vat),
    playback,
    rows: {
      addInstance: () => batch.addInstance(geometryId),
      deleteInstance: (row) => void batch.deleteInstance(row),
    },
  }
  return { batch, crowd }
}

export class Crowds {
  private readonly elves: InstancedMesh
  private readonly matrix = new Matrix4()

  constructor(
    seam: RendererSeam,
    elf: VAT,
    toon: Toon,
    scene: Scene,
    private readonly skeletons: BatchedMesh,
    private readonly simulation: Simulation,
  ) {
    scene.add(skeletons)

    const elves = seam.vatCrowd(
      elf,
      simulation.elves.map((elf) => elf.playback),
      toon,
    )
    this.elves = elves.mesh
    this.elves.castShadow = true
    // Fifteen, turning in place every frame.
    this.elves.frustumCulled = false
    scene.add(this.elves)
    this.draw()
  }

  /** Stand every skeleton and elf where the simulation has it. */
  draw(): void {
    for (const skeleton of this.simulation.skeletons) {
      this.skeletons.setMatrixAt(skeleton.row, placeAt(this.matrix, skeleton.position, skeleton.facing))
    }
    this.simulation.elves.forEach((elf, i) => this.elves.setMatrixAt(i, placeAt(this.matrix, elf.position, elf.facing)))
    this.elves.instanceMatrix.needsUpdate = true
  }
}
