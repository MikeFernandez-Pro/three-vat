// Where the release suite reaches, and in which direction.
//
// Absolute and anchored to this file rather than to the working directory: these
// are release checks, run by the library's own vitest project from the
// repository root — one package above the demo folder they read.
//
// The direction is the point. The release suite imports the demo's build;
// nothing in the demo imports this folder (ADR-0011, as amended). Giving that
// reach one home is what makes it a rule rather than a path spelled out again
// wherever it happens to be needed.
import { fileURLToPath } from 'node:url'

/** A path inside the release folder — this one. */
export const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

/** A path inside the demo package, which the release suite reads and never writes. */
export const demo = (path: string) => fileURLToPath(new URL(`../examples/${path}`, import.meta.url))
