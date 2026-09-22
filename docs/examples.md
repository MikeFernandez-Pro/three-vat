# Adding an example

The deployed site is a **gallery**: a shell with a sidebar listing every example
and framing the one you pick in an iframe
([ADR-0020](./adr/0020-the-gallery-is-the-root.md)). Nothing about that list is
written down. It is generated from the **page table** — every `*.html` in
`examples/` but the shell — and stamped into the shell as it is served, in dev
and in the build alike.

So an example joins the gallery by existing. There is no list to edit, no build
entry to register, and no route to add. What there is instead is a naming
convention, and it is load-bearing.

## The convention

Two files and two entry modules, one per renderer:

```
examples/webgl_horse.html    → examples/src/webgl_horse.ts
examples/webgpu_horse.html   → examples/src/webgpu_horse.ts
```

- **The `webgl_` / `webgpu_` prefix says which decode path the page is allowed
  to reach**, and it lives on the page's file *and* on its entry module. The two
  have to agree; a page that named one renderer and ran the other fails
  `release/packaging/bundles.test.ts` by name. This is the rule
  [ADR-0011](./adr/0011-one-example-per-renderer-duplicated-on-purpose.md) is
  built on, and three.js keys its own gallery off the same prefix.
- **`<feature>` is what comes after the prefix**, and it is what pairs the two
  pages. A feature on one renderer only fails the release suite: a page the TSL
  path lacks reads as a capability it lacks.
- **The page's `<title>` is `three-vat — <Renderer> <what it shows>`.** That is
  where the sidebar's entry text comes from, so a title that does not follow it
  fails the build rather than shipping a gallery with a hole in it — and the two
  pages of a pair must say the same thing after the renderer, because they are
  one example on two paths.
- **The page names its entry module with one module `<script>` tag**, pointing
  into `/src/`. The page table reads that tag; it is how a page says what it
  runs.
- **The page carries a HUD with a `<div id="title">`.** The one link back to the
  gallery is stamped in directly after it. A page without one is refused, rather
  than served with nowhere to go home from.

Everything else is the page's own. Pages duplicate each other on purpose
(ADR-0011): there is no shared layout module to inherit from, and the fastest
way to start one is to copy the pair nearest what you are showing.

## What the gallery is not allowed to own

**An example must work opened at its own address.** The iframe frames a page, it
does not own one — so a page may not depend on anything the shell provides. The
only thing stamped onto an example is the one link home, and the only thing that
link needs is the HUD title above it.

`examples/index.html` is the shell, and it is the one `*.html` in that folder the
page table excludes — by name, one line in the glob. It is never listed as an
example of itself, and because it is outside the table, the build is handed it
explicitly: `buildPages` in `examples/pages.mjs` is the table with the shell put
back in front, and that is what `build.mjs` loops over.

## No group level, yet

File names carry a renderer and a feature and nothing else. `webgl_<group>_<feature>`
stays available for the day the list needs sections, and that day is not this
one: eight features do not make sections, and a group level added early is a
taxonomy everyone has to learn before they can add a page. The sidebar lists
flat, one entry per page, with a renderer filter above it — the way three.js
lists its own. There is no search box either, until the list asks for one.

## Before you push

- `pnpm run dev` and open the gallery at `/`. The new pages are in the sidebar,
  the filter finds them, and each one still works opened at `/<name>.html`.
- `pnpm test` — the release suite reads the page table, so the new pair is under
  every guard the moment its files land.
- If the pair is worth holding to the pixel-comparison gate, see
  [releasing.md](./releasing.md).
