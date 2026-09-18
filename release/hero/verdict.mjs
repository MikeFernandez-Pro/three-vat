// What a captured recording means.
//
// Split from the capture on purpose, the way `release/parity/verdict.ts` is
// split from the frames it judges: taking the recording needs a browser and a
// rasteriser, deciding whether it carries the demo's argument needs neither. So
// the decision is pure and pinned by verdict.test.ts in CI — which is the only
// way a release step CI cannot run can be trusted to still work when a human
// runs it.
//
// Eight checks, in the order a reader should think about them: did the page
// survive the take at all, then the three that are the argument (the count
// starts at one, reaches the whole crowd, and never goes back), then the one the
// argument is *for* (the draw calls do not move), then the three about whether
// any of that is visible — the panel in frame, its cursors drawn on it, the
// readout not pushed off an edge — and last, whether the image is light enough
// to be seen before the reader has decided to care.
//
// The counts and draw calls here are read off the HUD, not off the plan that
// asked for them: the drag is a real mouse on a real control, so where it landed
// is the demo's answer and not the script's.

/**
 * @typedef {object} Box A rectangle in viewport pixels.
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 */

/**
 * @typedef {object} PanelBox Where the texture panel was, and what was on it.
 * @property {number} canvases     Strips plus their cursor layers.
 * @property {number} cursorLayers Canvases carrying cursors rather than texels.
 * @property {number} left
 * @property {number} right
 * @property {number} top
 * @property {number} bottom
 */

/**
 * @typedef {object} Recording What one run of the capture saw.
 * @property {number[]} counts     Robots on screen, one per frame, in order.
 * @property {number} maxCount     The top of the slider, as the page reported it.
 * @property {number[]} drawCalls  Every distinct draw-call figure the take saw.
 * @property {string[]} pageErrors Uncaught errors the page threw during it.
 * @property {PanelBox | null} panel
 * @property {Box | null} readout  The draw-call readout's place in the frame.
 * @property {{ width: number, height: number }} frame The captured viewport.
 * @property {number} bytes        Weight of the encoded GIF.
 */

/**
 * @typedef {object} HeroCheck
 * @property {string} name
 * @property {boolean} pass
 * @property {string} detail Why it passed or failed, in a line a developer can act on.
 */

import { HERO_BUDGET_BYTES } from './gif.mjs'

/**
 * Judge a recording.
 *
 * @param {Recording} recording
 * @returns {{ pass: boolean, checks: HeroCheck[] }}
 */
export function heroVerdict(recording) {
  const { counts, maxCount, drawCalls, pageErrors, panel, readout, frame, bytes } = recording
  const last = counts[counts.length - 1]
  const inFrame = (/** @type {Box | null} */ box) =>
    Boolean(box) && box.left >= 0 && box.top >= 0 && box.right <= frame.width && box.bottom <= frame.height
  const placement = (/** @type {Box} */ box) =>
    `x ${Math.round(box.left)}–${Math.round(box.right)} of ${frame.width}, ` +
    `y ${Math.round(box.top)}–${Math.round(box.bottom)} of ${frame.height}`

  const checks = [
    check('the page ran clean', pageErrors.length === 0, pageErrors.join('; ') || 'no uncaught errors'),
    check('the recording starts on one robot', counts[0] === 1, `opened on ${counts[0]}`),
    check('the count reaches the full crowd', last === maxCount, `ended on ${last} of ${maxCount}`),
    check(
      'the count only ever climbs',
      counts.every((count, i) => i === 0 || count >= counts[i - 1]),
      `${counts[0]} → ${last}, in ${new Set(counts).size} steps`,
    ),
    check(
      'the draw calls never move',
      drawCalls.length === 1,
      `${drawCalls.join(', ')} draw calls across ${counts[0]}–${last} robots`,
    ),
    check(
      'the texture panel is in frame',
      Boolean(panel) && panel.canvases >= 2 && inFrame(panel),
      panel ? `${panel.canvases} canvases, ${placement(panel)}` : 'no texture panel on the page',
    ),
    check(
      'the cursors are drawn on it',
      Boolean(panel) && panel.cursorLayers > 0,
      panel ? `${panel.cursorLayers} of ${panel.canvases} canvases carry cursors` : 'no panel to read',
    ),
    check(
      'the draw-call readout is in frame',
      inFrame(readout),
      readout ? placement(readout) : 'no draw-call readout on the page',
    ),
    check(
      'the image is small enough to be a first impression',
      bytes <= HERO_BUDGET_BYTES,
      `${(bytes / 1e6).toFixed(2)} MB of a ${(HERO_BUDGET_BYTES / 1e6).toFixed(2)} MB budget`,
    ),
  ]

  return { pass: checks.every((c) => c.pass), checks }
}

/**
 * @param {string} name
 * @param {boolean} pass
 * @param {string} detail
 * @returns {HeroCheck}
 */
function check(name, pass, detail) {
  return { name, pass, detail }
}
