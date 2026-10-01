// The merged-materials page's swatch diagram: each material the bake draws
// with, the colour it draws in, and the draw it costs. Three materials and
// three draws with the merge off; one white material with the three colours in
// its vertices, and one draw, with it on.
//
// Read off the bake, never written down: the materials are `vat.materials`,
// and a merged material's colours are the ones its triangles carry in the
// merged geometry's `color` attribute (ADR-0028). A diagram drawn from a list
// of its own would agree with any bake, including a wrong one.
//
// Studio, like the panel and the forge: no three.js, no renderer, no library
// (release/packaging/bundles.test.ts). The facts and the markup are pure, and
// `swatches.test.ts` checks them against real bakes in Node.

/**
 * Loud colours the page's "tint by draw" switch paints each draw in, in draw
 * order, as sRGB hex. The diagram keys each draw to its tint, so a visitor can
 * tell which part of the robot was which draw.
 */
export const TINTS = [0xff2d55, 0x00c2ff, 0xffcc00, 0x34c759, 0xaf52de, 0xff9500] as const;

/** A baked material, seen only as the diagram reads it. three's materials are this. */
export interface SwatchMaterial {
  name: string;
  /** Linear, as three keeps a material's colour in its working space. */
  color?: { r: number; g: number; b: number };
  vertexColors?: boolean;
}

/** A baked geometry, seen only as the diagram reads it: its triangles, their materials, their colours. */
export interface SwatchGeometry {
  index: { array: ArrayLike<number> } | null;
  groups: readonly { start: number; count: number; materialIndex?: number }[];
  getAttribute(name: "color"): { array: ArrayLike<number>; itemSize: number } | undefined;
}

/** The parts of a `VAT` the diagram reads. */
export interface SwatchVAT {
  materials: readonly SwatchMaterial[];
  geometry: SwatchGeometry;
}

/** One material, as the diagram draws it. Colours are `#rrggbb`, sRGB. */
export interface Swatch {
  name: string;
  /** The material's own colour, or white for one with none. */
  color: string;
  /** The distinct colours its vertices carry, in the order its triangles meet them; empty unless it reads them. */
  vertexColors: string[];
}

/** What the diagram shows: every material, and the draws they cost a pass. */
export interface SwatchFacts {
  materials: Swatch[];
  /** One draw per material, whatever the count (ADR-0008). */
  draws: number;
}

/** A linear channel in sRGB, as a byte: three's own transfer function, for a colour to be shown on a page. */
function srgbByte(linear: number): number {
  const c = Math.min(1, Math.max(0, linear));
  const srgb = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function hexOf(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => srgbByte(c).toString(16).padStart(2, "0")).join("")}`;
}

/** The distinct colours one material's triangles carry, read through the index of its groups. */
function vertexColorsOf(geometry: SwatchGeometry, materialIndex: number): string[] {
  const color = geometry.getAttribute("color");
  if (!color) return [];
  const seen = new Set<string>();
  for (const group of geometry.groups) {
    if ((group.materialIndex ?? 0) !== materialIndex) continue;
    for (let i = group.start; i < group.start + group.count; i++) {
      const v = geometry.index ? geometry.index.array[i]! : i;
      const o = v * color.itemSize;
      seen.add(hexOf(color.array[o]!, color.array[o + 1]!, color.array[o + 2]!));
    }
  }
  return [...seen];
}

/** Read the diagram off the bake. */
export function swatchFacts(vat: SwatchVAT): SwatchFacts {
  const materials = vat.materials.map((material, i) => ({
    name: material.name,
    color: material.color ? hexOf(material.color.r, material.color.g, material.color.b) : "#ffffff",
    vertexColors: material.vertexColors ? vertexColorsOf(vat.geometry, i) : [],
  }));
  return { materials, draws: materials.length };
}

// ---------------------------------------------------------------- markup

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The tint draw `draw` is painted in, as sRGB hex: the page's and the diagram's one rule. */
export const tintOf = (draw: number): number => TINTS[draw % TINTS.length]!;

const tintHex = (draw: number) => `#${tintOf(draw).toString(16).padStart(6, "0")}`;

/** A material's chip: its colour, and for one reading vertex colours, those colours inside it. */
function chip({ color, vertexColors }: Swatch): string {
  const inside = vertexColors.map((c) => `<i style="background:${c}"></i>`).join("");
  return `<span class="swatch-chip" style="background:${color}">${inside}</span>`;
}

/**
 * The diagram: one row per material, its chip and name leading to the draw it
 * costs, and that draw keyed to the tint the page paints it with.
 */
export function swatchMarkup(facts: SwatchFacts): string {
  const rows = facts.materials
    .map((swatch, i) => {
      const note = swatch.vertexColors.length > 0 ? `<span class="swatch-note">vertex colours</span>` : "";
      return (
        `<div class="swatch-row">${chip(swatch)}` +
        `<span class="swatch-name">${escapeHtml(swatch.name)}${note}</span>` +
        `<span class="swatch-arrow" aria-hidden="true">→</span>` +
        `<span class="swatch-draw"><span class="swatch-tint" style="background:${tintHex(i)}"></span>draw ${i + 1}</span>` +
        `</div>`
      );
    })
    .join("");
  return `<div class="swatches">${rows}</div>`;
}

// ---------------------------------------------------------------- mounted

/** Draw the diagram into the HUD element the page declares, by its id. */
export function showSwatches(id: string, facts: SwatchFacts): void {
  style();
  const el = document.getElementById(id);
  if (!el) throw new Error(`the page declares no #${id} element`);
  el.innerHTML = swatchMarkup(facts);
}

// Written against the theme's tokens (src/theme.css), as the panel is.
const SWATCH_CSS = /* css */ `
.swatches { display: grid; gap: var(--space-1); margin-top: var(--space-3); font-size: var(--text-sm); }
.swatch-row { display: grid; grid-template-columns: 22px 1fr auto auto; align-items: center; gap: var(--space-2); }
.swatch-chip {
  display: flex; align-items: flex-end; gap: 2px; width: 22px; height: 22px; padding: 3px;
  border-radius: var(--radius-sm); box-shadow: inset 0 0 0 1px var(--rule);
}
.swatch-chip i { flex: 1; height: 8px; border-radius: 1px; }
.swatch-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.swatch-note { margin-left: var(--space-2); font-size: var(--text-xs); color: var(--ink-3); }
.swatch-arrow { color: var(--ink-3); }
.swatch-draw { display: inline-flex; align-items: center; gap: var(--space-1); font-family: var(--font-mono); color: var(--ink-2); }
.swatch-tint { width: 8px; height: 8px; border-radius: 50%; }
`;

/** Put the stylesheet on the page, once. */
function style(): void {
  if (document.getElementById("swatch-style")) return;
  const el = document.createElement("style");
  el.id = "swatch-style";
  el.textContent = SWATCH_CSS;
  document.head.append(el);
}
