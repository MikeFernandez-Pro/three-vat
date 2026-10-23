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

The page opens on the open arena: no walls and no lights but the torch, which
never burns down, every rat running at the holder, and the debug keys on, so
Q, E and F work from the start. The game is at `#game` (`localhost:4321/#game`);
changing the hash loads the page again on the other.

The goose game is at `#goose` (`src/gooseplay.ts`): the goose, the torch in her
beak, crosses a night plain one way from brazier to brazier (`src/plain.ts`,
`?seed=N` lays another), gathering a gosling at each into an arc close round
her back. The first four braziers' places are scenes, worked with Space
(`src/goosescenes.ts`), the well (`public/models/well.glb`) and the dead tree
(`public/models/deadTree.glb`), whose folder sets its colours, size and
turn, where its gosling perches on it and which way it faces, and where she
calls it down: at the well she holds Space to winch its
gosling up in the bucket, and lets go to drop it; at the dead tree she holds Space
with her torch lit to call its gosling down, jumping down in front of it and
joining her once down; the tree itself never burns. A lit
brazier, the one in the tree's file, stands near it, its light stopping short of the trunk. At the third, grey-box, a
gosling is in a cage in the brazier's light, its key by a dead body out in the dark: Space by the body picks the key up, carried in her right wing,
and Space held at the cage unlocks it, the padlock dropping to the ground. At the fourth, no brazier burns: a gosling hides deep in the trunk of a hollow log (`public/models/thunderLog.glb`) in the dark. Coming within
7 m of it brings a lightning strike down on its roots at the far end at once (`src/lightning.ts`), which sets it burning along its length, a fire like a brazier's, the rats kept off it and the torch filled at it; at its near end, Space held calls the gosling out to her. With the torch out the dark takes them one by one; she is never caught
and the run never starts again. Wading into the pond past the last brazier ends
it, with the count of how many came home. The goose and her goslings are the
two armatures of `public/models/geese.glb` (`src/meat.ts`, `src/goslings.ts`),
both swimming once out of their depth. The pond is a hollow in the floor inside
a noisy shore, its water the old platform-typing water (`src/pond.ts`,
`src/water.ts`), drawn past the last brazier, where the route ends; the pond folder
sets its shape, bed and water. The run folder sets the dark's grace and
interval, the well's hold, the tree's hold, how long a fire takes to fill the torch, and the seed. No fire fills the torch
by itself: she holds Space in a brazier's dip, or at the well's lantern. The dead tree, cage and hollow log folders
set each scene's interact zones (the cage's key has its own), its fire zone where the torch is filled, how far its
fire holds the rats, and its flame, the torch's, and lamp. The debug keys 0 to 4 on the top row stand
her back at the start, by the well's zone, the dead tree's, the cage and the log's near end; any other number key, or 0
to 4 on the keypad,
gives her that many goslings at once.

The sewers' first corridor is at `#sewers`: the open arena's page, walled
either side, the rats in its dark, no light but the torch (`src/level.ts`,
`src/corridor.ts`). Its corridor folder picks one of five themes (`src/themes.ts`: moss glow, moss and rust,
toxic glow, turquoise water, lamplit moss), each a whole palette over the light,
the torch and its flame, the fog, the stone's tint, the rats' fur and eyes and
the pumpkin kid's colours, never the stone's texture; moves the walls apart,
raises them, and puts a dome over them or leaves them open. The see-through
folder sets the dithered hole the camera sees the child through. Its floor and walls share one folder in the panel to
pick a texture set, from `public/textures/surfaces/` or the painted floors, and
to switch each map on and off: colour, normal (OpenGL or DirectX), roughness,
metallic, ambient occlusion and height as parallax (`src/surfaces.ts`). The
roughness and metallic maps show only on the PBR shading; the toon shading is
the rats' shell.

