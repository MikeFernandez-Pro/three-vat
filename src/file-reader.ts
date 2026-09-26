// The one browser API three's `GLTFExporter` reaches for that Node lacks
// (ADR-0034): it reads its merged `Blob` back through a `FileReader` to build
// the `.glb`. Installed by the `bin` before the command runs, and by the tests
// that write a baked file in process; never from a page-facing entry point,
// where the browser's own is always there.

/** Give Node a `FileReader` good for the exporter's one use of it, unless it already has one. */
export function installFileReader(): void {
  const scope = globalThis as { FileReader?: unknown }
  if (scope.FileReader !== undefined) return
  scope.FileReader = class {
    result: ArrayBuffer | null = null
    onloadend: (() => void) | null = null
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
  }
}
