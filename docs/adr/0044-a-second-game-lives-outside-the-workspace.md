# A second game lives outside the workspace

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
