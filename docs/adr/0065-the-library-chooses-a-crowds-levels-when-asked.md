# The library chooses a crowd's levels when asked

> **Amends [ADR-0043](./0043-a-level-of-detail-repeats-the-vertices-and-the-decode-wraps-the-column.md)**, which left choosing a level to the caller and added no per-frame pass to make it.

`updateVATLevels(crowd, camera, { ids, bands, slack, onChange })` moves each instance of a `BatchedMesh` crowd to the level its distance from the camera asks for, and returns how many instances each level holds. It runs when the caller calls it, once a frame or less; nothing runs on its own. Choosing by hand stays open: `setGeometryIdAt` is still three's, and a crowd that never calls this changes nothing.

## Why

ADR-0043 measured the levels and left the choice out, as "a CPU decision per instance". Every crowd with levels writes the same loop, though, and the levels example already carried one with a remembered level, which is the part that is easy to get wrong. `@three.ez/instanced-mesh` gives a level in one line, `addLOD(geometry, material, distance, hysteresis)`, and shifts its threshold without remembering the level it left (docs/research/instanced-mesh2.md), so an instance inside the shifted band can still change level every frame. Moving the example's loop into the library gives the one line and keeps the memory.

## How it chooses

- **Bands between levels,** in world units, increasing: level 0 nearer than `bands[0]`, and so on. Fewer bands than gaps leave the last levels unused, so `bands: []` puts every instance back at full detail without the caller writing each one.
- **By distance,** from the camera's world position to the instance's, the instance read off the carrier with `getMatrixAt` and placed by the crowd's world matrix. Screen size is not offered: on one camera it orders instances as distance does.
- **With hysteresis that remembers the level.** An instance leaves its level only once it is `slack × band` past the band it crosses, outward or inward, `slack` a fraction of the band, 0.1 by default, as the example used. It crosses every band it is past in one call, so a camera cut lands every instance where it belongs.
- **The level now is read off the carrier,** with `getGeometryIdAt`, so the caller keeps no state. `ids[l][k]` is the id `addGeometry` gave level `l` of character `k`, the shape of `createVATLODs`'s `levels`. An instance keeps its character and changes only its level, so an atlas crowd is chosen the same way as a bake's.
- **Written only where it changes,** one `setGeometryIdAt`, and `onChange(instance, level)` is called there, for a caller who paints by level.
- **Removed instances are skipped.** three has no public way to ask whether an id is in use, and `getGeometryIdAt` throws for one that is not, so ids are probed until `instanceCount` live ones are found, as `src/carrier.ts` probes geometries.

## Measured

Node, the PC the benches run on, 4,096 instances on a `BatchedMesh` of two geometries: 0.15 to 0.21 ms a call, reading every matrix and every level and writing the ones that changed. Phones were not measured.

## Considered and not taken

- **Positions passed by the caller.** Cheaper than reading a matrix an instance, but the caller would keep a copy of every position in step with the carrier. The read was measured first and kept.
- **A pass that runs on its own,** from the crowd's `onBeforeRender`. It would hide a cost a frame pays, and three calls it once a camera, shadow cameras included, each of which would choose again.
- **An `InstancedMesh` carrier.** It holds one geometry, so a level there is a crowd of its own, and moving an instance means moving its row (ADR-0043).

## Consequences

- **The levels example calls it,** on both renderers, and its own `levelFor` is gone.
- **The camera's and the crowd's world matrices are brought up to date** by the call, as a render would, so a camera moved by controls that frame is measured where it is.
- **Coverage.** CI checks the choice on a real `BatchedMesh`: the bands, fewer bands than levels, the slack either way, a cut crossing every band, a character kept on an atlas, removed instances, the counts, and that nothing is written where nothing changed.
