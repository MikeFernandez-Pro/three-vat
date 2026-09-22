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
   node 20 and 22.
2. **`node scripts/fetch-test-assets.mjs` has run locally**, so the skinned
   real-asset tests actually baked a real character instead of skipping (see
   [test-assets.md](./test-assets.md)).
3. **`node release/parity/check.mjs` passes.** The cross-path pixel-diff gate.
   Details below.
4. **`node release/hero/capture.mjs` has been re-run if the crowd example
   changed**, so the README's image is a picture of the page being shipped.
   Details below.
5. **`CHANGELOG.md` has an entry for this version**, and `package.json`'s
   `version` matches it. The notes are drafted under `## [Unreleased]` as the
   work lands and the first line there names the version they are for, so this
   step is renaming that heading to `## [<version>] - <date>` and adding the
   `[<version>]:` link beneath the entry — a link that is a 404 until the tag
   below exists, which is why the tag is not optional.

## Publishing

```bash
node scripts/release.mjs
```

Authentication is whatever `~/.npmrc` holds for `registry.npmjs.org`, and the
second factor is whatever the npm account is enrolled in. There are three
shapes, and the script handles each:

- **A granular or automation token.** It bypasses 2FA on publish outright, so
  there is nothing to pass and nothing to approve. The unattended case.
- **A passkey** — WebAuthn, a security key, or the platform authenticator. The
  default. npm prints a URL, you approve the challenge in the browser, and the
  publish completes. Nothing extra to type.
- **An authenticator app.** Pass the code and the flag is added for you:

  ```bash
  NPM_OTP=<code from your authenticator> node scripts/release.mjs
  ```

  Mind the window: `prepublishOnly` runs before npm reaches the registry, so a
  code entered late in its thirty seconds can expire in transit.

Any of the three runs `prepublishOnly` (typecheck, tests, build), publishes, and
then polls the registry until the new version is readable — `0.2.0` once shipped a
changelog entry and a README badge for a version the registry never received.

**Why the script spawns `npm` and not `pnpm`.** `pnpm publish` can only ask for
a six-digit code. On a passkey account it runs the whole of `prepublishOnly`,
reaches the registry, and dies at `npm error code EOTP` with no way forward —
which is how the 2.0.0 release went before this was fixed, and the passkey is
the shape this account actually uses. `npm publish` runs the same lifecycle
script and builds the same tarball (`files` is `dist` alone), so the client
sending it changes nothing about what ships.

## After publishing

Tag the release commit and cut a GitHub Release from the tag. The CHANGELOG's
version links point at `releases/tag/v<version>`, so they are dead until this
has run — `1.0.1` shipped to npm with neither, and its link was a 404 for a day.

```bash
git tag -a v<version> -m "<version> — <the CHANGELOG entry's one-line summary>"
git push origin v<version>
gh release create v<version> --title "v<version>" --notes "<the CHANGELOG entry for this version>"
```

The release notes are the CHANGELOG entry, pasted, not rewritten: one account
of what shipped, in one place, with the GitHub Release pointing at it.

## The parity gate

```bash
node release/parity/check.mjs
```

