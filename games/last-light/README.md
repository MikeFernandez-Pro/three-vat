# Last Light

A swarm of rats held off by a light, on three-vat: the repo's second **game**
(see `CONTEXT.md` and
[ADR-0044](../../docs/adr/0044-a-second-game-lives-outside-the-workspace.md)).
It lives in the repo but outside its workspace: its own install, its own
scripts, and the library through a link to the repo root, so it runs the
library's last local build. Nothing in the repo's typecheck or tests knows
about it; the Pages deploy builds it, and it runs at
<https://mikefernandez-pro.github.io/three-vat/games/last-light/>.

```bash
pnpm --dir games/last-light install     # its own install, not the workspace's
pnpm --dir games/last-light dev         # bakes the rat, then serves the game on WebGPURenderer
pnpm --dir games/last-light phone       # the same, over https on the network, so a phone gets WebGPU
pnpm --dir games/last-light test        # the swarm, headless
pnpm --dir games/last-light typecheck
pnpm --dir games/last-light page '#goose'  # loads a page in headed Chrome, prints its errors (tools/page.mjs)
pnpm --dir games/last-light build       # bakes the rat, then dist/
pnpm --dir games/last-light bake        # builds the library, then bakes models/rat.glb into public/models/
```

The page is the goose game, A Goose Tale, and nothing else since 2026-10-30:
the open arena, the woods (`#game`), the sewers (`#sewers`), the hall, the
levels of detail's page and their 2D and 3D prototype pages are at the git tag
`last-light-before-goose-only`.

The goose game (`src/gooseplay.ts`): the goose, the torch in her
beak, crosses a night plain one way from brazier to brazier, gathering a
gosling at each into an arc close round her back. The route is laid by hand
on its 2D page, `goose2d.html` (`src/goose2d.prototype.ts`), and saved to
`src/gooseroute.json` (`src/plain.ts`), which the page plays: there E edits
it, every piece dragged into place, each leg labelled with its length, its
time at her walk and the torch it burns, and the route played top-down to
time it, dying lights placed and timed there too. On the page itself E edits
it in 3D (`src/gooseedit.ts`): the play paused and the camera free, a click
picks a piece (the well, its brazier's place, the dead tree, its brazier, the cage, its
cart, campfire and dead body, a plain brazier or its gosling),
a drag moves it, the wheel turns it (Shift, a degree), and Save writes the
route, the well's, tree's and cage's `turn` with it, and loads the page again. Three braziers' places are
scenes, worked with Space
(`src/goosescenes.ts`), the well (`public/models/well.glb`) and the dead tree
(justASimpleTree's bare spooky tree, `public/models/spookyTrees/spooky-663.glb`, its brazier
from `public/models/deadTree.glb`), whose folder sets its colours, size and
turn, where its gosling perches on it and which way it faces, and where she
calls it down: at the well she holds Space to winch its
gosling up in the bucket, and lets go to drop it; at the dead tree she holds Space
with her torch lit to call its gosling down, jumping down in front of it and
joining her once down; the tree itself never burns. A lit
brazier, the one in the tree's file, stands near it, its light stopping short of the trunk. At the third, grey-box, a
gosling is in a cage in the brazier's light, its key by a dead body out in the dark: Space by the body picks the key up, carried in her right wing,
and Space held at the cage unlocks it, the padlock dropping to the ground. The fourth place is kept for a scene to
come: for now a plain brazier, its gosling waiting in its light. She is never caught
and the run never starts again. The pond past the last brazier ends nothing:
she and her goslings wade and swim in it. The goose and her goslings are the
two armatures of `public/models/geese.glb` (`src/meat.ts`, `src/goslings.ts`),
both swimming once out of their depth. The pond is a hollow in the floor inside
a noisy shore, its water the old platform-typing water (`src/pond.ts`,
`src/water.ts`), drawn past the last brazier, where the route ends; the pond folder
sets its shape, bed and water. The run folder sets the well's hold, the tree's hold, how long a fire takes to fill the torch, and the rats' seed. No fire fills the torch
by itself: she holds Space in a fire's dip, a brazier's or the well's fire pit's. The dead tree and cage folders
set each scene's interact zones (the cage's key has its own), its fire zone where the torch is filled, how far its
fire holds the rats, and its flame, the torch's, and lamp; the dead tree's brazier and the cage's campfire
can be moved off their places, their light with them. The debug keys 0 to 3 on the top row stand
her back at the start, by the well's zone, the dead tree's and the cage, and 5 by the pond; any other number key, or
any on the keypad, gives her that many goslings at once.

