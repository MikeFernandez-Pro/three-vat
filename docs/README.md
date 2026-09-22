# three-vat docs

The [README](../README.md) gets one crowd on screen. Everything below is what a
reader needs only once they have committed — so each page names its reader
first, and you should be able to leave this one within a few seconds.

| Page | Who it is for |
| --- | --- |
| [usage.md](./usage.md) | **You have a crowd and now have to ship it.** Texture ceilings, measured bake cost and the Web Worker recipe, the rig encoding and when to reach for it, draw-call arithmetic, the primitives underneath `createVATMesh` on both renderers, the two encodings measured against each other, and what 1.0 deliberately does not do. |
| [adr/](./adr) | **You want to know why it is like this.** One decision per file, argued, in the order they were taken, with an index over them. Where an ADR and a page disagree, the ADR wins — that is what this folder is for. |
| [examples.md](./examples.md) | **You are adding an example to the gallery.** The naming convention a page joins by, what the gallery is not allowed to own, and why there is no group level in the file names yet. |
| [landscape.md](./landscape.md) | **You are deciding whether to adopt it, or thinking of contributing.** What else in the ecosystem does this and why it is not the same thing, plus the plan for drei and an official three.js example. |
| [releasing.md](./releasing.md) | **You are cutting a release.** The order of the steps, and the WebGL/TSL parity gate that a human has to run because CI has no GPU. |
| [test-assets.md](./test-assets.md) | **You are running or changing the test suite.** Where the two real glTF files come from, why one is not in git, and why the suite is green without it. |

Start with [ADR-0008](./adr/0008-a-vat-bakes-a-posed-subtree-not-a-skinnedmesh.md)
if you read only one: the unit of a bake is a posed subtree, not a mesh, and
almost everything else follows from that.

Per-instance playback rests on four more, listed with the rest in the
[ADR index](./adr/README.md):
[0017](./adr/0017-loop-mode-is-a-playback-policy-not-bake-data.md),
[0014](./adr/0014-changing-an-instance-is-a-function-not-a-mesh-subclass.md),
[0015](./adr/0015-the-pose-freeze-fade-is-provisional-and-capped.md) and
[0016](./adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md).

`agents/` is configuration for the coding-agent skills this repository uses, not
a page anyone reads — see [CLAUDE.md](../CLAUDE.md).
