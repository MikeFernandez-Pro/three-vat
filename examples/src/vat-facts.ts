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
// the crowd — least of all its count — is an input. The one import is
// `three-vat` itself, for {@link cursorsAt}: where an instance is reading is
// the library's own question, and the panel asks it rather than answering it a
// second time.
import { resolveVATFrame } from "three-vat";
import type { VATInstance } from "three-vat";

/** A baked texture, seen only as the bytes it holds. `THREE.DataTexture` is one. */
export interface SizedTexture {
  image: { data: { byteLength: number } | null };
}

/**
 * The parts of a `VAT` the HUD reads — structural, so the facts test needs no
 * bake. A union on the encoding, as the library's own `VAT` is (ADR-0018):
 * each member names the layers it has and nothing the other has.
 */
export type MeasurableVAT = MeasurableDeltaVAT | MeasurableRigVAT;

/** A VAT under the vertex encoding: a column per vertex, one or two layers. */
export interface MeasurableDeltaVAT {
  encoding: "delta";
  vertexCount: number;
  totalFrames: number;
  positionTexture: SizedTexture;
  /** `null` for a VAT baked with `bakeNormals: false` — half the bytes, no strip. */
  normalTexture: SizedTexture | null;
  materials: readonly unknown[];
}

/** A VAT under the rig encoding: a slot per bone across, one rig texture. */
export interface MeasurableRigVAT {
  encoding: "rig";
  slotCount: number;
  totalFrames: number;
  rigTexture: SizedTexture;
  materials: readonly unknown[];
}

/** What every VAT costs, whichever encoding: its rows, its bytes, its draws. */
interface VATFactsBase {
  /** Texture height: every clip's rows, end to end. */
  totalFrames: number;
  /** Every baked layer's CPU bytes, or `null` if one kept none to measure. */
  bytes: number | null;
  /** What the crowd costs to draw: one call per source material, at any count. */
  drawCalls: number;
}

export interface DeltaVATFacts extends VATFactsBase {
  encoding: "delta";
  /**
   * Vertices a frame holds: the texture width, one column per vertex, wherever
   * they fit one row — and the figure the HUD prints even where a frame spans
   * rows (ADR-0030), because that is still what a frame is.
   */
  vertexCount: number;
}

export interface RigVATFacts extends VATFactsBase {
  encoding: "rig";
  /** Texture width, in slots: what a rig row is indexed by. Two texels each. */
  slotCount: number;
}

/**
 * The HUD's figures, narrowed as the VAT they were read from is — so a page
 * holding a vertex-encoded bake reads `vertexCount` and a rig-encoded one reads
 * `slotCount`, and neither can print the other's width.
 */
export type VATFacts = DeltaVATFacts | RigVATFacts;

/**
 * Every layer or none: a half-measured VAT would understate the cost by exactly
 * half, which is worse than declining to state it.
 */
function bytesOf(layers: SizedTexture[]): number | null {
  const data = layers.map((texture) => texture.image.data);
  return data.every((d) => d !== null) ? data.reduce((total, d) => total + d!.byteLength, 0) : null;
}

/** Read the HUD's figures off the bake. Note the absence of a count parameter. */
export function vatFacts(vat: MeasurableDeltaVAT): DeltaVATFacts;
export function vatFacts(vat: MeasurableRigVAT): RigVATFacts;
export function vatFacts(vat: MeasurableVAT): VATFacts;
export function vatFacts(vat: MeasurableVAT): VATFacts {
  // Merging the materials would make this 1 — and break the character's look.
  // ADR-0008: the bake keeps the source materials, so the crowd costs one draw
  // call each, and that is the number the demo is asking you to watch. The same
  // under either encoding: a rig row changes what a vertex reads, not what is drawn.
  const drawCalls = vat.materials.length;

  if (vat.encoding === "rig") {
    return {
      encoding: "rig",
      slotCount: vat.slotCount,
      totalFrames: vat.totalFrames,
      bytes: bytesOf([vat.rigTexture]),
      drawCalls,
    };
  }

  // Every layer this bake actually has. A VAT baked with `bakeNormals: false`
  // has one, and one is then the whole truth about what it costs.
  const layers = [vat.positionTexture, vat.normalTexture].filter((texture) => texture !== null);
  return {
    encoding: "delta",
    vertexCount: vat.vertexCount,
    totalFrames: vat.totalFrames,
    bytes: bytesOf(layers),
    drawCalls,
  };
}

/**
 * The texture's dimensions as the HUD prints them: what a column is, then the
 * rows — `7434 verts × 105 frames` under the vertex encoding, `49 slots × 105
 * frames` under the rig encoding. The unit is the argument: it is the width
 * that collapses when the encoding changes.
 */
export function formatDimensions(facts: VATFacts): string {
  const width = facts.encoding === "rig" ? `${facts.slotCount} slots` : `${facts.vertexCount} verts`;
  return `${width} × ${facts.totalFrames} frames`;
}

/**
 * A bake's wall-clock time as the HUD prints it. The example sets a rig bake
 * beside a vertex bake, three orders of magnitude apart, so the unit follows
 * the figure: a decimal under ten milliseconds, whole milliseconds under a
 * second, seconds to one decimal from there.
 */
export function formatBakeTime(ms: number): string {
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const KB = 1024;
const MB = KB * KB;

/** A byte count as the HUD prints it. An unmeasurable one prints as a dash. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < MB) return `${Math.round(bytes / KB)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

/** One mark on a texture strip: the row a band is being read at, and how much of it shows. */
export interface Cursor {
  /** The texture row, fractional — `row + mix` as the shader interpolates them. */
  row: number;
  /**
   * The share of the pose this band contributes, in `[0, 1]`, and the two
   * cursors of a transitioning instance sum to one — because the shader mixes
   * them: `mix( live, outgoing, weight )` (`vatDecode` in src/webgl.ts, and its
   * TSL twin). So a band's cursor is drawn at exactly the strength its pose is
   * showing at, and the pair hands over as the blend runs.
   */
  weight: number;
}

/**
 * Where an instance is reading the texture at `time` — one cursor per band it
 * is sampling.
 *
 * One cursor almost always; **two** while the instance is crossfading, because
 * the clip it is leaving is still playing (ADR-0025). The second is the same
 * read as the first: `resolveVATFrame` resolves the outgoing band through the
 * arithmetic it resolves the incoming one with, and hands back the weight the
 * shader blends by. A transition that has run out leaves the outgoing band
 * named in the pack at a weight of zero — nothing rewrites a row to say
 * "finished" — so a weightless band draws no cursor.
 *
 * Asking the library rather than transcribing it is what keeps the panel from
 * drifting from the shader: same phase, same wrap, same band, same blend, one
 * definition.
 */
export function cursorsAt(instance: VATInstance, time: number): Cursor[] {
  const frame = resolveVATFrame(instance, time);
  const { outgoing } = frame;
  // Zero unless a band is genuinely still showing — which is the one test for
  // "mid-transition" anywhere in these pages, because a finished transition
  // leaves its outgoing band named in the pack at a weight of nothing.
  const blend = outgoing && outgoing.weight > 0 ? outgoing.weight : 0;

  const cursors: Cursor[] = [{ row: frame.row + frame.mix, weight: 1 - blend }];
  if (outgoing && blend > 0) cursors.push({ row: outgoing.row + outgoing.mix, weight: blend });
  return cursors;
}
