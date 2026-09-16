// The library is deliberately runtime-agnostic: tsconfig sets `types: []` and
// @types/node is not a dependency. Only the real-asset integration test touches
// the filesystem, so declare the sliver of node:fs it needs rather than pulling
// in Node's full type surface (which would let src/ reach for Node APIs by
// accident, and the baker must keep running in the browser).
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string): Uint8Array
}
