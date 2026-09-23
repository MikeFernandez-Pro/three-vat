// A one-geometry `BatchedMesh` drawn as one draw on WebGPU, which three does
// not do for itself (#65, ADR-0023).
//
// WebGPU has no multi-draw command. three's WebGPU backend therefore walks a
// batch's multi-draw and issues one `drawIndexed( count, 1, start, 0, i )` per
// visible instance — the whole crowd, once per pass — passing the slot `i` as
// `firstInstance` so the shader's `instanceIndex` comes out as `i`. That is
// what a `BatchedMesh` is for on WebGL, undone at the last step on WebGPU.
//
// A batch carrying a VAT holds one geometry (`assertVATCarrier`), so every one
// of those draws names the *same* range: same count, same start, only `i`
// differs. And `instance_index` already includes `firstInstance`. So a single
// `drawIndexed( count, drawCount, start, 0, 0 )` puts the identical sequence
// `0..drawCount-1` through the identical shader — the culling and sorting
// three did on the CPU are untouched, because they only ever decide
// `drawCount` — and the batch is one draw again.
//
// This reaches into `_draw`, a private method of three's backend, which is why
// it lives in the example and not in the library: the library may not depend on
// an underscore (ADR-0016's stop condition), and nothing here is about VAT —
// any uniform batch would fold the same way. It is a workaround for three r186,
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
 * How many instances a batch is about to draw as one range — or `null` when it
 * is not a batch, draws nothing to fold (one draw is already one draw), or draws
 * more than one geometry, in which case three's loop is the right thing and is
 * left to run.
 */
export function uniformDrawCount(object: unknown): number | null {
  const batch = object as BatchLike | null | undefined;
  if (!batch || batch.isBatchedMesh !== true) return null;
  const n = batch._multiDrawCount;
  const counts = batch._multiDrawCounts;
  const starts = batch._multiDrawStarts;
  if (n === undefined || counts === undefined || starts === undefined || n < 2) return null;
  for (let i = 1; i < n; i++) {
    if (counts[i] !== counts[0] || starts[i] !== starts[0]) return null;
  }
  return n;
}

/**
 * The pass encoder three's loop will call `drawCount` times, answering the
 * first call with one instanced draw of them all and swallowing the rest.
 * Everything else on the encoder goes straight through, bound to the real
 * object: a `GPURenderPassEncoder` is a platform object and its methods check
 * their receiver, so it is proxied rather than subclassed.
 */
export function coalescingEncoder<T extends EncoderLike>(pass: T, instanceCount: number): T {
  let fired = false;
  return new Proxy(pass, {
    get(target, property, receiver) {
      if (property === "drawIndexed") {
        return (indexCount: number, _one: number, firstIndex: number, baseVertex: number) => {
          if (fired) return;
          fired = true;
          target.drawIndexed(indexCount, instanceCount, firstIndex, baseVertex, 0);
        };
      }
      if (property === "draw") {
        return (vertexCount: number, _one: number, firstVertex: number) => {
          if (fired) return;
          fired = true;
          target.draw(vertexCount, instanceCount, firstVertex, 0);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * The counter three's loop will `update` `drawCount` times, once per one-instance
 * draw, told the truth instead: one draw of `instanceCount` instances. What the
 * page reads off `renderer.info.render.drawCalls` is then what the GPU was sent.
 */
export function coalescingInfo(info: InfoLike, instanceCount: number): InfoLike {
  let counted = false;
  return {
    update(object, count) {
      if (counted) return;
      counted = true;
      info.update(object, count, instanceCount);
    },
  };
}

/** Backends already wrapped, so a page that calls this twice does not fold twice. */
const installed = new WeakSet<object>();

/**
 * Wrap this renderer's backend so a one-geometry `BatchedMesh` is one draw.
 * Returns whether it did: `false` means the backend is not WebGPU's, or its
 * `_draw` is not the r186 function this file knows, and three's per-instance
 * draws are what the frame will have — a page should say which it is showing.
 */
export function collapseUniformBatches(renderer: THREE.WebGPURenderer): boolean {
  const backend = (renderer as unknown as { backend?: BackendLike }).backend;
  if (!backend || backend.isWebGPUBackend !== true) return false;
  if (installed.has(backend)) return true;

  const original = backend._draw;
  if (typeof original !== "function" || original.length !== ARITY) return false;

  backend._draw = function (this: BackendLike, ...args: unknown[]) {
    const renderObject = args[RENDER_OBJECT] as { object?: unknown } | undefined;
    const n = uniformDrawCount(renderObject?.object);
    if (n !== null) {
      args[PASS] = coalescingEncoder(args[PASS] as EncoderLike, n);
      args[INFO] = coalescingInfo(args[INFO] as InfoLike, n);
    }
    return original.apply(this, args);
  };
  installed.add(backend);
  return true;
}
