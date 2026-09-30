// The sound: the music from Play, and every effect of the original on the
// simulation event it answers, through howler. The original's Howls, with
// their files, volumes and rates, gathered from the modules that played them
// (Experience, Character, CharacterController, ProjectilesFactory, Enemy,
// Gift); the files ship as they came. Their downloads start with the page's
// and count toward the loader's progress.
import { Howl } from 'howler'
import type { Simulation } from './simulation/simulation'

/** The horde's approach and its footsteps come in this long after Play, as the original's did. */
const HORDE_SOUNDS_AFTER_MS = 1000
/** A kill screams one time in ten. */
const SCREAM_CHANCE = 0.1

const sound = (file: string, options: { volume: number; rate?: number; loop?: boolean }) =>
  new Howl({ src: [`audio/${file}`], ...options })

export class Sound {
  private readonly music = sound('music/christmas.mp3', { volume: 0.1, loop: true })
  private readonly approach = sound('soundEffects/enemiesApproach.mp3', { volume: 0.1, loop: true })
  private readonly footsteps = sound('soundEffects/walkingInSnow.mp3', { volume: 0.3, loop: true, rate: 0.6 })
  private readonly shoot = sound('soundEffects/shoot.mp3', { volume: 0.2 })
  private readonly hitEnemy = sound('soundEffects/hitEnemy.mp3', { volume: 0.2, rate: 1.2 })
  private readonly scream = sound('soundEffects/enemyScream2.mp3', { volume: 0.2 })
  private readonly hitArena = sound('soundEffects/hitArena.mp3', { volume: 0.17 })
  private readonly giftSpawn = sound('soundEffects/giftSpawn.mp3', { volume: 0.5 })
  private readonly giftExplosion = sound('soundEffects/giftExplosion.mp3', { volume: 0.7 })
  private readonly grabGift = sound('soundEffects/grabGift.mp3', { volume: 0.2 })
  private readonly caught = sound('soundEffects/hitCharacter.wav', { volume: 0.6, rate: 0.8 })

  /** One download per sound, settled whether it loaded or not: a sound that fails is silence, not a broken game. */
  readonly loading: Promise<void>[]

  private hordeSoundsTimer: ReturnType<typeof setTimeout> | undefined
  private approaching = false

  constructor() {
    this.loading = [
      this.music,
      this.approach,
      this.footsteps,
      this.shoot,
      this.hitEnemy,
      this.scream,
      this.hitArena,
      this.giftSpawn,
      this.giftExplosion,
      this.grabGift,
      this.caught,
    ].map(
      (howl) =>
        new Promise<void>((resolve) => {
          if (howl.state() === 'loaded') return resolve()
          howl.once('load', () => resolve())
          howl.once('loaderror', (_, error) => {
            console.warn('a sound did not load', error)
            resolve()
          })
        }),
    )
  }

  /** Answer `simulation`'s events from now on. */
  listen(simulation: Simulation): void {
    simulation.on('shoot', () => this.shoot.play())
    simulation.on('kill', () => {
      this.hitEnemy.play()
      if (Math.random() < SCREAM_CHANCE) this.scream.play()
    })
    simulation.on('burst', ({ cause }) => cause === 'arena' && this.hitArena.play())
    // The original started the approach on the first spawn as well as a second
    // after Play, so two of it play over each other: that is how it sounded.
    simulation.on('spawn', () => {
      if (this.approaching) return
      this.approaching = true
      this.approach.play()
    })
    simulation.on('giftDropped', () => this.giftSpawn.play())
    // The original's pickup went through the same teardown as a miss, which
    // played the explosion; so a pickup sounds both.
    simulation.on('giftCollected', () => {
      this.grabGift.play()
      this.giftExplosion.play()
    })
    simulation.on('giftMissed', () => this.giftExplosion.play())
    simulation.on('gameOver', () => {
      this.caught.play()
      clearTimeout(this.hordeSoundsTimer)
      this.approach.stop()
      this.footsteps.stop()
    })
  }

  /** Play was pressed: the music starts, and the horde is heard a second later. */
  start(): void {
    if (!this.music.playing()) this.music.play()
    this.hordeSoundsTimer = setTimeout(() => {
      this.approach.play()
      this.footsteps.play()
    }, HORDE_SOUNDS_AFTER_MS)
  }
}
