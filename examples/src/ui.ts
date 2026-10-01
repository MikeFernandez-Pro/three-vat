// The examples' control panel, their readout line and their source panel — a
// minimal ui of the library's own, where the pages used to borrow lil-gui and
// three's Inspector (ADR-0037).
//
// What it offers is what a page needs and no more: a slider, a toggle, a
// select and a button, stacked in one panel top-right that collapses to a
// button on a narrow screen; a setter for each HUD readout the page's HTML
// declares; the page's own entry module, shown as text in a panel that opens on
// demand and links to the file on GitHub; and a badge for a WebGPU page that is
// really drawing through the WebGL 2 backend.
//
// No three.js, no renderer, no library (release/packaging/bundles.test.ts): a
// page's bundle is one renderer's, and a panel of sliders has no business
// deciding which. The colours, type and spacing it uses are the theme's tokens
// (src/theme.css); the look can change there, and here, without touching a page.
//
// The markup is built by pure functions and then mounted, because it is a
// contract: the hero capture finds the crowd page's count control by its label
// and drags the range input inside it (release/hero/capture.mjs), and
// `ui.test.ts` pins that shape in Node, where there is no DOM.

/** Where a page's source lives on GitHub, as a prefix a repository path completes. */
export const GITHUB_BLOB = "https://github.com/MikeFernandez-Pro/three-vat/blob/main/";

/** One control, as the panel renders it. */
export type ControlSpec =
  | { kind: "slider"; label: string; min: number; max: number; step?: number; value: number }
  | { kind: "toggle"; label: string; value: boolean }
  | { kind: "select"; label: string; options: readonly (readonly [value: string, text: string])[]; value: string }
  | { kind: "button"; label: string };

/** Text, made safe to sit inside HTML. */
const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const labelSpan = (text: string) => `<span class="ui-label">${escapeHtml(text)}</span>`;

/**
 * A control's markup: a `<label class="ui-control">` whose first child names
 * it and whose input follows — so the label is what a visitor reads first, and
 * what a script finds the control by. A button is its own label.
 */
export function controlMarkup(spec: ControlSpec): string {
  switch (spec.kind) {
    case "slider": {
      const step = spec.step ?? 1;
      return (
        `<label class="ui-control" data-kind="slider">${labelSpan(spec.label)}` +
        `<output class="ui-value">${spec.value}</output>` +
        `<input type="range" min="${spec.min}" max="${spec.max}" step="${step}" value="${spec.value}" /></label>`
      );
    }
    case "toggle":
      return (
        `<label class="ui-control" data-kind="toggle">${labelSpan(spec.label)}` +
        `<input type="checkbox" role="switch"${spec.value ? " checked" : ""} /></label>`
      );
    case "select": {
      const options = spec.options
        .map(([value, text]) => `<option value="${escapeHtml(value)}"${value === spec.value ? " selected" : ""}>${escapeHtml(text)}</option>`)
        .join("");
      return `<label class="ui-control" data-kind="select">${labelSpan(spec.label)}<select>${options}</select></label>`;
    }
    case "button":
      return `<div class="ui-control" data-kind="button"><button type="button" class="ui-button">${escapeHtml(spec.label)}</button></div>`;
  }
}

/**
 * A group's shell: a fieldset its legend names, and the body its controls go
 * in. The legend is a `ui-label`, read as a control's label is.
 */
export function groupMarkup(label: string): string {
  return `<fieldset class="ui-group"><legend class="ui-label">${escapeHtml(label)}</legend><div class="ui-group-body"></div></fieldset>`;
}

/**
 * The panel's shell: one root, the controls' body, and the button a narrow
 * screen collapses the body behind. The collapse button is always in the
 * markup and only shown by the stylesheet below 640 px, so there is no resize
 * handler anywhere in this file.
 */
export function panelMarkup(): string {
  return (
    `<div id="ui-panel" class="ui-panel" data-open="false">` +
    `<button type="button" class="ui-collapse" aria-expanded="false" aria-controls="ui-body">controls</button>` +
    `<div class="ui-body" id="ui-body"></div>` +
    `</div>`
  );
}

/** What a page hands the source panel: its own entry module, and where it lives in the repository. */
export interface PageSource {
  /** The module's text, imported through vite's `?raw` — the code running, not a copy of it. */
  code: string;
  /** Its path from the repository root, `examples/src/webgl_crowd.ts`. */
  path: string;
}

