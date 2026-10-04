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
pnpm --dir games/last-light test        # the swarm, headless
pnpm --dir games/last-light typecheck
pnpm --dir games/last-light build       # bakes the rat, then dist/
pnpm --dir games/last-light bake        # builds the library, then bakes models/rat.glb into public/models/
```

WASD or the arrow keys walk the light; it stays put when no key is held. Space
puts it out and relights it. The mouse wheel, or + and -, zooms the camera.

The panel, top-right, sets the rats (2,000 to start, up to 16,384; more are
added at the arena's edge), the slowest and fastest rat, the light's strength,
the light on or off, and the camera's zoom. Its folders set the look: the lamp's colour,
intensity, reach and falloff, and its shadows (off to start: six passes, a
cube); the sun's colour, intensity, position (x, y, z from the light it follows), its shadows (on to
start) and their softness; the fill's sky and ground colours and intensity;
the fog's colour, near and far; and the rats' tint. The line top-left reads
rats drawn, steering ms, frame ms and frames a second, and the backend
drawing them.

The rats are culled by the page, not by three: on WebGPU, a batch three culls
per camera draws the wrong rats once a shadow pass and the view cull
differently, so every pass draws the one list the page picked from the view.

The URL sets the start, so two runs can be compared: `?webgl` draws through
WebGPURenderer's WebGL 2 backend, `?rats=8192` starts with that many rats,
`?shadows` with the lamp's shadows on, and `?loop` has the light walk the same
loop on every run in place of the keys.

## How it is cut

- **The swarm** (`src/swarm.ts`) is the steering, lifted from the prototype on
  branch `prototype/last-light-swarm`: the rats' ground positions and headings
  in flat arrays, stepped by a time step given the light and the tuning. No
  renderer and no DOM. Its tests (`src/swarm.test.ts`) drive it through its own
  calls at a fixed time step and seed.
- **The rats** (`src/rats.ts`) are one `BatchedMesh` over the baked rat, culled
  rat by rat and drawn in one draw (`src/collapse.ts`, copied from the
  examples). Each rat's Run playback is written once, when it spawns.
- **The ground** (`src/ground.ts`) is one plane under a tiled, hand-painted
  dirt texture, read at two scales and turned against itself so its repeats
  are hard to catch. The texture is generated, not painted:
  `node tools/dirt.mjs [size] [seed]` writes `public/textures/dirt.png`, and a
  painted one dropped in its place needs no code change.
- **The page** (`src/main.ts`) steps the swarm, stands the rats where it says,
  walks the light and trails it with the camera, high and close behind it, in
  grey-green fog, under a dim cold fill and a cold far sun.

The rat is Quaternius's (CC0, credited in `public/licence.txt`), a
placeholder; its baked file is written by the `bake` script and never committed.
