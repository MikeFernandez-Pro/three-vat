# A vertex-encoded file stores its position layer transformed for compression

> *Amends [ADR-0034](./0034-the-cli-bakes-to-a-versioned-vat-glb.md).*

A vertex-encoded baked file (#154) no longer stores its position layer as the texture holds it. Each half-float's bits are stored as the uint16 difference from the same vertex's previous frame, wrapping, with frame 0 kept as it is. The differences are laid out vertex-major, every frame of a texel side by side, then split into four channel planes, and each plane into its low bytes and then its high bytes. The file is the same size on disk. `loadVAT` undoes the transform before it builds the texture, so the VAT it returns is still the bake's, texel for texel. The normal layer and the rig texture are stored as they were. It ships in format version 3, which #152 introduced, because no release has gone out since. Decided on 2026-10-02.

## Why the file compresses itself

ADR-0034 said a baked file "deploys, caches and compresses like any other `.glb`", and left compression to HTTP. That holds, but HTTP compression is general-purpose and sees the position layer as interleaved half-floats. Consecutive bytes in that layout are a low byte, a high byte and another channel, and a vertex's next frame is a whole frame's stride away, out of reach of gzip's 32 KB window. Brotli and gzip cannot find the one thing the layer is made of, which is a vertex that barely moves from one frame to the next.

The transform puts that next to itself. A difference between frames is small, so its high byte is almost always 0 or 255, and a plane of high bytes is mostly runs. The compressor is still the server's: the file adds no codec and no dependency, and a page that serves it uncompressed loses nothing it had.

Measured on Michelle under the vertex encoding, both clips, 549 frames (a 71.8 MB position layer):

| | as stored before | transformed |
| --- | --- | --- |
| brotli, quality 11 | 33.5 MB | 17.1 MB |
| gzip, level 6 | 45.2 MB | 22.2 MB |

## What it costs at load

One pass over the layer, adding each difference to the frame before it. For Michelle that takes about 0.1 s in Node (105 to 130 ms over seven runs), on top of a load that already copies the layer once. Saving 16 MB is worth 1.3 s on a 100 Mbit/s link. A rig-encoded file, which is the default, pays nothing.

## Considered and rejected

- **Leave it to HTTP.** Nothing to maintain, but it leaves half the bytes on the wire for the encoding that most needs the file.
- **A codec in the file (meshopt, or quantised positions).** A codec would compress further, but it adds a decoder to `loadVAT` or a dependency to core, and quantising changes the texels, so `expectSameVAT` would no longer hold.
- **The same transform on the normal layer and the rig texture.** Neither gains. Octahedral bytes do not difference into small numbers, and the rig's floats are a small layer under a default encoding that is already small.
- **A second format version.** #152's version 3 has not shipped, so a file of it with untransformed positions exists only in a working tree. A bump would refuse files no one has. The next change after a release bumps it.

## Consequences

- **The stored array is no longer the texture's.** `BAKED_LAYER_FORMATS` in `src/baked-file.ts` gives each layer a `store` beside its `build`, so the writer and the loader read the difference from one table.
- **A tool that reads the layer must undo the transform.** Nothing outside `loadVAT` reads it, since the extension is private to the writer and the loader (ADR-0034).
