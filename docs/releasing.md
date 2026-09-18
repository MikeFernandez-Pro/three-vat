# Releasing

Everything a release needs is a `node` invocation, not a `pnpm run` entry:
`pnpm run` is the repository's front door and holds only the verbs a person
types — `dev`, `test`, `build`, `typecheck` — and nothing a newcomer will never
run (#25). This file is the index of the rest.

Everything below is required. `prepublishOnly` runs the typecheck, every suite
and the library build on its own; the parity gate it cannot run, because it
needs a GPU and a browser — so it is the one step a human has to remember, and
this file is where it is written down. The hero image is the other thing that
only happens if someone runs it.

## Before publishing

1. **CI is green on `main`** — typecheck, every suite, and the library build, on
   node 18 and 22.
2. **`node scripts/fetch-test-assets.mjs` has run locally**, so the skinned
   real-asset tests actually baked a real character instead of skipping (see
   [test-assets.md](./test-assets.md)).
3. **`node release/parity/check.mjs` passes.** The cross-path pixel-diff gate.
   Details below.
4. **`node release/hero/capture.mjs` has been re-run if the demo changed**, so
   the README's image is a picture of the demo being shipped. Details below.
5. **`CHANGELOG.md` has an entry for this version**, and `package.json`'s
   `version` matches it.

## Publishing

```bash
node scripts/release.mjs
```

Authentication is whatever `~/.npmrc` holds for `registry.npmjs.org`. A granular
or automation token bypasses 2FA on publish, which is the usual setup here and
needs no code. If the account is instead on authenticator-based 2FA for publish,
pass the code and the flag is added for you:

```bash
NPM_OTP=<code from your authenticator> node scripts/release.mjs
```

Either way it runs `prepublishOnly` (typecheck, tests, build), publishes, and
then polls the registry until the new version is readable — `0.2.0` once shipped a
changelog entry and a README badge for a version the registry never received.

## The parity gate

```bash
node release/parity/check.mjs
```

It serves `release/parity/index.html` on localhost, opens it in your default
browser, renders **one bake through both decode paths** at the same camera,
lights and animation time, compares the frames pixel by pixel, and exits non-zero
if they disagree. Run it on a machine with a real GPU, in a browser with WebGPU
(Chrome, Edge, or Safari 26+). `--no-open` prints the URL instead, for when your
default browser is not the one with WebGPU; `--browser="<command>"` names another.

**Why it is a gate and not a test.** Every automated test in this repository
verifies *structure* — attributes present, node graph builds, materials counted,
bundles isolated. None of that can catch a decode that is subtly wrong on one
path only, which is exactly the risk of shipping two decode paths
([ADR-0004](./adr/0004-ship-both-glsl-and-tsl-decode-paths.md)). Only pixels can.
And pixels need a GPU on both backends: headless WebGPU is not a dependable CI
target, and a flaky gate is a gate that gets disabled. So it stays out of
pull-request CI on purpose, and stays required here.

**What it checks**, in the order the page reports them:

| Check | Why it is there |
| --- | --- |
| Both paths drew something | Two empty frames match perfectly. Without this, a harness that never built a crowd reports the cleanest pass of its life. |
| Both readbacks come back the same way up | GL reads a framebuffer bottom-up, WebGPU reads a texture top-down. If either convention ever changes, every comparison fails at once — and that deserves its own sentence, not a trip into the shaders. |
| The backends light the same room the same way | The rest-pose mesh with no VAT in it. A difference here is the *backends* disagreeing about shading, which is not what this gate is for and would otherwise be blamed on the decode. |
| The two decode paths render the same pixels | The gate. |
| A deliberate one-frame slip on each path fails this gate (measured within that path) | The geometric fault: the crowd is decoded one baked frame late, so the silhouette lands in the wrong place. One frame is the smallest slip a decode can make, so a gate that catches it catches anything coarser. |
| A deliberate wrong-normal decode on each path fails this gate (measured within that path) | The shading-only fault, and the one that matters: every baked normal's x is negated, so the silhouette stays pixel-exact and only the lighting inside it is wrong. That is the shape of the bug a VAT is most likely to have on one path alone — a normal texture is half of what a VAT ships, and lighting is the whole reason it ships one ([ADR-0002](./adr/0002-runtime-texture-encoding.md)) — and it is the first thing a loose tolerance stops seeing. Together, these four are the run's proof that its own tolerance still has teeth: a tolerance wide enough to pass a broken decode passes a correct one too, and looks identical doing it. Each is measured against the *same path's* clean frame, never the other path's — across paths, a failing parity check would show up in all four and read as proof of their sharpness. It also makes each one a liveness probe: a path decoding nothing renders the same frame at `TIME` and one frame later. |

**When it fails.** Read the checks top to bottom and stop at the first failure —
they are ordered so that an earlier one explains a later one. A failure of the
last four means either the *tolerance* is wrong (reconsider `PARITY_TOLERANCE` in
`release/parity/compare.ts`) or that path is not decoding at all; the two
read apart, because a path that decodes nothing reports ~0% there. A failure of
the fourth, with the first three green and the last four green, is the one this
gate exists for — a real divergence between the GLSL and TSL decodes, with the
backends, the camera, the lighting and the readback all proven identical by the
third check. Do not publish.

**Why the gate drives no browser.** The spec (#1, Seam 3) named Playwright; this
does the job with a Vite dev server and `open`. The only thing a driver has to do
here is hand a localhost URL to a browser with a real GPU and collect what it
posts back, and the machine running a release already has such a browser
configured as its default — where a headless Chromium is the one browser whose
WebGPU support this gate cannot rely on. A driver would have bought a worse
browser and nothing else. The hero capture below is the unattended case that
paragraph reserved, and it is unattended for the opposite reason: it needs WebGL,
which headless Chrome renders perfectly well, and it needs no human at all.

**Where it lives.** `release/` — beside the library, not inside the demo. The
gate reaches into `examples/` for the robot and the WebGPU probe, because the
point is that both paths agree on the model a reader has actually seen; nothing
in the demo reaches back. That direction is the rule
([ADR-0011](./adr/0011-one-example-per-renderer-duplicated-on-purpose.md), as
amended): a release gate reaching into the demo is correct layering, a demo
containing the release gate is not. `release/` also holds the packaging and
deployment checks — that each page bundles exactly one decode path, and that the
built app survives being served from a subpath — which are properties of the
release for the same reason. They run in CI with the rest of `pnpm test`.

**How it is built.** The part that needs a GPU renders frames and nothing else
(`webgl-frame.ts`, `tsl-frame.ts` — deliberate near-copies, for the reason in
[ADR-0011](./adr/0011-one-example-per-renderer-duplicated-on-purpose.md)); the
part that decides what the frames mean is pure and runs in CI with the rest of
the suite (`compare.ts`, `verdict.ts`, and their tests). That split is what lets
a gate CI cannot run still be trusted to work when a human runs it.

## The hero image

```bash
node release/hero/capture.mjs
```

It builds the demo, serves the build, opens it in headless Chrome, presses the
real count slider and drags it from one robot to 340, screenshots every step, and
writes the frames to `docs/media/hero.gif` — the README's hero image. Run it
whenever the demo changes, and read the checks it prints.

**Why it is a script and not a screenshot.** A hand-taken image is prettier than
the demo the day after the demo changes, and nothing ever notices. This one is
regenerated from the deployed page in one command, so the worst it can be is out
of date by one release, and it is a picture of the thing it advertises
([ADR-0012](./adr/0012-the-demo-is-an-argument-not-a-showcase.md)).

**What it checks before it writes anything.** The capture has to carry the
demo's argument or the image is worse than none, so the script asserts it against
the recording rather than against the plan that asked for it — and on a failure
leaves the existing GIF untouched and exits non-zero:

| Check | Why it is there |
| --- | --- |
| The page ran clean | An uncaught error mid-drag is a demo that is broken in the image advertising it. |
| The recording starts on one robot, reaches the full crowd, and only ever climbs | The argument is the *climb*. Read off the HUD, not off the plan: the drag is a real mouse on a real control, and where it lands is the demo's answer, not the script's. |
| The draw calls never move | The claim. One number that does not change while the count changes by two orders of magnitude — if this ever fails, the image is the least of it. |
| The texture panel is in frame, with its cursors drawn on it | The only composition carrying both the mechanism and the result in one image, which is the whole reason the panel is visible by default. Found by the id the demo gives it, so it is that panel and not the next small canvas anyone adds. |
| The draw-call readout is in frame | The two checks above it read the DOM, which says nothing about whether a reader can see the answer. The readout is the one number given visual emphasis; a HUD that reflowed it off an edge would pass everything else here. |
| The image is small enough to be a first impression | A README hero loads before the reader has decided to care, on npm and on a phone. `HERO_BUDGET_BYTES` in `release/hero/gif.mjs` is set near what the capture actually weighs, not at the largest tolerable image: a ceiling with room to triple under it cannot report the regression it exists to catch. |

**Why GIF.** npm is half the audience and will not play a video. That constraint
sets the encoding: one palette quantized across the whole recording, and only the
pixels that changed written per frame, over an undisposed previous frame. Most of
this image never moves — sky, ground, both texture strips, every static line of
the HUD — so that is most of the file, and it is what keeps three seconds of a
340-robot crowd close to a megabyte.

**Flags.** `--out=` writes the GIF somewhere else; `--no-build` reuses the last
build; `--headed` opens the browser so you can watch the drag; `--browser=` names
the channels to try, in order (`chrome,msedge,chromium` by default). The image's
own shape — size, frame count, rate, colour table, the beats held at each end —
is a set of named constants at the top of `capture.mjs` rather than flags, for
the same reason `PARITY_TOLERANCE` is a constant: there is one hero image, and
retuning it is an edit, not an invocation.

**Where it lives.** `release/hero/`, beside the parity gate, and for the same
reason: it reaches into `examples/` and the demo never reaches back
([ADR-0011](./adr/0011-one-example-per-renderer-duplicated-on-purpose.md), as
amended). Split the same way, too. Only `capture.mjs` needs a browser; what to
drag and when (`plan.mjs`), what the frames cost in bytes (`gif.mjs`) and whether
the recording is worth publishing (`verdict.mjs`) are pure and pinned by tests in
CI — which is what lets a release step CI cannot run be trusted to still work.

**Its one dependency.** `playwright-core`, not `playwright`: it drives the Chrome
or Edge the machine already has, so cloning this repository to build a library
never downloads a browser. If it cannot find one it says which channels it
tried. Chrome renders the crowd through SwiftShader here — a software
rasteriser, on purpose, so the image looks the same on a laptop, a workstation,
or a box with no GPU at all. The demo is not being benchmarked, only photographed.
