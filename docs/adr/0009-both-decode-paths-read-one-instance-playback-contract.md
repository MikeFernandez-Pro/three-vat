# Both decode paths read one instance-playback contract

The WebGL and TSL decode paths reach feature parity, and the thing that makes
them equal is a single shared contract: **instance playback** — the per-instance
triple `{ clip, timeOffset, speed }`, carried as instanced attributes.
`addVATInstanceAttributes` moves from `three-vat/webgl` into the core entry
point, and both decoders read the same attribute names.

Before this, the two paths were not the same feature. WebGL read per-instance
clip, phase and rate from instanced attributes; TSL played one clip per material
with a phase hashed from `instanceIndex`, so a mixed-clip crowd was a WebGL-only
capability and the README had to say so. That makes the library's central
promise renderer-dependent, which is precisely the difference a library like
this exists to absorb.

Parity, not a narrower TSL path, and not TSL-as-reference:

- **Narrower TSL** dead-ends the planned official three.js example — a crowd demo
  that cannot mix clips is a worse demo than the WebGL one that already exists —
  and it pushes the asymmetry downstream into any drei wrapper.
- **TSL as the reference implementation, WebGL as legacy** is where the ecosystem
  goes eventually, but drei and `WebGLRenderer` are today's install base. Parity
  makes that promotion a docs change later rather than a rewrite.

The contract lives in core because it *is* the interface between the baker and
both decoders, and a contract with two definitions drifts the first time a field
is added — crossfade's reserved second clip index (ADR-0007) being the known
case. Nothing renderer-specific is involved (it is `InstancedBufferAttribute`
work on a `BufferGeometry`), so ADR-0005's bundle isolation is untouched. The
alternative — `three-vat/tsl` re-exporting from `three-vat/webgl` — would invert
that isolation.

## Convenience is symmetric, primitives stay

Each subpath also exports an identical `createVATMesh(vat, instances, options)`
over the existing primitives, absorbing the one asymmetry that remains real:
WebGL must attach a `customDepthMaterial` for correct instanced shadows, TSL
needs none because `positionNode` already feeds the depth pass. The same user
code then runs on either renderer with one import line changed, which is the
operative meaning of "convenient" here — and it is what keeps a future drei hook
a thin wrapper instead of a redesign.

The primitives (`addVATInstanceAttributes`, `patchVATMaterial`, `vatNodes`,
`createVATDepthMaterial`) stay exported. Users rendering onto something other
than a plain `InstancedMesh` — `@three.ez/instanced-mesh` being the motivating
case — need the escape hatch.

## Consequences

- `addInstancedVATAttributes` is re-exported from `three-vat/webgl` for one minor
  version under its old name, then dropped.
- The TSL path gains automated coverage: structural node-graph tests in CI (the
  graph builds, uniforms and attributes exist, an out-of-range `clipIndex`
  throws). These catch the realistic failure — a `three` release renaming
  `textureLoad`/`hash`/`instanceIndex` — which today would ship silently broken.
- A Playwright pixel-diff of the two paths rendering the same VAT is a manual
  release gate, not CI. It is the only check that can prove the paths decode
  *identically*, which is the claim parity commits us to.
- Hash-from-`instanceIndex` desync survives as the zero-config default when no
  instance-playback attributes are present.
