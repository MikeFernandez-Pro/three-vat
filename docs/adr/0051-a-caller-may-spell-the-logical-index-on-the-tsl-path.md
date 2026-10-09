# A caller may spell the logical index, on the TSL path

> **Amends [ADR-0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)**, whose scope says the instance-id source is hard-coded, "no pluggable seam".

`vatNodes` takes a `logicalIndex` (#167): an int node, spelled by the caller, at which the decode reads the instance's row of the **playback texture** and from which it hashes the desync, in place of the carrier's own spelling — `instanceIndex` on an `InstancedMesh`, `batchIndirectIndex` on a `BatchedMesh`. It is for a crowd drawn through an indirection the caller built itself, which puts an instance in a **drawn slot** no carrier knows how to map back. The option is refused together with `carrier`, by name, when `vatNodes` is called. It exists on the TSL path only.

## Why a seam now

ADR-0016 refused a pluggable id source because a seam with one implementation is speculative, and the second carrier then cost one expression, chosen from the carrier the caller names. That reasoning held while every way to draw a crowd was a three.js mesh this library could name. It stops holding for a draw three does not mediate.

The case is Last Light's rats (#166, prototyped before it was specified). On WebGPU a compute pass culls every rat against the view into a survivor list, counts the survivors into the arguments of one `drawIndexedIndirect`, and the vertex stage reads which rat it draws out of the list at `instanceIndex`. `instanceIndex` there is the drawn slot: survivor 0 is whichever rat the cull kept first. No carrier can spell which rat that is, because the list is the caller's own buffer, so only the caller can. Measured against the `BatchedMesh` it replaces (RTX 5080, 1920x1000, interleaved runs), the page's CPU frame fell by a third to a half — 26.6–38.5 ms to 18.9–24.1 ms at 16 384 rats under 4x throttle — almost all of it three's own batch work under `render`, at a GPU cost of about 5%. The seam has an implementation the day it lands.

## Why it is refused with a carrier

A carrier answers two questions from one object: which row of the pack an instance reads, and which transform places it (see `VATNodeOptions.carrier`). A `logicalIndex` answers only the first. With both given, the decode would read the caller's row and re-apply a mesh's instance matrix indexed by a slot that row knows nothing of — a crowd nothing could explain, the very mixing the single `carrier` option was shaped to rule out.

So the caller that spells the index also places the instance. Without a carrier the decode poses the instance in the geometry's own space, as it does on a single mesh, and the caller wraps the returned `positionNode` in its transform and turns `normalLocal` with it. That is what the prototype's cull did, and nothing on this side changes shape for it.

The refusal is made in `vatNodes`, eagerly, as the carrier checks are: the decode is built inside a `Fn` when the shader first is, and a refusal there would land in the renderer, far from the call that caused it.

## Why TSL alone

The GLSL path gets no mirror. WebGL 2 has no indirect draw and no compute pass to cull into a list, so no WebGL caller can have the indirection this exists for; Last Light keeps its CPU-culled `BatchedMesh` there. ADR-0016's own rule applies: the seam on that path is one expression when a caller needs it, and nobody does.

## Considered options

- **A third carrier kind** — an object holding an index node and a transform node, accepted where `carrier` is. Rejected: the transform is the caller's whole cull pipeline (two swarm states blended by an alpha uniform, in Last Light's case), and the library would be inventing an interface for a pipeline it has seen once. The index is the one thing the decode needs that it cannot otherwise get.
- **Read `instanceIndex` and have the caller sort the playback texture into drawn order.** Rejected: the survivors change every frame, so the CPU would have to read back the list the cull exists to keep off it, and the WebGPU backend re-uploads the whole playback texture on any change (ADR-0016's amendment), so it would be every row, every frame.
- **A GLSL mirror now, for symmetry.** Rejected above: it would be untestable against a real caller and could drift unseen.

## Consequences

- **Without the option the decode graph is unchanged**, node for node. Every existing TSL test passes untouched.
- **Both encodings take it.** The vertex and the rig decode read the pack through the same rows, so the seam is one node in the shared half of the decode (ADR-0018).
- **The parity gate does not cover it.** The gate compares the two decode paths, and this exists on one. Its coverage is structural — the pack rows and the hash are keyed by the supplied node, under both encodings — and a WGSL compile of a plain mesh with no variable read unassigned; the pixels are the caller's to check.
- **Additive, so it ships as a minor version.** One new optional field on `VATNodeOptions`.
