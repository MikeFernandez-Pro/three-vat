// The forge: a small texture filling texel by texel in the middle of the
// screen while a page bakes a VAT, so a visitor knows a texture is being made
// and the page has not frozen. Every page that bakes in the browser calls it
// round the bake.
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

/** The texture's size in texels: rows written top to bottom, like a VAT's frames. */
const COLUMNS = 4;
const ROWS = 4;
const TEXELS = COLUMNS * ROWS;

/**
 * The forge's markup: a status the page shows while it bakes, hidden as built.
 * The texels are written in order, so the stylesheet can stagger them.
 */
export function forgeMarkup(): string {
  return (
    `<div id="forge" class="forge" role="status" aria-live="polite" hidden>` +
    `<div class="forge-texture" aria-hidden="true">${`<i class="forge-texel"></i>`.repeat(TEXELS)}</div>` +
    `<span class="forge-label">baking` +
    `<span class="forge-dots" aria-hidden="true"><i>.</i><i>.</i><i>.</i></span>` +
    `</span>` +
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

/** The forge on the page, mounted the first time a bake starts. */
function mountedView(): ForgeView {
  let root: HTMLElement | null = null;

  return {
    show() {
      if (!root) {
        style();
        const template = document.createElement("template");
        template.innerHTML = forgeMarkup();
        root = template.content.firstElementChild as HTMLElement;
        document.body.append(root);
      }
      // Unhiding restarts every animation, so each bake fills from the first texel.
      root.hidden = false;
    },
    hide() {
      if (root) root.hidden = true;
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

/** One fill, in ms: the texels are written one by one, held, then cleared together. */
const FILL_MS = 2200;

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
      `.forge-texel:nth-child(${i + 1}) { animation-name: forge-texel-${i}; }\n`;
  }
  return css;
}

// Written against the theme's tokens (src/theme.css), as the panel is.
const FORGE_CSS = /* css */ `
.forge {
  position: fixed; top: 50%; left: 50%; z-index: 3; transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: var(--space-3);
  padding: var(--space-4) var(--space-5) var(--space-3); border-radius: var(--radius);
  background: var(--surface); box-shadow: var(--shadow); backdrop-filter: blur(8px);
  pointer-events: none; user-select: none;
}
.forge[hidden] { display: none; }
.forge-texture {
  display: grid; grid-template-columns: repeat(${COLUMNS}, 8px); grid-auto-rows: 8px; gap: 3px;
}
.forge-texel {
  border-radius: 2px; background: var(--accent);
  animation: ${FILL_MS}ms cubic-bezier(0.3, 0, 0.2, 1) infinite both;
}
${texelKeyframes()}
.forge-label {
  font-size: var(--text-xs); letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2);
}
.forge-dots i { font-style: normal; animation: forge-dot 1200ms ease-in-out infinite both; }
.forge-dots i:nth-child(2) { animation-delay: 200ms; }
.forge-dots i:nth-child(3) { animation-delay: 400ms; }
@keyframes forge-dot { 0%, 100% { opacity: 0.2; } 40% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .forge-texel { animation-duration: ${FILL_MS * 2}ms; }
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
