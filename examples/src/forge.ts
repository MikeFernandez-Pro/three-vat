// The forge: a hammer striking an anvil in the middle of the screen while a
// page bakes a VAT, so a visitor knows a texture is being made and the page
// has not frozen. Every page that bakes in the browser calls it round the bake.
//
// The swing is driven from requestAnimationFrame, never from a CSS animation,
// on purpose. A browser runs a CSS transform on its compositor, which keeps
// going while the main thread is busy; this hammer moves only when the main
// thread is free. So a bake on the main thread freezes it mid-swing and a bake
// in a worker leaves it striking, which is the worker page's whole point, made
// visible on the icon itself.
//
// Studio, like the panel beside it (ui.ts): no three.js, no renderer, no
// library (release/packaging/bundles.test.ts). The markup and the start/stop
// count are pure, and `forge.test.ts` pins them in Node, where there is no DOM.

/**
 * The forge's markup: a status the page shows while it bakes, hidden as built.
 * The hammer is a group of its own, so the swing turns it about its grip.
 */
export function forgeMarkup(): string {
  return (
    `<div id="forge" class="forge" role="status" aria-live="polite" hidden>` +
    `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">` +
    `<g class="forge-sparks"><path d="M22 30 L16 24 M30 28 L30 20 M38 30 L44 24" /></g>` +
    `<g class="forge-hammer">` +
    `<rect x="34" y="27" width="22" height="4" rx="2" />` +
    `<rect x="24" y="21" width="11" height="14" rx="2" />` +
    `</g>` +
    `<path class="forge-anvil" d="M8 36 H52 V42 H44 L40 47 H46 V54 H18 V47 H24 L20 42 H16 Q8 40 8 36 Z" />` +
    `</svg>` +
    `<span class="forge-label">baking</span>` +
    `</div>`
  );
}

/** What the forge drives: the icon, shown and hidden. */
export interface ForgeView {
  show(): void;
  hide(): void;
}

/**
 * Start and stop, counted: the icon shows at the first start and hides at the
 * last stop, so a re-bake picked while another is still under the forge (large,
 * morph, encodings) does not take it down early. A stop with nothing running is ignored, so a failed
 * bake's cleanup cannot push the count below zero.
 */
export function forgeControl(view: ForgeView): { start(): void; stop(): void } {
  let running = 0;
  return {
    start() {
      if (running++ === 0) view.show();
    },
    stop() {
      if (running === 0) return;
      if (--running === 0) view.hide();
    },
  };
}

// ---------------------------------------------------------------- mounted

/** One strike, in ms: the hammer rises, then drops onto the anvil. */
const STRIKE_MS = 640;
/** How far the hammer rises, in degrees about its grip. */
const RISE_DEG = 48;

/** The forge on the page, mounted the first time a bake starts. */
function mountedView(): ForgeView {
  let root: HTMLElement | null = null;
  let hammer: SVGGElement | null = null;
  let sparks: SVGGElement | null = null;
  let frame = 0;

  const swing = (now: number) => {
    const p = (now % STRIKE_MS) / STRIKE_MS;
    // Up slowly, easing out; down fast, easing in; and the sparks flash on the strike.
    const angle = p < 0.75 ? RISE_DEG * (1 - (1 - p / 0.75) ** 2) : RISE_DEG * (1 - ((p - 0.75) / 0.25) ** 2);
    hammer!.setAttribute("transform", `rotate(${angle.toFixed(1)} 55 29)`);
    sparks!.style.opacity = String(p < 0.15 ? 1 - p / 0.15 : 0);
    frame = requestAnimationFrame(swing);
  };

  return {
    show() {
      if (!root) {
        style();
        const template = document.createElement("template");
        template.innerHTML = forgeMarkup();
        root = template.content.firstElementChild as HTMLElement;
        hammer = root.querySelector<SVGGElement>(".forge-hammer");
        sparks = root.querySelector<SVGGElement>(".forge-sparks");
        document.body.append(root);
      }
      root.hidden = false;
      frame = requestAnimationFrame(swing);
    },
    hide() {
      cancelAnimationFrame(frame);
      if (root) root.hidden = true;
    },
  };
}

const forge = forgeControl(mountedView());

/**
 * Until the forge has been painted. A bake on the main thread blocks the page
 * the moment it starts, so without this the icon would be shown and never
 * drawn. A frame, then a task after it; and a timeout beside them, because a
 * hidden tab runs no frames and a bake must not wait on one.
 */
function painted(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 100);
    requestAnimationFrame(() => setTimeout(resolve, 0));
  });
}

/** Show the forge, and resolve once it is on screen: call it before a bake. */
export function startForge(): Promise<void> {
  forge.start();
  return painted();
}

/** Take the forge down: call it when the bake has ended, or failed. */
export function stopForge(): void {
  forge.stop();
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

// ---------------------------------------------------------------- look
// Written against the theme's tokens (src/theme.css), as the panel is.
const FORGE_CSS = /* css */ `
.forge {
  position: fixed; top: 50%; left: 50%; z-index: 3; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-1);
  padding: var(--space-3) var(--space-4) var(--space-2); border-radius: var(--radius);
  background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(8px);
  pointer-events: none; user-select: none;
}
.forge[hidden] { display: none; }
.forge-hammer { fill: var(--ink); }
.forge-anvil { fill: var(--ink-2); }
.forge-sparks { stroke: var(--accent); stroke-width: 2.5; stroke-linecap: round; fill: none; opacity: 0; }
.forge-label { font-size: var(--text-xs); letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-3); }
`;

/** Put the stylesheet on the page, once. */
function style(): void {
  if (document.getElementById("forge-style")) return;
  const el = document.createElement("style");
  el.id = "forge-style";
  el.textContent = FORGE_CSS;
  document.head.append(el);
}
