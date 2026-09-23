# The engineering overlay is three's Inspector, stats-gl where it cannot be, and the pages wear three's theme

The examples carried `stats-gl` for frame timings and `lil-gui` for their
control panel, on a sky-to-sand gradient of their own. Three things change at
once here, and they are one decision: where three.js has an instrument or a
room of its own, the pages take it.

## The overlay: three's Inspector on WebGPU, stats-gl on WebGL

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
they keep the nearest thing: **stats-gl**, Renaud Rohlinger's vanilla
counterpart of r3f-perf, which times the GPU through
`EXT_disjoint_timer_query_webgl2` where the Inspector times it through
timestamp queries — behind the same toggle as before — and `lil-gui` from
`three/addons/libs`, where it always came from. three's own `Stats` addon
(mrdoob's stats.js) was tried here first and reports no GPU time, which on a
page whose claim is *zero per-frame CPU* is the half of the picture that
matters.

The pair therefore stops matching panel for panel, and that is accepted: the
contract the release suite holds a pair to is the **readouts** — the HUD, draw
calls, texture memory, the same figures on both pages (ADR-0020) — and neither
overlay is a readout. The control panel moves: on WebGPU it is a group in the
Inspector's Parameters tab, which the Inspector floats beside its button while
the main panel is closed — so the count slider, the demo's one control
(ADR-0012), is on screen at rest and the timings are a click away. The page
places the widget once, low and on the side the texture panel does not hold;
after that the layout is the visitor's, which is the Inspector's own memory.
There is no "frame timings" toggle on that path, because the Inspector is the
timings and has its own button. And because the Inspector shows three's
console, the pages stopped constructing the deprecated `Clock` — `Timer` now —
rather than open every load with a warning badge.

## The theme: three's example stylesheet

The pages take `threejs.org/examples/main.css` rule for rule — black, white
`Monospace` at 13px on 24px, yellow links — and the gallery takes the site's
dark variables (`#222`, `#bbb`, `#049EF4`). The scene's own defaults follow:
background and fog to black, so what the renderer paints and what the page
paints are one colour. A three-vat example should look like a three example:
the visitor has seen that room before and reads the crowd, not the chrome.

The HUD keeps its place, top-left (ADR-0012), rather than moving to three's
centred `#info`: it carries a ledger and a texture panel that a centred caption
cannot, and its position is a decision of its own.

## What does not change

`stats-gl` stays in the examples' dependencies, for the WebGL pages only. The
library is untouched:
nothing here is a decode path, an API or a peer requirement. The release suite
is untouched: the hero capture drives the WebGL page's lil-gui as it did, the
parity gate has its own stage, and the gallery tests pin the sidebar's markup,
not its colours.