/**
 * The source panel: the page's entry module as text, with its path and a link
 * to it on GitHub in the header. Hidden as built — the scene is what a visitor
 * meets first, and the code is one click away.
 */
export function sourcePanelMarkup({ code, path }: PageSource): string {
  return (
    `<aside id="source" class="ui-source" hidden aria-label="source">` +
    `<header><span class="ui-source-path">${escapeHtml(path)}</span>` +
    `<a class="ui-source-github" href="${GITHUB_BLOB}${escapeHtml(path)}" target="_blank" rel="noopener">GitHub</a>` +
    `<button type="button" class="ui-source-close" aria-label="close source">×</button></header>` +
    `<pre><code>${escapeHtml(code)}</code></pre>` +
    `</aside>`
  );
}

// ---------------------------------------------------------------- mounted

/**
 * The panel a page builds its controls into. Each control hands back its root
 * element, for the page that has to hide one (a choice its asset does not
 * offer) or disable it (while a bake runs).
 */
export interface Panel {
  /** A number, dragged. `onInput` fires on every step of the drag. */
  slider(label: string, range: { min: number; max: number; step?: number; value: number }, onInput: (value: number) => void): HTMLElement;
  /** On or off. */
  toggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement;
  /** One of several, as `[value, text]` pairs. */
  select<T extends string>(label: string, options: readonly (readonly [T, string])[], value: T, onChange: (value: T) => void): HTMLElement;
  /** Something to do. */
  button(label: string, onClick: () => void): HTMLElement;
  /**
   * Controls that come and go together, under a legend: the clips of whatever
   * asset the page is showing. `clear()` empties it for the next.
   */
  group(label: string): Panel & { element: HTMLElement; clear(): void };
  /** The page's own source, behind a button at the foot of the panel. */
  source(page: PageSource): void;
}

/** Parse one element out of markup this file wrote. */
function element(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content.firstElementChild as HTMLElement;
}

/** Put the stylesheet on the page, once. */
function style(): void {
  if (document.getElementById("ui-style")) return;
  const el = document.createElement("style");
  el.id = "ui-style";
  el.textContent = UI_CSS;
  document.head.append(el);
}

/** Build the panel, top-right, and hand back what fills it. */
export function createPanel(): Panel {
  style();
  const root = element(panelMarkup());
  const body = root.querySelector<HTMLElement>(".ui-body")!;
  const collapse = root.querySelector<HTMLButtonElement>(".ui-collapse")!;
  collapse.addEventListener("click", () => {
    const open = root.dataset.open !== "true";
    root.dataset.open = String(open);
    collapse.setAttribute("aria-expanded", String(open));
  });
  document.body.append(root);
  return controlsIn(body);
}

/** The controls of one body: the panel's own, or a group's inside it. */
function controlsIn(body: HTMLElement): Panel {
  const add = (spec: ControlSpec) => {
    const control = element(controlMarkup(spec));
    body.append(control);
    return control;
  };

  return {
    slider(label, range, onInput) {
      const control = add({ kind: "slider", label, ...range });
      const input = control.querySelector("input")!;
      const value = control.querySelector("output")!;
      input.addEventListener("input", () => {
        value.textContent = input.value;
        onInput(Number(input.value));
      });
      return control;
    },
    toggle(label, value, onChange) {
      const control = add({ kind: "toggle", label, value });
      const input = control.querySelector("input")!;
      input.addEventListener("change", () => onChange(input.checked));
      return control;
    },
    select(label, options, value, onChange) {
      const control = add({ kind: "select", label, options, value });
      const select = control.querySelector("select")!;
      select.addEventListener("change", () => onChange(select.value as (typeof options)[number][0]));
      return control;
    },
    button(label, onClick) {
      const control = add({ kind: "button", label });
      control.querySelector("button")!.addEventListener("click", onClick);
      return control;
    },
    group(label) {
      const fieldset = element(groupMarkup(label));
      body.append(fieldset);
      const inner = fieldset.querySelector<HTMLElement>(".ui-group-body")!;
      return { ...controlsIn(inner), element: fieldset, clear: () => inner.replaceChildren() };
    },
    source(page) {
      const aside = element(sourcePanelMarkup(page));
      document.body.append(aside);
      const open = add({ kind: "button", label: "view source" }).querySelector("button")!;
      open.classList.add("ui-source-open");
      const show = (visible: boolean) => {
        aside.hidden = !visible;
        open.textContent = visible ? "hide source" : "view source";
      };
      open.addEventListener("click", () => show(aside.hidden));
      aside.querySelector(".ui-source-close")!.addEventListener("click", () => show(false));
    },
  };
}

