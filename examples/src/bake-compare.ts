// The baking pages' moment: a large button in the middle of the screen that
// runs the bake, and afterwards a comparison of what each path cost, coloured
// by verdict. Baked file sets the file against the glTF baked on the page;
// Bake in a worker sets the worker against the main thread, and the VAT crowd
// against the skinned one it replaced.

/** What a figure counts, which is also how it is written. */
export type FigureUnit = "ms" | "bytes" | "count";

/**
 * One figure for two columns. The first column is the one judged, against the
 * second; `null` where that column has not run yet.
 */
export interface Figure {
  label: string;
  unit: FigureUnit;
  values: readonly [judged: number | null, against: number | null];
}

/** How the judged column fares. Lower is better, for every figure. */
export type Verdict = "better" | "worse" | "same";

/** A figure as the comparison shows it. */
export interface ComparedFigure {
  label: string;
  cells: [string, string];
  /** The judged column less the other, signed; `null` until both have run. */
  difference: string | null;
  verdict: Verdict | null;
}

/** A figure rounded as it is written: to the ms, the draw, the kB, or the tenth of a MB. */
function rounded(value: number, unit: FigureUnit): number {
  // On the magnitude: `Math.round` sends a half up, which is towards zero for
  // a negative difference and away from it for the cell it is read beside.
  const size = Math.abs(value);
  const nearest = unit !== "bytes" ? Math.round(size) : size >= 1e6 ? Math.round(size / 1e5) * 1e5 : Math.round(size / 1e3) * 1e3;
  return Math.sign(value) * nearest;
}

function format(value: number, unit: FigureUnit): string {
  const v = rounded(value, unit);
  if (unit === "ms") return `${v} ms`;
  if (unit === "count") return `${v}`;
  return Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : `${Math.round(v / 1e3)} kB`;
}

/** A figure's two cells, its difference and its verdict. */
export function compareFigure({ label, unit, values }: Figure): ComparedFigure {
  const [judged, against] = values;
  const cells: [string, string] = [judged === null ? "—" : format(judged, unit), against === null ? "—" : format(against, unit)];
  if (judged === null || against === null) return { label, cells, difference: null, verdict: null };
  // The difference is a figure of its own, rounded as it is written: a verdict
  // never turns on digits nobody can read.
  const delta = rounded(judged - against, unit);
  const verdict: Verdict = delta < 0 ? "better" : delta > 0 ? "worse" : "same";
  // A true minus sign, as a figure is typeset; nothing for a tie.
  const sign = delta < 0 ? "−" : delta > 0 ? "+" : "";
  return { label, cells, difference: sign + format(Math.abs(delta), unit), verdict };
}

/** Text, made safe to sit inside HTML. */
const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The comparison: a row per figure, the two columns and their difference, the
 * difference carrying its verdict for the stylesheet to colour. A difference
 * not yet known is an empty cell with no verdict, so nothing is coloured early.
 */
export function comparisonMarkup(heads: readonly [string, string], figures: readonly Figure[]): string {
  const head = `<tr><th></th>${[...heads, "difference"].map((text) => `<th scope="col">${escapeHtml(text)}</th>`).join("")}</tr>`;
  const rows = figures.map((figure) => {
    const { label, cells, difference, verdict } = compareFigure(figure);
    const diff = verdict === null ? `<td class="compare-diff"></td>` : `<td class="compare-diff" data-verdict="${verdict}">${difference}</td>`;
    return `<tr><th scope="row">${escapeHtml(label)}</th>${cells.map((cell) => `<td>${cell}</td>`).join("")}${diff}</tr>`;
  });
  return `<table class="compare"><thead>${head}</thead><tbody>${rows.join("")}</tbody></table>`;
}

/**
 * The bake button: what it does, then a button per choice, each carrying its
 * value. One choice on Baked file, two on Bake in a worker.
 */
