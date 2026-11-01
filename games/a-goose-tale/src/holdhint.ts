// The goose game's hold indicator (#190): over the goose while he stands at
// the well with its gosling down it, in Gaegu, Google's hand-drawn font,
// "hold" over the space bar's key, the key filling from the left as the bucket
// comes up. Let go, it empties with the bucket; the gosling out, it is gone.
// At a fire, in its dip, with his torch short of full, it says "hold to
// refill" and fills with the torch; at the dead tree, his torch lit, "hold to
// light", filling as it catches. Where the key does nothing yet, the word alone
// says what to do first, with no key under it. On a pad (#196), the pad's
// button in the key's place, round, its glyph drawn for this game: A, or ✕ on
// a PlayStation pad. On a touch screen (#198), the same round button with no
// glyph, as the touch button at the screen's bottom right is (goosethumbs.ts).

import type { Commands } from './goosecontrols'

/** The font, from Google Fonts: Gaegu, bold. */
const FONT = 'https://fonts.googleapis.com/css2?family=Gaegu:wght@700&display=swap'
/** Its ink, the key's fill, how fast it shows and hides, s, and how wide the key is, px, whatever the word over it. */
export const INK = '#f6ead0'
const FILL = '#e9a23b'
const FADE = 0.15
const KEY_WIDTH = 150
/** How tall the key stands, px, borders and all, and so how wide the pad's round button is. */
const KEY_HEIGHT = 46

/** The button a prompt shows: the pad's glyph, the thumb's on a touch screen, or none for the space bar. */
export type Prompted = Commands['glyph'] | 'touch' | null

/** The button the prompts show by `commands`: the pad's glyph on a pad, the thumb's round button on touch, else none, the space bar. */
export const promptedOf = (commands: Commands): Prompted => (commands.device === 'gamepad' ? commands.glyph : commands.device === 'touch' ? 'touch' : null)

/** The pad's glyph beside a button's word, on a pad only: a tap presses the button itself, and nothing stands beside it. */
export const besideOf = (commands: Commands): Prompted => (commands.device === 'gamepad' ? commands.glyph : null)

export interface HoldHint {
  /**
   * Shown at (x, y) on the page, px, its foot there, `word` over the key, the key filled `share` of the way, from 0 to 1, or no key with `keyed` false;
   * with `pointing`, an arrow under the word pointing that way, rad, on the page, PI / 2 straight down; or hidden, at nothing.
   */
  update(at: { x: number; y: number } | null, share: number, word?: string, keyed?: boolean, pointing?: number): void
  /** The key shown from now on: the space bar's, or the pad's button with `prompted` its glyph. */
  prompt(prompted: Prompted): void
}

/** The ✕, in two strokes a little bent, as the arrow's are. */
const CROSS_PATH = 'M-6 -6 Q-1 -1 6 6 M6 -6 Q0 -1 -6 6'

/** A pad's button drawn as the key is, round: its glyph over a fill from the left. Spans, so it may sit in a button. */
export interface PadButton {
  readonly element: HTMLSpanElement
  /** Its glyph, empty for the thumb's, or hidden at null; filled `share` of the way, 0 to 1. */
  update(prompted: Prompted, share?: number): void
}

/** A pad's button `size` px across, hidden till given its glyph, then laid out as `display`. */
export function createPadButton(size: number, display = 'block'): PadButton {
  const element = document.createElement('span')
  element.style.cssText = `position:relative;overflow:hidden;box-sizing:border-box;width:${size}px;height:${size}px;flex:none;display:none;border:3px solid ${INK};border-radius:50%;background:#0007;box-shadow:0 ${Math.round(size / 12)}px 0 ${INK}99`
  const fill = document.createElement('span')
  fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0;background:${FILL};opacity:0.6`
  const face = document.createElement('span')
  face.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-family:Gaegu,cursive;font-weight:700;font-size:${Math.round(size * 0.68)}px;line-height:1;color:${INK}`
  element.append(fill, face)
  let shown: Prompted = null
  return {
    element,
    update(prompted, share = 0) {
      if (prompted !== shown) {
        shown = prompted
        element.style.display = prompted ? display : 'none'
        if (prompted === 'A') face.textContent = 'A'
        else if (prompted === 'touch') face.textContent = ''
        else if (prompted) {
          const stroke = Math.round(size * 0.16)
          face.innerHTML = `<svg viewBox="-12 -12 24 24" width="${size}" height="${size}" style="display:block;overflow:visible"><path d="${CROSS_PATH}" stroke="${INK}" stroke-width="${(stroke * 24) / size}" stroke-linecap="round" fill="none"/></svg>`
        }
      }
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`
    },
  }
}

/** The arrow, pointing right, as the badge's is (goslingbadge.prototype.ts) but with no outline, in the words' ink and shadow: how big, px. */
const ARROW = 30
const ARROW_PATH = 'M-5 -8 Q1 -3 6 0 Q1 3 -5 8'
const arrowDrawn = `<svg viewBox="-12 -12 24 24" width="${ARROW}" height="${ARROW}" style="display:block;overflow:visible;filter:drop-shadow(0 2px 4px #000c)">
<path d="${ARROW_PATH}" stroke="${INK}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`

/** Gaegu, asked for once on the page. */
export function loadHintFont(): void {
  if (document.querySelector(`link[href="${FONT}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONT
  document.head.append(link)
}

/** The indicator, on the page, hidden; the font asked for once. */
export function createHoldHint(): HoldHint {
  loadHintFont()
  const box = document.createElement('div')
  box.style.cssText = `position:fixed;left:0;top:0;transform:translate(-50%,-100%);pointer-events:none;opacity:0;transition:opacity ${FADE}s;text-align:center;font-family:Gaegu,cursive;font-weight:700;color:${INK};text-shadow:0 2px 4px #000c`
  const word = document.createElement('div')
  word.textContent = 'hold'
  word.style.cssText = 'font-size:35px;line-height:1;margin-bottom:5px'
  const key = document.createElement('div')
  key.style.cssText = `position:relative;overflow:hidden;box-sizing:border-box;width:${KEY_WIDTH}px;margin:0 auto;font-size:32px;line-height:1.2;padding:1px 0;border:3px solid ${INK};border-radius:13px;background:#0007;box-shadow:0 4px 0 ${INK}99`
  const fill = document.createElement('div')
  fill.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:0;background:${FILL};opacity:0.6`
  const label = document.createElement('span')
  label.textContent = 'space'
  label.style.position = 'relative'
  key.append(fill, label)
  const pad = createPadButton(KEY_HEIGHT)
  pad.element.style.margin = '0 auto'
  let prompted: Prompted = null
  const arrow = document.createElement('div')
  arrow.innerHTML = arrowDrawn
  arrow.style.cssText = `width:${ARROW}px;margin:0 auto;display:none`
  box.append(word, key, pad.element, arrow)
  document.body.append(box)
  return {
    update(at, share, said = 'hold', keyed = true, pointing) {
      box.style.opacity = at ? '1' : '0'
      if (!at) return
      if (word.textContent !== said) word.textContent = said
      key.style.display = keyed && !prompted ? '' : 'none'
      pad.update(keyed ? prompted : null, share)
      arrow.style.display = pointing === undefined ? 'none' : ''
      if (pointing !== undefined) arrow.style.transform = `rotate(${pointing}rad)`
      box.style.left = `${at.x}px`
      box.style.top = `${at.y}px`
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`
    },
    prompt(shown) {
      prompted = shown
    },
  }
}
