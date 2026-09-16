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
