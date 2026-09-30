# Ho Ho No

Santa against the horde, on three-vat: the repo's **game** (see `CONTEXT.md`
and [ADR-0038](../../docs/adr/0038-a-game-lives-beside-the-gallery-as-one-program-on-either-renderer.md)).
Ported from DecemberChallenge at `5c6c56b`. A private workspace package: it
is never published, and it is held to none of the gallery's rules.

```bash
pnpm --filter ho-ho-no dev         # the game, on WebGPU; add ?renderer=webgl for WebGLRenderer
pnpm --filter ho-ho-no test        # the simulation, headless
pnpm --filter ho-ho-no typecheck
pnpm --filter ho-ho-no build       # dist/, deployed to /games/ho-ho-no/
pnpm --filter ho-ho-no bake        # the crowds' baked files; dev, build and test run it first
```

`pnpm test` and `pnpm typecheck` at the root run the last two with everything
else.

## How it is cut

- **The simulation** (`src/simulation/`) is the gameplay: stepped by
  `(time, input)`, owning the Rapier world, with no renderer, DOM or audio.
  Input is plain state (a movement vector, an aim point, fire held); what
  happens is raised as events. The horde (`horde.ts`) and the elves
  (`elves.ts`) are in it: what each skeleton plays it writes into its row of the
  playback texture with the library's `setVATInstance`, and the row is the
  carrier's own numbering, handed in as `addInstance` and `deleteInstance`. Its
  tests drive it in Node on the real baked files, read with `loadVAT`, and ask
  the library's `resolveVATFrame` what each skeleton shows.
- **The renderer seam** (`src/seam.ts`) is everything that differs between the
  two renderers: the renderer, the toon and floor materials, the snow and burst
  particles, and the post pass with its vignette. `src/seams/webgl.ts` is GLSL
  on `WebGLRenderer`, `src/seams/webgpu.ts` is TSL on `WebGPURenderer`, and
  only the chosen one is downloaded. Nothing else imports either renderer.
- **Above the seam**, written once: the stage (`src/stage.ts` — lights, camera,
  camp, floor, Santa, snowballs), the crowds (`src/crowds.ts` — the horde's
  `BatchedMesh` of 400 rows and the elves' `createVATMesh`), Santa's animations
  (`src/santa.ts`), the input (`src/input.ts`), the start screen
  (`src/shell.ts`) and the HUD with its game over (`src/hud.ts`).

## Assets

### The crowds: baked files

The skeletons and the elves are VATs, loaded from two baked files that the
game's `bake` script writes with the repo's own `three-vat bake` before `dev`,
`build` and `test`: `public/models/skeleton.vat.glb` from `models/skull.glb`,
and `public/models/elf.vat.glb` from `models/elf.glb`. They are gitignored, so
the game always loads today's baker's output and never a stale format version,
and the browser never bakes. The step builds the library first, because the
command is the library's `dist/bin.js`.

`models/vat.config.json` names the clips and their playback defaults, so the
code writes a clip and a start and nothing more: `spawn` and `death` play once
and clamp, `walk` repeats at 2x (the original played its walk at double rate),
`run` is baked and unused, and both elf clips run at 0.8x (the original ran its
30 fps bakes at 24 fps).

`models/` holds the sources, which the deploy does not ship. `skull.glb` is
the one the library's rig crossfade test reads (`src/bake.rig-crossfade.test.ts`).
`elf.glb` is the KayKit elf with one change: its material pointed at an
`EXT_texture_webp` texture with no image behind it and the file had no images
at all, which three's `GLTFLoader` fails on in the browser as the bake command
does in Node. The dangling texture is removed; the game draws the elves in its
own toon material anyway.

### The rest

Every model in `public/models/` but the two baked files is meshopt-compressed with
[gltfpack](https://github.com/zeux/meshoptimizer/tree/master/gltf), keeping
every vertex attribute (the meshes carry no material, so UVs look unused to it)
and float texture coordinates (with no material, a quantised UV has nowhere to
put its dequantisation):

```bash
npx gltfpack -cc -kn -kv -vtf -i camp.glb -o public/models/camp.glb
npx gltfpack -cc -kn -kv -vtf -vpf -i snowBall.glb -o public/models/snowBall.glb
```

`-vpf` (float positions) is for the models whose geometry is used without its
node: the snowball, drawn instanced, and the arena collider, handed to Rapier.

The baked files go as the command writes them, 570 KB and 350 KB: gltfpack
reorders and welds vertices, and a VAT's texels are addressed by the vertex
order it was baked with, so `loadVAT` refuses a baked file an optimizer has
been through.

The models are KayKit (CC0). `public/licence.txt` is the original's licence
file with a KayKit line added — the icon credits, and the audio credits for the
sound that arrives with the gifts (#131) — shown behind the start screen's
Credits link.
