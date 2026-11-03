# A second game lives outside the workspace

> **Moved out:** on 2026-11-03 the game left this repo for
> [MikeFernandez-Pro/a-goose-tale](https://github.com/MikeFernandez-Pro/a-goose-tale),
> where it is now made, installing `three-vat` from npm, and is deployed at
> [agoosetale.com](https://agoosetale.com). Its code here ends at the tag
> `a-goose-tale-moved`, and this site's old addresses for it redirect there.
> `games/ho-ho-no/` stays the game that holds the library to account (ADR-0038).

> **Renamed:** on 2026-11-01 *Last Light* became *A Goose Tale*, in
> `games/a-goose-tale/`, deployed at `/games/a-goose-tale/`. This record and
> those after it keep the name they were written under.

> **Amended:** the game is also published on its own, at
> [MikeFernandez-Pro/a-goose-tale](https://github.com/MikeFernandez-Pro/a-goose-tale),
> as Ho Ho No is (ADR-0038): a snapshot taken on 2026-11-01 that installs
> `three-vat` from npm (`^5.0.0`), bakes its rat with the package's own
> `three-vat bake`, and deploys to its own Pages site, which the README links.
> It is not synced: the copy here is where the game is made.

> **Amended:** the Pages deploy builds it too, at `/games/last-light/`, so
> its look can be tried from a link by someone who will not clone the repo.
> It is built as it is installed here: its own install, then its own build,
> after the workspace's. The typecheck, the test suites, the release suite and
> the root README still ignore it, and a library change that breaks its build
> now fails the deploy, not CI. What follows is the decision as it was taken.

ADR-0038 put a **game** in the workspace: a package beside the library,
typechecked with it, tested, deployed beside the gallery and linked from the
README, so that a library change that breaks a real application breaks it in
the same commit. *Last Light*, the second game, is a swarm of rats held off
by a light. It is not that kind of check yet. It begins as a question (can
thousands of steered rats run on the library at all, and on which backend?)
whose answers will change its shape more than the library's API will.

## In the repo, outside the workspace

`games/last-light/` is committed here but declared in neither
`pnpm-workspace.yaml` nor the root `workspaces`. It has its own
`package.json` and its own install, and it reaches the library through a
`link:` path to the root, so it runs whatever the library's last local build
is. Nothing in the repo knows about it. The typecheck, the test suites, the
release suite, the Pages deploy and the README all ignore it. Its tests cover
the **swarm** alone, through the steering's own calls, and run only from its
folder, so a library change never fails on them; the drawing is checked by
eye and by its frame-time readout.

It runs on `WebGPURenderer` alone, as ho-ho-no does since ADR-0038's
amendment. Which backend is faster is measured through `forceWebGL: true`,
not by keeping a second renderer.

## Consequences

A library change can break it without anything failing. That is the price,
and it is paid knowingly: the game answers to the library, not the other way
round. A workaround it needs is still a finding against the library, fixed
there (ADR-0038). Once it is playable, joining the workspace is the way back,
and it costs one line in each list.

## Considered options

- **In the workspace, like ho-ho-no.** Rejected for now. It would bind an
  experiment to the repo's typecheck and deploy while its shape is still
  being found.
- **A separate repo, installing `three-vat` from npm.** Rejected for the
  reason ADR-0038 gives. This is the library's first steering at thousands of
  instances, it is likely to surface library fixes, and each one would have
  to be published before the game could use it.
