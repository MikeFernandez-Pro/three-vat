# Examples beside the demo

> **Superseded by [ADR-0020](./0020-the-gallery-is-the-root.md).**
> The navigation strip is deleted and the gallery landing page this record
> rejected is now the root. The rejection was conditional — "it can be revisited
> when there are enough examples that a strip stops fitting" — and ADR-0020
> revisits it early, on the reasoning below rather than against it: "which
> feature" being a choice a visitor *can* make is the argument for a gallery,
> and the strip was only the smallest thing that offered that choice while the
> root had to stay the demo. What stands untouched is what an **example** is,
> and that every pair is held to the parity gate through the page table.

The demo stays what [ADR-0012](./0012-the-demo-is-an-argument-not-a-showcase.md)
made it — one page, one control, one claim, the deployed root and the hero
image's source — and it stops being the *only* page. An **example** is a page
that presents one feature the way the demo presents its claim: with a control
that produces the evidence rather than a caption that states it. Examples exist
one per renderer like the demo, every pair is held to the same parity gate and
HUD contract through the page table, and every page carries a navigation strip
listing all of them, the demo first. There is still no landing page.

This amends two recorded positions, and each stands where it stood.

- [ADR-0011](./0011-one-example-per-renderer-duplicated-on-purpose.md) —
  *one page per renderer, duplicated on purpose* — stands in full and is what
  makes this cheap: a page is a file, the page table globs it, no build config
  changes. What changes is that "a third demo" is now expected rather than
  hypothetical. The duplication cost it accepted is accepted again, per
  example, for the same reason: a reader sees their own code on their own
  path, and two pages that resemble each other without a shared module is
  evidence of parity that a harness would manufacture.
- [ADR-0012](./0012-the-demo-is-an-argument-not-a-showcase.md) rejected
  "keep the crowd page and add a second one" because it doubled the
  duplication *for a page a newcomer is less likely to need*. That reasoning
  was about a second telling of the same claim. An example tells a different
  one — and the first example exists because the demo *cannot* tell it: the
  rig encoding ([ADR-0018](./0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md))
  is refused by the demo's own asset, so a feature that halves a crowd's
  frame time on a phone and its texture by two orders of magnitude would
  otherwise be visible nowhere. ADR-0012's other amendment — no landing page,
  because "which renderer" is a choice a visitor cannot make — also stands:
  "which feature" is a choice they *can* make, and a strip on every page
  offers it without displacing the argument from the root that the README
  links and the hero is captured from.

## Considered

- **Feature pages on WebGL only**, the demo remaining the sole pair. Rejected:
  a WebGL-only example reads as a feature the TSL path lacks, which is the
  split [ADR-0016](./0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)
  committed never to reopen, and the pages are where a reader would look for
  proof that the paths agree.
- **A gallery landing page** in the three.js style, the demo one tile among
  many. Rejected for now for the reason above: the root is the argument. It
  can be revisited when there are enough examples that a strip stops fitting.
- **A toggle on the demo** instead of a second page. Rejected: the demo's
  asset cannot take the feature the first example is for, and ADR-0012's
  single control is the point of that page.

## Consequences

- The glossary's **Demo** entry narrows to the front door, and **Example** —
  a word the glossary avoided because it had meant the page, the test suite and
  the README snippet at once — is admitted, pinned to a page and nothing else.
- The parity gate, the HUD contract and the deployment guards read the page
  table rather than naming the demo, so an example is covered the moment its
  file exists. The hero capture alone stays pinned to the root.
- The first example is the rig encoding on Soldier: the count slider, plus an
  **encoding toggle** that bakes both encodings and lets the visitor flip
  between them while the HUD's texture memory and bake time change. The second
  bake at load is a third of a second on a phone and a second and a half on a
  desktop, and that wait is itself part of the evidence. Soldier joins the
  example assets.
- Which further features get examples, and the strip's design, are a separate
  issue; this record only says that examples exist and what one is.
