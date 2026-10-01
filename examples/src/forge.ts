// The forge: the studio's sign that a page is working rather than frozen, in
// the middle of the screen. Two states, each with its own icon: loading, a row
// of texels pulsing in turn while a model comes in; and baking, a small
// texture filling texel by texel while the page bakes a VAT. Every page wraps
// its loads in `loading` and its bakes in `forging`.
//
// It moves on CSS animations of opacity and transform only, on purpose. A
// browser runs those on its compositor, which keeps going while the main
// thread is busy, and nearly every page bakes on the main thread: an icon
// driven from requestAnimationFrame stood still for the whole bake it was
// there to announce. The worker page still shows its point on the scene, which
// stops drawing under a main-thread bake and keeps turning under a worker one.
//
// Studio, like the panel beside it (ui.ts): no three.js, no renderer, no
// library (release/packaging/bundles.test.ts). The markup and the start/stop
// count are pure, and `forge.test.ts` pins them in Node, where there is no DOM.

/** What the page is doing: bringing a model in, or baking one. */
export type ForgeKind = "loading" | "baking";

/** The texture's size in texels: rows written top to bottom, like a VAT's frames. */
const COLUMNS = 4;
const ROWS = 4;
const TEXELS = COLUMNS * ROWS;

/** Three dots after a label, lit in turn. */
const DOTS = `<span class="forge-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>`;

/**
 * The forge's markup: a status the page shows while it loads or bakes, hidden
 * as built. Both icons are in it and `data-kind` says which one shows; the
 * texels are written in order, so the stylesheet can stagger them.
 */
export function forgeMarkup(): string {
  return (
    `<div id="forge" class="forge" role="status" aria-live="polite" data-kind="baking" hidden>` +
    `<div class="forge-state forge-loading">` +
    `<div class="forge-icon forge-row" aria-hidden="true">${`<i class="forge-texel"></i>`.repeat(COLUMNS)}</div>` +
    `<span class="forge-label">loading${DOTS}</span>` +
    `</div>` +
    `<div class="forge-state forge-baking">` +
    `<div class="forge-icon forge-texture" aria-hidden="true">${`<i class="forge-texel"></i>`.repeat(TEXELS)}</div>` +
    `<span class="forge-label">baking${DOTS}</span>` +
    `</div>` +
    `</div>`
  );
}

/** What the forge drives: the icon, shown in one state or hidden. */
export interface ForgeView {
  show(kind: ForgeKind): void;
  hide(): void;
}

/**
 * Start and stop, counted per state: the icon shows at the first start and
 * hides at the last stop, so a re-bake picked while another is still under the
 * forge (large, morph, encodings) does not take it down early. A bake outranks
 * a load, so a page that loads one thing while it bakes another says baking. A
 * stop with nothing running is ignored, so a failed bake's cleanup cannot push
 * a count below zero.
 */
export function forgeControl(view: ForgeView): { start(kind: ForgeKind): void; stop(kind: ForgeKind): void } {
  const running: Record<ForgeKind, number> = { loading: 0, baking: 0 };
  let shown: ForgeKind | null = null;
  const update = () => {
    const now: ForgeKind | null = running.baking > 0 ? "baking" : running.loading > 0 ? "loading" : null;
    if (now === shown) return;
    shown = now;
    if (now) view.show(now);
    else view.hide();
  };
  return {
    start(kind) {
      running[kind]++;
      update();
    },
    stop(kind) {
      if (running[kind] === 0) return;
      running[kind]--;
      update();
    },
  };
}

// ---------------------------------------------------------------- mounted

/**
 * How long the forge stays up after the last load or bake ends, in ms. A page
 * loads, then bakes, with a parse between the two: without the wait the icon
 * would blink out and back in at the hand-over.
 */
const LINGER_MS = 150;

/** The forge on the page, mounted the first time a load or bake starts. */
function mountedView(): ForgeView {
  let root: HTMLElement | null = null;
  let leaving = 0;

  return {
    show(kind) {
      clearTimeout(leaving);
      if (!root) {
        style();
        const template = document.createElement("template");
        template.innerHTML = forgeMarkup();
        root = template.content.firstElementChild as HTMLElement;
        document.body.append(root);
      }
      // Showing a state restarts its animations, so each bake fills from the first texel.
      root.dataset.kind = kind;
      root.hidden = false;
    },
    hide() {
      clearTimeout(leaving);
      leaving = window.setTimeout(() => {
        if (root) root.hidden = true;
      }, LINGER_MS);
    },
  };
}

const forge = forgeControl(mountedView());

/**
 * Until the forge has been painted. A bake on the main thread blocks the page
 * the moment it starts, so without this the icon would be shown and never
 * drawn, and its animations never handed to the compositor. A frame, then a
 * task after it; and a timeout beside them, because a hidden tab runs no
 * frames and a bake must not wait on one.
 */
