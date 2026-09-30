// The gift as it is drawn: the present its boost stands for, where the
// simulation's body has it, off on the beats of its warning blink, and bursting
// when it goes — into colour when Santa collects it, into black when nobody
// does. The original's Gift and GiftParticles, less the gameplay, which is the
// simulation's (simulation/gifts.ts).
import { Box3, Group, Mesh, Vector3, type MeshStandardMaterial, type Object3D, type Scene, type Texture } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Bursts, GIFT_BURST } from './particles'
import type { RendererSeam } from './seam'
import { BOOST_KINDS, type BoostKind, type Simulation } from './simulation/simulation'

/** The presents are drawn at twice the model's size. */
const SCALE = 2

export class GiftView {
  private readonly presents: Record<BoostKind, Object3D>
  private readonly root = new Group()
  private shown: Object3D | null = null

  constructor(
    seam: RendererSeam,
    model: GLTF,
    gradientMap: Texture,
    scene: Scene,
    private readonly simulation: Simulation,
  ) {
    // One present per boost, in the model's order, each in the toon look over
    // its own texture, and centred on its bounds, where the body's centre is.
    this.presents = Object.fromEntries(
      BOOST_KINDS.map((kind, i) => {
        const present = model.scene.children[i]
        present.traverse((child) => {
          if (child instanceof Mesh) child.material = seam.toonMaterial({ map: (child.material as MeshStandardMaterial).map!, gradientMap })
        })
        present.position.set(0, 0, 0)
        present.scale.setScalar(SCALE)
        present.position.sub(new Box3().setFromObject(present).getCenter(new Vector3()))
        return [kind, present]
      }),
    ) as Record<BoostKind, Object3D>
    scene.add(this.root)

    const bursts = new Bursts(seam, scene, GIFT_BURST)
    simulation.on('giftCollected', ({ position }) => bursts.play(position))
    simulation.on('giftMissed', ({ position }) => bursts.play(position, true))
  }

  /** Follow the simulation's step. */
  draw(): void {
    const gift = this.simulation.gift
    const present = gift ? this.presents[gift.kind] : null
    if (present !== this.shown) {
      if (this.shown) this.root.remove(this.shown)
      if (present) this.root.add(present)
      this.shown = present
    }
    if (!gift) return
    this.root.position.copy(gift.position)
    this.root.quaternion.copy(gift.rotation)
    this.root.visible = gift.visible
  }
}
