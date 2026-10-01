// Labels that stand over something in the scene: HTML placed by three's
// `CSS2DRenderer`, so they take the theme's type, stay sharp at any zoom, need
// no font file, and read the same on both renderers.
//
// The renderer's layer sits over the canvas and under the HUD and the panel,
// and lets every pointer through to the orbit controls. The label's text is an
// inner element, zoomed by the theme's `--ui-scale` as the HUD is: zooming the
// element `CSS2DRenderer` positions would scale its placement as well.
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";

/** A layer the size of the window that draws every label in `scene`; render it after the scene, every frame. */
export function createLabelRenderer(): CSS2DRenderer {
  style();
  const labels = new CSS2DRenderer();
  labels.setSize(innerWidth, innerHeight);
  labels.domElement.className = "css2d-labels";
  document.body.append(labels.domElement);
  addEventListener("resize", () => labels.setSize(innerWidth, innerHeight));
  return labels;
}

/** A label, centred on its object's origin: move it as you would any object, and set its text through `textElement`. */
export function css2dLabel(text: string): CSS2DObject & { textElement: HTMLElement } {
  const holder = document.createElement("div");
  const inner = document.createElement("span");
  inner.className = "css2d-label";
  inner.textContent = text;
  holder.append(inner);
  return Object.assign(new CSS2DObject(holder), { textElement: inner });
}

function style(): void {
  if (document.getElementById("css2d-labels-style")) return;
  const el = document.createElement("style");
  el.id = "css2d-labels-style";
  el.textContent = /* css */ `
.css2d-labels { position: fixed; inset: 0; z-index: 1; pointer-events: none; }
.css2d-label {
  display: inline-block; zoom: var(--ui-scale, 1); padding: 3px var(--space-2); border-radius: var(--radius-sm);
  font: 600 var(--text-sm) / 1.2 var(--font-sans); white-space: nowrap; color: var(--ink);
  background: var(--surface); box-shadow: var(--shadow); transition: color 160ms;
}
.css2d-label[data-finished="true"] { color: var(--ink-3); }
`;
  document.head.append(el);
}
