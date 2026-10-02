# Adding an example

The deployed site is a **gallery**: a shell with a sidebar listing every
feature, in sections, and framing the one you pick in an iframe on the renderer
you chose ([ADR-0020](./adr/0020-the-gallery-is-the-root.md),
[ADR-0037](./adr/0037-an-example-is-a-recipe-in-a-studio-of-its-own.md)). Nothing about that list is
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
- **The page files itself under a gallery section** with
  `<meta name="three-vat:section" content="…">` in its head: one of *Start
  here*, *Baking*, *Playback*, *Rendering*, *Your assets*
  (`SECTIONS` in `examples/gallery.mjs`). Both pages of a pair name the same
  one. A page with no section, or one the shell does not have, fails the build.
- **The page names its entry module with one module `<script>` tag**, pointing
  into `/src/`. The page table reads that tag; it is how a page says what it
  runs.
- **The page carries a HUD with an element `id="title"`**, an `<h1>` in the
  studio's pages. The one link back to the gallery is stamped in directly after
  it. A page without one is refused, rather than served with nowhere to go home
  from.

## What a page is made of

An example is evidence and a recipe (ADR-0037). Its entry module is the whole
program, written out as a three.js example is: renderer, lights, loader,
loop, then the library. There is no shared stage for the renderer or the
lights to inherit from, and pages duplicate each other on purpose (ADR-0011).
The camera's limits and the floor are the studio's (ADR-0037's amendment),
because neither is ever the feature a page teaches. The
fastest way to start one is to copy the pair nearest what you are showing;
`webgl_crowd` / `webgpu_crowd` is the shortest.

What *is* shared is the studio:

- `src/theme.css`, linked from the page's head, holds the design tokens, in
  both looks: light, and dark under `[data-look="dark"]`.
- `src/palette.ts` holds the scene colours, used inline:
  `new THREE.Color(palette.floor)`. It reads the page's look once as it loads,
  so a page never asks which look it is in.
- There is no `scene.background`: the renderer clears to nothing (WebGL
  `alpha: true`, WebGPU `renderer.setClearAlpha(0)`), and the page's own
  `--studio` is the backdrop. The one exception is the post-processing pair:
  its depth of field writes an opaque frame, so it paints `--studio` as
  `scene.background` instead. The look script that marks the page with its
  look is stamped into its head as it is served (`look.mjs`); a page never
  writes it.
- `src/ui.ts` holds the panel. `createPanel()` gives a slider, a toggle, a
  select, a colour and a button, each handing back its element to hide or
  disable, and `group(label)` for controls that come and go together (the
  drop page's clips); `readout(id)` sets a HUD readout the page's HTML
  declares; `panel.source({ code, path })` shows the page's own entry module,
  imported as `import source from "./webgl_horse.ts?raw"`.
- `src/forge.ts` holds the forge, the hammer and anvil shown while a page
  bakes. Wrap every bake the page runs in the browser:
  `const vat = await forging(() => bakeVAT(...))`. It is shown once it has
  painted and taken down when the bake ends or fails.
- `src/camera-limits.ts` limits the orbit (`limitCamera(controls)`), and
  `src/floor.ts` (WebGL) or `src/webgpu/floor.ts` (WebGPU) makes the floor
  that fades into the backdrop, by `src/floor-fade.ts`'s numbers.

The page's text is a title, **one sentence saying what to try** (never what a
readout means), an **API line** (`<p id="api">`) naming the three-vat calls or
the CLI command the recipe teaches, and the readouts its feature is evidenced
by. Both pages of a pair carry the same ids and the same API line, word for
word. A WebGPU page lets `WebGPURenderer` fall back to its
WebGL 2 backend and says so with `badge()`, read off `renderer.backend`.
stats-gl goes only on a page whose feature is cost.

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

## Sections live in the page, not the name

File names carry a renderer and a feature and nothing else. The sidebar lists
one entry per feature under the section its pages declare, and a WebGL / WebGPU
switch above it picks which page of the pair is framed and remembers the
choice. Moving a feature to another section is one edit to each page's head,
never a rename. There is no search box, until the list asks for one.

## Before you push

- `pnpm run dev` and open the gallery at `/`. The new feature is in the sidebar
  under its section, the switch frames both of its pages, and each one still
  works opened at `/<name>.html`.
- `pnpm test` — the release suite reads the page table, so the new pair is under
  every guard the moment its files land.
- `node release/smoke/check.mjs --pages=webgl_horse,webgpu_horse` opens both
  in headed Chrome and fails on a console error or a page that never draws.
- If the pair is worth holding to the pixel-comparison gate, see
  [releasing.md](./releasing.md).
