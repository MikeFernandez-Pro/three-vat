// The baked VAT, on screen: the demo's evidence, not a diagnostic (ADR-0012).
// The position and normal textures are drawn as tall strips down the right-hand
// side — frames run down y, so a vertical panel fits them without distortion
// and leaves the horizon clear — with one cursor per instance marking the frame
// row that instance is sampling *right now*.
//
// That field of cursors is the argument. Raise the count and the cursors fan
// out across the clip bands while the strips behind them do not change size:
// one texture, one draw, hundreds of independent animations.
//
// Drawn with canvas 2D rather than a second render pass: `bakeVAT` builds the
// texel data on the CPU, so `texture.image.data` is already sitting in memory.
// No shader, no extra draw call, and what you see is literally the baked bytes.
import * as THREE from "three";
import type { DeltaVAT, VAT } from "three-vat";
import { frameRowAt, type PlaybackState } from "./vat-facts.js";

export interface TexturePanelEntry {
  name: string;
  vat: VAT;
  /**
   * The instances to draw cursors for, read fresh each frame so they follow the
   * count slider. `PlaybackState` and nothing more: one instance-playback
   * contract, read here exactly as the decode paths read it (CONTEXT.md).
   */
  instances: () => PlaybackState[];
}

// Strips are sized in CSS, not pixels: `min()` keeps them legible on a desktop
// and out of the way on a phone, and the cursor overlay measures itself, so
// there is no resize handler anywhere in this file.
const STRIP_WIDTH = "min(78px, 13vw)";
const STRIP_GAP = 6; // px between the two strips
/**
 * The panel is exactly as wide as the strips it holds, and its labels wrap
 * inside that. Without this a long label would set the width and the panel
 * would creep left across the HUD on a phone. Each page reserves the same
 * expression on the other side (see `#hud` in index.html, the WebGL demo, and
 * in webgpu_crowd.html).
 *
 * A VAT baked with `bakeNormals: false` has one layer, so the panel is one
 * strip wide — the width follows the strips rather than the strips padding out
 * a fixed width.
 */
const panelWidth = (stripsPerEntry: number) =>
  `calc(${STRIP_WIDTH} * ${stripsPerEntry} + ${STRIP_GAP * (stripsPerEntry - 1)}px)`;
const CURSOR_COLOR = "rgba(255,255,255,0.62)";
const BAND_LABEL_COLOR = "rgba(255,255,255,0.8)";

/**
 * Render a VAT texture to a canvas at 1 texel : 1 pixel.
 *
 * Position deltas are signed and small, so they are normalized by the clip's
 * `maxDelta` into 0..1 around a neutral grey — displayed raw they would be a
 * near-black rectangle. Normals are already roughly unit-length, so the usual
 * `n * 0.5 + 0.5` gives the familiar lilac normal-map look.
 */
