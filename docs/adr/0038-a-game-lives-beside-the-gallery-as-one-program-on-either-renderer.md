# A game lives beside the gallery, as one program on either renderer

> **Amended:** the game runs on `WebGPURenderer` alone, which still falls back
> to its own WebGL 2 backend. The `WebGLRenderer` seam, `?renderer=webgl` and
> the start screen's toggle are gone: one renderer to keep correct is the
> maintenance a second one only doubled. The seam stays as the one place the
> renderer is touched. What follows is the decision as it was taken.

Every page the repo deploys is an **example**: one feature, a control that
evidences it, an entry module a reader copies, one page per renderer
([ADR-0011](./0011-one-example-per-renderer-duplicated-on-purpose.md),
[ADR-0037](./0037-an-example-is-a-recipe-in-a-studio-of-its-own.md)). None of
them puts the library under the load a real application does: characters that
spawn, crossfade, die and are recycled while physics, audio, particles, a HUD
and postprocessing run beside them. DecemberChallenge's *Ho Ho No* is that
application, and it animated its crowd with hand-written VAT shaders over
offline EXR bakes. Ported onto the library, it is the library's first
**game** (CONTEXT.md).

## A game is not an example

It presents no single feature, carries no evidence control and is no recipe,
so it is held to none of the gallery's rules: not ADR-0011's pairing, not
ADR-0037's studio, source panel, one sentence or `ui.ts` panel, not the page
table, the HUD pair contract, or the examples' bundle and payload guards. It
keeps its own look — the night camp, toon shading, the vignette — and its own
dependencies, Rapier, gsap and howler among them. The gallery does not list
it; the README links to it.

## It lives in the repo

`games/ho-ho-no/` is a third workspace package, `private`, beside the library
and `examples/`. It depends on the library through `workspace:*`, so a library
change and the game change it forces land in one commit, and it is written in
TypeScript under the repo's `typecheck`, so a change to the library's API
breaks the game there rather than in a browser. Its baked files are generated
by `three-vat bake` before `dev` and `build`, never committed, so it always
runs today's baker. It deploys to Pages beside the gallery, at
`/games/ho-ho-no/`.

The published package does not grow: `files` is `dist` alone, the library has
no runtime dependencies, and a private workspace package never enters the
tarball — exactly as `examples/` never has. What grows is the clone, by the
game's audio and compressed models.

## One program, a renderer seam

The game runs on `WebGPURenderer` by default, falling back to its WebGL 2
backend, and on `WebGLRenderer` when asked (`?renderer=webgl`, or the toggle on
the start screen). Gameplay, physics, audio, UI and assets are written once. A
seam per renderer supplies the renderer, the materials, the post pass and the
decode path: GLSL through `onBeforeCompile` on one side, TSL on the other.
ADR-0011 duplicated the examples on purpose because two pages reading alike is
evidence of parity; a game evidences nothing that way, and maintaining its
gameplay twice would only let the two drift.

## What it is for

A workaround the game needs is a finding against the library, fixed there
rather than in the game. The first is the rig encoding's tear mid-crossfade:
the skeletons' walk-to-death blend waits on its fix rather than baking the
vertex encoding around it.

## Considered options

- **A separate public repo, consuming `three-vat` from npm.** The most
  separated, and a true outside consumer. Rejected: every library fix the game
  surfaces would have to be published before the game could use it, and the
  game would stop being the check that a library change did not break a real
  application.
- **A new kind of page inside the gallery.** It would keep the smoke run and
  the parity gate over it. Rejected: the gallery's rules exist for examples,
  and a game in its sidebar either bends them or carries exemptions from each.
- **Two copies, one per renderer, as the examples are.** Rejected, as above:
  duplication is evidence for an example and only drift for a game.
