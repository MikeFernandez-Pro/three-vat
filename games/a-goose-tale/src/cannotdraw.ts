// What a phone does when it cannot draw the game, in place of a game with no goose,
// or no rats, and nothing to say why: a driver may refuse any shader, and no list of
// phones would know which. Three reports each refusal as a console error and draws
// on without what was refused, so that is where it is heard. From WebGPU it tries
// WebGL 2, on its own; from there the phone is told. A lost GPU is no refusal: a phone
// switching apps loses it, and the page comes back (main.ts).

/** The errors three logs for what it could not build or draw. A missing file or a warning is no reason to stop. */
const FAILURES = /pipeline creation failed|Program link failed|Shader Error|GPUValidationError/i

/** Whether a console error says the game can no longer be drawn whole. */
export const isDrawFailure = (text: string): boolean => FAILURES.test(text)

/** What a refusal leads to on a backend: the other one, or the words. */
export const nextAfterFailure = (backend: 'WebGPU' | 'WebGL 2'): 'try webgl' | 'give up' => (backend === 'WebGPU' ? 'try webgl' : 'give up')

const WORDS = 'This phone can’t draw the game.<br>Please open it on a computer.'

/** From now on, once it cannot draw: `tried` asked, once, whether something else can be tried; if not, the page's own words over all else, and `stopped` told. */
export function watchForDrawFailure(tried: () => boolean, stopped: () => void): void {
  let shown = false
  const stop = () => {
    if (shown) return
    shown = true
    if (tried()) return
    const card = document.createElement('div')
    card.className = 'cannot-draw'
    card.innerHTML = WORDS
    card.style.cssText = 'position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:#000;color:#f6ead0;font-family:Gaegu,cursive;font-weight:700;font-size:26px;line-height:1.3;text-align:center'
    document.body.append(card)
    stopped()
  }
  const logged = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    logged(...args)
    if (args.some((arg) => isDrawFailure(String(arg)))) stop()
  }
  addEventListener('unhandledrejection', (event) => {
    if (isDrawFailure(String(event.reason)) || /webgl|webgpu|adapter|context/i.test(String(event.reason))) stop()
  })
}
