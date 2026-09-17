// An on-screen view of the baked VAT textures — the point of the demo made
// visible. The position and normal textures are drawn as strips, with cursors
// marking the frame rows the shader is sampling *right now*. With a mixed-clip
// crowd those cursors sit in different clip bands, which is the claim made
// visible: one texture, one draw, independent animations.
//
// Drawn with canvas 2D rather than a second render pass: `bakeVAT` builds the
// texel data on the CPU, so `texture.image.data` is already sitting in memory.
// No shader, no extra draw call, and what you see is literally the baked bytes.
import * as THREE from "three";
import type { VAT, VATClip } from "three-vat";

/** The per-instance playback state a cursor is drawn for. */
export interface DebugInstance {
  /** Which clip band this instance reads — cursors land in different bands. */
  clip: VATClip;
  timeOffset: number;
  speed: number;
}

export interface DebugEntry {
  name: string;
  vat: VAT;
  /** Read fresh each frame so a flock rebuild (count change) is picked up. */
  instances: () => DebugInstance[];
}

const STRIP_WIDTH = 280; // px; every strip is scaled to this regardless of vertex count
const ROW_HEIGHT = 2; // px per frame row — rows are stretched vertically to stay legible
const CURSOR_COUNT = 4; // 1 reference + 3 real instances, to show desync

/** Read one texel channel as a float. A bake's texels are always `Float32Array`. */
function makeReader(data: THREE.TypedArray): (i: number) => number {
  return (i) => data[i] as number;
}

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
  const read = makeReader(data);

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
      const v = read(o + c) * k + 0.5;
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
  };margin:0 0 2px;text-shadow:0 1px 2px rgba(0,0,0,.8)`;
  return el;
}

interface Strip {
  entry: DebugEntry;
  cursors: HTMLElement[];
  heightPx: number;
}

/**
 * Build the panel. Returns the root element (already styled, caller appends it)
 * and an `update(time)` to call each frame with the same clock that drives
 * `uVatTime` — that shared clock is what keeps the cursors honest.
 */
export function createVATDebugPanel(entries: DebugEntry[]) {
  const root = document.createElement("div");
  root.style.cssText =
    "position:fixed;right:10px;bottom:10px;z-index:2;display:flex;" +
    "flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none";

  const strips: Strip[] = [];

  for (const entry of entries) {
    const { vat } = entry;
    const heightPx = vat.totalFrames * ROW_HEIGHT;

    const block = document.createElement("div");
    block.append(
      label(
        `${entry.name} · ${vat.vertexCount} verts × ${vat.totalFrames} frames`,
      ),
    );

    const cursors: HTMLElement[] = [];
    const maxDelta = Math.max(...vat.clips.map((c) => c.maxDelta));

    for (const [texture, mode, name] of [
      [vat.positionTexture, "delta", "position (Δ)"],
      [vat.normalTexture, "normal", "normal"],
    ] as const) {
      const canvas = textureToCanvas(texture, mode, maxDelta);
      drawClipBands(canvas, vat);
      canvas.style.cssText =
        `display:block;width:${STRIP_WIDTH}px;height:${heightPx}px;` +
        "image-rendering:pixelated;border-radius:2px";

      // The canvas and its cursors share a positioned wrapper so cursor `top`
      // is expressed directly in strip pixels.
      const wrap = document.createElement("div");
      wrap.style.cssText = `position:relative;margin-bottom:4px;width:${STRIP_WIDTH}px`;
      wrap.append(canvas);

      for (let i = 0; i < CURSOR_COUNT; i++) {
        const cursor = document.createElement("div");
        const primary = i === 0;
        cursor.style.cssText =
          `position:absolute;left:0;width:100%;height:${primary ? 2 : 1}px;` +
          `background:${primary ? "#ff5a5a" : "rgba(255,255,255,.75)"};` +
          "top:0;will-change:transform";
        wrap.append(cursor);
        cursors.push(cursor);
      }

      block.append(label(name, true), wrap);
    }

    root.append(block);
    strips.push({ entry, cursors, heightPx });
  }

  root.append(
    label("red = reference · white = real instances (desync + clip choice)", true),
  );

  /**
   * Position every cursor. The row expression deliberately mirrors
   * `vatSample()` in src/webgl.ts so the panel cannot drift from the shader.
   */
  function update(time: number) {
    for (const { entry, cursors, heightPx } of strips) {
      const { vat } = entry;
      const instances = entry.instances();
      const reference = vat.clips[0];
      if (!reference) continue;

      for (let i = 0; i < cursors.length; i++) {
        const slot = i % CURSOR_COUNT;
        // Slot 0 is a fixed reference on clip 0 (offset 0, speed 1); the rest
        // track real instances. With a mixed-clip crowd those instances sit in
        // *different clip bands*, which is the thing worth seeing.
        const inst = slot === 0 ? null : instances[slot - 1];
        const clip = inst ? inst.clip : reference;
        const timeOffset = inst ? inst.timeOffset : 0;
        const speed = inst ? inst.speed : 1;

        const duration = clip.frames / clip.fps;
        const t = ((((time * speed + timeOffset) / duration) % 1) + 1) % 1; // fract()
        const row = clip.startFrame + t * clip.frames;
        const y = (row / vat.totalFrames) * heightPx;
        cursors[i]!.style.transform = `translateY(${y.toFixed(1)}px)`;
      }
    }
  }

  return { root, update };
}