function textureToCanvas(
  texture: THREE.DataTexture,
  mode: "delta" | "normal",
  scale: number,
): HTMLCanvasElement {
  const { width, height, data } = texture.image as {
    width: number;
    height: number;
    data: THREE.TypedArray;
  };
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(width, height);

  // `scale` maps the signed source range onto ±0.5 about mid-grey.
  const k = mode === "delta" ? 0.5 / (scale || 1) : 0.5;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      // A bake's texels are always `Float32Array`, so this reads as a float.
      const v = (data[o + c] as number) * k + 0.5;
      img.data[o + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Horizontal rules where one clip's band of rows ends and the next begins. */
function drawClipBands(canvas: HTMLCanvasElement, vat: VAT) {
  if (vat.clips.length < 2) return; // nothing to separate
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  for (const clip of vat.clips) {
    if (clip.startFrame === 0) continue;
    ctx.fillRect(0, clip.startFrame, canvas.width, 1);
  }
}

function label(text: string, dim = false): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `font:10px ui-monospace,Consolas,monospace;color:#fff;opacity:${
    dim ? 0.55 : 0.9
  };margin:0 0 2px;text-shadow:0 1px 2px rgba(0,0,0,.8);text-align:right;` +
    // Wrap rather than widen: the panel's width belongs to the strips.
    "overflow-wrap:anywhere";
  return el;
}

/** One texture strip: the baked bytes, and the overlay the cursors live on. */
interface Strip {
  entry: TexturePanelEntry;
  overlay: HTMLCanvasElement;
  /** Clip names are drawn on one strip only, so the pair stays uncluttered. */
  showsClipNames: boolean;
}

/**
 * Assemble one strip: the baked texture underneath, a transparent overlay on
 * top, and a `ResizeObserver` keeping the overlay's pixel grid equal to
 * whatever size CSS gave it. Cursor drawing then works in the overlay's own
 * pixels, at any viewport size, with no resize handling of its own.
 */
function buildStrip(canvas: HTMLCanvasElement): {
  wrap: HTMLElement;
  overlay: HTMLCanvasElement;
} {
  canvas.style.cssText =
    `display:block;width:${STRIP_WIDTH};height:100%;` +
    "image-rendering:pixelated;border-radius:2px";

  const overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%";

  const wrap = document.createElement("div");
  wrap.style.cssText = "position:relative;flex:1 1 auto;min-height:0";
  wrap.append(canvas, overlay);

  new ResizeObserver(([observed]) => {
    const box = observed!.contentRect;
    overlay.width = Math.max(1, Math.round(box.width));
    overlay.height = Math.max(1, Math.round(box.height));
  }).observe(wrap);

  return { wrap, overlay };
}

/**
 * The member the panel knows how to draw, narrowed on the encoding (ADR-0018).
 * A rig texture is a different picture — slots across, not vertices — and gets
 * its own strip when that encoding lands; until then it is refused by name
 * rather than drawn as if it held deltas.
 */
function drawable(vat: VAT): DeltaVAT {
  if (vat.encoding !== "delta") throw new Error(`texture panel: no strip for encoding "${String(vat.encoding)}" yet`);
  return vat;
}

/**
 * Build the panel. Returns the root element (already styled, caller appends it)
 * and an `update(time)` to call each frame with the same clock that drives
 * `uVatTime` — that shared clock is what keeps the cursors honest.
 */
export function createTexturePanel(entries: TexturePanelEntry[]) {
  // One strip per baked layer. Every entry on a page comes from the same bake
  // settings, so the widest entry sets the panel and the rest line up under it.
  const stripsPerEntry = Math.max(1, ...entries.map((e) => (drawable(e.vat).normalTexture ? 2 : 1)));

  const root = document.createElement("div");
  // Named like the HUD's readouts are named (see each page's `index.html`), and
  // for the same reason: the release suite reads this panel to confirm it is in
  // frame in the captured hero image, and a check that finds it by size instead
  // would quietly start measuring the next small canvas anyone adds.
  root.id = "texture-panel";
  root.style.cssText =
    `position:fixed;right:10px;top:10px;bottom:10px;width:${panelWidth(stripsPerEntry)};` +
    "z-index:2;display:flex;flex-direction:column;gap:10px;align-items:flex-end;" +
    "pointer-events:none";

  const strips: Strip[] = [];

  for (const entry of entries) {
    const { vat } = entry;

    const block = document.createElement("div");
    block.style.cssText = "display:flex;flex-direction:column;flex:1 1 auto;min-height:0";
    block.append(
      label(entry.name),
      label(`${vat.vertexCount} verts × ${vat.totalFrames} frames`, true),
    );

    const row = document.createElement("div");
    row.style.cssText = `display:flex;gap:${STRIP_GAP}px;flex:1 1 auto;min-height:0`;
    const maxDelta = Math.max(...vat.clips.map((c) => c.maxDelta));

    const { positionTexture, normalTexture } = drawable(vat);
    const layers: [THREE.DataTexture, "delta" | "normal", string][] = [
      [positionTexture, "delta", "position (Δ)"],
    ];
    // Absent for a `bakeNormals: false` bake: no texture, so no strip, and the
    // panel's own width already accounts for it.
    if (normalTexture) layers.push([normalTexture, "normal", "normal"]);

    for (const [texture, mode, name] of layers) {
      const canvas = textureToCanvas(texture, mode, maxDelta);
      drawClipBands(canvas, vat);
      const { wrap, overlay } = buildStrip(canvas);

      const column = document.createElement("div");
      column.style.cssText = "display:flex;flex-direction:column;min-height:0";
      column.append(wrap, label(name, true));
      row.append(column);

      strips.push({ entry, overlay, showsClipNames: strips.length === 0 });
    }

    block.append(row);
    root.append(block);
  }

  root.append(label("one cursor per robot", true));

  /**
   * Draw every instance's cursor. One `fillRect` per instance per strip: at the
   * top of the count that is a few hundred one-pixel lines, which canvas 2D
   * does without noticing — and unlike a DOM node each, it costs nothing at all
   * while the panel is hidden.
   */
  function update(time: number) {
    for (const { entry, overlay, showsClipNames } of strips) {
      const { vat } = entry;
      const { width, height } = overlay;
      const ctx = overlay.getContext("2d")!;
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = CURSOR_COLOR;
      for (const instance of entry.instances()) {
        const y = (frameRowAt(instance, time) / vat.totalFrames) * height;
        ctx.fillRect(0, Math.round(y), width, 1);
      }

      // Each band named where it begins, on one strip only — so a reader who
      // drags the count can see it is "Walking" that has just lit up.
      if (!showsClipNames) continue;
      ctx.fillStyle = BAND_LABEL_COLOR;
      ctx.font = "9px ui-monospace,Consolas,monospace";
      for (const clip of vat.clips) {
        const y = (clip.startFrame / vat.totalFrames) * height;
        ctx.fillText(clip.name, 3, y + 10);
      }
    }
  }

  return { root, update };
}
