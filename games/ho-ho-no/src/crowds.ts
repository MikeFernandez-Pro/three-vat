// The horde and the elves, drawn: above the renderer seam, which dresses them
// in the toon look on the decode path it has. Both ride an `InstancedMesh`,
// one draw a pass on either backend: the skeletons' at a fixed capacity, its
// rows handed out as they spawn and die (`instance-rows.ts`); the elves' from
// the library's `createVATMesh`. What each instance plays the simulation
// writes; where each one stands is copied off its state here, once a frame.
import { InstancedMesh, Matrix4, type Scene } from 'three'
import { createVATPlaybackTexture, type VAT } from 'three-vat'
import type { Assets } from './assets'
import { InstanceRows } from './instance-rows'
import { placeAt } from './placement'
import type { RendererSeam, Toon } from './seam'
import { SKELETON_CAPACITY, skeletonClipsOf, type Simulation, type SkeletonCrowd } from './simulation/simulation'

/** The toon look, out of the assets: what every model in the camp is drawn in. */
export const toonOf = (assets: Assets): Toon => ({ map: assets.gradient, gradientMap: assets.fiveTone })

/** The horde's carrier, and what the simulation needs of it: its clips, its rows, their playback. */
export function createHorde(seam: RendererSeam, vat: VAT, toon: Toon) {
  // The material is the seam's, put on below.
  const mesh = new InstancedMesh(vat.geometry, undefined, SKELETON_CAPACITY)
  const playback = createVATPlaybackTexture([], { capacity: SKELETON_CAPACITY, maxTextureSize: seam.maxTextureSize })
  seam.dressHorde(mesh, vat, playback, toon)
  mesh.castShadow = true
  // Its bounds change with every spawn and every step, and the horde is
  // mostly on screen: drawn whole, the rows past `count` never.
  mesh.frustumCulled = false

  const crowd: SkeletonCrowd = { clips: skeletonClipsOf(vat), playback, rows: new InstanceRows(mesh) }
  return { mesh, crowd }
}

export class Crowds {
  private readonly elves: InstancedMesh
  private readonly matrix = new Matrix4()

  constructor(
    seam: RendererSeam,
    elf: VAT,
    toon: Toon,
    scene: Scene,
    private readonly skeletons: InstancedMesh,
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
    this.skeletons.instanceMatrix.needsUpdate = true
    this.simulation.elves.forEach((elf, i) => this.elves.setMatrixAt(i, placeAt(this.matrix, elf.position, elf.facing)))
    this.elves.instanceMatrix.needsUpdate = true
  }
}
