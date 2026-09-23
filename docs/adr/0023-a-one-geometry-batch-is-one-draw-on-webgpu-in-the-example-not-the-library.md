# A one-geometry batch is one draw on WebGPU, in the example and not the library

The WebGPU batched page reported **194 draw calls** for a crowd of 96, where its
WebGL pair reported 3 (#65). The number was three's, not the page's, and it
undid the page's whole argument: a `BatchedMesh` is the carrier you reach for
so that a crowd is one draw, and on WebGPU it was not.

## Why three draws a batch once per instance

WebGPU has no multi-draw command. WebGL has `WEBGL_multi_draw`, and three's
WebGL backend draws a batch with one `multiDrawElements`; the WebGPU backend has
nothing to hand the same list to, so `WebGPUBackend._draw` walks it and issues
one `drawIndexed( counts[i], 1, starts[i] / bpe, 0, i )` per visible instance,
passing the slot `i` as `firstInstance` so the shader's `instanceIndex` is `i`.
The shadow pass does it again. This is by design and it is not close to
changing: the multi-draw command that would fix it (`multiDrawIndirect`) is a
Chrome experiment outside the WebGPU spec, and three's own attempt at a better
path (mrdoob/three.js#30645) has been a draft since March 2025 and would still
issue one call per instance.

## Why this carrier can fold them back

A batch carrying a VAT holds **one geometry** — `assertVATCarrier` refuses a
second, because a sampler is a uniform per draw call and two characters are two
textures (ADR-0002, `docs/usage.md`). So every draw in three's loop names the
same range: same count, same start, only `i` differs. And `instance_index`
includes `firstInstance`. A single `drawIndexed( count, drawCount, start, 0, 0 )`
therefore puts the identical sequence `0..drawCount-1` through the identical
shader. three's culling and sorting are untouched, because they only ever decide
`drawCount` and the order of the slots; the pack is still read through
`batchIndirectIndex`, which is what makes the permutation safe in the first
place (ADR-0016). Measured: **194 → 4**, the frame pixel for pixel the same.

## Decision

The fold ships in the **example** — `examples/src/webgpu/collapse.ts`, used by
the WebGPU batched page — and not in the library.

- **It is not about VAT.** Any `BatchedMesh` whose drawn slots share one range
  folds the same way; a crowd of static rocks gets the same 194 → 4. A VAT
  library shipping a general three-renderer workaround would make three-vat
  the owner of three's draw loop.
- **It depends on an underscore.** The fold wraps `_draw`, a private method of
  three's backend, and ADR-0016's stop condition is that this library does not
  depend on a private three.js API. A demo may: the reach is contained in one
  file anyone can read and delete, and it is under nobody's semver.
- **It is temporary.** The right home is three itself — detecting equal ranges
  and issuing one draw needs no extension and no vendor — and a library API
  built around it would be one to deprecate the day upstream moves.

## How it fails

Softly, and audibly. The wrapper installs only on a WebGPU backend whose
`_draw` has the arity of r186's; any other three is left alone, the installer
returns `false`, and the page's HUD says what it is then showing — three's own
count, one draw per visible instance per pass — rather than a number the reader
cannot reconcile with the crowd. Never a broken frame.

## What the usage guide says

That on WebGPU three draws a batch once per visible instance; that a VAT batch
can fold that back and the example does; where the file is and why the library
does not carry it; and to drop it the day three collapses a uniform batch
itself. A caller who copies it owns it, and is told so.
