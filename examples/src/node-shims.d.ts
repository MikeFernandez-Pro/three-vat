// The demo is browser code; `types` is `vite/client`, not Node's whole surface.
// Only the bundle-shape test reads the tree as text, so declare the sliver of
// Node it needs rather than letting page code reach for `fs` by accident. The
// library does the same thing for the same reason (src/node-shims.d.ts).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function readdirSync(path: string): string[]
}

declare module 'node:path' {
  export function dirname(path: string): string
  export function resolve(...segments: string[]): string
}
