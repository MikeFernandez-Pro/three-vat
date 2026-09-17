// `navigator.gpu` is not in TypeScript's DOM lib, and @webgpu/types is a big
// dependency to add for one property the demo only ever tests for existence.
// Declared exactly as the spec has it — optional, because a browser without
// WebGPU and a page outside a secure context both simply do not have it, which
// is the whole subject of support.ts. The shape itself lives there, so there is
// one of it.
import type { GPUEntryPoint } from './support.js'

declare global {
  interface Navigator {
    readonly gpu?: GPUEntryPoint
  }
}