function painted(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 100);
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** Show the forge, and resolve once it is on screen: call it before a bake. */
export function startForge(): Promise<void> {
  forge.start("baking");
  return painted();
}

/** Take the forge down: call it when the bake has ended, or failed. */
export function stopForge(): void {
  forge.stop("baking");
}

/**
 * Run a bake under the forge: shown before it starts, taken down when it ends
 * however it ends, and the bake's own result handed back.
 */
export async function forging<T>(bake: () => T | Promise<T>): Promise<T> {
  await startForge();
  try {
    return await bake();
  } finally {
    stopForge();
  }
}

/**
 * Run a load under the forge: shown while it is in flight, taken down when it
 * ends however it ends, and the load's own result handed back. A load leaves
 * the main thread free, so it waits for no paint.
 */
export async function loading<T>(load: () => Promise<T>): Promise<T> {
  forge.start("loading");
  try {
    return await load();
  } finally {
    forge.stop("loading");
  }
}

// ---------------------------------------------------------------- look

/** One fill, in ms: the texels are written one by one, held, then cleared together. */
const FILL_MS = 2200;
/** One pass of the loading row, in ms, and the step from one texel to the next. */
const PULSE_MS = 1100;
const PULSE_STEP_MS = 140;
/** A texel's side and the gap between two, in px. */
const TEXEL_PX = 8;
const GAP_PX = 3;

/**
 * One keyframe per texel, since a keyframe's stops cannot be variables: texel
 * i lights at its own moment, and every texel holds until the shared clear, so
 * the texture is seen whole before it empties.
 */
function texelKeyframes(): string {
  const off = `opacity: 0.12; transform: scale(0.5);`;
  const on = `opacity: 1; transform: scale(1);`;
  let css = "";
  for (let i = 0; i < TEXELS; i++) {
    const lit = 4 + i * 3.5;
    css +=
      `@keyframes forge-texel-${i} { 0%, ${lit}% { ${off} } ${lit + 5}%, 80% { ${on} } 90%, 100% { ${off} } }\n` +
      `.forge-texture .forge-texel:nth-child(${i + 1}) { animation-name: forge-texel-${i}; }\n`;
  }
  return css;
}

/** The loading row's texels, each a step behind the one before. */
function pulseDelays(): string {
  let css = "";
  for (let i = 0; i < COLUMNS; i++) css += `.forge-row .forge-texel:nth-child(${i + 1}) { animation-delay: ${i * PULSE_STEP_MS}ms; }\n`;
  return css;
}

// Written against the theme's tokens (src/theme.css), as the panel is.
const FORGE_CSS = /* css */ `
.forge {
  position: fixed; top: 50%; left: 50%; z-index: 3; transform: translate(-50%, -50%);
  padding: var(--space-4) var(--space-5) var(--space-3); border-radius: var(--radius);
  background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(8px);
  pointer-events: none; user-select: none; zoom: var(--ui-scale, 1);
}
.forge[hidden] { display: none; }
.forge-state { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
.forge[data-kind="loading"] .forge-baking, .forge[data-kind="baking"] .forge-loading { display: none; }
/* Both icons in the same square, so the card keeps its size from load to bake. */
.forge-icon {
  width: ${COLUMNS * TEXEL_PX + (COLUMNS - 1) * GAP_PX}px; height: ${ROWS * TEXEL_PX + (ROWS - 1) * GAP_PX}px;
  display: grid; grid-template-columns: repeat(${COLUMNS}, ${TEXEL_PX}px); grid-auto-rows: ${TEXEL_PX}px; gap: ${GAP_PX}px;
}
.forge-row { align-content: center; }
.forge-texel { border-radius: 2px; background: var(--accent); }
.forge-texture .forge-texel { animation: ${FILL_MS}ms cubic-bezier(0.3, 0, 0.2, 1) infinite both; }
${texelKeyframes()}
.forge-row .forge-texel { animation: forge-pulse ${PULSE_MS}ms ease-in-out infinite both; }
${pulseDelays()}
@keyframes forge-pulse {
  0%, 60%, 100% { opacity: 0.12; transform: translateY(0) scale(0.5); }
  25% { opacity: 1; transform: translateY(-5px) scale(1); }
}
.forge-label {
  font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2);
}
.forge-dots i { font-style: normal; animation: forge-dot 1200ms ease-in-out infinite both; }
.forge-dots i:nth-child(2) { animation-delay: 200ms; }
.forge-dots i:nth-child(3) { animation-delay: 400ms; }
@keyframes forge-dot { 0%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .forge-texture .forge-texel { animation-duration: ${FILL_MS * 2}ms; }
  .forge-row .forge-texel { animation-duration: ${PULSE_MS * 2}ms; }
}
`;

/** Put the stylesheet on the page, once. */
function style(): void {
  if (document.getElementById("forge-style")) return;
  const el = document.createElement("style");
  el.id = "forge-style";
  el.textContent = FORGE_CSS;
  document.head.append(el);
}