Light stops at walls: each light lights only the ground it can see (ADR-0054).
Space is the interact key. The debug keys: Q and E turn the torch's reach up
and down, F gives it a light that never burns down and puts it out again, K
takes her life, and the number keys stand her by a scene or give her
goslings. The camera is fixed over her, V going round the orbit, locked and
chase cameras.

The panel, top-right, sets the rats (500 to start, up to 16,384), the slowest and fastest rat, the rat scale, the
spacing (the room a rat keeps round it, on top of its size), how
fast the rats' run animation plays, the holder's walking speed, and the torch
put out or relit. Its run folder sets how fast the torch burns, the last share
of the fuel its reach shrinks over, its reach (which the lamp's follows), each
placed light's reach and whether it is lit, and the debug keys.

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
before it; how far they keep off the light's edge; and how far off they notice the holder.

The panel's folders set the look: the lamp's colour, intensity, reach and
falloff, and its shadows (off to start, and on only with `?shadows` at the
start: six passes, a cube); the sun's colour,
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
(`src/post.ts`, over the depth and normals the scene draws beside its colour,
in one unsampled pass smoothed by FXAA, ADR-0050): the ambient occlusion (three's GTAO: on or off, the AO
alone on screen, its strength and colour, radius, thickness, falloff, samples
and resolution), the inked outlines (colour, thickness, and how far depth or
the normal must break) and the posterized palette (levels a channel), each
with its switch; and the stop motion (beats a second, holding the run, the
swarm, or both). Every shell has a rim light too, on the lit side of its
silhouette. Everything lit is toon-shaded. The line top-left reads rats drawn, the vertices on screen
(the rats drawn and the ground; the shadow pass draws the rats again), the draw calls in the frame (every pass included), the
worker's step in ms (on the GPU, a step's GPU time under `?timestamps`), the swarm's states a second
(60 while it keeps up), frame ms and frames a second, and the backend drawing them.

The rats are culled once a frame against the view, never by three per pass:
on WebGPU, a batch three culls per camera draws the wrong rats once a shadow
pass and the view cull differently, so every pass draws the one list. On
WebGPU the GPU culls them (ADR-0052), and the rats drawn are read back from it
a few times a second; on WebGL 2 the page does.

The URL sets the start, so two runs can be compared: `?webgl` draws through
WebGPURenderer's WebGL 2 backend, `?batch` draws the rats as the page-culled
batch on WebGPU too, `?cpustep` steps the swarm in the worker on WebGPU too,
`?timestamps` reads the GPU's step time into the readouts, `?rats=8192` starts with that many rats,
`?shadows` with the lamp's shadows on. `?film` is for recording a take: no
panel, no readouts and no cursor; T turns the camera a quarter round the light,
pulling back as it turns. `?nocharacter` hides the goose with her torch, flame,
embers and smoke.

## How it is cut

- **The run** (`src/run.ts`) is the game's rules, stepped by a frame's input:
  the holder's walk, along the walls, the torch's fuel and reach, refuelling
  at a flame, the wind and its scripted gusts, fragile flames put out by their
  scripts, keys, levers and gates, checkpoints, being caught, and the exit. No renderer, no DOM and no
  swarm of its own; its tests (`src/run.test.ts`) step it through its own
  calls. Each frame it hands the swarm the torch and the level's lights
  (the goose play's, drawn by `src/lights.ts`, the walls, gates,
  keys and levers by `src/blockout.ts`, the wind zones by `src/wind.ts`), and
  reads back the rats the swarm found at the holder.
  When a gate opens or shuts, the page hands the swarm and the lit areas the
  walls as they now stand; when the run starts again, the swarm places its
  rats again, out of the lights and the room round the holder.
