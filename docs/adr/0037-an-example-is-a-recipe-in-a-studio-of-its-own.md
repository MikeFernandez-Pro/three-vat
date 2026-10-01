# An example is a recipe as well as evidence, in a studio of the library's own

The examples were built as arguments ([ADR-0012](./0012-the-demo-is-an-argument-not-a-showcase.md)):
one control, no prose, readouts that prove a claim. They wore three.js's own
room ([ADR-0024](./0024-the-engineering-overlay-is-threes-own-and-the-pages-wear-threes-theme.md)):
black, monospace, lil-gui on WebGL, the Inspector on WebGPU, stats-gl always on.
And the gallery listed them flat, one entry per page
([ADR-0020](./0020-the-gallery-is-the-root.md)). A visitor who came to learn how
to do a thing had to reverse-engineer it from pages written to persuade, and
most of what the library does had no page at all (#121).

Three things change together, and they are one decision: the examples are for
the person learning the library.

## An example is evidence and a recipe

An **example** (CONTEXT.md) is two things at once. It is **evidence**, as
before: a control that makes one feature visible, and readouts that are
measured, never stated. And it is a **recipe**: its entry module is the
smallest readable, self-contained three.js program that uses the feature,
with the renderer, scene, lights, floor, loader and loop written out inline, as
a three.js example is. There is no shared scene or stage module. A reader knows
three.js and has to see the whole program to copy it.

A page may now carry **one sentence**, saying what to try. That amends
ADR-0012's no-caption rule rather than overturning its principle: the sentence
says what to *do*, never what a readout *means*. The evidence is still produced
by the visitor, not captioned for them.

Each page shows its own entry module in a **source panel**: imported as raw
text through vite (`?raw`), so the code shown is the code running. The panel
is hidden when the page opens, so the scene comes first, and links to the file
on GitHub.

Coverage is by the number of examples, not by the controls one page carries:
one pair per feature, one or two controls each, 18 features in five sections.

## The studio replaces three's room

The pages stop wearing three.js's theme. **Superseding ADR-0024**: lil-gui,
the Inspector and three's example stylesheet leave the pages, and stats-gl is
no longer always on. It stays a dependency, and is used only where cost is the
feature (`crowd`, `batched`, `encodings`).

The look is a **light studio** of the library's own: an off-white seamless
backdrop and floor, soft shadows, one accent, matte characters where the
feature allows. It is driven by three shared modules and nothing else, so a
later pass that makes it more beautiful edits those three and not 36 pages:

- `examples/src/theme.css`: the design tokens (colour, type, spacing) for the
  page text, the panel and the gallery shell.
- `examples/src/palette.ts`: six named scene colours the pages use inline.
- `examples/src/ui.ts`: a minimal panel of our own (slider, toggle, select,
  button), the readout setter, the source panel, a collapse to a button on
  narrow screens, and the no-WebGPU badge. The texture panel reads its colours
  and placement from custom properties this stylesheet sets.

None of the three imports a renderer, three.js or the library. The bundle guard
holds `palette.ts` and `ui.ts` to importing nothing at all.

The panel's label → control markup is a contract: the hero capture finds the
crowd page's count control by its label and drags the range input inside it.
`examples/src/ui.test.ts` pins it.

A WebGPU page no longer turns away a browser without WebGPU.
`WebGPURenderer` falls back to its WebGL 2 backend, and the page says so in a
badge, read off `renderer.backend` rather than guessed. The page runs; it just
doesn't claim to be something it isn't.

## The gallery lists by feature, in sections

**Superseding ADR-0020's flat list**: the sidebar lists **one entry per
feature**, grouped into sections (*Start here*, *Baking*, *Playback*,
*Carriers & shaders*, *Your assets*). A WebGL / WebGPU switch in the shell
replaces the renderer filter, swaps which page of the pair is framed, and is
remembered in `localStorage`. A page declares its section in its own head
(`<meta name="three-vat:section">`), read by the page table beside its entry
and title, so adding an example is still adding a file. Sections are the
shell's grouping, never a level in a file name. The build refuses a page with
no section, a section the shell does not have, a feature with one page, and a
pair that disagrees about its title or its section.

Everything else ADR-0020 decided stands: the gallery is the root, the list is
generated from the page table, and an example works opened at its own address.

## What stands

[ADR-0011](./0011-one-example-per-renderer-duplicated-on-purpose.md) is
reinforced. With no shared scene module, the two pages of a pair reading alike
is still evidence of parity rather than something a harness produced. The
HUD pair contract, the bundle and payload guards and the parity gate are
unchanged in function.

## Guarding it

A **browser smoke run** (`node release/smoke/check.mjs`) is a release step
beside the parity and drop checks, on the same headed-Chrome harness. It opens
every page in the page table and fails on any console error or on a page that
never issues a draw call, counted at the GPU API. With 36 pages, one that
stopped running would otherwise be found by a visitor. It is not part of
`pnpm test`, because it needs a GPU.

## Migration

Pair by pair, so the deployed gallery and the README's hero never go blank.
`crowd` and `instanced` land first, with the three shared modules, the source
panel, the sectioned gallery, the smoke run and the retargeted hero capture.
Each later pair replaces its predecessor, and the helpers and tests only that
predecessor used, in the same change.

## Considered options

- **Keep lil-gui and restyle it.** Rejected: its markup is not ours to make a
  contract of, it cannot collapse to a button, and it is a second look to
  theme on WebGPU, where the Inspector was the panel.
- **A shared stage module for the renderer, lights and floor.** Rejected: the
  recipe is the page, and a page that hides its renderer behind a helper
  cannot be copied. The duplication is ADR-0011's, on purpose.
- **Sections as a file-name level** (`webgl_<section>_<feature>`), the option
  ADR-0020 left open. Rejected: moving a feature between sections would rename
  both its files and break every link to it. A tag in the head moves with one
  edit.

## Amendment (#134, 2026-10-01): the camera and the floor are studio

The recipe above writes out "the renderer, scene, lights, floor, loader and
loop" inline, and rejects a shared stage module. The camera limits and the
fading floor (918a883) broke that as written: every page now orbits within
limits set by `examples/src/camera-limits.ts`, and stands on a floor from
`examples/src/floor.ts` (WebGL) or `examples/src/webgpu/floor.ts` (WebGPU),
both fading by `examples/src/floor-fade.ts`'s numbers.

They are **studio**, shared like the palette and the panel. Camera and floor
are never the feature a page teaches. A reader copying a recipe brings their
own camera and their own ground, and a page that wrote out its orbit limits
and its floor shader would bury the lines that use the library. The
renderer and the lights stay inline, because a recipe must show them: the
renderer is where `getMaxTextureSize` is read and the decode path chosen, and
the lights are what the shadow pass and the normals are evidence against.

So the rejected option, **a shared stage module for the renderer, lights and
floor**, is narrowed to **the renderer and the lights**. It stays rejected for
those two, for the reason given.

The studio gains two more pieces in the same change, both on every page:

- **The API line.** Each page's HUD carries one line, in its own HTML (`#api`),
  naming the three-vat calls, or the CLI command, its recipe teaches. It names
  and never explains, so it is not a second sentence: the one sentence is still
  `#try`'s. The HUD pair contract holds both pages of a pair to the same line,
  word for word.
- **The forge.** `examples/src/forge.ts`, beside the panel: a row of texels
  pulsing while a page loads its model, and a small texture filling texel by
  texel while it bakes, in the middle of the screen. The page wraps each load
  in `loading` and each bake in `forging`. It moves on CSS opacity and
  transform animations, which the compositor runs while the main thread is
  busy: the first forge swung from requestAnimationFrame and stood still
  through every main-thread bake, which is nearly all of them. The bundle
  guard holds it to importing nothing, as it holds `palette.ts` and `ui.ts`.

The camera and floor tuning groups stay on the panels until their values are
settled (#140); then they leave, and the defaults stay.

## Amendment (#140, 2026-10-01): the camera and floor values are settled

The values stand as they were: the orbit from 0.36x to 1.5x the page's starting
distance with its polar stop at 0.45 pi, and the floor solid to 0.5x and gone by
1.1x, with no page excepted. The camera and floor groups have left every panel,
which now carries only its page's feature.

## Amendment (#147, 2026-10-01): the twisted crowd lights its own scene

The deform pages carry more than one or two controls: a group for the crowd
(its colour, its material, and the toon material's gradient), one for the two
lights and one for the tone mapping. Exploring how a twisted crowd reads under
light and under a material it was not baked with is that page's feature. The
studio's lights and tone mapping stay the defaults every other page keeps.

The panel gains a colour control, `panel.color(label, 0xrrggbb, onInput)`, for
the light and crowd colours.
