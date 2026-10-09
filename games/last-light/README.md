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
pnpm --dir games/last-light build       # bakes the rat, then dist/
pnpm --dir games/last-light bake        # builds the library, then bakes models/rat.glb into public/models/
```

The level is a grey-box blockout (`src/level.ts`), its first section: outside
a property. The holder starts in the street with a torch, and the torch burns
down. A brazier stands near the start, a short wall beside it, and the key to
the property's gate lies in that wall's shadow, among the rats. The fence runs
across the middle, the locked gate in it to the east; beyond it, the lit house
door at the west end of the house front is the exit, a stand-in until the
next sections exist. WASD or the arrow keys walk the holder, as the camera sees
the ground; it stays put when no key is held, and walks along any wall it
meets. The torch's reach holds for most of its fuel and shrinks to nothing
over the last of it; dipped into one of the braziers, standing at it, it is
full again. A lit window or door holds the rats off as any light does, but
refuels nothing. The street between the brazier and the gate is a wind zone,
its ground streaked: in it the torch burns faster, and faster still in a
gust, which comes on a set timing from the holder first walking in, calm
first, the streaks brightening and racing as it blows. In the wind, beside
the car, stands a fragile flame, a small flame on a post, which refuels as a
brazier does but can die: the first gust puts it out, and so do enough rats
pressing on its edge. Out, it stays out, and the rats take its ground. Light
stops at walls: each light lights only the ground it can see, and rats sit in
a wall's shadow right beside it (ADR-0054). A far light shows through the
dark where nothing stands between it and the eye. The walls between the
camera and the holder are dithered away round it. Rats fill the level's dark,
and only those within nine metres run at the holder; the rest seethe where
they are. Run dry, the torch goes out, the rats close on the holder, and once
they reach it the player is caught and the run starts again at the last
checkpoint passed, or the start, with a full torch, the level as it stood
then (its fragile flames as they were), the wind waiting for the holder
again, and the rats placed again. Space is the interact key:
standing on a key it picks it up (the gold bar), and standing at a lever,
held for the lever's time, it works it; let go early, it does nothing. A gate
(rust brown) is a wall to the rats, the holder and the light while shut; it
opens once the holder brings its key to it, or its lever is worked, and the
lit areas of the lights that see through it are worked out again. Going on
through a gate passes its checkpoint, and a gate can be marked to shut behind
the holder. Reaching the exit wins the run. The line top-left shows the fuel
left, the wind or a gust where the holder stands in it, the keys carried, the
last checkpoint, and the win. The debug keys are
off to start (`?debug`, or the run folder's switch): Q and E turn the torch's
reach up and down, F puts it out and relights it.
The mouse moves the camera freely: the left button turns it round the light, the right slides it,
the wheel brings it in and out; it follows the light from wherever it was put.
T turns the camera a quarter round the light, pulling back as it turns,
easing out of rest and back into it: a travelling for a take, which a paused
scene still turns through.

The panel, top-right, sets the rats (2,000 to start, up to 16,384; more are
added at the arena's edge), the slowest and fastest rat, the rat scale, the
spacing (the room a rat keeps round it, on top of its size), how
fast the rats' run animation plays, the holder's walking speed, and the torch
put out or relit. Its run folder sets how fast the torch burns, the last share
of the fuel its reach shrinks over, its reach (which the lamp's follows), how
much faster the wind and a gust burn it, how often a gust comes and how long it
lasts, how many rats overrun a fragile flame, each placed light's reach and
whether it is lit, and the debug keys; and starts the run at any checkpoint,
for testing a late section.

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
`?shadows` with the lamp's shadows on, and `?loop` has the light walk the same
loop on every run in place of the keys, its torch never burning down and no flame going out. `?film` is for recording a take: no
panel, no readouts and no cursor, the light walking at 2 m/s; T turns the camera a quarter round the light,
pulling back as it turns. `?stop=0` turns the stop motion off, and
`?nocharacter` hides the character with its torch, flame, embers and smoke.
At the light stands the pumpkin kid (`public/models/pumpkinKid.glb`), the
flame in the cup of the torch in its hand.

## How it is cut

- **The run** (`src/run.ts`) is the game's rules, stepped by a frame's input:
  the holder's walk, along the walls, the torch's fuel and reach, refuelling
  at a flame, the wind and its gusts, fragile flames put out, keys, levers and
  gates, checkpoints, being caught, and the exit. No renderer, no DOM and no
  swarm of its own; its tests (`src/run.test.ts`) step it through its own
  calls. Each frame it hands the swarm the torch and the level's lights
  (`src/level.ts`, drawn as grey boxes by `src/lights.ts`, the walls, gates,
  keys and levers by `src/blockout.ts`, the wind zones by `src/wind.ts`), and
  reads back the rats the swarm found at the holder and at each light's edge.
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
  relief scales the normal map's lean.
- **The page** (`src/main.ts`) walks the light, stands the rats where the
  swarm has them, and trails the light with the camera, eased a little behind
  it, high and close, in purple fog, under a dim violet fill and a far lavender moon.
- **The film** (`src/film.ts`) is the quarter turn on T, and under `?film` the
  panel that sets it, plays it and copies where the camera stands.

The swarm is drawn as the rat (`models/rat.glb`, its Run), a `Creature` in
`src/rats.ts`: its baked file, its run clip, and the playback speed that keeps
its feet on the ground. The rat is Quaternius's (CC0, credited in
`public/licence.txt`), a placeholder; its baked file is written by the `bake`
script and never committed.
