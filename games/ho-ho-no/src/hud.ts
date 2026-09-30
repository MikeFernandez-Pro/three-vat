// The run on screen: the timer, the kill counter, and the game-over screen with
// its Play Again. The original's GameTimer, KillsCounter and GameOver, driven by
// the simulation's state and events rather than reaching into a singleton.
import gsap from 'gsap'
import type { Simulation } from './simulation/simulation'

const query = <T extends Element>(selector: string) => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`index.html has no ${selector}`)
  return element
}

/** Seconds as the original's timer showed them: `m : ss`. */
export function formatTime(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)} : ${String(whole % 60).padStart(2, '0')}`
}

export class Hud {
  private readonly timer = query<HTMLElement>('.timer-text')
  private readonly counter = query<HTMLElement>('.counter-text')
  private shown = ''

  constructor(private readonly simulation: Simulation) {
    this.timer.textContent = formatTime(0)
    this.counter.textContent = 'x 0'
    simulation.on('kill', ({ kills }) => {
      this.counter.textContent = `x ${kills}`
    })
    simulation.on('gameOver', ({ kills, elapsed }) => this.gameOver(kills, elapsed))
    // A new run is a fresh page, on the same renderer: the original's reload.
    query<HTMLButtonElement>('.restart-button').addEventListener('click', () => window.location.reload())
  }

  /** Once a frame: the run's clock, which stops where the run ended. */
  update(): void {
    const text = formatTime(this.simulation.elapsed)
    if (text !== this.shown) this.timer.textContent = this.shown = text
  }

  /** The kills and the time, then a circle opening from the centre until the screen is covered. */
  private gameOver(kills: number, elapsed: number): void {
    query<HTMLElement>('.enemies-defeated-text').textContent = `Enemies defeated: ${kills}`
    query<HTMLElement>('.time-survived-text').textContent = `Time survived: ${formatTime(elapsed)}`

    const overlay = query<HTMLElement>('.game-over-overlay')
    overlay.classList.add('is-active')
    gsap.killTweensOf(overlay)
    gsap.set(overlay, { '--r': '0vmax' })
    requestAnimationFrame(() => {
      gsap.to(overlay, {
        duration: 0.5,
        ease: 'power2.in',
        '--r': '150vmax',
        onComplete: () => query<HTMLButtonElement>('.restart-button').focus({ preventScroll: true }),
      })
    })
  }
}
