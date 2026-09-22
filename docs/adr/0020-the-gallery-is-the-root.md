# The gallery is the root, and the demo is gone

[ADR-0012](./0012-the-demo-is-an-argument-not-a-showcase.md) made the demo the
deployed root and the library's whole argument;
[ADR-0019](./0019-examples-beside-the-demo.md) put examples beside it and gave
every page a navigation strip rather than a landing page, explicitly rejecting
"a gallery landing page in the three.js style" and noting it could be revisited
"when there are enough examples that a strip stops fitting". This revisits it
before that point, and goes further than the revisit it anticipated: the root
becomes a gallery in the three.js style — a shell with a sidebar listing every
example and framing the one you pick in an iframe — and the **demo stops
existing as a category**. Its page survives, demoted: the robot crowd is
`webgl_crowd` / `webgpu_crowd`, an example like the rest.

The strip was the right answer to two pages and the wrong one to sixteen.
ADR-0019's own reasoning is the reasoning for a gallery — *"which feature" is a
choice a visitor can make* — and the strip was simply the smallest thing that
honoured it while the root had to stay the argument. Once every feature of the
library has a page, what a visitor needs is somewhere to browse, and a list of
every page carried *on* every page is a gallery drawn badly, N times.

Losing the demo costs less than it looks. ADR-0012's claim was that a stranger
must see the library's claim made rather than a catalogue — still true, and it
was never really the deployed root that did that work. Anyone arriving from npm
or GitHub meets the README's hero image first, which is unchanged, still
captured from the crowd page, and still the thing that cannot be prettier than
what it advertises. The deployed root was the second door, and a second door is
allowed to be a directory.

## Considered and rejected

- **The gallery at `/examples/`, the demo staying the root.** The tidy
  compromise, and rejected because it leaves two front doors and reopens "which
  one do I link?" at every release — while keeping the `Demo` category alive for
  exactly one page.
- **A gallery page with full-page examples and a back link, no iframe.** Works,
  and loses the persistent sidebar that makes browsing cheap. Its supposed
  advantage — pages that stand on their own — is paid for anyway below, so it
  bought nothing.
- **Keep the strip and redraw it three.js-style.** The strip's problem is that
  it lives on every page. Redrawing it does not move it.
- **Thumbnails from the start.** Deferred, not rejected: a grid needs a capture
  per page in CI, which is `release/hero/capture.mjs` generalised. Coupling a
  navigation change to a capture pipeline is how both stall. The gallery is born
  a list and grows images later.

## Consequences

- ADR-0012 is superseded on the root and on the demo as a category. Its
  principle — evidence, never a caption — stands, and is what shrinks the **HUD**
  here: each page carries the readouts its own feature is evidenced by and drops
  the rest, instead of every page carrying every figure.
- ADR-0019 is superseded entirely. The navigation strip is deleted; each page
  carries a link back to the gallery instead, stamped by the same
  `transformIndexHtml` hook that stamped the strip.
- **An example must work opened at its own address.** The iframe frames a page,
  it does not own one. This is what keeps ADR-0011 intact and what the parity
  gate and every build guard go on relying on.
- `examples/index.html` becomes the shell, and is the one `*.html` in that
  folder the **page table** excludes — by name, a line in the glob, rather than
  by moving every example into a subfolder and revisiting each non-recursive
  packaging glob. `rootPage` stops meaning "the WebGL demo".
- `rendererOf`'s prefix-less special case dies with the demo: every page now
  carries a `webgl_` or `webgpu_` prefix, and the table gets simpler rather than
  more complicated.
- The sidebar lists **flat** — one entry per page, a renderer filter above it —
  as three.js lists its own, rather than one entry per feature with a link per
  renderer. That a pair is held to the parity gate is an argument
  `docs/releasing.md` makes; it is not a shape the sidebar has to carry.
- **No group level in file names yet.** Eight features do not make sections, and
  `webgl_<group>_<feature>` stays available whenever they do, without touching
  `featureOf`. No search box either, until the list asks for one.
- The hero image is still captured from the crowd page, same plan, new address.
- The parity gate is untouched. It has its own page and its own scene outside
  the examples folder and never read the demo.
- The first wave of examples is `crowd`, `soldier`, `batched` and `deform`;
  `playback`, `instance`, `normals` and `worker` follow one file at a time,
  which is what the globbed table has always been for.
