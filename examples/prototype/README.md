# PROTOTYPE — the bone encoding, measured

Throwaway. Nothing here ships, and nothing in `src/` imports it.

It answers the one question [#47](https://github.com/MikeFernandez-Pro/three-vat/issues/47)
left open: **what do 8–32 texel fetches per vertex cost against the 4–6 a VAT
spends?**

## Run it

```sh
pnpm --filter three-vat-example dev     # then open /prototype/
node examples/prototype/sweep.mjs http://localhost:5173/prototype/?asset=soldier
```

`?asset=robot` (RobotExpressive) · `?asset=soldier` (49-bone rig) ·
`?max=1000` · `?enc=qt-slerp`.

The button is the deliverable, not the picture: it warms up, locks the camera,
and times 90 frames per variant through `EXT_disjoint_timer_query_webgl2`.

## The answer

The answer depends on the GPU, and it depends on it in the direction that
matters. Ratios are the **best frame** of 90 against the VAT's best frame at
the same count, Soldier, 1× pixel ratio, no shadows. Raw reports are in
[`reports/`](./reports).

**Desktop — RTX 5080, Chrome 141, WebGL2, GPU timer query:**

| | 340 instances | 1000 instances |
| --- | --- | --- |
| `mat4-lerp` (32 fetches) | 1.5–2.1× | 1.6–2.0× |
| `mat4-near` (16) | 1.5–2.0× | 1.5–2.0× |
| `qt-near` (8) | 1.4–1.8× | 1.3–1.8× |
| `qt-slerp` (16) | 1.4–1.9× | 1.4–1.8× |

**Phone — iPhone 15 Pro Max (A17 Pro), Safari, WebGL2, wall clock, two runs:**

| | 340 instances |
| --- | --- |
| `mat4-lerp` (32 fetches) | 0.70–0.74× |
| `mat4-near` (16) | 0.59–0.63× |
| `qt-near` (8) | 0.59–0.60× |
| `qt-slerp` (16) | 0.60× |

**On the desktop the cache does not absorb it.** The premise in
`docs/landscape.md` — that every vertex of an instance reads the same 1.5–3 kB,
so the fetches are nearly free — is wrong there. The bone decode costs
**1.3–2.1× the VAT's frame time**, consistently, on both assets and at both
counts. (Frame time, not vertex time: the timer wraps the whole render, and the
fragment work is identical on both sides, so the vertex-stage ratio alone is
higher than this.)

**On the phone the same premise is true, and the bone decode is faster.**
340 Soldiers cost 7.3–7.5 ms a frame as a VAT and 4.3–4.5 ms as bones. The
VAT texture is 25 MB and every vertex reads a different texel, so on a
bandwidth-starved GPU the decode is a stream of cache misses; the bone texture
is 177 kB, cache-resident, and the dependent fetches the desktop pays for come
back nearly free. The landscape doc's argument holds exactly on the platform
where memory matters most, and fails only where it does not matter.

**And the fetch count is not what drives it, on either GPU.** 8 fetches
(`qt-near`) and 32 (`mat4-lerp`) are within ~15% of each other on the
desktop and ~20% on the phone. The cost is the *dependent* read — four indirect
lookups whose addresses come from an attribute — plus the blend and the `mat4`
reconstruction, not the bytes moved. Halving the texels does not halve anything.

What it buys, on the same runs:

| | Soldier (7 434 v, 51 slots) | RobotExpressive (7 214 v, 184 slots) |
| --- | --- | --- |
| VAT texture | 25.2 MB | 34.8 MB |
| `qt-slerp` texture | 176.9 kB (**146× less**) | 908.5 kB (**39× less**) |
| VAT bake | 1 433 ms | 163 ms |
| `qt-slerp` bake | 5 ms (**286× faster**) | 11 ms (**15× faster**) |

So on a discrete GPU the trade is real and it is a trade: **~1.5× frame cost
for 40–150× less memory, a bake that is 15–290× faster, and no vertex
ceiling.** At these counts a desktop crowd is nowhere near GPU-bound — 340
Soldiers cost 0.47 ms as a VAT and 0.72 ms as bones — so the ratio matters far
less than the memory does.

On a phone there is no trade. The bone encoding is **~0.6× the frame time and
~1/150 the memory**, and 340 VAT Soldiers already cost half a 60 Hz budget
there. That moves the question the ADR has to answer from *whether to offer
this* to *whether it should be the default for a skinned asset*, with the
vertex encoding kept for morph targets and for anything a rig cannot express.

## Three findings the issue did not anticipate

**1. RobotExpressive cannot be bone-baked at all.** Not just the morphed head
in some clips — *every one of its 14 clips* animates `Head_2`/`3`/`4`'s morph
targets, Idle and Walking and Running included. The refusal fires correctly and
names the part and the clips. To get a number at all, the page drops those
parts (`onMorphAnimation: 'drop'`) and says so on screen and in the report. The
robot's bone rows are therefore timed on slightly less geometry than the VAT's.

**2. `qt-slerp` is not the winner I expected, but `mat4-lerp` is still the
loser.** Quaternion storage wins on memory (2 texels vs 4) and is the only
variant that interpolates a rotation *as* a rotation. Componentwise-lerping two
`mat4`s shortens a limb as it turns; it is also the slowest variant. There is
no reason to carry it forward.

**3. Measuring this is harder than it looks.** The first draft reported the
median and produced two runs that disagreed by 5×: past ~8 ms a frame,
everything collapses onto the display's cadence and the variants stop
separating. The headline is now the best frame of 90, and any GPU-timed row
over 8 ms is flagged `SATURATED` and should not be read.

**4. Measuring it on a phone is harder still.** Safari has no GPU timer query,
rounds `performance.now` to 1 ms, and its `gl.finish()` returns before the
GPU is done. The first phone run timed every variant at 0.000 ms. The wall-clock
fallback now ends each batch on a one-pixel `readPixels`, which cannot return
before the frame exists, and calibrates the batch to at least 50 ms so the
clock's rounding is a 2% error. The two phone reports carry `SATURATED` flags
from before the flag was scoped to the GPU-timed path; under a synchronous
readback there is no display cadence to fight, and the spread between best and
median there is throttling, which the best frame already discards.

## What is deliberately not measured

- **A phone at more than one count.** The two Safari runs are both at 340;
  `?max=150` would add an unsaturated-looking pair but two agreeing runs were
  taken as enough. Android is unmeasured.
- **WGSL/TSL.** A fetch-cost ratio transfers; building a second decode for a
  throwaway would not have changed the answer.
- **Shadows, moving instances, `BatchedMesh`.** All excluded to keep the
  measurement about the vertex stage.
- **The LOD claim.** `docs/landscape.md`'s strongest argument for this encoding
  is that one rig's texture serves several meshes, which would make LOD and a
  mixed crowd possible for the first time. Nothing here tests it, and it is the
  thing most worth testing next — the memory numbers above are the *weaker*
  half of the case.

## Known imprecision

Slots are allocated per part, not per `(skeleton, bindMatrix)`, so a rig shared
by two meshes is stored twice. `idealSlotCount` reports what the dedupe would
have cost. It widens the texture and changes no fetch count, so every memory
number above is the pessimistic one.

## Files

| | |
| --- | --- |
| `bake-bones.ts` | the bone bake, both formats, and the morph refusal |
| `decode.ts` | the four GLSL variants over one shared row resolver |
| `bench.ts` | the GPU timer, its fallback, and the sweep |
| `main.ts` | the page: crowds, tables, report |
| `sweep.mjs` | runs the sweep from a terminal |
| `reports/` | the raw reports every number above is read from |
