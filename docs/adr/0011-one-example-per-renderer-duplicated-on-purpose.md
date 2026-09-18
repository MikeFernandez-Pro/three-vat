# One example per renderer, duplicated on purpose

The demo app ships two entry points for the same crowd —
`examples/webgl_crowd.html` and `examples/webgpu_crowd.html` — in one Vite
multi-page app with auto-globbed HTML entries, plus a landing `index.html`.
Renderer setup, materials and VAT wiring are **duplicated between them**. Only
renderer-agnostic code is shared: crowd layout, GUI defaults, asset loading.

This follows the ecosystem, which was checked rather than guessed:

- **three.js** has **81 demos existing as both `webgl_X.html` and
  `webgpu_X.html`** — duplicated files, each fully self-contained, with no
  shared scene harness anywhere in `examples/`. The prefix is load-bearing:
  `examples/files.json` keys the gallery by it, and `test/e2e/puppeteer.js`
  filters the WebGPU run with `f.includes('webgpu_')`.
- **three-mesh-bvh** — the closest analogue, a small single-purpose library with
  both decode paths — uses the same convention inside one Vite app whose entries
  are discovered by `readdirSync('./example/').filter(/\.html$/)`, sharing
  renderer-agnostic utils and duplicating backend-specific material modules
  under a `Node` suffix.
- **drei** is the one runtime-toggle precedent, and only because every story
  already routes through a shared `<Setup>` that constructs the renderer for it.
- **Two separate example apps**: found in no repository checked.

A runtime toggle is additionally ruled out here by ADR-0005: one bundle would
have to import both `three-vat/webgl` and `three-vat/tsl`, dragging the
node-material system into the WebGL build — the exact mistake the subpath split
exists to prevent shipping to users.

## Why duplication is the feature, not the compromise

The example's job is to show a reader what *their* code looks like on each path.
An abstraction that parameterizes the renderer away hides the one thing they
came to read. There is also a self-serving benefit: if `createVATMesh`
(ADR-0009) genuinely achieved parity, the two pages' VAT sections will read
near-identically *without* a shared module forcing them to. That resemblance is
evidence. A shared harness would manufacture it and prove nothing.

## Consequences

- `examples/vite.config.ts` globs `*.html` entries, so a third demo needs no
  config change.
- `examples/src/main.ts` splits: layout (`crowd.ts`), GUI defaults and asset
  loading stay shared; scene, lights, materials and VAT wiring are per-page.
- `examples/` becomes a real workspace package (`pnpm-workspace.yaml`) with its
  own vitest project. `src/crowd-layout.test.ts` moves to `examples/src/` — the
  library's suite reaching into the demo is a layering inversion.
- The app deploys to GitHub Pages from `main`, so the README can link a live
  crowd. For a library whose pitch is "one draw call, thousands of characters",
  that link is the highest-leverage adoption asset available.

## Amendment (ADR-0012, ADR-0013)

The decision above stands: one page per renderer, duplicated on purpose, in one
Vite app. Three of its consequences are revised.

- **The demo folder holds the demo and nothing else.** When this ADR was
  written, `examples/` also became the home of the parity gate
  (`examples/parity/` plus `examples/src/parity/*` — nine files) and of the
  packaging and deployment tests (`bundles.test.ts`, `pages.test.ts`,
  `deploy.test.ts`). Those assert things about the *release*, not about the
  demo, and a stranger opening the folder to learn how to use the library meets
  a build-integrity suite instead. They move out and import the demo's build
  where they need it: a release gate reaching into the demo is correct layering;
  a demo containing the release gate is not. Their new home is `release/`, which
  belongs to the root package rather than being a third workspace package —
  cutting a release is that package's job, so `pnpm test` and `pnpm parity` reach
  them directly instead of forwarding into another package.
- **There is no landing page.** `examples/index.html` existed to offer a choice
  between the two demos, but the choice is "which renderer", which most visitors
  cannot answer and should not have to. The GitHub Pages root is the WebGL
  demo — the one that works everywhere today — with a visible link to the
  WebGPU page for those who care. The `*.html` globbing is unaffected.
- **The pages' content is set by ADR-0012**, which replaces the fixed three-zone
  crowd with a single count slider. The duplication argument is untouched: both
  pages still show the reader what *their* code looks like on each path, and
  their VAT sections still resemble each other without a shared module forcing
  it.
