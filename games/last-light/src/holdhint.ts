// The goose game's hold indicator (#190): over the goose while she stands at
// the well with its gosling down it, in Gaegu, Google's hand-drawn font,
// "hold" over the space bar's key, the key filling from the left as the bucket
// comes up. Let go, it empties with the bucket; the gosling out, it is gone.
// At a fire, in its dip, with her torch short of full, it says "hold to
// refill" and fills with the torch; at the dead tree, her torch lit, "hold to
// light", filling as it catches. Where the key does nothing yet, the word alone
// says what to do first, with no key under it.

/** The font, from Google Fonts: Gaegu, bold. */
const FONT = 'https://fonts.googleapis.com/css2?family=Gaegu:wght@700&display=swap'
/** Its ink, the key's fill, how fast it shows and hides, s, and how wide the key is, px, whatever the word over it. */
const INK = '#f6ead0'
const FILL = '#e9a23b'
const FADE = 0.15
const KEY_WIDTH = 150

export interface HoldHint {
  /** Shown at (x, y) on the page, px, its foot there, `word` over the key, the key filled `share` of the way, from 0 to 1, or no key with `keyed` false; or hidden, at nothing. */
  update(at: { x: number; y: number } | null, share: number, word?: string, keyed?: boolean): void
}

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
  box.append(word, key)
  document.body.append(box)
  return {
    update(at, share, said = 'hold', keyed = true) {
      box.style.opacity = at ? '1' : '0'
      if (!at) return
      if (word.textContent !== said) word.textContent = said
      key.style.display = keyed ? '' : 'none'
      box.style.left = `${at.x}px`
      box.style.top = `${at.y}px`
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%`
    },
  }
}
