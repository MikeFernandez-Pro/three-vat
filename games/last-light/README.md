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

The light walks to the point under the pointer, and walks its own loop once the
pointer has been idle for 3 s. Space puts it out and relights it.

The panel, top-right, sets the rats (2,000 to start, up to 16,384; more are
added at the arena's edge), the slowest and fastest rat, the light's strength,
the light on or off, and shadows (off to start). Shadows on also turns off
culling rat by rat, because on WebGPU a batch culled per instance draws the
wrong rats once the shadow pass and the view cull differently. The line
top-left reads rats drawn, steering ms and frame ms, and the backend drawing
them.

The URL sets the start, so two runs can be compared: `?webgl` draws through
WebGPURenderer's WebGL 2 backend, `?rats=8192` starts with that many rats, and
`?shadows` with shadows on. Left alone, the light walks the same loop on every
run.

## How it is cut

- **The swarm** (`src/swarm.ts`) is the steering, lifted from the prototype on
  branch `prototype/last-light-swarm`: the rats' ground positions and headings
  in flat arrays, stepped by a time step given the light and the tuning. No
  renderer and no DOM. Its tests (`src/swarm.test.ts`) drive it through its own
  calls at a fixed time step and seed.
- **The rats** (`src/rats.ts`) are one `BatchedMesh` over the baked rat, culled
  rat by rat and drawn in one draw (`src/collapse.ts`, copied from the
  examples). Each rat's Run playback is written once, when it spawns.
- **The ground** (`src/flagstones.ts`) is flagstones built in code, no
  texture: a jittered lattice cut into irregular stones, each at its own height,
  tilt and tone, bevelled down to dark joints, flat-shaded, one draw.
- **The page** (`src/main.ts`) steps the swarm, stands the rats where it says,
  walks the light and trails it with the camera, high and close behind it, in
  grey-green fog under a dim cold fill.

The rat is Quaternius's (CC0, credited in `public/licence.txt`), a
placeholder; its baked file is written by the `bake` script and never committed.