- **The walls and the lit areas** (`src/walls.ts`, `src/litareas.ts`,
  ADR-0054): the walls bodies slide along and never cross, and each light's
  lit area, a table of how far it sees in 512 directions. The swarm keeps rats
  out of the lit areas, and the drawing lights the ground in them, from one
  texture (`src/seen.ts`). Their tests are the swarm's
  (`src/swarm-walls.test.ts`) and the run's.
- **The swarm** (`src/swarm.ts`) is the steering: one pass over the rats and
  a neighbour grid, bodies that push and each rat's own nerve, with the rats'
  ground positions, headings, gaits and real speeds in flat arrays, stepped by
  a time step given the torch, the lights the level places, and the tuning.
  A rat will step into no light's lit area, nor cross a wall, and the light
  whose edge it is nearest is the one it burns at and flinches from; a rat in
  a wall's shadow from a light is not held off by it. No renderer and no DOM. Its
  tests (`src/swarm.test.ts`) drive it through its own calls at a fixed time
  step and seed. It runs in a worker (`src/swarm.worker.ts`), stepped a
  sixtieth of a second at a time on the worker's own clock; `src/swarm-remote.ts`
  is the page's end, which sends the count, the light and the tuning every
  frame and stands the rats a step behind the latest post, between two steps
  (ADR-0047). A rat the worker brought round is marked in its state and
  placed, never slid; the remote's tests (`src/swarm-remote.test.ts`) hand it
  states over a stand-in for the worker. On WebGPU the swarm steps on the GPU
  instead (`src/gpuswarm.ts`, ADR-0053): the same step, in compute passes the
  page runs on its own fixed clock, writing the cull's state buffers, so the
  rats' places never leave the GPU; only the rats whose gait changed are read
  back. Its tests (`src/gpuswarm.test.ts`) drive the page's side over a
  stand-in renderer and check the kernels' WGSL. `tools/compare-steps.mjs`,
  run by hand, compares how the CPU and GPU swarms behave from one start.
- **The rats** (`src/rats.ts`) are the baked rat on one of two carriers. On
  WebGPU, a compute pass (`src/gpucull.ts`) blends every rat between the two
  swarm states, culls it against the view and writes the rats kept into a
  survivor list, and one indirect draw a pass draws them; the states go up to
  the GPU as they arrive, each once, and its tests (`src/gpucull.test.ts`)
  check what goes up and the shaders' WGSL. On WebGL 2 they are one
  `BatchedMesh`, sized to the count and rebuilt a size up as it grows, culled
  rat by rat on the page and drawn in one draw (`src/collapse.ts`, copied from
  the examples). Every rat plays Run, each from its own moment in the cycle,
  at the one playback speed the panel sets; its row is rewritten only when it
  spawns, that speed moves or its gait changes.
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
  relief scales the normal map's lean. The goose game lays the stylized sets;
  the floor folder picks between them, each floor bringing its own look.
- **The page** (`src/main.ts`) feeds the goose play the keys, stands the rats
  where the swarm has them, and draws the plain, its scenes and the pond round
  her.
- **The film** (`src/film.ts`) is the quarter turn on T, and under `?film` the
  panel that sets it, plays it and copies where the camera stands.

The swarm is drawn as the rat (`models/rat.glb`, its Run), a `Creature` in
`src/rats.ts`: its baked file, its run clip, and the playback speed that keeps
its feet on the ground. The rat is Quaternius's (CC0, credited in
`public/licence.txt`), a placeholder; its baked file is written by the `bake`
script and never committed.
