# An InstancedMesh crowd reads its matrices from a storage buffer, on WebGPU

`vatNodes` used to hand a posed vertex back to the carrier with `instancedMesh( carrier )`, which is what three would have applied. On an `InstancedMesh` it now reads the instance matrix from a storage buffer instead, wherever the renderer has one, and calls `instancedMesh( carrier )` only where it does not. A `BatchedMesh` is untouched, and so is a caller spelling its own `logicalIndex` (ADR-0051), which places the instance itself.

## Why

three reads an instance matrix as four vertex attributes: from r187 at every crowd size, and on r186 once the matrices pass its uniform-buffer limit, 1,024 of them. On the GPU that route is the difference between this decode and `@three.ez/instanced-mesh`, which reads its matrices from a storage buffer.

Measured with the bench outside the repo on an RTX 5080, 1600x900, dpr 1, no shadows, three-vat e241e2a4, best GPU frame, paired rounds: on r186, adding one instance took the rig from 1.12 to 1.40 ms on Soldier and from 1.28 to 1.72 ms on Imp, between 1,024 and 1,025 instances, while the other library stayed flat. Reading the matrices from storage took 20-31% off the frame on r187 and made the rig 7-14% faster than the other library, from 9-21% slower, at 340 to 4,096 instances. The other library refuses r187, so it ran on r186. With only part of each mesh drawn, 8,192 instances at 1/8 of the triangles, the route made no difference, and why is not known either.

Nothing else in the decode accounted for the gap. Each of these changed the steady frame by 1% or less: three's own instancing run ahead of the decode, the crossfade branches, and the outgoing band. Nor did the size of the playback texture. What makes the attribute route slower was not found out, only that it is.

## Why a second attribute

A storage attribute in the carrier's place was the first thing tried, and it cannot be done from here. Swapped when the mesh is made, nothing yet says what the renderer has, and a storage read on the WebGL 2 fallback draws the crowd in the wrong places with nothing on the console. Swapped as the shader builds, three's own instancing has already run over `instanceMatrix`, and that buffer is then created without storage usage, which WebGPU refuses.

So the decode reads a second attribute over the carrier's own array, which follows the carrier's by version. `setMatrixAt` and `needsUpdate` work as they did, and a mesh passed to `vatNodes` gets the same route as one from `createVATMesh`, with no new option on either.

## Why it is settled in the shader build

The builder is the first thing on this path that knows what the renderer can do. `createVATMesh` takes no renderer, and asking for one would break its promise that a crowd moves between renderers by changing the import line.

## Considered options

- **An option on `createVATMesh`.** Rejected: the fast route would be the one nobody finds, and a crowd moved between renderers would have one more line to change.
- **Waiting for three.** Rejected: r187 went further onto the attribute route on purpose, so that instanced meshes share builds.

## Consequences

- **The matrices are on the GPU twice**, 64 bytes an instance: three's own instancing still binds the carrier's attribute, though its result is overwritten. Moving all of 4,096 Soldiers every frame uploads both, and the frame still came out ahead of the old route, 6.09 ms against 7.31.
- **The second attribute always uploads whole.** `addUpdateRange` reaches only the carrier's.
- **The build belongs to its carrier**, marked `objectSpecific`, since the shader names that carrier's buffer. r187 otherwise shares builds across meshes on one material. A material whose decode was built for one carrier was never meant to draw another (`VATNodeOptions.carrier`), so this names the rule rather than changing it.
- **A carrier whose `instanceMatrix` is replaced is not followed.** The attribute views the array the carrier had when the shader was built. Nothing in this repo replaces it.
- **The other route remains for the fallback**, which is what keeps it drawing.
- **Coverage.** CI reads the route off the WGSL, without a GPU. Same pixels against the old route, on r186 and r187, came from the bench: steady, mid-crossfade, after a move, with shadows, instance colours, two crowds over one bake, two materials on one crowd, and on the fallback. The parity gate still holds the two paths together. Phones and the motion-vector pass have not been checked.