/**
 * The setter for one HUD readout, by the id the page's HTML gives it. Throws
 * when the page declares no such readout, so a script and its page cannot
 * drift apart silently — the HUD pair contract reads the HTML, and this makes
 * the script answer to it.
 */
export function readout(id: string): (value: string | number) => void {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the page declares no #${id} readout`);
  return (value) => {
    const text = String(value);
    if (el.textContent !== text) el.textContent = text;
  };
}

/**
 * A small badge, bottom-right, saying something true about how the page is
 * running — a WebGPU page whose renderer fell back to its WebGL 2 backend, read
 * off the backend by the page rather than guessed here.
 */
export function badge(text: string): void {
  style();
  const el = document.createElement("div");
  el.className = "ui-badge";
  el.textContent = text;
  document.body.append(el);
}

/**
 * Keep `--hud-bottom` at the HUD's lower edge, so what sits under it — the
 * texture panel — starts below it however tall a page's readouts make it. A
 * readout that grows a line when a bake falls back moves the panel with it.
 */
function followHud(): void {
  const hud = document.getElementById("hud");
  if (!hud || typeof ResizeObserver === "undefined") return;
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--hud-bottom", `${Math.round(hud.getBoundingClientRect().bottom)}px`);
  }).observe(hud);
}

// ---------------------------------------------------------------- look
// Everything here is written against the theme's tokens. Kept in the module
// rather than in the theme so the markup above and the rules that lay it out
// are read together; the tokens are what a beauty pass reaches for first.
const UI_CSS = /* css */ `
/* The texture panel (src/texture-panel.ts) in the studio: under the HUD, ink
   rather than white, the cursors in the accent. It reads these and falls back
   to the dark room where they are unset. */
:root {
  --texture-panel-top: calc(var(--hud-bottom, 156px) + var(--space-3)); --texture-panel-left: var(--space-4);
  --texture-panel-bottom: calc(var(--space-4) + 48px); /* clear of the 48px frame timings a cost page keeps bottom-left */
  --texture-panel-ink: var(--ink-2); --texture-panel-shadow: none;
  --texture-panel-cursor: rgba(228, 87, 46, 0.75); --texture-panel-band: rgba(31, 31, 34, 0.8);
}

body { overflow: hidden; overscroll-behavior: none; }
canvas { display: block; }

#hud {
  position: fixed; top: var(--space-4); left: var(--space-4); z-index: 2; max-width: 340px;
  padding: var(--space-3) var(--space-4); border-radius: var(--radius);
  background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(8px);
  user-select: none; pointer-events: none;
}
#hud a { pointer-events: auto; }
#hud #title { display: inline; margin: 0; font-size: var(--text-lg); font-weight: 650; letter-spacing: -0.01em; }
#hud #gallery-link { margin-left: var(--space-2); font-size: var(--text-sm); color: var(--ink-3); text-decoration: none; white-space: nowrap; }
#hud #gallery-link:hover { color: var(--accent); }
#hud #try { margin: var(--space-1) 0 var(--space-2); font-size: var(--text-sm); color: var(--ink-2); }
/* The calls the page's recipe teaches: names, read as code. */
#hud #api { margin: 0 0 var(--space-3); font-size: var(--text-xs); line-height: 1.6; color: var(--ink-3); }
#hud #api code { font-family: var(--font-mono); color: var(--ink); }
#hud #readouts { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); margin: 0; }
#hud #readouts dt { font-size: var(--text-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3); }
#hud #readouts dd { margin: 0; font: 600 var(--text-lg) / 1.2 var(--font-mono); font-variant-numeric: tabular-nums; }
/* A readout whose value is a sentence — a reason read off a bake — takes the
   HUD's full width and reads as text rather than as a figure. */
#hud #readouts .wide { flex-basis: 100%; }
#hud #readouts .wide dd { font: 400 var(--text-sm) / 1.45 var(--font-sans); color: var(--ink-2); }
/* Where a page's model comes from, and under what licence. */
#hud #credit { margin: var(--space-3) 0 0; font-size: var(--text-xs); color: var(--ink-3); }

.ui-panel {
  position: fixed; top: var(--space-4); right: var(--space-4); z-index: 3; width: 232px;
  padding: var(--space-3); border-radius: var(--radius);
  background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(8px);
}
.ui-body { display: flex; flex-direction: column; gap: var(--space-3); }
.ui-collapse { display: none; }
.ui-control { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: var(--space-1) var(--space-2); font-size: var(--text-sm); }
.ui-label { color: var(--ink-2); }
.ui-value { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--ink); }
.ui-control input[type="range"] { grid-column: 1 / -1; width: 100%; margin: 0; accent-color: var(--accent); }
.ui-control select {
  grid-column: 1 / -1; width: 100%; padding: 5px var(--space-2); font: inherit; color: var(--ink);
  background: var(--surface-solid); border: 1px solid var(--rule); border-radius: var(--radius-sm);
}
.ui-control input[role="switch"] {
  appearance: none; position: relative; width: 30px; height: 18px; margin: 0; cursor: pointer;
  border-radius: 9px; background: var(--rule); transition: background 120ms;
}
.ui-control input[role="switch"]::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--surface-solid); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); transition: transform 120ms;
}
.ui-control input[role="switch"]:checked { background: var(--accent); }
.ui-control input[role="switch"]:checked::after { transform: translateX(12px); }
.ui-control[data-kind="button"] { display: block; }
.ui-control[hidden], .ui-group[hidden] { display: none; }
.ui-group { margin: 0; padding: var(--space-2) 0 0; border: 0; border-top: 1px solid var(--rule); min-width: 0; }
.ui-group legend { padding: 0 var(--space-1) 0 0; font-size: var(--text-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3); }
.ui-group-body { display: flex; flex-direction: column; gap: var(--space-2); }
.ui-button:disabled, .ui-control select:disabled, .ui-control input:disabled { opacity: 0.5; cursor: default; }
.ui-button, .ui-collapse {
  width: 100%; padding: 6px var(--space-2); font: inherit; font-size: var(--text-sm); font-weight: 550; cursor: pointer;
  color: var(--ink); background: var(--surface-solid); border: 1px solid var(--rule); border-radius: var(--radius-sm);
}
.ui-button:hover, .ui-collapse:hover { border-color: var(--accent); color: var(--accent); }
.ui-source-open { color: var(--ink-2); }

.ui-source {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 4; width: min(680px, 100vw);
  display: flex; flex-direction: column; background: var(--surface-solid); box-shadow: var(--shadow);
}
/* \`display: flex\` above outranks the browser's own \`[hidden] { display: none }\`. */
.ui-source[hidden] { display: none; }
.ui-source header {
  display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--rule); font-size: var(--text-sm);
}
.ui-source-path { flex: 1; font-family: var(--font-mono); color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-source-close { font: inherit; font-size: var(--text-lg); line-height: 1; padding: 0 var(--space-1); cursor: pointer; color: var(--ink-2); background: none; border: 0; }
.ui-source pre {
  flex: 1; margin: 0; padding: var(--space-4); overflow: auto; background: var(--code-bg);
  font: 12px / 1.55 var(--font-mono); color: var(--ink); tab-size: 2;
}

.ui-badge {
  position: fixed; right: var(--space-4); bottom: var(--space-4); z-index: 2;
  padding: 4px var(--space-3); border-radius: 999px; font-size: var(--text-xs); font-weight: 550;
  color: var(--accent-ink); background: var(--accent); box-shadow: var(--shadow);
}

@media (max-width: 640px) {
  #hud { top: var(--space-2); left: var(--space-2); right: var(--space-2); max-width: none; }
  .ui-panel { top: auto; bottom: var(--space-2); right: var(--space-2); width: auto; padding: var(--space-2); }
  .ui-panel[data-open="true"] { left: var(--space-2); }
  .ui-collapse { display: block; }
  .ui-panel[data-open="false"] .ui-body { display: none; }
  .ui-panel[data-open="true"] .ui-body { margin-top: var(--space-2); }
  .ui-badge { bottom: auto; top: var(--space-2); right: var(--space-2); }
}
`;

// On import, not on the first panel — and here, below the stylesheet it
// injects: a page bakes before it builds its panel, and its HUD would sit
// unstyled for the whole of the bake. The guard is for Node, where ui.test.ts
// reads the markup and there is no page.
if (typeof document !== "undefined") {
  style();
  followHud();
}
