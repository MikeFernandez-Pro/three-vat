# The README is beginner-first; depth lives in `docs/`

The README's reader is someone who has never heard of a vertex animation
texture. Its job is to make them want this and get one crowd on screen: a hero
image of the demo, the live links, install, and one end-to-end snippet. Anything
a reader needs only once they have already committed — texture-size limits,
baking in a Web Worker, draw-call arithmetic, the trade-offs, the deferred work
— is not on that path. Short answers collapse inline; anything needing a code
block *and* an explanation moves to `docs/` and is linked.

Before this, the README was 371 lines serving two readers at once — the curious
newcomer and someone shipping a 500-instance crowd — and that is the reason it
read as technical, more than any individual sentence did. Serving both in one
document is the default every library drifts into, and the drift is one-way:
every new capability wants a README paragraph, and the newcomer's path gets
longer with each release. This ADR exists to make that a decision someone has to
argue against, rather than a thing that quietly happens.

The rule, so it is testable: **if an answer fits in about fifteen lines it may
collapse inline; otherwise it links out.** The README is not a reference manual,
and completeness is not one of its goals.

## Consequences

- The README targets roughly 120 visible lines, with collapsed sections for the
  short answers. `<details>` was already the established device on this page.
- `docs/` gains a usage page for the shipper's material and a one-screen front
  door; `docs/DESIGN.md` is audited against the ADRs, which win where they
  overlap.
- The library exposes one bake call that does not branch on mesh type
  (ADR-0008), so the README shows **one** snippet, not one per asset shape — a
  variant per shape would teach a beginner the opposite of the truth. The
  variety is stated as a list, and the one real gotcha (pass the subtree root,
  not a mesh) gets the words instead.
- The README is the npm package page and the only shipped artifact that changes,
  so a rewrite warrants a patch release on its own.

## Amendment (#27)

The audit above happened, and the design report did not survive it. Every
section of `docs/DESIGN.md` was either an ADR's subject already — the bake
recipe is ADR-0002, the shader-injection rule ADR-0006, the offline format
ADR-0003 and ADR-0010, the showcase ADR-0012 — or had moved to `docs/usage.md`
with the README's depth. Nothing about the design of the library was left.

So there is no "how it actually works" page, because there are two already and
this was not going to be a third. What did survive is the material no ADR
covers and no shipper needs: the neighbouring packages and why they are not
competitors, and the plan for drei and an upstream three.js example. That is
`docs/landscape.md`, named for what it holds; `docs/DESIGN.md` is gone, and git
remembers it.

The front door is `docs/README.md` — what GitHub renders for the folder — and it
names each page with the reader it is for. A handful of lines went nowhere and
are not missed: the npm name-availability check, and that the repository was
public from the first commit. Both were true and are now spent.
