// The run on screen: the timer, the kill counter, the boost indicator, and the
// game-over screen with its Play Again. The original's GameTimer,
// KillsCounter, BoostIndicator and GameOver, driven by the simulation's state
// and events rather than reaching into a singleton.
import gsap from 'gsap'
import { MathUtils } from 'three'
import { query } from './dom'
import type { BoostKind, Simulation } from './simulation/simulation'

/** Seconds as the original's timer showed them: `m : ss`. */
export function formatTime(seconds: number): string {
  const whole = Math.floor(seconds)
  return `${Math.floor(whole / 60)} : ${String(whole % 60).padStart(2, '0')}`
}

/** Each boost's icon and line, as the original's BoostIndicator had them. */
const BOOSTS: Record<BoostKind, { icon: string; label: string }> = {
  shoot: { icon: 'ui/shootBoost.png', label: 'Rapid fire!' },
  ghost: { icon: 'ui/ghostBoost.png', label: 'Piercing shot!' },
  speed: { icon: 'ui/speedBoost.png', label: 'Speed boost!' },
}

/** An SVG path for the filled sector of a circle from `from` to `to` degrees, clockwise, 0 pointing right. */
function sector(cx: number, cy: number, r: number, from: number, to: number): string {
  const at = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180
    return `${cx + r * Math.cos(radians)} ${cy + r * Math.sin(radians)}`
  }
  const large = to - from > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${at(from)} A ${r} ${r} 0 ${large} 1 ${at(to)} Z`
}

/**
 * The boost running: its icon and line, and a shadow sweeping round the icon
 * as its time runs out, then a shrink away. The original's BoostIndicator,
 * its countdown read off the simulation's boost rather than its own tween.
 */
class BoostIndicator {
  private readonly container = query<HTMLElement>('.boost-container')
  private pie: SVGPathElement | null = null

  constructor(private readonly simulation: Simulation) {
    simulation.on('boostStarted', ({ kind }) => this.show(kind))
    simulation.on('boostEnded', () => this.fade())
  }

  update(): void {
    const boost = this.simulation.boost
    if (!boost || !this.pie) return
    const share = (this.simulation.elapsed - boost.startedAt) / (boost.endsAt - boost.startedAt)
    // Short of a whole turn, where the arc's two ends would meet and it vanish.
    const swept = MathUtils.clamp(share, 0, 0.99999)
    this.pie.setAttribute('d', swept <= 0.0001 ? '' : sector(50, 50, 48, -90, -90 + swept * 360))
  }

  private show(kind: BoostKind): void {
    const { icon, label } = BOOSTS[kind]
    gsap.killTweensOf(this.container.querySelector('.boost-active'))
    this.container.innerHTML = `
      <div class="boost-track" aria-live="polite">
        <div class="boost-active">
          <p class="boost-active__label">${label}</p>
          <div class="boost-active__icon" aria-hidden="true">
            <img src="${icon}" alt="${kind} boost" />
            <svg class="boost-active__pie" viewBox="0 0 100 100" aria-hidden="true">
              <path class="boost-active__pie-path" d=""></path>
            </svg>
          </div>
        </div>
      </div>
    `
    this.pie = this.container.querySelector('.boost-active__pie-path')
    this.container.classList.add('is-visible')
  }

  private fade(): void {
    this.pie = null
    const active = this.container.querySelector('.boost-active')
    const hide = () => {
      this.container.classList.remove('is-visible')
      this.container.innerHTML = ''
    }
    if (!active) return hide()
    gsap.to(active, { duration: 0.25, ease: 'power2.in', scale: 0, opacity: 0, transformOrigin: '50% 50%', onComplete: hide })
  }
}

export class Hud {
  private readonly timer = query<HTMLElement>('.timer-text')
  private readonly counter = query<HTMLElement>('.counter-text')
  private readonly boost: BoostIndicator
  private shown = ''

  /** `covered` is called once the game-over screen hides the camp whole: nothing drawn under it is seen. */
  constructor(
    private readonly simulation: Simulation,
    private readonly covered: () => void,
  ) {
    this.boost = new BoostIndicator(simulation)
    this.timer.textContent = formatTime(0)
    this.counter.textContent = 'x 0'
    simulation.on('kill', ({ kills }) => {
      this.counter.textContent = `x ${kills}`
    })
    simulation.on('gameOver', ({ kills, elapsed }) => this.gameOver(kills, elapsed))
    // A new run is a fresh page: the original's reload.
    query<HTMLButtonElement>('.restart-button').addEventListener('click', () => window.location.reload())
  }

  /** Once a frame: the run's clock, which stops where the run ended. */
  update(): void {
    const text = formatTime(this.simulation.elapsed)
    if (text !== this.shown) this.timer.textContent = this.shown = text
    this.boost.update()
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
        onComplete: () => {
          query<HTMLButtonElement>('.restart-button').focus({ preventScroll: true })
          this.covered()
        },
      })
    })
  }
}