It serves `release/parity/index.html` on localhost, opens it in the Chrome (or
Edge) this machine already has, renders **one bake per encoding through both
decode paths** — the demo's robot under the vertex encoding, Soldier under the
rig encoding ([ADR-0018](./adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md))
— at the same camera, lights and animation time, compares the frames pixel by
pixel, captures everything the browser prints to its console, and exits non-zero
if any of it is wrong. Run it on a machine with a real GPU, after
`node scripts/fetch-test-assets.mjs` (the rig case needs Soldier, which is not
in git). `--browser=chrome,msedge` orders the channels it tries; `--no-open`
prints the URL for a browser it cannot drive (Safari 26+), at the cost of the
console capture; `--screenshot=<file>` keeps a picture of the page and its
verdict.

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
| The browser console reported no error | Printed by the driver, first, because it explains anything below it. A WGSL compile error never reaches a pixel: three reports it to the console, the pipeline never builds, and the render target keeps whatever frame it held — so the page's own checks can pass on a picture the decode under test did not draw. Every console line is printed as it arrives; any error fails the gate. |
| Both paths were handed the same bake, and the same rig bake | Each path bakes its own VAT (a texture cannot be shared between two live renderers without asking a question the gate is not about), so the guarantee that both saw identical texels is taken back as evidence — a texel walk over both layers of the vertex bake, and over the rig texture of the rig bake. |
| Both paths drew something | Two empty frames match perfectly. Without this, a harness that never built a crowd reports the cleanest pass of its life. Checked for the robot, the batched crowd and the rig crowd alike. |
| Both readbacks come back the same way up | GL reads a framebuffer bottom-up, WebGPU reads a texture top-down. If either convention ever changes, every comparison fails at once — and that deserves its own sentence, not a trip into the shaders. |
| The backends light the same room the same way | The rest-pose mesh with no VAT in it. A difference here is the *backends* disagreeing about shading, which is not what this gate is for and would otherwise be blamed on the decode. |
| The two paths read the same texel for the same vertex | The addressing probe: the decode's inputs painted as colour, with no VAT sampled. If this fails, the two paths are reading different texels and comparing what they made of them is premature. |
| The two paths compute the same texture row for the same vertex | The sampling probe, the other half of the coordinate — the clock, the clip's frame count and its fps all land here. Between the two probes, every number a texture read is handed has been compared. |
| The two decode paths render the same pixels | The gate. |
| The two decode paths agree on a BatchedMesh crowd | The gate again on the second carrier, which is not the same question: a batch reaches its instance's pack through `getIndirectIndex( gl_DrawID )` on one path and the `batchIndirectIndex` varying on the other, so agreement on an `InstancedMesh` says nothing about agreement here. |
| Each path's batched crowd survives its draw order being permuted | The stripe test, in one number. `BatchedMesh` culls and sorts per instance, so the drawn slot is a permutation that changes every frame; the batch is rendered twice with its draw order reversed between them, and a decode reading the pack by the drawn slot rather than by the logical index renders the crowd's clips shuffled. Measured within one path, so the permutation is the only variable ([ADR-0016](./adr/0016-the-pack-is-a-texture-keyed-by-instance-not-instanced-attributes.md)). |
| The two decode paths agree on a rig-encoded crowd | The gate a third time, for the second encoding. A rig-encoded VAT is a different decode on each path — four slots skinned from a rig texture, where the vertex encoding reads a texel per vertex ([ADR-0018](./adr/0018-the-rig-encoding-is-a-second-encoding-opt-in-for-now.md)) — so everything above, proven on the robot's vertex bake, proves nothing about it. Soldier, rig-baked once per path, in the same room at the same clock; named apart from the robot so a failure here reads as the rig decode drifting. |
| A deliberate one-frame slip on each path fails this gate (measured within that path) | The geometric fault: the crowd is decoded one baked frame late, so the silhouette lands in the wrong place. One frame is the smallest slip a decode can make, so a gate that catches it catches anything coarser. |
| A deliberate wrong-normal decode on each path fails this gate (measured within that path) | The shading-only fault, and the one that matters: every baked normal's x is negated, so the silhouette stays pixel-exact and only the lighting inside it is wrong. That is the shape of the bug a VAT is most likely to have on one path alone — a normal texture is half of what a VAT ships, and lighting is the whole reason it ships one ([ADR-0002](./adr/0002-runtime-texture-encoding.md)) — and it is the first thing a loose tolerance stops seeing. Together with the two below, these are the run's proof that its own tolerance still has teeth: a tolerance wide enough to pass a broken decode passes a correct one too, and looks identical doing it. Each is measured against the *same path's* clean frame, never the other path's — across paths, a failing parity check would show up in every one and read as proof of their sharpness. It also makes each one a liveness probe: a path decoding nothing renders the same frame at `TIME` and one frame later. |
| A deliberate one-frame slip on each path's rig-encoded crowd fails this gate (measured within that path) | The rig case's own proof it is armed. The slip alone, because a rig has no normal texture to bend — its normals come out of the skin matrix with its positions — and the slip is the fault it needs: a rig decode that drew nothing renders the same frame at `TIME` and one frame later, and says so here. |

**When it fails.** Read the checks top to bottom and stop at the first failure —
they are ordered so that an earlier one explains a later one. A console error at
the top is the cause of whatever follows; read the shader message it prints
before anything else. A failure of the last six means either the *tolerance* is
wrong (reconsider `PARITY_TOLERANCE` in `release/parity/compare.ts`) or that
path is not decoding at all; the two read apart, because a path that decodes
nothing reports ~0% there. A failure of one of the three "agree" checks — the
robot's crowd, its batched crowd, or the rig-encoded crowd — with everything
above it green and the six below it green, is the one this gate exists for: a
real divergence between the GLSL and TSL decodes, with the backends, the camera,
the lighting and the readback all proven identical above it. Do not publish.

**Why the gate drives a browser, and which.** For a long time it did not: the
only thing a driver seemed to buy was a choice of browser, and the machine
running a release already had the right one as its default — where a headless
Chromium is the one browser whose WebGPU support this gate cannot rely on. What
changed that was a lost `i32()` cast in the TSL decode (#52's run-up): the
vertex shader was invalid, three said so in the console, the pipeline never
built, and the gate showed a rest-posed robot with identical numbers on both
TSL self-tests and no cause named. A pixel verdict cannot see a compile error.
So the driver — `playwright-core`, the dependency the hero capture already
carries — opens the page in the *headed* Chrome or Edge this machine has, on its
real GPU, and subscribes to the console; the browser is still not chosen for
the gate, only listened to. The hero capture below is the unattended case, and
it is unattended for the opposite reason: it needs WebGL, which headless Chrome
renders perfectly well, and it needs no human at all.

**Where it lives.** `release/` — beside the library, not inside the demo. The
gate reaches into `examples/` for the robot and the WebGPU probe, because the
point is that both paths agree on the model a reader has actually seen; nothing
in the demo reaches back. Soldier, the rig case's asset, is served from
`test-assets/` — where `node scripts/fetch-test-assets.mjs` puts it, see
[test-assets.md](./test-assets.md) — by a middleware in `release/vite.config.ts`,
and a missing file is a named failure of the gate, not a stack trace. That
direction is the rule
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
the suite (`compare.ts`, `verdict.ts`, and their tests), as does the part that
decides what the captured console means (`console.mjs`). That split is what lets
a gate CI cannot run still be trusted to work when a human runs it.

## The hero image

```bash
node release/hero/capture.mjs
```

It builds the pages, serves the build, opens the **crowd example** —
`webgl_crowd.html`, at its own address rather than inside the gallery
([ADR-0020](./adr/0020-the-gallery-is-the-root.md)) — in headless Chrome,
presses the real count slider and drags it from one robot to 340, screenshots
every step, and writes the frames to `docs/media/hero.gif`, the README's hero
image. Run it whenever that page changes, and read the checks it prints.

**Why it is a script and not a screenshot.** A hand-taken image is prettier than
the page the day after the page changes, and nothing ever notices. This one is
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
