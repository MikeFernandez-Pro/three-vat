# A Goose Tale

Called Last Light until 2026-11-01.

A swarm of rats held off by a light, on three-vat: the repo's second **game**
(see `CONTEXT.md` and
[ADR-0044](../../docs/adr/0044-a-second-game-lives-outside-the-workspace.md)).
It lives in the repo but outside its workspace: its own install, its own
scripts, and the library through a link to the repo root, so it runs the
library's last local build. Nothing in the repo's typecheck or tests knows
about it; the Pages deploy builds it, and it runs at
<https://mikefernandez-pro.github.io/three-vat/games/a-goose-tale/>.

```bash
pnpm --dir games/a-goose-tale install     # its own install, not the workspace's
pnpm --dir games/a-goose-tale dev         # bakes the rat, then serves the game on WebGPURenderer
pnpm --dir games/a-goose-tale phone       # the same, over https on the network, so a phone gets WebGPU
pnpm --dir games/a-goose-tale test        # the swarm, headless
pnpm --dir games/a-goose-tale typecheck
pnpm --dir games/a-goose-tale page '#goose'  # loads a page in headed Chrome, prints its errors (tools/page.mjs)
pnpm --dir games/a-goose-tale build       # bakes the rat, then dist/
pnpm --dir games/a-goose-tale bake        # builds the library, then bakes models/rat.glb into public/models/
```

The page is the goose game and nothing else since 2026-10-30:
the open arena, the woods (`#game`), the sewers (`#sewers`), the hall, the
levels of detail's page and their 2D and 3D prototype pages are at the git tag
`last-light-before-goose-only`.

The goose game (`src/gooseplay.ts`): the goose, the torch in his
beak, crosses a night plain one way from brazier to brazier, gathering a
gosling at each into an arc close round his back. The route is laid by hand
on its 2D page, `goose2d.html` (`src/goose2d.prototype.ts`), and saved to
`src/gooseroute.json` (`src/plain.ts`), which the page plays: there E edits
it, every piece dragged into place, each leg labelled with its length, its
time at his walk and the torch it burns, and the route played top-down to
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
turn, where its gosling perches on it and which way he faces, and where the goose
calls him down: at the well he holds Space to winch its
gosling up in the bucket, and lets go to drop it; at the dead tree he holds Space
with his torch lit to call its gosling down, jumping down in front of it and
joining him once down; the tree itself never burns. A lit
brazier, the one in the tree's file, stands near it, its light stopping short of the trunk. At the third, grey-box, a
gosling is in a cage in the brazier's light, its key by a dead body out in the dark: Space by the body picks the key up, carried in his right wing,
and Space held at the cage unlocks it, the padlock dropping to the ground. The fourth place is kept for a scene to
come: for now a plain brazier, its gosling waiting in its light. He is never caught
and the run never starts again. The pond past the last brazier ends nothing:
he and his goslings wade and swim in it. The goose and his goslings are the
two armatures of `public/models/geese.glb` (`src/meat.ts`, `src/goslings.ts`),
both swimming once out of their depth. The pond is a hollow in the floor inside
a noisy shore, its water an older project's water ported to TSL (`src/pond.ts`,
`src/water.ts`), drawn past the last brazier, where the route ends; the pond folder
sets its shape, bed and water. An oak of justASimpleTree's stands on the island's top left in its file's own colours, drawn with the dead trees' bark, leaf texture and grass at its foot, swaying and dropping its leaves (`public/models/oak-3118.glb`, `src/islandtree.ts`); the pond folder's tree folder places and sizes it and sets its leaves, wind and fall. A breakfast lies at its foot, on the island's left, its tray on the slope (`public/models/picnic.glb`, `src/picnic.ts`, credited in `public/licence.txt`), placed and sized by the pond folder's picnic folder. The run folder sets the well's hold, the tree's hold, how long a fire takes to fill the torch, and the rats' seed. No fire fills the torch
by itself: he holds Space in a fire's dip, a brazier's or the well's fire pit's. The dead tree and cage folders
set each scene's interact zones (the cage's key has its own), its fire zone where the torch is filled, how far its
fire holds the rats, and its flame, the torch's, and lamp; the dead tree's brazier and the cage's campfire
can be moved off their places, their light with them. The debug keys 0 to 3 on the top row stand
him back at the start, by the well's zone, the dead tree's and the cage, and 5 by the pond; any other number key, or
any on the keypad, gives him that many goslings at once.