export function bakeButtonMarkup(prompt: string, choices: readonly (readonly [value: string, text: string])[]): string {
  const buttons = choices
    .map(([value, text]) => `<button type="button" class="bake-choice" data-choice="${escapeHtml(value)}">${escapeHtml(text)}</button>`)
    .join("");
  return (
    `<div id="bake-button" class="bake-button" role="group" aria-label="${escapeHtml(prompt)}">` +
    `<p class="bake-prompt">${escapeHtml(prompt)}</p><div class="bake-choices">${buttons}</div></div>`
  );
}

// ---------------------------------------------------------------- mounted

/**
 * Put the bake button in the middle of the screen, and resolve with the
 * choice clicked. The button leaves the moment it is clicked, so the forge
 * that follows it into the middle has the place to itself.
 */
export function askToBake<T extends string>(prompt: string, choices: readonly (readonly [T, string])[]): Promise<T> {
  style();
  const template = document.createElement("template");
  template.innerHTML = bakeButtonMarkup(prompt, choices);
  const root = template.content.firstElementChild as HTMLElement;
  document.body.append(root);
  return new Promise((resolve) => {
    root.addEventListener("click", (event) => {
      const choice = (event.target as HTMLElement).closest<HTMLElement>("[data-choice]")?.dataset.choice;
      if (choice === undefined) return;
      root.remove();
      resolve(choice as T);
    });
  });
}

/**
 * Fill the HUD's comparison by the id the page's HTML gives it, and show it in
 * place of the readouts: they held one path's figures, and it holds both.
 * Throws when the page declares none, as a readout does (ui.ts), so a script
 * and its page cannot drift apart silently.
 */
export function showComparison(id: string, heads: readonly [string, string], figures: readonly Figure[]): void {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the page declares no #${id} comparison`);
  style();
  el.innerHTML = comparisonMarkup(heads, figures);
  el.hidden = false;
  const readouts = document.getElementById("readouts");
  if (readouts) readouts.hidden = true;
}

// ---------------------------------------------------------------- look
// Written against the theme's tokens (src/theme.css), as the panel and the
// forge are; the verdict's two colours are tokens there too.
const BAKE_COMPARE_CSS = /* css */ `
.bake-button {
  position: fixed; top: 50%; left: 50%; z-index: 3; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-5); border-radius: var(--radius);
  background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(8px);
  zoom: var(--ui-scale, 1);
}
.bake-prompt { margin: 0; font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); }
.bake-choices { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-3); }
.bake-choice {
  padding: var(--space-3) var(--space-5); font: inherit; font-size: var(--text-lg); font-weight: 650; cursor: pointer;
  color: var(--accent-ink); background: var(--accent); border: 0; border-radius: var(--radius-sm); box-shadow: var(--shadow);
  transition: transform 120ms;
}
.bake-choice:hover { transform: translateY(-1px); }
.bake-choice:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

/* The comparison takes the readouts' place once a page has both columns, and
   \`display: flex\` on the readouts (ui.ts) outranks the browser's own [hidden]. */
#hud #readouts[hidden], #hud .compare-figures[hidden] { display: none; }
#hud .compare-figures + .compare-figures { margin-top: var(--space-3); }
#hud .compare { border-collapse: collapse; font-size: var(--text-sm); }
#hud .compare th, #hud .compare td { padding: 2px var(--space-3) 2px 0; text-align: right; white-space: nowrap; }
#hud .compare thead th { font-size: var(--text-xs); font-weight: 400; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3); }
#hud .compare tbody th { font-weight: 400; text-align: left; color: var(--ink-2); }
#hud .compare td { font: 600 var(--text-sm) / 1.4 var(--font-mono); font-variant-numeric: tabular-nums; }
#hud .compare-diff[data-verdict="better"] { color: var(--better); }
#hud .compare-diff[data-verdict="worse"] { color: var(--worse); }
#hud .compare-diff[data-verdict="same"] { color: var(--ink-3); }
`;

/** Put the stylesheet on the page, once. */
function style(): void {
  if (document.getElementById("bake-compare-style")) return;
  const el = document.createElement("style");
  el.id = "bake-compare-style";
  el.textContent = BAKE_COMPARE_CSS;
  document.head.append(el);
}
