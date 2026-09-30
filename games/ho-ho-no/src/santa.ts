// Santa as he is drawn: the character model on an AnimationMixer, blending
// idle, run and shoot as the original's CharacterAnimationController did. He
// stays a SkinnedMesh rather than a VAT crowd of one — a single player-driven
// instance whose shoot is interruptible gains nothing from a crowd.
//
// Where he is and which way he faces is the simulation's; this only follows it.
import { AnimationClip, AnimationMixer, LoopOnce, Mesh, type AnimationAction, type Material, type Object3D } from 'three'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Simulation } from './simulation/simulation'

type Clip = 'idle' | 'run' | 'shoot'

/** How long one clip takes to hand over to the next. */
const CROSSFADE = 0.1

export class SantaView {
  readonly object: Object3D
  private readonly mixer: AnimationMixer
  private readonly actions: Record<Clip, AnimationAction>
  private current: Clip = 'idle'
  private shooting = false

  constructor(
    character: GLTF,
    material: Material,
    private readonly simulation: Simulation,
  ) {
    this.object = character.scene
    this.object.traverse((child) => {
      if (child instanceof Mesh) {
        child.material = material
        child.castShadow = true
        child.receiveShadow = false
      }
    })

    this.mixer = new AnimationMixer(this.object)
    const clip = (name: Clip) => this.mixer.clipAction(clipOf(character, name))
    this.actions = { idle: clip('idle'), run: clip('run'), shoot: clip('shoot') }
    this.actions.shoot.loop = LoopOnce
    this.actions.shoot.clampWhenFinished = true
    this.actions.idle.play()

    this.mixer.addEventListener('finished', ({ action }) => {
      if (action !== this.actions.shoot) return
      // A one-shot ends: back to whatever his feet are doing.
      this.shooting = false
      this.play(this.locomotion())
    })
    simulation.on('shoot', ({ timeScale }) => {
      this.actions.shoot.timeScale = timeScale
      this.shooting = true
      this.play('shoot', true)
    })

    this.sync()
  }

  /** The shoot clip's length at speed 1: the simulation holds the next shot until it has played out. */
  static shootClipDuration(character: GLTF): number {
    return clipOf(character, 'shoot').duration
  }

  /**
   * Advance the mixer by `delta` seconds. Called before the simulation steps,
   * as the original did, so a shoot clip that ends this frame frees the next
   * shot in the same one.
   */
  animate(delta: number): void {
    this.mixer.update(delta)
  }

  /** Follow the simulation's step: run or idle, unless a throw is playing, and where he stands. */
  follow(): void {
    if (!this.shooting) this.play(this.locomotion())
    this.sync()
  }

  private locomotion(): Clip {
    return this.simulation.santa.moving ? 'run' : 'idle'
  }

  private sync(): void {
    const { position, facing } = this.simulation.santa
    this.object.position.copy(position)
    this.object.rotation.y = facing
  }

  /**
   * Fade from the current clip into `name`. The shoot clip restarts even when
   * it is the current one: the simulation opens the next shot on the clip's
   * length, and the mixer's `finished` can land a frame after it.
   */
  private play(name: Clip, restart = false): void {
    if (this.current === name && !restart) return
    const next = this.actions[name]
    const previous = this.actions[this.current]
    next.reset()
    next.play()
    if (previous !== next) next.crossFadeFrom(previous, CROSSFADE)
    this.current = name
  }
}

function clipOf(character: GLTF, name: Clip) {
  const found = AnimationClip.findByName(character.animations, name)
  if (!found) throw new Error(`character.glb has no "${name}" clip`)
  return found
}