Light stops at walls: each light lights only the ground it can see (ADR-0054).
Space is the interact key, P pauses and M mutes. The camera is fixed over him.

Everything else is on the developer's page, `#_debug` on the address
(`localhost:4321/#_debug`): the panels, the readouts, the edit mode (E) and the
debug keys. Q and E turn the torch's reach up and down, F gives it a light that
never burns down and puts it out again, K takes his life, the number keys stand
him by a scene or give him goslings, and V goes round the orbit, locked and
chase cameras. Without it the page is the game as played.

On a phone or a tablet (`src/goosetouch.ts`, `src/goosethumbs.ts`; `?touch`
to try them elsewhere) it plays with two thumbs: a small stick that stands wherever the
left thumb lands on the screen's left half, any push past its dead zone his one pace,
as on the keys, its ring following a thumb dragged past it; and a round button with a ✕ at the bottom right that does all the
space bar does: interact, tapped or held, and the opening's skip, filling as it is
held. On a phone the gosling's badge shrinks to fit the screen, and out of
view keeps clear of the stick and the button. The first touch
puts the prompts on touch, a key or a pad's press back. On a touch screen the
panel is hidden; the camera is the PC's. The page hidden pauses the game.

A phone draws a leaner frame: no shadows, no bloom and none of the tilt's blur,
the scene pass writing its colour alone; `?lean=0` puts them back to compare,
`?lean` tries it elsewhere. Its rats wear a wider, stronger rim (`?rim=strength,width`),
and its lens zooms in held sideways and out a little upright (`?zoom=sideways,upright`). `?bench` on `pnpm phone` measures it on the phone
and posts the readings to `_phone/` on the machine serving it (`src/phonebench.ts`):
`?bench&intro=0&outro=0&mute` prices what is drawn, `=all` every cost and place,
`=soak` five minutes of walking, the quality free to move. For a phone on another
network, `tools/remote-bench.mjs` serves the build and takes the readings, and nothing
else, behind a tunnel.

A phone can drop the page at any moment, so its run is kept for the tab
(`src/keptrun.ts`), and a reload takes it up: the goslings found and their scenes
done, he waking where he last filled his torch, past the opening. `?keep` tries it
elsewhere.

The panel, top-right on `#_debug`, sets the rats (500 to start, up to 16,384), the slowest and fastest rat, the rat scale, the
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
panel, no readouts and no cursor. `?nocharacter` hides the goose with his torch,
flame, embers and smoke.

## How it is cut

- **The run** (`src/run.ts`) is the goose's walk and his torch, stepped by a
  frame's input: where he walks, along the level's walls, the way he faces,
  and the torch's fuel and reach. No renderer, no DOM and no swarm of its own;
  its tests (`src/run.test.ts`) step it through its own calls. The goose play
  (`src/gooseplay.ts`) steps it each frame and hands the swarm the torch and
  the level's lights, drawn by `src/lights.ts`; everything else, the goslings,
  the scenes, the bites and filling the torch at a fire, is the goose play's
  own.
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
  him.

The swarm is drawn as the rat (`models/rat.glb`, its Run), a `Creature` in
`src/rats.ts`: its baked file, its run clip, and the playback speed that keeps
its feet on the ground. The rat is Quaternius's (CC0, credited in
`public/licence.txt`), a placeholder; its baked file is written by the `bake`
script and never committed.
