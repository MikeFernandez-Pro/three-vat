// Copied from the examples (examples/src/webgpu/collapse.ts): the game is
// outside the workspace and imports nothing from the gallery (ADR-0044).
//
// A `BatchedMesh` drawn as one draw a run on WebGPU, which three does not do
// for itself (#65, ADR-0023, generalised to runs by ADR-0040).
//
// WebGPU has no multi-draw command. three's WebGPU backend therefore walks a
// batch's multi-draw and issues one `drawIndexed( count, 1, start, 0, i )` per
// visible instance — the whole crowd, once per pass — passing the slot `i` as
// `firstInstance` so the shader's `instanceIndex` comes out as `i`. That is
// what a `BatchedMesh` is for on WebGL, undone at the last step on WebGPU.
//
// Consecutive draws that name the *same* range — same count, same start, only
// `i` differs — are a **run**, and `instance_index` already includes
// `firstInstance`. So one `drawIndexed( count, runLength, start, 0, first )`
// puts the identical sequence of slots through the identical shader. The
// culling and sorting three did on the CPU are untouched, because they only
// ever decide `drawCount` and the order of the slots.
//
// A batch over one geometry is one run, and one draw. A batch over an atlas
// holds one geometry a character, so it is one draw a character when its
// instances stay grouped by character (`sortObjects = false`, instances added
// character by character), and more where depth sorting interleaves them.
//
// This reaches into `_draw`, a private method of three's backend, which is why
// it lives in the example and not in the library: the library may not depend on
// an underscore (ADR-0016's stop condition), and nothing here is about VAT —
// any batch would fold the same way. It is a workaround for three r186,
// written to fail *soft*: if `_draw` is not the function this file knows, or
// the backend is not WebGPU's, nothing is installed and the caller is told so,
// and the page falls back to three's own count rather than to a broken frame.
import type * as THREE from "three/webgpu";

/** What a `BatchedMesh` carries to the backend, as far as this file reads it. */
interface BatchLike {
  isBatchedMesh?: boolean;
  _multiDrawCount?: number;
  _multiDrawCounts?: ArrayLike<number>;
  _multiDrawStarts?: ArrayLike<number>;
}

/** The renderer's per-frame counter, as far as `_draw` calls it. */
interface InfoLike {
  update(object: unknown, count: number, instanceCount: number): void;
}

/** The two draw commands three's batched loop can issue on a pass encoder. */
interface EncoderLike {
  drawIndexed(indexCount: number, instanceCount: number, firstIndex: number, baseVertex: number, firstInstance: number): void;
  draw(vertexCount: number, instanceCount: number, firstVertex: number, firstInstance: number): void;
}

interface BackendLike {
  isWebGPUBackend?: boolean;
  _draw?: (...args: unknown[]) => unknown;
}

/**
 * The signature this file knows — three r186's
 * `_draw( renderObject, info, renderContextData, pipelineGPU, bindings,
 * vertexBuffers, drawParams, passEncoderGPU, currentSets, cameraIndexSlot = -1 )`.
 * The two arguments the collapse replaces are positional, so the arity is the
 * guard: a `_draw` of any other length is one whose positions this file cannot
 * vouch for, and it is left alone.
 */
const ARITY = 9;
const RENDER_OBJECT = 0;
const INFO = 1;
const PASS = 7;

/**
 * The runs in a batch's first `n` draws: at the slot that starts a run, how
 * many consecutive draws name the same range as it; `0` at every other slot.
 * A pure function of three's multi-draw arrays.
 */
export function drawRuns(counts: ArrayLike<number>, starts: ArrayLike<number>, n: number): Int32Array {
  const runs = new Int32Array(n);
  for (let i = 0; i < n; ) {
    let j = i + 1;
    while (j < n && counts[j] === counts[i] && starts[j] === starts[i]) j++;
    runs[i] = j - i;
    i = j;
  }
  return runs;
}

/**
 * The runs a batch is about to draw ({@link drawRuns}) — or `null` when it is
 * not a batch, or no run is longer than one draw, in which case there is
 * nothing to fold and three's loop is left to run.
 */
export function batchRuns(object: unknown): Int32Array | null {
  const batch = object as BatchLike | null | undefined;
  if (!batch || batch.isBatchedMesh !== true) return null;
  const n = batch._multiDrawCount;
  const counts = batch._multiDrawCounts;
  const starts = batch._multiDrawStarts;
  if (n === undefined || counts === undefined || starts === undefined || n < 2) return null;
  const runs = drawRuns(counts, starts, n);
  return runs.some((length) => length > 1) ? runs : null;
}

/**
 * The pass encoder three's loop will call once per draw, answering the first
 * draw of each run with one instanced draw of the whole run and swallowing the
 * rest. Its `firstInstance` is three's own for that draw, the run's first
 * slot. Everything else on the encoder goes straight through, bound to the
 * real object: a `GPURenderPassEncoder` is a platform object and its methods
 * check their receiver, so it is proxied rather than subclassed.
 */
export function coalescingEncoder<T extends EncoderLike>(pass: T, runs: Int32Array): T {
  let k = 0;
  return new Proxy(pass, {
    get(target, property, receiver) {
      if (property === "drawIndexed") {
        return (indexCount: number, _one: number, firstIndex: number, baseVertex: number, firstInstance: number) => {
          const run = runs[k++]!;
          if (run > 0) target.drawIndexed(indexCount, run, firstIndex, baseVertex, firstInstance);
        };
      }
      if (property === "draw") {
        return (vertexCount: number, _one: number, firstVertex: number, firstInstance: number) => {
          const run = runs[k++]!;
          if (run > 0) target.draw(vertexCount, run, firstVertex, firstInstance);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * The counter three's loop will `update` once per one-instance draw, told the
 * truth instead: one draw a run, of the run's instances. What the page reads
 * off `renderer.info.render.drawCalls` is then what the GPU was sent.
 */
export function coalescingInfo(info: InfoLike, runs: Int32Array): InfoLike {
  let k = 0;
  return {
    update(object, count) {
      const run = runs[k++]!;
      if (run > 0) info.update(object, count, run);
    },
  };
}

/** Backends already wrapped, so a page that calls this twice does not fold twice. */
const installed = new WeakSet<object>();

/**
 * Wrap this renderer's backend so a `BatchedMesh` is one draw a run: one draw
 * for a one-geometry batch, one a character for an atlas batch kept grouped.
 * Returns whether it did: `false` means the backend is not WebGPU's, or its
 * `_draw` is not the r186 function this file knows, and three's per-instance
 * draws are what the frame will have — a page should say which it is showing.
 */
export function collapseBatchRuns(renderer: THREE.WebGPURenderer): boolean {
  const backend = (renderer as unknown as { backend?: BackendLike }).backend;
  if (!backend || backend.isWebGPUBackend !== true) return false;
  if (installed.has(backend)) return true;

  const original = backend._draw;
  if (typeof original !== "function" || original.length !== ARITY) return false;

  backend._draw = function (this: BackendLike, ...args: unknown[]) {
    const renderObject = args[RENDER_OBJECT] as { object?: unknown } | undefined;
    const runs = batchRuns(renderObject?.object);
    if (runs !== null) {
      args[PASS] = coalescingEncoder(args[PASS] as EncoderLike, runs);
      args[INFO] = coalescingInfo(args[INFO] as InfoLike, runs);
    }
    return original.apply(this, args);
  };
  installed.add(backend);
  return true;
}
