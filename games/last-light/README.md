# Last Light

A swarm of rats held off by a light, on three-vat: the repo's second **game**
(see `CONTEXT.md` and
[ADR-0044](../../docs/adr/0044-a-second-game-lives-outside-the-workspace.md)).
It lives in the repo but outside its workspace: its own install, its own
scripts, and the library through a link to the repo root, so it runs the
library's last local build. Nothing in the repo's typecheck, tests or deploy
knows about it.

```bash
pnpm --dir games/last-light install     # its own install, not the workspace's
pnpm --dir games/last-light dev         # bakes the rat, then serves the game on WebGPURenderer
pnpm --dir games/last-light phone       # the same, over https on the network, so a phone gets WebGPU
pnpm --dir games/last-light test        # the swarm, headless
pnpm --dir games/last-light typecheck
pnpm --dir games/last-light build       # bakes the rat, then dist/
pnpm --dir games/last-light bake        # builds the library, then bakes models/rat.glb into public/models/
```

WASD or the arrow keys walk the light, as the camera sees the ground; it stays
put when no key is held. F puts it out and relights it, Q and E turn it up and
down, and Space hops the chicken, for the look of it: the swarm never sees a
hop. The mouse moves the camera freely: the left button turns it round the light, the right slides it,
the wheel brings it in and out; it follows the light from wherever it was put.
T turns the camera a quarter round the light, pulling back as it turns,
easing out of rest and back into it: a travelling for a take, which a paused
scene still turns through.

The panel, top-right, sets the rats (2,000 to start, up to 16,384; more are
added at the arena's edge), the slowest and fastest rat, the rat scale, the
spacing (the room a rat keeps round it, on top of its size), how
fast the rats' run animation plays, the light's strength (which the lamp's
reach follows) and walking speed, and the light on or off.

Every rat runs straight for the light, and nothing routes it or tells it to
circle (ADR-0046). What stops it is the light's edge, which it will not step
over, and the bodies ahead; stopped, it slides toward the less crowded side,
so the milling at the front comes out of the crowding. The light burns: a rat
at the edge holds there a second or two, flinches back through the mass, and
comes again, and the rats beside it flinch with it, so the front breaks open
in bays and the rats behind pour in. The mass seethes where it waits: every
rat writhes at walking pace, packed in or not. The light moves no rat: rats
get out of a walking light's way, and run out of one that overtakes them.

The panel's crowd folder tunes that, live, with no reset: how fast the rats
writhe; how many seconds ahead they read a walking light's path, so part
before it; and how far they keep off the light's edge.

The panel's folders set the look: the lamp's colour, intensity, reach and
falloff, and its shadows (off to start: six passes, a cube); the sun's colour,
intensity, position (x, y, z from the light it follows), its shadows (off to
start, the ambient occlusion carrying the mass's volume instead) and their
softness; the fill's sky and ground colours and intensity; the fog's colour,
near and far; the rats' colours (one a part of the model, skin, fur and eyes,
in the model's own to start, and a tint over them), their sheen (the light's
own colour in the toon steps, whatever the colour, so a black shell still
shows the light), their highlight (a cel specular: strength, tightness, edge
softness and colour) and their toon steps, three or five, each step's
brightness; the floor's lightness, saturation, tile size and relief, with a
shell and toon steps of its own, on the same material; the frame's effects
(`src/post.ts`, over a depth-and-normal pre-pass of their own, since the scene
pass is multisampled): the ambient occlusion (three's GTAO: on or off, the AO
alone on screen, its strength and colour, radius, thickness, falloff, samples
and resolution), the inked outlines (colour, thickness, and how far depth or
the normal must break) and the posterized palette (levels a channel), each
with its switch; and the stop motion (beats a second, holding the run, the
swarm, or both). Every shell has a rim light too, on the lit side of its
silhouette. Everything lit is toon-shaded. The line top-left reads rats drawn, the vertices on screen
(the rats drawn and the ground; the shadow passes and the AO's pre-pass draw
the rats again), the draw calls in the frame (every pass included), the
worker's step in ms, frame ms and frames a second, and the backend drawing them.

The rats are culled by the page, not by three: on WebGPU, a batch three culls
per camera draws the wrong rats once a shadow pass and the view cull
differently, so every pass draws the one list the page picked from the view.

The URL sets the start, so two runs can be compared: `?webgl` draws through
WebGPURenderer's WebGL 2 backend, `?rats=8192` starts with that many rats,
`?shadows` with the lamp's shadows on, and `?loop` has the light walk the same
loop on every run in place of the keys. `?film` is for recording a take: no
panel, no readouts and no cursor, and a Film panel that sets how long the
quarter turn takes, which way and how far it pulls back, plays it, and copies where the camera
stands from the light, to set a take's start again; H hides it.

## How it is cut

- **The swarm** (`src/swarm.ts`) is the steering: one pass over the rats and
  a neighbour grid, bodies that push and each rat's own nerve, with the rats'
  ground positions, headings, gaits and real speeds in flat arrays, stepped by
  a time step given the light and the tuning. No renderer and no DOM. Its
  tests (`src/swarm.test.ts`) drive it through its own calls at a fixed time
  step and seed. It runs in a worker (`src/swarm.worker.ts`), stepped a
  sixtieth of a second at a time on the worker's own clock; `src/swarm-remote.ts`
  is the page's end, which sends the count, the light and the tuning every
  frame and stands the rats a step behind the latest post, between two steps
  (ADR-0047).
- **The rats** (`src/rats.ts`) are one `BatchedMesh` over the baked rat, sized
  to the count and rebuilt a size up as it grows, culled rat by rat and drawn
  in one draw (`src/collapse.ts`, copied from the examples). Every rat plays
  Run, each from its own moment in the cycle, at the one playback speed the
  panel sets; its row is rewritten only when it spawns or that speed moves.
  The model's flat colours, merged at the bake, are its parts, each on a
  colour of its own in the panel's rats folder.
- **The ground** (`src/ground.ts`) is one plane under a tiled, hand-painted
  floor and its normal map, `public/textures/floor.png` and `floor-normal.png`,
  one set of coordinates reading both. Both are made to tile by
  `tools/seamless.py` from the painted originals, whose edges do not meet: each
  edge is overlapped with the opposite one and cut along the path where the
  two agree most, the same cut for the normal map, so nothing blends or ghosts.
  It keeps them full size in `textures/` and gives the game 512-pixel copies,
  scaled wrapping round the edges so they still tile. The panel's floor folder sets how light
  and how saturated it is, how many metres one tile covers, and how deep the
  relief scales the normal map's lean.
- **The page** (`src/main.ts`) walks the light, stands the rats where the
  swarm has them, and trails the light with the camera, eased a little behind
  it, high and close, in grey-green fog, under a dim cold fill and a cold far sun.
- **The film** (`src/film.ts`) is the quarter turn on T, and under `?film` the
  panel that sets it, plays it and copies where the camera stands.

The swarm is drawn as the rat (`models/rat.glb`, its Run); `?scarab` draws the
scarab (`models/scarab.glb`) in its place. Each is a `Creature` in `src/rats.ts`:
its baked file, its run clip, the way the model faces, and the playback speed
that keeps its feet on the ground. The rat is Quaternius's (CC0, credited in
`public/licence.txt`), a placeholder; both baked files are written by the
`bake` script and never committed.