In the game, the level is the woods (`src/woods.ts`), the level the 2D page
(`2d.html`) was designed on, played by the same play step (`src/play.ts`) and
drawn in grey boxes (`src/scenery.ts`): the ground the level covers, a band of
simple trees round it, its own trees, rocks, thicket and bushes, on the
ground's height (`src/heights.ts`). Beats 1 to 4 are built in 3D so far
(#182, #183). The child wakes in a clearing, control locked, alone; lightning strikes
the big tree, and the rats burst out of the bushes at it. Touching the burning
tree lights his stick, and the torch burns down from there. A few seconds
later a second strike drops the cracked tree burning across the only gap: it
stops him standing, and he crawls under it (C on and off, left Ctrl while
held, read by where the keys sit), standing up once through. Round the thicket the
wood leads to the estate wall's gate, locked, between two torches; the
gamekeeper lies along the wall with the key. Through the gate he pushes the
burning cart over the bridge by walking into its back; it jams at the bottom
step, the rain puts his stick out and won't let it catch, and the cart's fire
and the braziers up the steps drown behind him, one ahead. The ground rises up
the hill as stone steps, the ravine drops under the fallen pine, which he
walks slowly, out of the rats' reach, its rats far below; the manor's windows
show from the hilltop, and past the pine the rain stops. The gate's torches,
the gate, the jammed cart and the far side are checkpoints. His lines show as
a caption. Beat 6, the dark run home, is built in 3D too (#184): past the
pine his stick catches again at the far brazier, damp, so it burns short and
dims fast, and it gutters out at the same place on the forest path whatever is
left of it. Then he runs by himself, the keys steering him, the far side's rats
on his heels, which drag him down only once they have held on for the grip.
Whitewashed posts with drowned lanterns, pale in the dark, show the path down
to the fallen tree's tangle, crawled through, and the lawn; the lanterns on
the manor's steps still burn, and at the door, ajar, he goes in, pushing it
open, and it shuts behind him; then the night fades out (#185). The storm is
drawn too (#185): rain streaks fall round him while it rains, and splashes open
on the river, a sheet of water with a line along its shore and ripples running
in to it; each strike shows its bolt, with sparks rising before it and bursting
where it lands, and flashes the scene, the rats' eyes flaring in it. Crossing
the pine, the camera rises high over the ravine, looking down at its rats and
out to the manor as he goes, and hands back to the orbit at the far side. The
rain's streaks, the bolts and the river are ported from Bruno Simon's
folio-2025, under its MIT licence: see `THIRD_PARTY_NOTICES.md`.
A click locks the pointer, which then turns the camera round him;
the wheel brings it in and out, and it never sinks into the ground. A light
that is not a flame, a lit window or door, holds the rats off as any light
does, but refuels nothing; a fragile flame, which a level may script, goes out
as it says, and stays out, the rats taking its ground. Light
stops at walls: each light lights only the ground it can see, and rats sit in
a wall's shadow right beside it (ADR-0054). A far light shows through the
dark where nothing stands between it and the eye. The walls between the
camera and the holder are dithered away round it. Rats fill the level's dark,
and only those within nine metres run at the holder; the rest seethe where
they are. Run dry, the torch goes out, the rats close on the holder, and once
they reach it the player is caught and the run starts again at the last
checkpoint passed, or the start, with a full torch, the level as it stood
then (its fragile flames as they were), every scripted trigger waiting for
the holder again, and the rats placed again. Space is the interact key:
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
much faster the wind and a gust burn it, each placed light's reach and
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
  at a flame, the wind and its scripted gusts, fragile flames put out by their
  scripts, keys, levers and gates, checkpoints, being caught, and the exit. No renderer, no DOM and no
  swarm of its own; its tests (`src/run.test.ts`) step it through its own
  calls. Each frame it hands the swarm the torch and the level's lights
  (`src/level.ts`, drawn as grey boxes by `src/lights.ts`, the walls, gates,
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
  relief scales the normal map's lean. The woods (`#game`) lay earth instead,
  `ground.png` and `ground-normal.png`: already seamless, kept full size in
  `textures/`, the game's 512-pixel copies scaled by the same wrapping shrink.
  The floor folder picks between them and painted dirt, `dirt.png`, which came
  without a normal map and lies on a flat one; each floor brings its own look.
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
