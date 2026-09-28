// What one page's smoke run means — the pure half of check.mjs, split out for
// the reason parity/verdict.ts is split from its frames: opening a page needs
// a browser and a GPU, deciding whether what it did is a pass needs neither, so
// the decision is pinned by verdict.test.ts in CI. Plain JavaScript because
// check.mjs runs under bare `node`.
import { judgeConsole } from "../parity/console.mjs";

/**
 * What the driver saw of one page.
 *
 * @typedef {object} PageRun
 * @property {string} page  The page name, `webgpu_crowd`.
 * @property {import("../parity/console.mjs").ConsoleLine[]} lines Every console line it printed.
 * @property {number} draws Draw calls the page issued to its GPU context, counted at the API.
 * @property {number} waitedMs How long the driver waited for the first of them.
 */

/**
 * @typedef {object} SmokeCheck
 * @property {string} name
 * @property {boolean} pass
 * @property {string} detail
 */

/**
 * Judge one page: it has to have drawn, and said nothing wrong while doing it.
 *
 * Both, because neither implies the other. A page can draw a frame and still
 * print a WGSL compile error for the one pipeline that never built; a page can
 * print nothing and never draw, when an `await` upstream of its loop never
 * settled. The console is judged first, as the parity gate judges it, because
 * it is usually what explains the other.
 *
 * @param {PageRun} run
 * @returns {SmokeCheck[]}
 */
export function judgePage({ page, lines, draws, waitedMs }) {
  const console = judgeConsole(lines);
  return [
    { ...console, name: `${page}: ${console.name}` },
    {
      name: `${page}: the page drew`,
      pass: draws > 0,
      detail:
        draws > 0
          ? `${draws} draw call${draws === 1 ? "" : "s"} issued`
          : `no draw call issued in ${(waitedMs / 1000).toFixed(0)} s — the page never rendered a frame`,
    },
  ];
}
