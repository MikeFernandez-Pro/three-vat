// The release suite is mostly browser code — the parity gate renders on a real
// GPU — so `types` is `vite/client`, not Node's whole surface. The packaging
// checks are the exception: they read the tree as text. Declare the sliver of
// Node they need rather than letting the gate's page code reach for `fs` by
// accident. The library does the same thing for the same reason
// (src/node-shims.d.ts).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string): string[]
  export function existsSync(path: string): boolean
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function resolve(...segments: string[]): string
}
