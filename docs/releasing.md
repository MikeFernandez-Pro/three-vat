# Releasing

Everything below is required. `prepublishOnly` runs the first three on its own;
the parity gate it cannot run, because it needs a GPU and a browser — so it is
the one step a human has to remember, and this file is where it is written down.

## Before publishing

1. **CI is green on `main`** — typecheck, both test suites, and the library
   build, on node 18 and 22.
2. **`pnpm fetch:test-assets` has run locally**, so the skinned real-asset tests
   actually baked a real character instead of skipping (see
   [test-assets.md](./test-assets.md)).
3. **`pnpm parity` passes.** The cross-path pixel-diff gate. Details below.
4. **`CHANGELOG.md` has an entry for this version**, and `package.json`'s
   `version` matches it.

## Publishing

```bash
NPM_OTP=<code from your authenticator> pnpm release
```

That runs `prepublishOnly` (typecheck, tests, build), publishes, and then polls
the registry until the new version is readable — `0.2.0` once shipped a
changelog entry and a README badge for a version the registry never received.

## The parity gate

```bash
pnpm parity
```

It serves `examples/parity/index.html` on localhost, opens it in your default
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
| A deliberate one-frame slip on each path fails this gate | The geometric fault: the crowd is decoded one baked frame late, so the silhouette lands in the wrong place. One frame is the smallest slip a decode can make, so a gate that catches it catches anything coarser. |
| A deliberate wrong-normal decode on each path fails this gate | The shading-only fault, and the one that matters: every baked normal's x is negated, so the silhouette stays pixel-exact and only the lighting inside it is wrong. That is the shape of the bug a VAT is most likely to have on one path alone — a normal texture is half of what a VAT ships, and lighting is the whole reason it ships one ([ADR-0002](./adr/0002-runtime-texture-encoding.md)) — and it is the first thing a loose tolerance stops seeing. Together, these four are the run's proof that its own tolerance still has teeth: a tolerance wide enough to pass a broken decode passes a correct one too, and looks identical doing it. |

**When it fails.** Read the checks top to bottom and stop at the first failure —
they are ordered so that an earlier one explains a later one. A failure of the
last four means the *tolerance* is wrong, not the decode: reconsider
`PARITY_TOLERANCE` in `examples/src/parity/compare.ts`. A failure of the fourth,
with the first three green, is the one this gate exists for — a real divergence
between the GLSL and TSL decodes. Do not publish.

**Why there is no Playwright.** The spec (#1, Seam 3) named it; this does the job
with a Vite dev server and `open`. The only thing a driver has to do here is hand
a localhost URL to a browser with a real GPU and collect what it posts back, and
the machine running a release already has such a browser configured as its
default — where a headless Chromium, the thing Playwright is for, is the one
browser whose WebGPU support this gate cannot rely on. So the dependency would
have bought a worse browser and a browser-download step in every clone. If this
ever needs to run unattended, that is the point to reach for it.

**How it is built.** The part that needs a GPU renders frames and nothing else
(`webgl-frame.ts`, `tsl-frame.ts` — deliberate near-copies, for the reason in
[ADR-0011](./adr/0011-one-example-per-renderer-duplicated-on-purpose.md)); the
part that decides what the frames mean is pure and runs in CI with the rest of
the suite (`compare.ts`, `verdict.ts`, and their tests). That split is what lets
a gate CI cannot run still be trusted to work when a human runs it.
