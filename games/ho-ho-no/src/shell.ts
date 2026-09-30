// The start screen: the loader that turns into a Play button, and the Credits
// link. The original's Loader, with the credits added; there is no debug panel.
import gsap from 'gsap'

const query = <T extends Element>(selector: string) => {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`index.html has no ${selector}`)
  return element
}

export class Shell {
  private readonly overlay = query<HTMLElement>('.loading-overlay')
  private readonly hole = query<SVGCircleElement>('.loading-overlay-mask__hole')
  private readonly circleContainer = query<HTMLElement>('.load-circle-container')
  private readonly percent = query<HTMLElement>('.load-circle-container p')
  private readonly circle = query<SVGCircleElement>('.load-circle-container circle')
  private readonly circleLength: number

  constructor() {
    // The circle's own path length, so the ring fills exactly whatever its radius.
    this.circleLength = this.circle.getTotalLength()
    this.circle.style.strokeDasharray = `${this.circleLength}`
    this.circle.style.strokeDashoffset = `${this.circleLength}`
    this.circle.style.transition = 'stroke-dashoffset 150ms linear'

    this.setUpCredits()
  }

  /** The loader's ring and percentage, `share` from 0 to 1. */
  progress(share: number): void {
    const clamped = Math.min(1, Math.max(0, share))
    this.percent.textContent = `${Math.round(clamped * 100)}%`
    this.circle.style.strokeDashoffset = `${this.circleLength * (1 - clamped)}`
  }

  /** Everything is in: swap the ring for Play, and resolve once it is pressed. */
  ready(): Promise<void> {
    this.progress(1)
    query<HTMLElement>('.loading-text').style.display = 'none'
    this.overlay.classList.add('is-ready')

    const play = document.createElement('button')
    play.type = 'button'
    play.className = 'loading-button loading-button--start is-visible'
    play.textContent = 'Play'
    this.circleContainer.replaceWith(play)
    play.focus({ preventScroll: true })

    return new Promise((resolve) => {
      play.addEventListener(
        'click',
        () => {
          resolve()
          this.reveal()
        },
        { once: true },
      )
    })
  }

  /** The loader could not finish: say so where the ring was. */
  failed(error: unknown): void {
    query<HTMLElement>('.loading-text').textContent = 'Santa got lost on the way...'
    this.percent.textContent = '!'
    console.error(error)
  }

  /** Fade the start screen's UI, and open a hole in its mask from the centre out to reveal the camp. */
  private reveal(): void {
    this.overlay.style.pointerEvents = 'none'
    const ui = Array.from(this.overlay.children).filter((element) => !element.classList.contains('loading-overlay-mask'))
    gsap.to(ui, { duration: 0.18, ease: 'power1.out', opacity: 0 })

    const radius = Math.ceil(Math.hypot(window.innerWidth, window.innerHeight) / 2) + 20
    gsap.set(this.hole, { attr: { r: 0 } })
    gsap.to(this.hole, {
      duration: 0.5,
      ease: 'power2.in',
      attr: { r: radius },
      onComplete: () => {
        this.overlay.style.display = 'none'
      },
    })
  }

  /** The original's licence file, a KayKit line added, one credit to a line. */
  private setUpCredits(): void {
    const dialog = query<HTMLDialogElement>('.credits')
    const list = query<HTMLUListElement>('.credits-list')
    let loaded: Promise<void> | undefined
    query<HTMLButtonElement>('.credits-link').addEventListener('click', () => {
      loaded ??= fetch('licence.txt')
        .then((response) => response.text())
        .then((text) => {
          for (const line of text.split('\n')) {
            if (line.trim() === '') continue
            const item = document.createElement('li')
            // The game's own file, and its credits are links: markup, as written.
            item.innerHTML = line
            for (const link of item.querySelectorAll('a')) link.target = '_blank'
            list.append(item)
          }
        })
        .catch((error) => {
          // Try again on the next click rather than keep the failure.
          loaded = undefined
          throw error
        })
      loaded.then(() => dialog.showModal()).catch((error) => console.warn('the credits did not load', error))
    })
  }
}
