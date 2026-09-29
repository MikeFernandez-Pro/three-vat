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
```

`pnpm test` and `pnpm typecheck` at the root run the last two with everything
else.

## How it is cut

- **The simulation** (`src/simulation/`) is the gameplay: stepped by
  `(time, input)`, owning the Rapier world, with no renderer, DOM or audio.
  Input is plain state (a movement vector, an aim point, fire held); what
  happens is raised as events. Its tests drive it in Node.
- **The renderer seam** (`src/seam.ts`) is everything that differs between the
  two renderers: the renderer, the toon and floor materials, the snow and burst
  particles, and the post pass with its vignette. `src/seams/webgl.ts` is GLSL
  on `WebGLRenderer`, `src/seams/webgpu.ts` is TSL on `WebGPURenderer`, and
  only the chosen one is downloaded. Nothing else imports either renderer.
- **Above the seam**, written once: the stage (`src/stage.ts` — lights, camera,
  camp, floor, Santa, snowballs), Santa's animations (`src/santa.ts`), the
  input (`src/input.ts`) and the start screen (`src/shell.ts`).

## Assets

Every model in `public/models/` is meshopt-compressed with
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

The models are KayKit (CC0). `public/licence.txt` is the original's licence
file with a KayKit line added — the icon credits, and the audio credits for the
sound that arrives with the gifts (#131) — shown behind the start screen's
Credits link.
