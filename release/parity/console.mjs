// What the browser's console says about a gate run — the pure half of
// check.mjs, split out for the reason verdict.ts is split from the frames: the
// driver needs a browser, and deciding what its console lines *mean* needs
// none, so that decision is pinned by console.test.ts in CI. Plain JavaScript
// because check.mjs runs under bare `node`; the test beside it is TypeScript
// reading this file's JSDoc, which release/tsconfig.json's `allowJs` permits.

/**
 * One captured line.
 *
 * @typedef {{ level: string, text: string }} ConsoleLine
 *   `level` is playwright's console message type — `log`, `debug`, `info`,
 *   `warning`, `error`, … — or `pageerror` for an uncaught exception, which
 *   reaches the driver by a different event and is folded in here.
 */

/**
 * The levels that fail the gate. Warnings do not: three warns about
 * deprecations and fallbacks a healthy run legitimately hits, and a gate that
 * failed on those would be a gate that gets its console check disabled.
 */
export const FAILING_LEVELS = new Set(["error", "pageerror"]);

/**
 * The line to keep for a playwright console message.
 *
 * A message printed by the page's own scripts (three's `console.error` of a
 * WGSL diagnostic, say) names its cause in its text. A message the *browser*
 * prints — a resource that failed to load — does not: its text is the same
 * "Failed to load resource" for every resource, and the resource is in the
 * message's location instead. The browser's messages carry no script line, so
 * a zero line number is how the two are told apart, and only then is the
 * location appended.
 *
 * @param {{ type: string, text: string, location: { url?: string, lineNumber?: number } }} message
 *   The shape of a playwright `ConsoleMessage`, read through its accessors.
 * @returns {ConsoleLine}
 */
export function describeMessage({ type, text, location }) {
  const fromBrowser = Boolean(location.url) && !location.lineNumber;
  return { level: type, text: fromBrowser && !text.includes(location.url) ? `${text} — ${location.url}` : text };
}

/**
 * The console verdict: a check in the shape of the page's own, passing when no
 * captured line is an error.
 *
 * Read first, before any pixel check, because it explains them: a WGSL compile
 * error never reaches a pixel — three reports it here, the pipeline never
 * builds, and the render target keeps whatever frame it held — so the page's
 * own checks can pass on a picture the decode under test did not draw.
 *
 * @param {ConsoleLine[]} lines
 * @returns {{ name: string, pass: boolean, detail: string }}
 */
export function judgeConsole(lines) {
  const errors = lines.filter((line) => FAILING_LEVELS.has(line.level));
  return {
    name: "the browser console reported no error",
    pass: errors.length === 0,
    detail:
      errors.length === 0
        ? `${lines.length} console line${lines.length === 1 ? "" : "s"} captured, none an error`
        : errors.map((line) => line.text).join("\n        "),
  };
}
