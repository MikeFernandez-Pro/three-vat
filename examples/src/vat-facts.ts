// The numbers the demo states about the bake, and where on the texture each
// instance is reading right now.
//
// Kept free of three.js and the DOM — like crowd.ts, and for the same reason:
// these are the figures the demo's whole argument rests on ("the draw calls and
// the texture do not grow with the crowd"), so they are asserted in
// vat-facts.test.ts rather than eyeballed on the page.
//
// Every figure here is *derived*: the memory comes from the texture's own
// bytes, the draw-call cost from the bake's own material list. Nothing about
// the crowd — least of all its count — is an input.

/** The frame band of one clip: what a cursor is confined to. */
export interface FrameBand {
  startFrame: number;
  frames: number;
  fps: number;
}

/** One instance's playback, as the decode paths read it (CONTEXT.md). */
export interface PlaybackState {
  clip: FrameBand;
  /** Clock time this instance's animation began — in the past, for a desynced crowd. */
  startTime: number;
  speed: number;
}

/** A baked texture, seen only as the bytes it holds. `THREE.DataTexture` is one. */
export interface SizedTexture {
  image: { data: { byteLength: number } | null };
}

/** The parts of a `VAT` the HUD reads — structural, so the facts test needs no bake. */
export interface MeasurableVAT {
  /** Which encoding the layers below belong to; the HUD measures the vertex encoding's (ADR-0018). */
  encoding: "delta";
  vertexCount: number;
  totalFrames: number;
  positionTexture: SizedTexture;
  /** `null` for a VAT baked with `bakeNormals: false` — half the bytes, no strip. */
  normalTexture: SizedTexture | null;
  materials: readonly unknown[];
}

export interface VATFacts {
  /** Texture width: one column per vertex. */
  vertexCount: number;
  /** Texture height: every clip's rows, end to end. */
  totalFrames: number;
  /** Every baked layer's CPU bytes, or `null` if one kept none to measure. */
  bytes: number | null;
  /** What the crowd costs to draw: one call per source material, at any count. */
  drawCalls: number;
}

/** Read the HUD's figures off the bake. Note the absence of a count parameter. */
export function vatFacts(vat: MeasurableVAT): VATFacts {
  // Narrowed on the encoding before a layer is measured: a rig-encoded VAT has
  // other layers and other dimensions, and gets its own figures when it lands.
  if (vat.encoding !== "delta") throw new Error(`HUD facts: no figures for encoding "${String(vat.encoding)}" yet`);
  // Every layer this bake actually has. A VAT baked with `bakeNormals: false`
  // has one, and one is then the whole truth about what it costs.
  const layers = [vat.positionTexture, vat.normalTexture]
    .filter((texture) => texture !== null)
    .map((texture) => texture.image.data);
  return {
    vertexCount: vat.vertexCount,
    totalFrames: vat.totalFrames,
    // Every layer or none: a half-measured VAT would understate the cost by
    // exactly half, which is worse than declining to state it.
    bytes: layers.every((data) => data !== null)
      ? layers.reduce((total, data) => total + data!.byteLength, 0)
      : null,
    // Merging the materials would make this 1 — and break the robot's look.
    // ADR-0008: the bake keeps the source materials, so the crowd costs one
    // draw call each, and that is the number the demo is asking you to watch.
    drawCalls: vat.materials.length,
  };
}

const KB = 1024;
const MB = KB * KB;

/** A byte count as the HUD prints it. An unmeasurable one prints as a dash. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/**
 * The texture row an instance is sampling at `time` — the cursor's position.
 *
 * Deliberately mirrors `vatSample()` in src/webgl.ts (and its TSL twin) so the
 * panel cannot drift from the shader: same phase, same wrap, same band. A
 * cursor never leaves its clip's band, because `fract()` keeps the offset
 * inside one clip length and the band is exactly that long.
 */
export function frameRowAt({ clip, startTime, speed }: PlaybackState, time: number): number {
  const duration = clip.frames / clip.fps;
  const t = (((((time - startTime) * speed) / duration) % 1) + 1) % 1; // fract()
  return clip.startFrame + t * clip.frames;
}
