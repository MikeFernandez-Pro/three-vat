// `pnpm parity` — the cross-path pixel-diff release gate (#14), driven from a
// terminal so it can have an exit code.
//
// It serves release/parity/index.html on localhost, opens it in a browser, and
// waits for the page to post its verdict back. That shape — a real browser on
// the developer's own machine rather than a headless one in CI — is the whole
// point: the gate compares a GLSL decode on a real GPU against a WGSL decode on
// the same real GPU, and headless WebGPU is not a dependable target. localhost
// is a secure context, so `navigator.gpu` is exposed without a certificate.
//
// No browser-automation dependency, on purpose. The one thing a driver has to do
// is hand a URL to a browser that has a GPU, and the machine running this
// already has one configured as its default. `--no-open` prints the URL instead,
// for a machine where the default browser is not the one with WebGPU.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const args = new Set(process.argv.slice(2));
const flag = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = [...args].find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
};

const TIMEOUT_MS = Number(flag("timeout", 180_000));
const OPEN = !args.has("--no-open");
const BROWSER = flag("browser", null);
// `release/`, so the page is served at `/parity/` and the demo's `public/` —
// which vite.config.ts points at — is served at the root beside it.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Resolved by the middleware below, the first time the page posts a verdict. */
let deliver;
const verdict = new Promise((resolve) => {
  deliver = resolve;
});

const server = await createServer({
  root: ROOT,
  // Quiet: the gate's output is the verdict, not a dev-server banner.
  logLevel: "warn",
  server: { port: 0, strictPort: false },
  plugins: [
    {
      name: "parity-result",
      // Registered inside `configureServer` so it runs *before* vite's own
      // middlewares, which would otherwise answer this POST with the SPA
      // fallback and swallow the verdict.
      configureServer(vite) {
        vite.middlewares.use("/__parity/result", (req, res) => {
          const chunks = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => {
            res.statusCode = 204;
            res.end();
            try {
              deliver(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch (error) {
              deliver({ pass: false, checks: [{ name: "the page reported a readable verdict", pass: false, detail: String(error) }] });
            }
          });
        });
      },
    },
  ],
});

await server.listen();
const url = `${server.resolvedUrls.local[0]}parity/`;

console.log(`\n  three-vat — cross-path parity gate\n  ${url}\n`);
if (OPEN) {
  openInBrowser(url);
  console.log("  Waiting for the browser to finish rendering both paths…\n");
} else {
  console.log("  Open that in a browser with WebGPU. Waiting for its verdict…\n");
}

const timeout = new Promise((resolve) =>
  setTimeout(
    () => resolve({ pass: false, checks: [{ name: "the browser reported back in time", pass: false, detail: `nothing posted to ${url} within ${TIMEOUT_MS / 1000}s — is the page open, and does that browser have WebGPU?` }] }),
    TIMEOUT_MS,
  ).unref?.(),
);

const result = await Promise.race([verdict, timeout]);
await server.close();

for (const check of result.checks ?? []) {
  console.log(`  ${check.pass ? "PASS" : "FAIL"}  ${check.name}`);
  console.log(`        ${check.detail}`);
}
console.log(`\n  ${result.pass ? "PASS — the two decode paths agree" : "FAIL — the gate is not satisfied"}\n`);
if (result.userAgent) console.log(`  ${result.userAgent}\n`);

process.exit(result.pass ? 0 : 1);

/** Hand the URL to whatever this OS considers a browser. */
function openInBrowser(target) {
  const [command, ...rest] = BROWSER
    ? BROWSER.split(" ")
    : process.platform === "darwin"
      ? ["open"]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", ""]
        : ["xdg-open"];
  spawn(command, [...rest, target], { stdio: "ignore", detached: true }).unref();
}
