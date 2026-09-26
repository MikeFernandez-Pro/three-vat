// The library is deliberately runtime-agnostic: tsconfig sets `types: []` and
// @types/node is not a dependency. Only the real-asset integration test and the
// bake command's `bin` touch the filesystem, so declare the sliver of node:fs
// they need rather than pulling in Node's full type surface (which would let
// src/ reach for Node APIs by accident, and the baker must keep running in the
// browser).
declare module 'node:fs' {
  export function existsSync(path: string): boolean
  export function readFileSync(path: string): Uint8Array
  export function readFileSync(path: string, encoding: 'utf8'): string
}

// Read by the subpath-isolation test, which walks src/ as text to prove what a
// consumer's bundle would pull in (ADR-0005).
declare module 'node:path' {
  export function dirname(path: string): string
  export function resolve(...segments: string[]): string
}

declare module 'node:process' {
  export const env: Record<string, string | undefined>
  // The bake command's `bin` (src/bin.ts), the one module in src/ that runs
  // only in Node: it hands the command the process's arguments, directory and
  // streams, and sets the exit code.
  export const argv: string[]
  export function cwd(): string
  export const stdout: { write(text: string): boolean }
  export const stderr: { write(text: string): boolean }
  const process: { exitCode?: number }
  export default process
}
