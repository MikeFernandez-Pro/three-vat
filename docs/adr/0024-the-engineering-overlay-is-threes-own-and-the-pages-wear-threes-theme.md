# The frame timings are always on, the Inspector is WebGPU's, and the pages wear three's theme

The examples carried `stats-gl` for frame timings and `lil-gui` for their
control panel, on a sky-to-sand gradient of their own. Three things change at
once here, and they are one decision: where three.js has an instrument or a
room of its own, the pages take it.

## The overlay: stats-gl on both renderers, and three's Inspector on WebGPU besides

three ships an **Inspector** (`three/addons/inspector/Inspector.js`) for its
node renderer: set `renderer.inspector` and the renderer reports into it —
CPU and GPU time per pass, draw calls, memory and buffers, a recorded timeline
of every call in a frame, a console, render-target previews, and a
**Parameters** tab that is a control panel in the lil-gui shape (`add`,
`addColor`, `addFolder`, `.name()`, `.onChange()`). With its **TSL Graph**
extension, a node material tagged `material.userData.graphId` opens as an
editable graph — the decode this library builds in TSL, laid out on screen.
That is the debugger a TSL library's examples should be running, and it
replaces two dependencies with none.

It is the node renderer's. `WebGLRenderer` has no `inspector`, and the WebGL
pages exist to run the GLSL decode on `WebGLRenderer` (ADR-0004, ADR-0011), so
they keep `lil-gui` from `three/addons/libs` for their controls, where it
always came from.

The **frame timings** are the same on both renderers, and always on screen:
**stats-gl**, Renaud Rohlinger's vanilla counterpart of r3f-perf, top-left
where three's examples put `Stats`, reading FPS, CPU, GPU — through
`EXT_disjoint_timer_query_webgl2` on WebGL, timestamp queries on WebGPU — and
**draw calls**, in a panel of the pages' own (`examples/src/frame-stats.ts`),
because the count is the number every crowd page's argument rests on and
stats-gl has no panel for it. Nothing hides behind a "frame timings" toggle any
more, which ADR-0012 had them do: a page whose claim is a draw count and zero
per-frame CPU keeps its instruments in view. three's own `Stats` addon
(mrdoob's stats.js) was tried first and reports no GPU time, which is the half
of that picture that matters.

The pair therefore stops matching panel for panel, and that is accepted: the
contract the release suite holds a pair to is the **readouts** — the HUD, draw
calls, texture memory, the same figures on both pages (ADR-0020) — and neither
overlay is a readout. The control panel moves: on WebGPU it is a group in the
Inspector's Parameters tab, which the Inspector floats beside its button while
the main panel is closed — so the count slider, the demo's one control
(ADR-0012), is on screen at rest and the timings are a click away. The page
places the widget once, low and on the side the texture panel does not hold;
after that the layout is the visitor's, which is the Inspector's own memory.
And because the Inspector shows three's
console, the pages stopped constructing the deprecated `Clock` — `Timer` now —
rather than open every load with a warning badge.

## The theme: three's example stylesheet

The pages take `threejs.org/examples/main.css` rule for rule — black, white
`Monospace` at 13px on 24px, yellow links — and the gallery takes the site's
dark variables (`#222`, `#bbb`, `#049EF4`). The scene's own defaults follow:
background and fog to black, so what the renderer paints and what the page
paints are one colour. A three-vat example should look like a three example:
the visitor has seen that room before and reads the crowd, not the chrome.

And the pages take a three example's **layout**, as `webgl_batch_lod_bvh`
has it: the readouts centred at the top as three's `#info` — one size, one line
height, the page's number bold and in line rather than large — the frame
timings top-left (stats-gl where three puts `Stats`), and the controls top-right
(lil-gui auto-placed; the Inspector where it puts itself). This moves the HUD
from the top-left ADR-0012 gave it; what that record protected — the readouts
on screen at rest, and the same ones on both pages of a pair — is untouched, and
the release suite still holds a pair to it. The texture panel, which three has
no counterpart for, takes the left edge under the frame timings — the one edge
the layout leaves free — and is **off by default**, where ADR-0012 had it on:
the page opens on the crowd and its number, as a three example opens on its
scene, and the textures are one click away in the panel. The hero capture
switches them on before it records, so the README's image still shows the
evidence and the release suite still checks that it does.

## What does not change

`stats-gl` stays in the examples' dependencies, on every page. The library is
untouched:
nothing here is a decode path, an API or a peer requirement. The release suite
is untouched: the hero capture drives the WebGL page's lil-gui as it did, the
parity gate has its own stage, and the gallery tests pin the sidebar's markup,
not its colours.

## Amendment (#71): the crossfade pages open with the texture panel on

The rule above — the texture panel **off by default**, one click away, because a
page opens on its scene as a three example does — stands for every page it was
written about, and is amended for one pair.

The crossfade pages' claim is that an instance blends between two clips that are
**both still playing**. What that looks like is a second cursor, in a second
band, moving. The panel is therefore not a diagnostic on those pages: it is the
readout the feature is evidenced by, and ADR-0020 does not let a page make its
argument with its evidence hidden behind a toggle. So the pair opens with the
panel on, and the toggle turns it off rather than on.

Nothing else moves. The panel keeps its place (the left edge, under the frame
timings), the toggle keeps its name, and every other page keeps the default this
record gave it — including the crowd pages, whose evidence is a draw count and
not a texture. The panel itself gained the second cursor for every page that
carries one, since an instance mid-transition samples two bands wherever it is
drawn.
